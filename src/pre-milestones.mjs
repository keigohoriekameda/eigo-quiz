// Project Skyline integration preparation: deterministic, non-awarding milestone logic.
// This module NEVER grants tickets; only the authenticated server may do that.
export const PRE_MILESTONES = Object.freeze({
  PRE_HALF_350: 18, // 20-item units, so first attainable threshold is 360
  PRE_ALL_700: 35
});
export function normalizePassedUnits(keys) {
  const allowed = new Set(Array.from({length:7},(_,l)=>Array.from({length:5},(_,u)=>`${l+1}-${u+1}`)).flat());
  return [...new Set(Array.isArray(keys) ? keys.filter(k=>typeof k==='string' && allowed.has(k)) : [])];
}
export function computePreMilestones(keys) {
  const count=normalizePassedUnits(keys).length;
  return Object.freeze({
    completedUnits:count,
    creditedWords:count*20,
    halfReached:count>=PRE_MILESTONES.PRE_HALF_350,
    allReached:count===PRE_MILESTONES.PRE_ALL_700,
    qualifyingRewardKeys:[
      ...(count>=PRE_MILESTONES.PRE_HALF_350 ? ['PRE_HALF_350']:[]),
      ...(count===PRE_MILESTONES.PRE_ALL_700 ? ['PRE_ALL_700']:[])
    ]
  });
}
