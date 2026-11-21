import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { completeAttempt, isFinished, makeAttempt, quizView } from './quiz.mjs';
import { edition, studentUnit, writableEdition, writableStudentUnit } from './store.mjs';

const assets = new Map([
  ['/teacher', ['index.html', 'text/html']],
  ['/student', ['index.html', 'text/html']],
  ['/trial.js', ['trial.js', 'text/javascript']],
  ['/trial.css', ['trial.css', 'text/css']],
]);
const headers = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
};

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireRequest(condition, status, message) {
  if (!condition) throw new RequestError(status, message);
}

const digest = code => createHash('sha256').update(code).digest('hex');
const credentialsError = 'この画面で使える利用コードを入力してください。';

function accountIndex(accounts) {
  if (!Array.isArray(accounts)) throw new Error('アカウント設定は配列で指定してください。');
  const byCode = new Map();
  const ids = new Set();
  const roles = new Set();
  for (const account of accounts) {
    const { id, name, role, code } = account ?? {};
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
        typeof name !== 'string' || !name.trim() || name.length > 80 ||
        typeof code !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(code) ||
        !['teacher', 'student'].includes(role) || ids.has(id) || byCode.has(digest(code))) {
      throw new Error('アカウント設定に無効な項目、またはID・利用コードの重複があります。');
    }
    ids.add(id);
    roles.add(role);
    byCode.set(digest(code), { id, name, role });
  }
  if (roles.size !== 2) throw new Error('教員と生徒のアカウントを設定してください。');
  return byCode;
}

async function body(req) {
  requireRequest(req.headers['content-type']?.split(';')[0] === 'application/json', 415, 'JSONを指定してください。');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    requireRequest(size <= 16384, 413, '入力が長すぎます。');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new RequestError(400, '入力の形式を確認してください。');
  }
}

function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(value));
}

const card = ({ id, level, unit, title }) => ({ id, level, unit, title });
const teacherQuestion = q => ({
  id: q.id, lemma: q.lemma, example: q.context_en,
  choices: [q.meaning_ja, ...q.distractors_ja], answer: q.meaning_ja, explanation: q.explanation_ja,
});

