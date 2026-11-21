import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function openTrialStore(file) {
  await mkdir(dirname(file), { recursive: true });
  let state;
  try {
    state = JSON.parse(await readFile(file, 'utf8'));
    if (!state || state.version !== 1 || !state.editions || typeof state.editions !== 'object' || Array.isArray(state.editions)) {
      throw new Error('試用データの形式を確認してください。');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { version: 1, editions: {} };
  }

  let pending = Promise.resolve();
  return {
    read: () => state,
    update(mutate) {
      const write = pending.then(async () => {
        const next = structuredClone(state);
        const result = mutate(next);
        const temp = file + '.' + randomUUID() + '.tmp';
        try {
          await writeFile(temp, JSON.stringify(next) + '\n', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          await rename(temp, file);
        } finally {
          await rm(temp, { force: true });
        }
        state = next;
        return result;
      });
      pending = write.catch(() => {});
      return write;
    },
  };
}

export function edition(state, commit) {
  return state.editions[commit] ?? { approvals: {}, students: {} };
}

export function writableEdition(state, commit) {
  return state.editions[commit] ??= { approvals: {}, students: {} };
}

export function studentUnit(currentEdition, student, unit) {
  return currentEdition.students['student:' + student]?.[unit] ?? { passed: false, score: null, misses: [], attempt: null };
}

export function writableStudentUnit(currentEdition, student, unit) {
  const units = currentEdition.students['student:' + student] ??= {};
  return units[unit] ??= { passed: false, score: null, misses: [], attempt: null };
}
