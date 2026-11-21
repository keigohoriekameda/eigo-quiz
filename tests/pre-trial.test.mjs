import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../pre-trial/catalog.mjs';
import { createTrialServer } from '../pre-trial/server.mjs';
import { openTrialStore } from '../pre-trial/store.mjs';
import { readyForEditorialApproval, validVocabularyContext } from '../src/vocabulary-prompt.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = resolve(tmpdir());
const example = {
  id: 'PRE-L1-001', stage: 'PRE', level: 1, unit: 1,
  lemma: 'apple', unit_type: 'word', part_of_speech: 'noun', meaning_ja: 'りんご',
  context_en: '', prompt_type: 'meaning_4choice', distractors_ja: ['もも','ぶどう','みかん'],
  explanation_ja: 'りんごのこと。', source_tag: 'test', review_status: 'approved', quality_flags: [],
};

test('blank context is allowed only for direct Pre word prompts, and approval checks remain strict', () => {
  assert.ok(readyForEditorialApproval(example));
  assert.ok(!validVocabularyContext({ ...example, context_en: undefined }));
  assert.ok(!validVocabularyContext({ ...example, unit_type: 'phrase' }));
  assert.ok(!validVocabularyContext({ ...example, stage: 'MAIN' }));
  assert.ok(!validVocabularyContext({ ...example, prompt_type: 'meaning_in_context_4choice' }));
  assert.ok(!validVocabularyContext({ ...example, prompt_type: 'phrase_meaning_4choice', context_en: ' ' }));
  assert.ok(validVocabularyContext({ ...example, prompt_type: 'phrase_meaning_4choice', context_en: 'since Monday' }));
  assert.ok(!readyForEditorialApproval({ ...example, part_of_speech: 'unspecified' }));
  assert.ok(!readyForEditorialApproval({ ...example, quality_flags: ['unresolved'] }));
});

const accounts = [
  { id: 'teacher-1', name: '確認担当', role: 'teacher', code: 'test-only-teacher-code-001' },
  { id: 'student-a', name: '試用A', role: 'student', code: 'test-only-student-code-001' },
  { id: 'student-b', name: '試用B', role: 'student', code: 'test-only-student-code-002' },
];

async function fixture(t) {
  const folder = await mkdtemp(join(temp, 'pre-trial-test-'));
  t.after(async () => {
    if (dirname(resolve(folder)) === temp && basename(folder).startsWith('pre-trial-test-')) {
      await rm(folder, { recursive: true, force: true });
    }
  });
  await mkdir(join(folder, 'data'));
  for (let i = 1; i <= 7; i++) {
    const rel = 'data/pre-lv' + i + '-draft.json';
    await copyFile(join(root, rel), join(folder, rel));
  }
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Trial Test', '-c', 'user.email=trial@example.test',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + join(folder,'no-hooks'), ...args], {
    cwd: folder, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true,
  }).trim();
  git('init', '--quiet');
  git('add', 'data');
  git('commit', '--quiet', '-m', 'Fixture course');
  return { folder, git, commit: git('rev-parse', 'HEAD'), stateFile: join(folder, 'state.json') };
}

async function start(catalog, stateFile) {
  const server = await createTrialServer({ catalog, accounts, store: await openTrialStore(stateFile) });
  function dispatch(path, token, input, method = input === undefined ? 'GET' : 'POST') {
    const request = Readable.from(input === undefined ? [] : [Buffer.from(JSON.stringify(input))]);
    request.url = path;
    request.method = method;
    request.headers = token ? { authorization: 'Bearer ' + token } : {};
    if (input !== undefined) request.headers['content-type'] = 'application/json';
    return new Promise(resolve => {
      let status, headers;
      const response = {
        writeHead(code, responseHeaders) { status = code; headers = responseHeaders; },
        end(raw) { resolve(new Response(raw, { status, headers })); },
      };
      server.emit('request', request, response);
    });
  }
  return {
    dispatch,
    async send(path, token, input, expected = 200) {
      const response = await dispatch(path, token, input);
      const isJson = response.headers.get('content-type')?.includes('application/json');
      const data = isJson ? await response.json() : await response.text();
      assert.equal(response.status, expected, path + ' ' + JSON.stringify(data).slice(0,120));
      return data;
    },
  };
}

