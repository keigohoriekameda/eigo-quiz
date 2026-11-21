'use strict';

const role = location.pathname === '/teacher' ? 'teacher' : 'student';
const app = document.getElementById('app');
const status = document.getElementById('status');
const account = document.getElementById('account');
const logout = document.getElementById('logout');
const canceled = Symbol();
let session = null;
let generation = 0;
let busy = false;

document.getElementById('page-title').textContent = role === 'teacher' ? 'Pre 教員承認' : 'Pre 生徒試用';
document.title = '英単語2500マスター | ' + document.getElementById('page-title').textContent;

function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

function button(text, handler, secondary = false) {
  const b = node('button', text, secondary ? 'secondary' : undefined);
  b.type = 'button';
  b.addEventListener('click', handler);
  return b;
}

function focusTitle(title) {
  title.tabIndex = -1;
  title.focus();
}

async function request(path, payload) {
  const entered = generation;
  const headers = {};
  if (session) headers.Authorization = 'Bearer ' + session.token;
  if (payload !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch('/api' + path, {
    method: payload === undefined ? 'GET' : 'POST', headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = await r.json();
  if (entered !== generation) throw canceled;
  if (r.status === 401 && session) {
    showLogin();
    status.textContent = data.error;
    throw canceled;
  }
  if (!r.ok) throw new Error(data.error);
  return data;
}

async function run(action) {
  if (busy) return;
  const entered = generation;
  busy = true;
  app.setAttribute('aria-busy', 'true');
  status.textContent = '';
  try {
    await action();
  } catch (error) {
    if (entered === generation && error !== canceled) status.textContent = error.message;
  } finally {
    if (entered === generation) {
      busy = false;
      app.setAttribute('aria-busy', 'false');
    }
  }
}

function showLogin() {
  generation++;
  session = null;
  busy = false;
  account.textContent = '';
  logout.hidden = true;
  status.textContent = '';
  app.setAttribute('aria-busy', 'false');

  const form = node('form', undefined, 'panel login');
  form.autocomplete = 'off';
  const heading = node('h2', '利用コードで入る');
  const label = node('label', '利用コード');
  label.htmlFor = 'access-code';
  const input = node('input');
  input.id = 'access-code';
  input.type = 'password';
  input.autocomplete = 'off';
  input.required = true;
  input.maxLength = 128;
  input.spellcheck = false;
  const submit = node('button', role === 'teacher' ? '教員承認画面を開く' : '単元一覧を開く');
  submit.type = 'submit';
  const actions = node('div', undefined, 'actions');
  actions.append(submit);
  form.append(heading, label, input, actions);
  app.replaceChildren(form);
  form.addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      const signedIn = await request('/login', { role, code: input.value.trim() });
      input.value = '';
      session = signedIn;
      try {
        if (role === 'teacher') await showTeacher();
        else await showStudent();
      } catch (error) {
        if (error !== canceled) {
          showLogin();
          status.textContent = error.message;
        }
        throw canceled;
      }
      account.textContent = signedIn.name;
      logout.hidden = false;
    });
  });
}

logout.addEventListener('click', () => {
  const token = session?.token;
  showLogin();
  if (token) fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }).catch(() => {});
});
window.addEventListener('pagehide', showLogin);
window.addEventListener('pageshow', event => { if (event.persisted) showLogin(); });

function titleOf(unit) {
  return 'Lv.' + unit.level + ' 単元' + unit.unit + '　' + unit.title;
}

function commitText(commit) {
  const p = node('p', '教材コミット　', 'muted');
  p.append(node('code', commit));
  return p;
}

async function showTeacher(selected) {
  const data = await request('/teacher/units');
  const picker = node('select');
  picker.id = 'teacher-unit';
  for (let level = 1; level <= 7; level++) {
    const group = node('optgroup');
    group.label = 'Pre Lv.' + level;
    for (const unit of data.units.filter(item => item.level === level)) {
      const option = node('option', titleOf(unit) + (unit.approval ? '（承認済み）' : '（承認待ち）'));
      option.value = unit.id;
      group.append(option);
    }
    picker.append(group);
  }
  if (selected) picker.value = selected;
  const selection = node('section', undefined, 'panel');
  const label = node('label', '確認する単元');
  label.htmlFor = picker.id;
  selection.append(label, picker, commitText(data.commit));
  const detail = node('section');
  app.replaceChildren(selection, detail);

  async function renderSelection() {
    picker.disabled = true;
    try {
      const unit = await request('/teacher/units/' + picker.value);
      renderTeacherUnit(unit, detail);
    } finally {
      picker.disabled = false;
    }
  }
  picker.addEventListener('change', () => run(renderSelection));
  await renderSelection();
}

