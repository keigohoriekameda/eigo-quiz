import test from 'node:test';
import assert from 'node:assert/strict';
import {computePreMilestones,normalizePassedUnits} from '../src/pre-milestones.mjs';
const all=Array.from({length:7},(_,l)=>Array.from({length:5},(_,u)=>`${l+1}-${u+1}`)).flat();
test('no credits before 18 approved units',()=>{
 const s=computePreMilestones(all.slice(0,17));
 assert.equal(s.creditedWords,340);
 assert.deepEqual(s.qualifyingRewardKeys,[]);
});
test('350 threshold first occurs at 360 credited words',()=>{
 const s=computePreMilestones(all.slice(0,18));
 assert.equal(s.creditedWords,360);
 assert.deepEqual(s.qualifyingRewardKeys,['PRE_HALF_350']);
});
test('700 milestone requires all 35 units',()=>{
 const s=computePreMilestones(all);
 assert.equal(s.creditedWords,700);
 assert.deepEqual(s.qualifyingRewardKeys,['PRE_HALF_350','PRE_ALL_700']);
});
test('duplicate and invalid keys cannot accelerate milestone',()=>{
 assert.deepEqual(normalizePassedUnits(['1-1','1-1','100-1',null,'7-5']),['1-1','7-5']);
 assert.equal(computePreMilestones([...Array(100).fill('1-1')]).creditedWords,20);
});
