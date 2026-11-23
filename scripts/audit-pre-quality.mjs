// Run: node scripts/audit-pre-quality.mjs
// This is a screening report. Editorial approval is recorded separately.
import fs from 'node:fs';
import { checkPreQuality } from '../src/pre-quality.mjs';

const all = Array.from({ length: 7 }, (_, i) =>
  JSON.parse(fs.readFileSync(`data/pre-lv${i + 1}-draft.json`, 'utf8'))
).flat();
const { summary, errors, warnings } = checkPreQuality(all);
console.log(JSON.stringify(summary, null, 2));
for (const error of errors) console.error('ERROR', error);
for (const warning of warnings) console.warn('REVIEW', warning);
if (all.length !== 700 || errors.length) process.exitCode = 1;
