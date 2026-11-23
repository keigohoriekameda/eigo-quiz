// Run: node scripts/audit-pre.mjs
import fs from 'node:fs';
const all=[];const errors=[];
for(let level=1;level<=7;level++){
 const file=`data/pre-lv${level}-draft.json`;
 const rows=JSON.parse(fs.readFileSync(file,'utf8'));
 if(rows.length!==100)errors.push(`${file}: expected 100, got ${rows.length}`);
 for(const r of rows){
  if(r.level!==level||r.stage!=='PRE'||r.unit<1||r.unit>5)errors.push(`${r.id}: invalid stage/level/unit`);
  if(!Array.isArray(r.distractors_ja)||r.distractors_ja.length!==3||new Set([r.meaning_ja,...r.distractors_ja]).size!==4)errors.push(`${r.id}: choices invalid`);
  if(!r.lemma||!r.meaning_ja)errors.push(`${r.id}: missing lemma/meaning`);
  all.push(r);
 }
}
const ids=all.map(x=>x.id), lemmas=all.map(x=>x.lemma.toLowerCase());
if(new Set(ids).size!==ids.length)errors.push('Duplicate question IDs');
if(new Set(lemmas).size!==lemmas.length)errors.push('Duplicate headwords');
// A small, high-confidence guard against answer choices that are both valid Japanese meanings.
// Expand after editorial review; this list is deliberately not a general synonym dictionary.
const equivalentMeanings = [
 ['海','大洋'],
 ['頭のよい','賢い'],
 ['ごみ','ごみくず'],
 ['早い','速い']
];
for(const r of all){
 for(const choices of equivalentMeanings){
  if(choices.includes(r.meaning_ja) && r.distractors_ja.some(x=>choices.includes(x))){
   errors.push(`${r.id}: ambiguous answer and distractor (${choices.join(' / ')})`);
  }
 }
}
const manual=all.filter(x=>x.distractor_method==='manual-semantic-candidate').length;
const automatic=all.filter(x=>x.distractor_method==='automatic-within-unit').length;
const reviewNeeded=all.filter(x=>x.quality_flags?.includes('requires_semantic_distractor_review')).length;
console.log(JSON.stringify({total:all.length,manual_candidates:manual,automatic_candidates:automatic,requiring_semantic_review:reviewNeeded,editorially_approved:all.filter(x=>x.review_status==='approved').length,issues:errors},null,2));
if(errors.length)process.exitCode=1;
