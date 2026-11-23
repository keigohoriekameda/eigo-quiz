import { cp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCatalog, readEdition } from './catalog.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const destination = process.argv[2];
if (!destination || process.argv.length !== 3) throw new Error('出力先に新しいディレクトリを指定してください。');
const output = resolve(destination);
const snapshot = readEdition(root);
makeCatalog(snapshot);
await mkdir(output);
const files = [
  'pre-trial/catalog.mjs', 'pre-trial/server.mjs', 'pre-trial/quiz.mjs', 'pre-trial/store.mjs',
  'pre-trial/skyline.mjs', 'pre-trial/supabase-store.mjs', 'pre-trial/web-app.mjs',
  'pre-trial/web/index.html', 'pre-trial/web/trial.css', 'pre-trial/web/trial.js',
  'src/pre-quality.mjs', 'src/vocabulary-prompt.mjs',
];
for (const file of files) {
  await mkdir(dirname(join(output, file)), { recursive: true });
  await cp(join(root, file), join(output, file));
}
for (const file of ['api/pre.mjs', 'package.json', 'vercel.json', 'public/robots.txt']) {
  await mkdir(dirname(join(output, file)), { recursive: true });
  await cp(join(root, 'pre-trial', 'vercel-preview', file), join(output, file));
}
await writeFile(join(output, 'pre-trial', 'snapshot.mjs'), 'export default ' + JSON.stringify(snapshot) + ';\n');
console.log(snapshot.commit + ' ' + output);
