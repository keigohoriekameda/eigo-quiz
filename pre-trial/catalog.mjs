import { execFileSync } from 'node:child_process';
import { checkPreQuality } from '../src/pre-quality.mjs';
import { readyForEditorialApproval } from '../src/vocabulary-prompt.mjs';

const titles = [["数（1～20）","曜日・月・日付","色・大きさ・気持ち","家族・学校","動物・食べ物"],["体の部分","動作・行動","時間・季節・天気","家・町・自然","スポーツ・音楽・趣味"],["日常の動詞","家事と生活","衣服と持ち物","食事と食材","教科と学用品"],["自然と地形","生き物と昆虫","乗り物と交通","国と文化","場所と施設"],["形容詞・性質","状態と感情","比較と数量","方向と位置","時間・頻度"],["学びとコミュニケーション","社会と仕事","暮らしとお金","身体と健康","デジタル生活"],["抽象名詞・考え","気持ちと人間関係","環境と地球","出来事と行動","入試につながる動詞"]];
const promptTypes = new Set(['meaning_4choice', 'meaning_in_context_4choice', 'phrase_meaning_4choice']);

export function loadCatalog(root, commit) {
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error('PRE_TRIAL_COMMIT に Git の完全なコミットSHAを指定してください。');
  }
  const git = args => execFileSync('git', ['--no-replace-objects', ...args], {
    cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (git(['rev-parse', '--verify', commit + '^{commit}']).trim() !== commit) {
    throw new Error('指定されたGitコミットを確認できません。');
  }

  const items = [];
  const units = new Map();
  for (let level = 1; level <= 7; level++) {
    const rows = JSON.parse(git(['show', commit + ':data/pre-lv' + level + '-draft.json']));
    if (!Array.isArray(rows) || rows.length !== 100) throw new Error('Pre Lv.' + level + ' の問題数が不正です。');
    for (const q of rows) {
      if (!q || !Array.isArray(q.distractors_ja)) throw new Error('Pre Lv.' + level + ' に無効な問題があります。');
      const textFields = [q.id, q.lemma, q.meaning_ja, q.explanation_ja, q.source_tag, ...q.distractors_ja];
      if (q.stage !== 'PRE' || q.level !== level || !Number.isInteger(q.unit) || q.unit < 1 || q.unit > 5 ||
          textFields.some(s => typeof s !== 'string' || !s.trim()) ||
          !promptTypes.has(q.prompt_type) || !['draft', 'approved'].includes(q.review_status)) {
        throw new Error('問題データが不正です。' + q.id);
      }
    }
    items.push(...rows);
    for (let unit = 1; unit <= 5; unit++) {
      const questions = rows.filter(q => q.unit === unit);
      if (questions.length !== 20) throw new Error('単元の問題数が不正です。' + level + '-' + unit);
      const id = level + '-' + unit;
      units.set(id, {
        id, level, unit, title: titles[level - 1][unit - 1], questions,
        byId: new Map(questions.map(q => [q.id, q])),
      });
    }
  }
  const { errors, warnings } = checkPreQuality(items);
  if (errors.length) throw new Error('Pre品質検査に失敗しました。\n' + errors.join('\n'));
  const warnedIds = new Set(warnings.map(warning => warning.split(': ')[0]));
  for (const unit of units.values()) {
    unit.blockers = unit.questions.filter(q => {
      // The pending editorial flag is resolved by the teacher's unit approval.
      const flags = Array.isArray(q.quality_flags)
        ? q.quality_flags.filter(flag => flag !== 'editorial_review_pending') : q.quality_flags;
      return warnedIds.has(q.id) || !readyForEditorialApproval({ ...q, quality_flags: flags });
    }).map(q => q.id);
  }
  return { commit, units };
}
