import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createPreviewApp } from '../pre-trial/web-app.mjs';

const env = {
  VERCEL_ENV: 'preview', NEXT_PUBLIC_SUPABASE_URL: 'https://trial.example.test',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test',
  AUTH_INTERNAL_EMAIL_DOMAIN: 'students.example.test', PRE_SKYLINE_PRODUCT_CODE: 'eigo-pre-pilot',
};
const commit = 'a'.repeat(40);
const students = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
const admin = '00000000-0000-4000-8000-000000000003';
const testPassword = 'test password only';
const fixtureKeys = {
  eigo_pre_progress: ['curriculum_commit', 'learner_id', 'unit_key'],
  eigo_pre_approvals: ['curriculum_commit', 'unit_key'],
  eigo_pre_sessions: ['token_hash'],
};

function mockSupabase() {
  const data = {
    profiles: students.map((id, i) => ({ id, login_id: 'student-' + i, display_name: 'Student ' + i, is_active: true })),
    admin_users: [{ id: admin, display_name: 'Teacher', is_active: true }],
    products: [{ product_code: env.PRE_SKYLINE_PRODUCT_CODE, is_active: true }],
    user_product_access: students.map(user_id => ({
      user_id, product_id: env.PRE_SKYLINE_PRODUCT_CODE, is_active: true, expires_at: null,
    })),
    eigo_pre_sessions: [], eigo_pre_progress: [], eigo_pre_approvals: [],
  };
  let conflicts = 0;
  return {
    data,
    conflicts: () => conflicts,
    async fetcher(url, options) {
      assert.equal(url.origin, env.NEXT_PUBLIC_SUPABASE_URL);
      const body = options.body && JSON.parse(options.body);
      if (url.pathname === '/auth/v1/token') {
        assert.equal(options.headers.apikey, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
        assert.equal(options.method, 'POST');
        assert.equal(url.searchParams.get('grant_type'), 'password');
        const index = ['student-0@students.example.test', 'student-1@students.example.test', 'teacher@example.test'].indexOf(body.email);
        if (index < 0 || body.password !== testPassword) return Response.json({}, { status: 400 });
        return Response.json({ user: { id: [...students, admin][index] }, access_token: 'upstream-token-never-sent' });
      }
      assert.equal(options.headers.apikey, env.SUPABASE_SECRET_KEY);
      const table = url.pathname.split('/').at(-1);
      const rows = data[table];
      assert.ok(rows, 'unexpected table ' + table);
      const matches = row => [...url.searchParams].every(([key, value]) => {
        if (key === 'select') return true;
        if (value.startsWith('gt.')) return Date.parse(row[key]) > Date.parse(value.slice(3));
        assert.ok(value.startsWith('eq.'));
        return String(row[key]) === value.slice(3);
      });
      if (options.method === 'GET') return Response.json(rows.filter(matches));
      assert.ok(fixtureKeys[table], 'unexpected write to shared Skyline table');
      if (options.method === 'POST') {
        if (rows.some(row => fixtureKeys[table].every(key => row[key] === body[key]))) {
          assert.match(options.headers.prefer, /ignore-duplicates/);
          conflicts++;
          return Response.json([]);
        }
        rows.push(body);
        return options.headers.prefer ? Response.json([body]) : new Response(null, { status: 204 });
      }
      if (options.method === 'PATCH') {
        const affected = rows.filter(matches).map(row => Object.assign(row, body));
        if (affected.length === 0) conflicts++;
        return Response.json(affected);
      }
      assert.equal(options.method, 'DELETE');
      data[table] = rows.filter(row => !matches(row));
      return new Response(null, { status: 204 });
    },
  };
}

async function snapshot() {
  const levels = await Promise.all(Array.from({ length: 7 }, async (_, i) =>
    JSON.parse(await readFile(new URL('../data/pre-lv' + (i + 1) + '-draft.json', import.meta.url), 'utf8'))));
  return { commit, levels };
}

function client(handle) {
  return async function send(path, token, body, status = 200) {
    const headers = new Headers();
    if (token) headers.set('authorization', 'Bearer ' + token);
    if (body !== undefined) headers.set('content-type', 'application/json');
    const response = await handle(new Request('https://preview.example.test' + path, {
      headers, method: body === undefined ? 'GET' : 'POST', body: JSON.stringify(body),
    }));
    assert.equal(response.status, status, path);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.headers.get('content-type')?.includes('application/json') ? response.json() : response.text();
  };
}

const teacherRoute = '/api/teacher/units/';
const studentRoute = '/api/student/units/';
const logIn = (send, loginId, role = 'student', status) =>
  send('/api/login', null, { role, loginId, password: testPassword }, status);

test('Web Preview reuses Skyline login and revokes access without writing shared tables', async () => {
  const mock = mockSupabase();
  const source = await snapshot();
  const build = settings => createPreviewApp({ snapshot: source, env: settings, fetcher: mock.fetcher });
  await assert.rejects(build({ ...env, VERCEL_ENV: 'production' }), /Preview/);
  const send = client(await build(env));
  assert.match(await send('/student'), /data-auth="skyline"/);
  assert.match(await send('/teacher'), /data-auth="skyline"/);
  await send('/api/login', null, { role: 'student', code: 'local-code-is-unusable' }, 401);
  await logIn(send, 'teacher@example.test', 'student', 401);
  await logIn(send, 'student-0@students.example.test', 'teacher', 401);
  const { token, name } = await logIn(send, '  STUDENT-0 ');
  assert.equal(name, 'Student 0');
  assert.match(mock.data.eigo_pre_sessions[0].token_hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(mock.data).includes(token));
  assert.ok(!JSON.stringify(mock.data).includes(testPassword));
  await send(teacherRoute + '1-1', token, undefined, 403);

  mock.data.profiles[0].is_active = false;
  await send('/api/student/units', token, undefined, 401);
  mock.data.profiles[0].is_active = true;
  mock.data.user_product_access[0].expires_at = '2000-01-01T00:00:00Z';
  await logIn(send, 'student-0', 'student', 401);
  mock.data.user_product_access[0].expires_at = null;
  mock.data.products[0].is_active = false;
  await send('/api/student/units', token, undefined, 401);
  mock.data.products[0].is_active = true;
  const teacher = (await logIn(send, 'teacher@example.test', 'teacher')).token;
  mock.data.admin_users[0].is_active = false;
  await send(teacherRoute + '1-1/approve', teacher, { commit, reviewed: true }, 401);
  mock.data.eigo_pre_sessions[0].expires_at = '2000-01-01T00:00:00Z';
  await send('/api/student/units', token, undefined, 401);
});

test('mock Supabase preserves approvals and per-student progress across Preview instances and concurrent retries', async () => {
  const mock = mockSupabase();
  const source = await snapshot();
  const instance = async () => client(await createPreviewApp({ snapshot: source, env, fetcher: mock.fetcher }));
  const send = await instance();
  const teacher = (await logIn(send, 'teacher@example.test', 'teacher')).token;
  const student = (await logIn(send, 'student-0')).token;
  const other = (await logIn(send, 'student-1')).token;
  const review = { commit, reviewed: true };
  for (const unit of ['1-1', '1-2']) {
    assert.equal((await send(teacherRoute + unit, teacher)).questions.length, 20);
    await send(studentRoute + unit + '/start', student, { mode: 'normal' }, 403);
  }
  const approval = await send(teacherRoute + '1-1/approve', teacher, review);
  assert.equal(approval.approval.byId, admin);
  assert.deepEqual(await send(teacherRoute + '1-1/approve', teacher, review), approval);
  await send(teacherRoute + '1-3/approve', teacher, review, 404);
  await send(studentRoute + '1-2/start', student, { mode: 'normal' }, 403);
  await send(teacherRoute + '1-2/approve', teacher, review);

  const later = await instance();
  const start = studentRoute + '1-1/start';
  const submit = studentRoute + '1-1/answer';
  const normal = { mode: 'normal' };
  let [quiz, parallel] = await Promise.all([send(start, student, normal), later(start, student, normal)]);
  assert.deepEqual(quiz, parallel);
  const expected = q => source.levels[0].find(row => row.id === q.id).meaning_ja;
  const answer = (view, choice) => ({ attempt: view.id, question: view.question.id, choice });
  const first = answer(quiz, quiz.question.choices.find(value => value !== expected(quiz.question)));
  const [feedback, repeated] = await Promise.all([send(submit, student, first), later(submit, student, first)]);
  assert.deepEqual(feedback, repeated);
  assert.ok(mock.conflicts() >= 2);
  assert.equal(mock.data.eigo_pre_progress[0].state.attempt.answers.length, 1);
  await later(submit, other, first, 409);
  await send('/api/logout', student, {});
  await later('/api/student/units', student, undefined, 401);

  const returning = (await logIn(later, 'student-0')).token;
  quiz = await later(start, returning, normal);
  assert.deepEqual(quiz, feedback.next);
  for (let i = 1; i < 20; i++) {
    const correct = expected(quiz.question);
    const choice = i === 1 ? quiz.question.choices.find(value => value !== correct) : correct;
    quiz = (await later(submit, returning, answer(quiz, choice))).next;
  }
  assert.equal(quiz.result.correct, 18);
  assert.equal(quiz.result.passed, true);
  quiz = await later(start, returning, { mode: 'review' });
  assert.equal(quiz.total, 2);
  for (let i = 0; i < 2; i++) {
    quiz = (await later(submit, returning, answer(quiz, expected(quiz.question)))).next;
  }
  assert.equal(quiz.result.correct, 2);
  const history = mock.data.eigo_pre_progress[0].state.history;
  assert.deepEqual(history.map(({ mode, score, total }) => [mode, score, total]), [['normal', 18, 20], ['review', 2, 2]]);
  await later(start, returning, normal);
  assert.equal(mock.data.eigo_pre_progress[0].state.history.length, 2);
  const otherDashboard = await later('/api/student/units', other);
  assert.ok(otherDashboard.units.every(unit => unit.score === null && unit.misses === 0 && unit.activeMode === null));
});
