import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, pilotCatalog } from './catalog.mjs';
import { createTrialServer } from './server.mjs';
import { openTrialStore } from './store.mjs';

const {
  NODE_ENV, PRE_TRIAL_COMMIT, PRE_TRIAL_ACCOUNTS, PRE_TRIAL_STATE,
  PRE_TRIAL_HOST = '127.0.0.1', PRE_TRIAL_PORT = '4170',
  PRE_TRIAL_TLS_KEY, PRE_TRIAL_TLS_CERT, PRE_TRIAL_SCOPE = 'first40',
} = process.env;

if (NODE_ENV === 'production') throw new Error('試用サーバーは本番モードで起動できません。');
if (!PRE_TRIAL_ACCOUNTS || !PRE_TRIAL_STATE || !isAbsolute(PRE_TRIAL_ACCOUNTS) || !isAbsolute(PRE_TRIAL_STATE)) {
  throw new Error('PRE_TRIAL_ACCOUNTS と PRE_TRIAL_STATE に絶対パスを指定してください。');
}
if (PRE_TRIAL_ACCOUNTS === PRE_TRIAL_STATE) throw new Error('アカウントと進捗は別のファイルにしてください。');
if (Boolean(PRE_TRIAL_TLS_KEY) !== Boolean(PRE_TRIAL_TLS_CERT)) throw new Error('TLSの秘密鍵と証明書を両方指定してください。');
const tls = PRE_TRIAL_TLS_KEY ? {
  key: await readFile(PRE_TRIAL_TLS_KEY), cert: await readFile(PRE_TRIAL_TLS_CERT),
} : null;
if (PRE_TRIAL_HOST !== '127.0.0.1' && !tls) throw new Error('別端末への配信にはHTTPSを指定してください。');
const port = Number(PRE_TRIAL_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PRE_TRIAL_PORT が不正です。');

if (!['first40', 'all'].includes(PRE_TRIAL_SCOPE)) throw new Error('PRE_TRIAL_SCOPE を確認してください。');
const fullCatalog = loadCatalog(fileURLToPath(new URL('..', import.meta.url)), PRE_TRIAL_COMMIT);
const catalog = PRE_TRIAL_SCOPE === 'all' ? fullCatalog : pilotCatalog(fullCatalog);
const accounts = JSON.parse(await readFile(PRE_TRIAL_ACCOUNTS, 'utf8'));
const store = await openTrialStore(PRE_TRIAL_STATE);
const server = await createTrialServer({ catalog, accounts, store, tls });
server.listen(port, PRE_TRIAL_HOST, () => {
  const host = PRE_TRIAL_HOST.includes(':') ? '[' + PRE_TRIAL_HOST + ']' : PRE_TRIAL_HOST;
  const url = (tls ? 'https://' : 'http://') + host + ':' + port;
  console.log('教員承認 ' + url + '/teacher\n生徒試用 ' + url + '/student\n教材コミット ' + catalog.commit);
});
