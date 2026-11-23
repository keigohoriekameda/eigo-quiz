import { emptyProgress } from './store.mjs';

const progressTable = 'eigo_pre_progress';
const approvalTable = 'eigo_pre_approvals';

export function supabaseRepository(db, commit) {
  const edition = { curriculum_commit: 'eq.' + commit };
  const unitKey = unit => ({ ...edition, unit_key: 'eq.' + unit });
  const key = (learner, unit) => ({ ...unitKey(unit), learner_id: 'eq.' + learner });
  const progressRows = (learner, unit) => db.rows(progressTable, {
    params: { ...key(learner, unit), select: 'state,revision' },
  });
  const approvalFrom = row => ({ commit, by: row.approved_name, byId: row.approved_by, at: row.approved_at });

  return {
    async approvals() {
      const rows = await db.rows(approvalTable, {
        params: { ...edition, select: 'unit_key,approved_name,approved_by,approved_at' },
      });
      return Object.fromEntries(rows.map(row => [row.unit_key, approvalFrom(row)]));
    },
    async approve(unit, record) {
      const [inserted] = await db.rows(approvalTable, {
        method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation', body: {
          curriculum_commit: commit, unit_key: unit, approved_by: record.byId,
          approved_name: record.by, approved_at: record.at,
        },
      });
      if (inserted) return approvalFrom(inserted);
      const [existing] = await db.rows(approvalTable, { params: unitKey(unit) });
      return approvalFrom(existing);
    },
    async progress(learner, unit) {
      const [row] = await progressRows(learner, unit);
      return row?.state ?? emptyProgress();
    },
    async editProgress(learner, unit, mutate) {
      for (let i = 0; i < 8; i++) {
        const [previous] = await progressRows(learner, unit);
        const state = previous?.state ?? emptyProgress();
        const result = mutate(state);
        const response = previous
          ? await db.rows(progressTable, {
            method: 'PATCH', params: { ...key(learner, unit), revision: 'eq.' + previous.revision },
            prefer: 'return=representation', body: { state, revision: previous.revision + 1 },
          })
          : await db.rows(progressTable, {
            method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
            body: { curriculum_commit: commit, learner_id: learner, unit_key: unit, state, revision: 1 },
          });
        if (response.length) return result;
      }
      throw new Error('進捗が同時に更新されました。');
    },
  };
}
