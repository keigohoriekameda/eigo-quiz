// Run: node scripts/audit-pre-quality.mjs
// This is a screening report, not editorial approval. Data remain draft.
import fs from 'node:fs';
const all=Array.from({length:7},(_,i)=>JSON.parse(fs.readFileSync(`data/pre-lv${i+1}-draft.json`,'utf8'))).flat();
const ids=new Set(),headwords=new Set(),errors=[],warnings=[];
const canonical=s=>String(s??'').normalize('NFKC').trim().toLowerCase();
const semGroups=[
 ['海','大洋'],['家','自宅'],['頭のよい','賢い'],['ごみ','ごみくず'],
 ['かわいい','かわいらしい'],['見える','見る'],['聞こえる','聞く'],
 ['遅い','遅れた'],['早い','速い'],['船','ボート'],['絵・写真','写真']
];
for(const q of all){
 const at=q.id||'<missing-id>';
 const key=canonical(q.lemma);
 if(ids.has(at))errors.push(`${at}: duplicate ID`);ids.add(at);
 if(headwords.has(key))warnings.push(`${at}: duplicate spelling ${q.lemma}`);headwords.add(key);
 const opts=[q.meaning_ja,...(Array.isArray(q.distractors_ja)?q.distractors_ja:[])];
 if(opts.length!==4||new Set(opts.map(canonical)).size!==4||opts.some(v=>!canonical(v)))errors.push(`${at}: invalid four-choice answers`);
 for(const group of semGroups){
   const hits=opts.filter(v=>group.includes(v));
   if(hits.length>=2)warnings.push(`${at}: possible overlapping meanings: ${hits.join(' / ')}`);
 }
 if(q.review_status==='approved'&&(!q.context_en?.trim()||q.part_of_speech==='unspecified'||q.quality_flags?.length)){
   errors.push(`${at}: approved without required contextual review`);
 }
}

// Option audit: generated candidates must share an editor-assigned semantic group and part of speech.
// Exceptions are explicitly identified as individual candidates and still need human editorial approval.
const groups = new Map();
for(const q of all){const g=groups.get(q.choice_group)||[];g.push(q);groups.set(q.choice_group,g);}
for(const q of all){
  if(!q.part_of_speech||q.part_of_speech==='unspecified'||q.part_of_speech==='vocabulary')
    errors.push(`${q.id}: no specific part of speech`);
  if(!q.choice_group) errors.push(`${q.id}: missing semantic choice group`);
  if(q.distractor_method==='semantic-group-candidate'){
    const peers=groups.get(q.choice_group)||[];
    for(const option of q.distractors_ja){
      if(!peers.some(p=>p.id!==q.id&&p.meaning_ja===option&&p.part_of_speech===q.part_of_speech))
        errors.push(`${q.id}: distractor outside its semantic group / part of speech: ${option}`);
    }
  } else if(q.distractor_method!=='individual-semantic-candidate'){
    errors.push(`${q.id}: unclassified distractor source`);
  }
}
const summary={
 total:all.length,
 with_context:all.filter(q=>Boolean(q.context_en?.trim())).length,
 with_part_of_speech:all.filter(q=>q.part_of_speech!=='unspecified'&&q.part_of_speech!=='vocabulary').length,
 individual_candidates:all.filter(q=>q.distractor_method==='individual-semantic-candidate').length,
 pending_editorial:all.filter(q=>q.review_status!=='approved').length,
 semantic_group_candidates:all.filter(q=>q.distractor_method==='semantic-group-candidate').length,
 errors:errors.length,review_warnings:warnings.length
};
console.log(JSON.stringify(summary,null,2));
for(const x of errors)console.error('ERROR',x);
for(const x of warnings)console.warn('REVIEW',x);
if(all.length!==700||errors.length)process.exitCode=1;