const logIn = async ({ send }, i) => {
  const { role, code } = accounts[i];
  return (await send('/api/login', null, { role, code })).token;
};
const studentPath = (unit, operation) => '/api/student/units/' + unit + '/' + operation;
const submit = ({ send }, token, unit, attempt, choice, expected) =>
  send(studentPath(unit, 'answer'), token, { attempt: attempt.id, question: attempt.question.id, choice }, expected);

test('the teacher can review all 700 and approve eligible units without exposing draft or answers to students', async t => {
  const { folder, git, commit, stateFile } = await fixture(t);
  const catalog = loadCatalog(folder, commit);
  assert.equal(catalog.units.size, 35);
  assert.equal([...catalog.units.values()].flatMap(u => u.questions).filter(q => q.context_en === '').length, 441);
  const app = await start(catalog, stateFile);

  assert.match(await app.send('/teacher'), /利用コード|id="app"/);
  assert.match(await app.send('/student'), /id="page-title"/);
  await app.send('/data/pre-lv1-draft.json', null, undefined, 404);
  await app.send('/pre-lv1-preview.html', null, undefined, 404);
  await app.send('/api/teacher/units', null, undefined, 401);
  await app.send('/api/student/units', null, undefined, 401);
  await app.send('/api/login', null, { role: 'teacher', code: accounts[1].code }, 401);

  const teacher = await logIn(app, 0);
  const student = await logIn(app, 1);
  await app.send('/api/teacher/units/1-1', student, undefined, 403);
  await app.send('/api/teacher/units/1-1/approve', student, { commit, reviewed: true }, 403);
  await app.send('/api/student/units', teacher, undefined, 403);
  assert.equal((await app.send('/api/student/units', student)).units.filter(unit => unit.available).length, 0);
  await app.send(studentPath('1-1','start'), student, { mode: 'normal' }, 403);
  await app.send(studentPath('1-1','answer'), student, {}, 403);

  let reviewed=0;
  for (const unit of (await app.send('/api/teacher/units', teacher)).units) {
    const detail = await app.send('/api/teacher/units/' + unit.id, teacher);
    assert.equal(detail.commit, commit);
    assert.equal(detail.questions.length, 20);
    assert.deepEqual(detail.blockers, []);
    for (const q of detail.questions) {
      reviewed++;
      assert.ok(q.id && q.lemma && typeof q.example === 'string' && q.explanation);
      assert.equal(q.choices.length, 4);
      assert.ok(q.choices.includes(q.answer));
    }
  }
  assert.equal(reviewed,700);
  await app.send('/api/teacher/units/1-1/approve', teacher, { commit: '0'.repeat(40), reviewed: true }, 409);
  await app.send('/api/teacher/units/1-1/approve', teacher, { commit, reviewed: false }, 400);
  const approved = (await app.send('/api/teacher/units/1-1/approve', teacher, { commit, reviewed: true })).approval;
  assert.equal(approved.byId, 'teacher-1');
  assert.equal(approved.by, '確認担当');
  assert.equal(approved.commit, commit);
  assert.equal(approved.at, new Date(approved.at).toISOString());
  assert.deepEqual((await app.send('/api/teacher/units/1-1/approve', teacher, { commit, reviewed:true })).approval, approved);
  await app.send(studentPath('1-1','answer'), student, {}, 409);

  const attempt = await app.send(studentPath('1-1','start'), student, { mode:'normal' });
  assert.equal(attempt.total, 20);
  assert.equal(attempt.question.choices.length, 4);
  assert.ok(!('answer' in attempt.question) && !('explanation' in attempt.question));
  await app.send(studentPath('1-2','start'), student, { mode: 'normal' }, 403);

  git('commit', '--quiet', '--allow-empty', '-m', 'New edition');
  const newApp = await start(loadCatalog(folder, git('rev-parse','HEAD')), stateFile);
  const newLogin = await logIn(newApp, 1);
  assert.equal((await newApp.send('/api/student/units', newLogin)).units.some(u => u.available), false);
});

