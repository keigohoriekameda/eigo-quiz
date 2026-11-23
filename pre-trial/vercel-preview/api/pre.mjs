import snapshot from '../pre-trial/snapshot.mjs';
import { createPreviewApp } from '../pre-trial/web-app.mjs';

let app;
const privateHeaders = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };

export default {
  async fetch(request) {
    if (process.env.VERCEL_ENV !== 'preview') return new Response(null, { status: 404, headers: privateHeaders });
    const url = new URL(request.url);
    const route = url.searchParams.getAll('__pre_path');
    const path = route.length === 1 ? route[0] : url.pathname;
    if (!/^\/(?:teacher|student|trial\.(?:js|css)|api\/[a-z0-9/-]+)$/.test(path) || path === '/api/pre') {
      return new Response(null, { status: 404, headers: privateHeaders });
    }
    try {
      app ??= createPreviewApp({ snapshot, env: process.env });
      return await (await app)(request, path);
    } catch {
      app = undefined;
      return new Response('試用画面を起動できません。', {
        status: 503, headers: { ...privateHeaders, 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  },
};
