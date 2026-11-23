import { createHash, randomBytes } from 'node:crypto';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const tokenHash = token => createHash('sha256').update(token).digest('hex');

export function createSupabaseConnection(env, fetcher = fetch) {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY } = env;
  const url = new URL(NEXT_PUBLIC_SUPABASE_URL);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY || NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === SUPABASE_SECRET_KEY) {
    throw new Error('Supabaseの接続設定を確認してください。');
  }

  async function send(path, key, { method = 'GET', params, body, prefer } = {}) {
    const target = new URL(path, url);
    if (params) target.search = new URLSearchParams(params).toString();
    const headers = { apikey: key, accept: 'application/json' };
    if (path.startsWith('/rest/') && key.startsWith('eyJ')) headers.authorization = 'Bearer ' + key;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (prefer) headers.prefer = prefer;
    return fetcher(target, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
  }
  return {
    async password(email, password) {
      const response = await send('/auth/v1/token', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
        method: 'POST', params: { grant_type: 'password' }, body: { email, password },
      });
      if ([400, 401, 403].includes(response.status)) return null;
      if (!response.ok) throw new Error('Supabase Authを利用できません。');
      const data = await response.json();
      return uuid.test(data.user?.id) ? data.user.id : null;
    },
    async rows(table, options) {
      const response = await send('/rest/v1/' + table, SUPABASE_SECRET_KEY, options);
      if (!response.ok) throw new Error('Supabaseのデータを処理できません。');
      return response.status === 204 ? [] : response.json();
    },
  };
}

export function skylineAuth(db, domain, productCode) {
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain ?? '') || !domain.includes('.') ||
      !/^[a-z0-9][a-z0-9-]{1,79}$/.test(productCode ?? '')) {
    throw new Error('Skylineの内部メールドメインと製品コードを確認してください。');
  }

  async function authorize(id, role, loginId) {
    const table = role === 'teacher' ? 'admin_users' : 'profiles';
    const select = role === 'teacher' ? 'id,display_name,is_active' : 'id,login_id,display_name,is_active';
    const [person] = await db.rows(table, { params: { id: 'eq.' + id, select } });
    if (!person?.is_active || person.id !== id || (loginId !== undefined && person.login_id !== loginId)) return null;
    if (role === 'student') {
      const [[product], [access]] = await Promise.all([
        db.rows('products', { params: { product_code: 'eq.' + productCode, select: 'is_active' } }),
        db.rows('user_product_access', { params: {
          user_id: 'eq.' + id, product_id: 'eq.' + productCode, select: 'is_active,expires_at',
        } }),
      ]);
      if (!product?.is_active || !access?.is_active ||
          (access.expires_at !== null && !(Date.parse(access.expires_at) > Date.now()))) return null;
    }
    return { role, id, name: person.display_name };
  }

  return {
    skyline: true,
    async login({ loginId, password, role }) {
      if (typeof loginId !== 'string' || loginId.length > 254 || typeof password !== 'string' ||
          !password.length || password.length > 1024) return null;
      const identity = loginId.trim();
      const studentId = role === 'student' ? identity.toLowerCase() : undefined;
      const email = studentId === undefined ? identity : studentId + '@' + domain;
      if (!/^[^\s@]+@[^\s@]+$/.test(email)) return null;
      const id = await db.password(email, password);
      return id ? authorize(id, role, studentId) : null;
    },
    async issue(actor) {
      const token = randomBytes(32).toString('base64url');
      await db.rows('eigo_pre_sessions', {
        method: 'POST', body: {
          token_hash: tokenHash(token), user_id: actor.id, role: actor.role,
          expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        },
      });
      return token;
    },
    async inspect(token) {
      const [entry] = await db.rows('eigo_pre_sessions', { params: {
        token_hash: 'eq.' + tokenHash(token), expires_at: 'gt.' + new Date().toISOString(), select: 'user_id,role',
      } });
      return entry ? authorize(entry.user_id, entry.role) : null;
    },
    async revoke(token) {
      await db.rows('eigo_pre_sessions', { method: 'DELETE', params: { token_hash: 'eq.' + tokenHash(token) } });
    },
  };
}
