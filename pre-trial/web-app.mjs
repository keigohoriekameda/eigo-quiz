import { Readable } from 'node:stream';
import { makeCatalog, pilotCatalog } from './catalog.mjs';
import { createTrialHandler } from './server.mjs';
import { createSupabaseConnection, skylineAuth } from './skyline.mjs';
import { supabaseRepository } from './supabase-store.mjs';

export async function createPreviewApp({ snapshot, env, fetcher }) {
  if (env.VERCEL_ENV !== 'preview') throw new Error('Web試用には Vercel Preview が必要です。');
  const catalog = pilotCatalog(makeCatalog(snapshot));
  const db = createSupabaseConnection(env, fetcher);
  const auth = skylineAuth(db, env.AUTH_INTERNAL_EMAIL_DOMAIN, env.PRE_SKYLINE_PRODUCT_CODE);
  const handler = await createTrialHandler({ catalog, auth, repository: supabaseRepository(db, catalog.commit) });

  return function handle(request, pathname = new URL(request.url).pathname) {
    const req = request.body ? Readable.fromWeb(request.body) : Readable.from([]);
    req.url = pathname;
    req.method = request.method;
    req.headers = Object.fromEntries(request.headers);
    return new Promise(resolve => {
      let status, headers;
      handler(req, {
        writeHead(code, fields) { status = code; headers = fields; },
        end(body) { resolve(new Response(body, { status, headers })); },
      });
    });
  };
}
