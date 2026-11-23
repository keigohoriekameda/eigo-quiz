import { randomInt, randomUUID } from 'node:crypto';

function shuffle(values) {
  const shuffled = [...values];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function makeAttempt(unit, mode, misses) {
  const questions = mode === 'normal' ? unit.questions : unit.questions.filter(q => misses.includes(q.id));
  return {
    id: randomUUID(), mode, questions: shuffle(questions).map(q => ({
      id: q.id, choices: shuffle([q.meaning_ja, ...q.distractors_ja]),
    })), answers: [],
  };
}

export function isFinished(attempt) {
  return attempt.answers.length === attempt.questions.length;
}

export function questionPrompt(q) {
  if (q.prompt_type === 'phrase_meaning_4choice') {
    return { heading: q.context_en, example: '', instruction: '語句全体の日本語の意味を選んでください。' };
  }
  return {
    heading: q.lemma, example: q.context_en,
    instruction: q.context_en ? '例文中の「' + q.lemma + '」の意味を選んでください。' : '日本語の意味を選んでください。',
  };
}

export function quizView(unit, attempt) {
  const position = attempt.answers.length;
  const item = attempt.questions[position];
  const base = { id: attempt.id, mode: attempt.mode, position, total: attempt.questions.length };
  if (item) {
    const q = unit.byId.get(item.id);
    return { ...base, question: { id: q.id, ...questionPrompt(q), choices: item.choices } };
  }
  const correct = attempt.answers.filter(a => a.correct).length;
  return {
    ...base,
    result: {
      correct, passed: attempt.mode === 'normal' && correct >= 18,
      misses: attempt.answers.filter(a => !a.correct).map(a => {
        const q = unit.byId.get(a.question);
        return { id: q.id, heading: questionPrompt(q).heading, meaning: q.meaning_ja };
      }),
    },
  };
}

export function completeAttempt(progress, attempt) {
  if (!isFinished(attempt)) return;
  const wrong = attempt.answers.filter(a => !a.correct).map(a => a.question);
  const score = attempt.answers.length - wrong.length;
  (progress.history ??= []).push({
    attemptId: attempt.id, mode: attempt.mode, score, total: attempt.questions.length,
    completedAt: new Date().toISOString(),
  });
  if (attempt.mode === 'normal') {
    progress.score = score;
    progress.passed ||= progress.score >= 18;
    progress.misses = wrong;
  } else {
    const reviewed = new Set(attempt.questions.map(q => q.id));
    progress.misses = [...new Set([...progress.misses.filter(id => !reviewed.has(id)), ...wrong])];
  }
}
