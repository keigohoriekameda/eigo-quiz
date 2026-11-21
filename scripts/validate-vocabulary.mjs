/**
 * Vocabulary quality validation for English 2500.
 * Run: node scripts/validate-vocabulary.mjs path/to/items.json
 * Input: JSON array of items conforming to docs/english-2500-spec.md
 */
import fs from 'node:fs';
const path = process.argv[2];
if (!path) { console.error('Usage: node scripts/validate-vocabulary.mjs <items.json>'); process.exit(2); }
const items = JSON.parse(fs.readFileSync(path, 'utf8'));
if (!Array.isArray(items)) throw new Error('Expected a JSON array');
const errors = [];
const ids = new Set();
const groups = new Set(['G1', 'G2', 'G3', 'EXAM']);
const norm = x => String(x ?? '').trim().normalize('NFKC').toLowerCase();
const required = ['id','stage','level','unit','lemma','unit_type','part_of_speech','meaning_ja','context_en','prompt_type','distractors_ja','explanation_ja','source_tag','review_status'];
for (const [i, q] of items.entries()) {
  const at = `item[${i}]`;
  for (const field of required) if (q[field] === undefined || q[field] === null || q[field] === '') errors.push(`${at}: missing ${field}`);
  if (ids.has(q.id)) errors.push(`${at}: duplicate ID ${q.id}`);
  ids.add(q.id);
  if (!['PRE','MAIN'].includes(q.stage)) errors.push(`${at}: invalid stage`);
  if (!Number.isInteger(q.level) || q.level < 1 || q.level > (q.stage === 'PRE' ? 7 : 10)) errors.push(`${at}: invalid level`);
  if (!Number.isInteger(q.unit) || q.unit < 1) errors.push(`${at}: invalid unit`);
  if (q.stage === 'MAIN' && !groups.has(q.grade_group)) errors.push(`${at}: missing/invalid grade_group`);
  if (!Array.isArray(q.distractors_ja) || q.distractors_ja.length !== 3) {
    errors.push(`${at}: exactly three curated distractors required`);
  } else {
    const choices = [q.meaning_ja, ...q.distractors_ja].map(norm);
    if (choices.some(x => !x) || new Set(choices).size !== 4) errors.push(`${at}: empty/duplicate choices`);
  }
  if (q.review_status !== 'approved') errors.push(`${at}: not editorially approved`);
  if (!String(q.explanation_ja ?? '').trim()) errors.push(`${at}: empty explanation`);
}
const count = s => items.filter(x => x.stage === s).length;
console.log(`Validated ${items.length} items: PRE=${count('PRE')}, MAIN=${count('MAIN')}; issues=${errors.length}`);
if (errors.length) { for (const e of errors) console.error(e); process.exit(1); }
if (process.env.REQUIRE_COMPLETE === '1' && (count('PRE') !== 700 || count('MAIN') !== 1800)) {
  console.error('Incomplete inventory: expected PRE=700, MAIN=1800'); process.exit(1);
}