export async function createTrialServer({ catalog, accounts, store, tls }) {
  if (process.env.NODE_ENV === 'production') throw new Error('試用サーバーは本番モードで起動できません。');

  const accountByCode = accountIndex(accounts);
  const sessions = new Map();
  const { commit, units } = catalog;
  const staticFiles = new Map(await Promise.all([...assets].map(async ([url, [file, type]]) =>
    [url, [await readFile(new URL('./web/' + file, import.meta.url)), type]]
  )));
  const currentEdition = () => edition(store.read(), commit);

  function session(token, role) {
    const entry = sessions.get(token);
    if (entry && entry.expires <= Date.now()) sessions.delete(token);
    requireRequest(entry && entry.expires > Date.now(), 401, '利用コードを入力してください。');
    requireRequest(!role || entry.actor.role === role, 403, 'この画面を利用する権限がありません。');
    return entry.actor;
  }

  function unitById(id) {
    const unit = units.get(id);
    requireRequest(unit, 404, '単元が見つかりません。');
    return unit;
  }

  function requireApproved(data, id) {
    const approval = data.approvals[id];
    requireRequest(approval?.commit === commit, 403, 'この単元は教員の承認待ちです。');
  }

  async function router(req, res) {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const method = req.method;
    if (method === 'GET' && staticFiles.has(pathname)) {
      const [data, type] = staticFiles.get(pathname);
      res.writeHead(200, { 'content-type': type + '; charset=utf-8', ...headers });
      res.end(data);
      return;
    }

    if (method === 'POST' && pathname === '/api/login') {
      const { role, code } = await body(req);
      const actor = typeof code === 'string' && accountByCode.get(digest(code));
      requireRequest(actor && actor.role === role, 401, credentialsError);
      const now = Date.now();
      for (const [key, value] of sessions) if (value.expires <= now) sessions.delete(key);
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, { actor, expires: now + 4 * 60 * 60 * 1000 });
      return json(res, { token, name: actor.name, commit });
    }

    const token = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
    if (method === 'POST' && pathname === '/api/logout') {
      sessions.delete(token);
      return json(res, { ok: true });
    }

    if (method === 'GET' && pathname === '/api/teacher/units') {
      session(token, 'teacher');
      const data = currentEdition();
      return json(res, {
        commit, units: [...units.values()].map(unit => ({ ...card(unit), approval: data.approvals[unit.id] ?? null })),
      });
    }

    const teacherRoute = pathname.match(/^\/api\/teacher\/units\/([^/]+)(\/approve)?$/);
    if (teacherRoute) {
      const teacher = session(token, 'teacher');
      const unit = unitById(teacherRoute[1]);
      if (method === 'GET' && !teacherRoute[2]) {
        return json(res, {
          ...card(unit), commit, approval: currentEdition().approvals[unit.id] ?? null,
          blockers: unit.blockers, questions: unit.questions.map(teacherQuestion),
        });
      }
      if (method === 'POST' && teacherRoute[2]) {
        const input = await body(req);
        requireRequest(input.commit === commit, 409, '対象コミットが変わりました。画面を開き直してください。');
        requireRequest(input.reviewed === true, 400, '20問の確認を記録してください。');
        requireRequest(unit.blockers.length === 0, 409, '要確認フラグのある問題を解消してください。');
        const approval = await store.update(state => {
          const data = writableEdition(state, commit);
          return data.approvals[unit.id] ??= { commit, by: teacher.name, byId: teacher.id, at: new Date().toISOString() };
        });
        return json(res, { approval });
      }
    }

    if (method === 'GET' && pathname === '/api/student/units') {
      const student = session(token, 'student');
      const data = currentEdition();
      return json(res, {
        commit, units: [...units.values()].map(unit => {
          const progress = studentUnit(data, student.id, unit.id);
          return {
            ...card(unit), available: data.approvals[unit.id]?.commit === commit,
            passed: progress.passed, score: progress.score, misses: progress.misses.length,
            activeMode: progress.attempt && !isFinished(progress.attempt) ? progress.attempt.mode : null,
          };
        }),
      });
    }

    const studentRoute = pathname.match(/^\/api\/student\/units\/([^/]+)\/(start|answer)$/);
    if (method === 'POST' && studentRoute) {
      const student = session(token, 'student');
      const unit = unitById(studentRoute[1]);
      requireApproved(currentEdition(), unit.id);
      const input = await body(req);
      const response = await store.update(state => {
        const data = writableEdition(state, commit);
        requireApproved(data, unit.id);
        const progress = writableStudentUnit(data, student.id, unit.id);
        if (studentRoute[2] === 'start') {
          requireRequest(['normal', 'review'].includes(input.mode), 400, '出題形式を確認してください。');
          if (progress.attempt && !isFinished(progress.attempt)) {
            requireRequest(input.mode === progress.attempt.mode, 409, '途中の出題を再開してください。');
          } else {
            requireRequest(input.mode === 'normal' || progress.misses.length > 0, 409, '復習する問題はありません。');
            progress.attempt = makeAttempt(unit, input.mode, progress.misses);
          }
          return quizView(unit, progress.attempt);
        }

        const attempt = progress.attempt;
        requireRequest(attempt && attempt.id === input.attempt, 409, '単元の一覧からやり直してください。');
        const q = unit.byId.get(input.question);
        const existing = attempt.answers.find(answer => answer.question === input.question);
        const active = attempt.questions[attempt.answers.length];
        requireRequest(q && (existing || active?.id === q.id), 409, '出題中の問題を確認してください。');
        if (existing) {
          requireRequest(existing.selected === input.choice, 409, 'この問題の解答は記録済みです。');
        } else {
          requireRequest(active.choices.includes(input.choice), 400, '表示された選択肢を選んでください。');
          attempt.answers.push({ question: q.id, selected: input.choice, correct: input.choice === q.meaning_ja });
          completeAttempt(progress, attempt);
        }
        return {
          feedback: { correct: input.choice === q.meaning_ja, answer: q.meaning_ja, explanation: q.explanation_ja },
          next: quizView(unit, attempt),
        };
      });
      return json(res, response);
    }
    throw new RequestError(404, 'ページが見つかりません。');
  }

  const handler = (req, res) => router(req, res).catch(error => {
    if (error instanceof RequestError) return json(res, { error: error.message }, error.status);
    console.error(error.message);
    return json(res, { error: '処理に失敗しました。時間をおいてやり直してください。' }, 500);
  });
  return tls ? createSecureServer(tls, handler) : createServer(handler);
}