test('reloading and server restarts preserve progress for the same student and isolate a shared browser', async t => {
  const { folder, commit, stateFile } = await fixture(t);
  const catalog = loadCatalog(folder, commit);
  let app = await start(catalog, stateFile);
  const teacher = await logIn(app, 0);
  const unit = '5-5';
  await app.send('/api/teacher/units/' + unit + '/approve', teacher, { commit, reviewed: true });

  let a = await logIn(app, 1);
  const b = await logIn(app, 2);
  let attempt = await app.send(studentPath(unit,'start'), a, { mode:'normal' });
  const original = catalog.units.get(unit);
  const correct = question => original.byId.get(question.id).meaning_ja;
  const first = attempt;
  const wrongChoice = attempt.question.choices.find(x => x !== correct(attempt.question));
  let answer = await submit(app, a, unit, attempt, wrongChoice);
  assert.equal(answer.feedback.correct, false);
  assert.deepEqual(await submit(app, a, unit, first, wrongChoice), answer);
  await submit(app, a, unit, first, correct(first.question), 409);
  await submit(app, b, unit, first, wrongChoice, 409);

  const resumeFrom = answer.next;
  await app.send('/api/logout', a, {});
  await app.send('/api/student/units', a, undefined, 401);
  app = await start(catalog, stateFile);
  a = await logIn(app, 1);
  assert.deepEqual(await app.send(studentPath(unit,'start'), a, { mode:'normal' }), resumeFrom);
  attempt = resumeFrom;
  let phrases = 0;
  function checkPhrase(prompt) {
    if (['PRE-L5-097','PRE-L5-099'].includes(prompt.id)) {
      assert.equal(prompt.heading, original.byId.get(prompt.id).context_en);
      assert.equal(prompt.example, '');
      phrases++;
    }
  }
  checkPhrase(first.question);
  do {
    checkPhrase(attempt.question);
    const right = correct(attempt.question);
    const choice = attempt.position === 1 ? attempt.question.choices.find(x => x !== right) : right;
    answer = await submit(app, a, unit, attempt, choice);
    attempt = answer.next;
  } while (!attempt.result);
  assert.equal(phrases, 2);
  assert.equal(attempt.result.correct, 18);
  assert.equal(attempt.result.passed, true);
  assert.equal(attempt.result.misses.length, 2);
  const review = await app.send(studentPath(unit,'start'), a, { mode:'review' });
  assert.equal(review.total, 2);
  answer = await submit(app, a, unit, review, correct(review.question));
  answer = await submit(app, a, unit, answer.next, correct(answer.next.question));
  assert.equal(answer.next.result.passed, false);
  assert.equal(answer.next.result.correct, 2);
  const dashboard = token => app.send('/api/student/units', token).then(data => data.units.find(x => x.id === unit));
  assert.deepEqual((({ passed, score, misses, activeMode }) => ({ passed, score, misses, activeMode }))(await dashboard(a)),
    { passed:true, score:18, misses:0, activeMode:null });
  await app.send(studentPath(unit,'start'), a, { mode:'review' }, 409);
  const other = await dashboard(await logIn(app, 2));
  assert.equal(other.passed, false);
  assert.equal(other.score, null);
  assert.equal(other.misses, 0);
  assert.equal(other.activeMode, null);
});

test('a missing phrase context or unresolved quality flag cannot be approved', async t => {
  const { folder, git, stateFile } = await fixture(t);
  const rel = 'data/pre-lv5-draft.json';
  const rows = JSON.parse(await readFile(join(folder,rel),'utf8'));
  const q = rows.find(x => x.id === 'PRE-L5-097');
  q.quality_flags = ['unresolved'];
  await writeFile(join(folder,rel), JSON.stringify(rows));
  git('add', rel);
  git('commit', '--quiet', '-m', 'Flag a question');
  const catalog = loadCatalog(folder, git('rev-parse','HEAD'));
  const app = await start(catalog, stateFile);
  const teacher = await logIn(app, 0);
  assert.deepEqual((await app.send('/api/teacher/units/5-5', teacher)).blockers, ['PRE-L5-097']);
  await app.send('/api/teacher/units/5-5/approve', teacher, { commit:catalog.commit, reviewed:true },409);

  q.context_en = '';
  await writeFile(join(folder,rel), JSON.stringify(rows));
  git('add', rel);
  git('commit', '--quiet', '-m', 'Remove required context');
  assert.throws(() => loadCatalog(folder,git('rev-parse','HEAD')), /PRE-L5-097: missing or invalid context_en/);
});