function renderTeacherUnit(unit, target) {
  const header = node('section', undefined, 'panel');
  header.append(node('h2', titleOf(unit)), node('p', unit.questions.length + '問'));
  if (unit.approval) {
    const approvedAt = new Date(unit.approval.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
    header.append(node('p', '承認済み　' + unit.approval.by + ' ／ ' + approvedAt + '（日本時間）', 'approved'), commitText(unit.approval.commit));
  } else {
    header.append(node('p', '承認待ち', 'muted'));
  }
  if (unit.blockers.length) header.append(node('p', '要確認の問題　' + unit.blockers.join('、')));

  const cards = unit.questions.map(q => {
    const card = node('article', undefined, 'panel');
    const word = node('span', q.lemma);
    word.lang = 'en';
    const heading = node('h3', q.id + '　');
    heading.append(word);
    const example = node('p', q.example || '例文なし', 'muted');
    if (q.example) example.lang = 'en';
    const choices = node('ol');
    for (const value of q.choices) choices.append(node('li', value, value === q.answer ? 'correct-answer' : undefined));
    card.append(heading, example, choices, node('p', '正答　' + q.answer, 'correct-answer'), node('p', '解説　' + q.explanation));
    return card;
  });
  target.replaceChildren(header, ...cards);
  if (!unit.approval && !unit.blockers.length) {
    const panel = node('section', undefined, 'panel');
    const confirmation = node('input');
    confirmation.type = 'checkbox';
    confirmation.id = 'unit-reviewed';
    const label = node('label');
    label.htmlFor = confirmation.id;
    label.append(confirmation, document.createTextNode('このコミットの20問を確認しました'));
    const approve = button('この単元を承認', () => run(async () => {
      await request('/teacher/units/' + unit.id + '/approve', { commit: unit.commit, reviewed: confirmation.checked });
      await showTeacher(unit.id);
      status.textContent = '単元を承認しました。';
    }));
    approve.disabled = true;
    confirmation.addEventListener('change', () => { approve.disabled = !confirmation.checked; });
    panel.append(label, approve);
    target.append(panel);
  }
}

async function showStudent() {
  const data = await request('/student/units');
  const top = node('section', undefined, 'panel');
  top.append(node('h2', '単元を選ぶ'), node('p', '試用できる単元 ' + data.units.filter(u => u.available).length + ' / 35'));
  app.replaceChildren(top);
  for (let level = 1; level <= 7; level++) {
    const heading = node('h2', 'Pre Lv.' + level);
    const grid = node('div', undefined, 'unit-grid');
    for (const unit of data.units.filter(item => item.level === level)) {
      const card = node('article', undefined, 'unit');
      card.append(node('h3', '単元' + unit.unit + '　' + unit.title));
      if (!unit.available) {
        card.append(node('p', '教員の承認待ち', 'muted'));
      } else {
        const progress = unit.score === null ? '未受験' : '前回 ' + unit.score + '/20' + (unit.passed ? '・合格済み' : '');
        card.append(node('p', progress + ' ／ 復習 ' + unit.misses + '問', 'muted'));
        const actions = node('div', undefined, 'actions');
        if (unit.activeMode) {
          actions.append(button(unit.activeMode === 'review' ? '復習を再開' : '途中から再開', () => run(() => startUnit(unit.id, unit.activeMode))));
        } else {
          actions.append(button('練習する', () => run(() => startUnit(unit.id, 'normal'))));
          if (unit.misses) actions.append(button('間違えた単語を復習', () => run(() => startUnit(unit.id, 'review')), true));
        }
        card.append(actions);
      }
      grid.append(card);
    }
    app.append(heading, grid);
  }
  focusTitle(top.querySelector('h2'));
}

async function startUnit(unit, mode) {
  renderStudentQuiz(unit, await request('/student/units/' + unit + '/start', { mode }));
}

function renderStudentQuiz(unit, attempt) {
  if (attempt.result) return renderResult(unit, attempt);
  const q = attempt.question;
  const panel = node('section', undefined, 'panel quiz');
  const position = (attempt.mode === 'review' ? '復習' : '練習') + '　' + (attempt.position + 1) + ' / ' + attempt.total;
  const word = node('h2', q.heading);
  word.lang = 'en';
  const progress = node('progress');
  progress.max = attempt.total;
  progress.value = attempt.position;
  progress.setAttribute('aria-label', position);
  panel.append(node('p', position, 'muted'), progress, word);
  if (q.example) {
    const example = node('p', q.example);
    example.lang = 'en';
    panel.append(example);
  }
  const choices = node('div', undefined, 'choices');
  const feedback = node('p');
  feedback.setAttribute('aria-live', 'polite');
  const actions = node('div', undefined, 'actions');
  actions.append(button('単元一覧へ', () => run(showStudent), true));
  for (const choice of q.choices) {
    choices.append(button(choice, () => run(async () => {
      const answer = await request('/student/units/' + unit + '/answer', {
        attempt: attempt.id, question: q.id, choice,
      });
      for (const b of choices.children) {
        b.disabled = true;
        if (b.textContent === answer.feedback.answer) b.classList.add('correct');
        else if (b.textContent === choice) b.classList.add('wrong');
      }
      feedback.textContent = (answer.feedback.correct ? '正解！ ' : '正答は「' + answer.feedback.answer + '」。') + answer.feedback.explanation;
      const next = button(answer.next.result ? '結果を見る' : '次の問題へ', () => renderStudentQuiz(unit, answer.next));
      actions.prepend(next);
      next.focus();
    })));
  }
  panel.append(node('p', q.instruction), choices, feedback, actions);
  app.replaceChildren(panel);
  focusTitle(word);
}

function renderResult(unit, attempt) {
  const { result } = attempt;
  const panel = node('section', undefined, 'panel quiz');
  const title = node('h2', '結果');
  const message = attempt.mode === 'review'
    ? '復習完了'
    : result.passed ? '練習合格（18問以上正解）' : '18問以上正解で練習合格';
  panel.append(title, node('p', result.correct + ' / ' + attempt.total + '問正解'), node('p', message));
  if (result.misses.length) {
    const list = node('ul');
    for (const q of result.misses) list.append(node('li', q.heading + ' → ' + q.meaning + '（' + q.id + '）'));
    panel.append(node('h3', 'もう一度確認する単語'), list);
  }
  const actions = node('div', undefined, 'actions');
  if (result.misses.length) actions.append(button('間違えた単語を復習', () => run(() => startUnit(unit, 'review'))));
  actions.append(button('単元一覧へ', () => run(showStudent), true));
  panel.append(actions);
  app.replaceChildren(panel);
  focusTitle(title);
}

showLogin();