class Element {
  childNodes = [];
  events = new Map();
  attributes = new Map();
  hidden = false;
  classList = { add() {} };
  constructor(tag, text = '') { this.tag = tag; this.text = text; }
  get children() { return this.childNodes; }
  get textContent() { return this.text + this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) { this.text = value; this.childNodes = []; }
  get value() { return this.selected ?? this.querySelector('option')?.value ?? ''; }
  set value(value) { this.selected = value; }
  append(...values) { this.childNodes.push(...values); }
  prepend(...values) { this.childNodes.unshift(...values); }
  replaceChildren(...values) { this.childNodes = values; this.text = ''; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key); }
  focus() {}
  addEventListener(type, handler) { this.events.set(type, handler); }
  fire(type) { this.events.get(type)?.({ preventDefault() {} }); }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.childNodes) {
      const match = child.find(predicate);
      if (match) return match;
    }
  }
  querySelector(tag) { return this.find(node => node.tag === tag); }
}

async function browserModel(app, route) {
  const ids = new Map(['app','status','account','logout','page-title'].map(id => [id, new Element('div')]));
  const container = ids.get('app');
  const source = await readFile(join(root, 'pre-trial/web/trial.js'), 'utf8');
  const document = {
    getElementById: id => ids.get(id),
    createElement: tag => new Element(tag),
    createTextNode: value => new Element('#text', value),
  };
  vm.runInNewContext(source, {
    document, location: { pathname: route }, window: new Element('window'),
    fetch: (url, options) => app.dispatch(url, options.headers.Authorization?.slice(7),
      options.body === undefined ? undefined : JSON.parse(options.body), options.method),
  });
  const settle = async () => {
    for (let i = 0; i < 1000 && container.getAttribute('aria-busy') === 'true'; i++) {
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    assert.equal(container.getAttribute('aria-busy'), 'false', 'UI did not settle');
    assert.equal(ids.get('status').textContent, '');
  };
  return {
    container,
    async signIn(i) {
      container.find(node => node.id === 'access-code').value = accounts[i].code;
      container.querySelector('form').fire('submit');
      await settle();
      assert.equal(ids.get('account').textContent, accounts[i].name);
    },
    findButton: text => container.find(node => node.tag === 'button' && node.textContent === text),
    async click(text) {
      const target = container.find(node => node.tag === 'button' && node.textContent === text);
      assert.ok(target && !target.disabled, text);
      target.fire('click');
      await settle();
    },
    signOut() { ids.get('logout').fire('click'); },
  };
}

test('the approval and lesson views work together from login through resume and student switching', async t => {
  const { folder, commit, stateFile } = await fixture(t);
  const app = await start(loadCatalog(folder, commit), stateFile);
  const teacher = await browserModel(app, '/teacher');
  await teacher.signIn(0);
  assert.match(teacher.container.textContent, /PRE-L1-001/);
  assert.match(teacher.container.textContent, /20問/);
  assert.ok(teacher.findButton('この単元を承認').disabled);

  const student = await browserModel(app, '/student');
  await student.signIn(1);
  assert.equal(student.findButton('練習する'), undefined);
  const confirmation = teacher.container.find(node => node.id === 'unit-reviewed');
  confirmation.checked = true;
  confirmation.fire('change');
  // The success announcement is set after the newly approved unit is rendered.
  teacher.findButton('この単元を承認').fire('click');
  for (let i=0; i<1000 && teacher.container.getAttribute('aria-busy')==='true';i++) {
    await new Promise(resolve=>setTimeout(resolve,2));
  }
  assert.match(teacher.container.textContent, /承認済み　確認担当/);
  assert.equal(teacher.findButton('この単元を承認'), undefined);

  student.signOut();
  await student.signIn(1);
  await student.click('練習する');
  assert.match(student.container.textContent, /練習　1 \/ 20/);
  const choice = student.container.find(node => node.className==='choices').children[0];
  await student.click(choice.textContent);
  assert.ok(student.findButton('次の問題へ'));

  const afterReload = await browserModel(app, '/student');
  assert.match(afterReload.container.textContent,/利用コード/);
  await afterReload.signIn(1);
  await afterReload.click('途中から再開');
  assert.match(afterReload.container.textContent,/練習　2 \/ 20/);
  afterReload.signOut();
  assert.match(afterReload.container.textContent,/利用コード/);
  await afterReload.signIn(2);
  assert.equal(afterReload.findButton('途中から再開'), undefined);
  assert.ok(afterReload.findButton('練習する'));
});

test('the trial service rejects production mode', async () => {
  const saved = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    await assert.rejects(createTrialServer({}), /本番モードで起動できません/);
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved;
  }
});
