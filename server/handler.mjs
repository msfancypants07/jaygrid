import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';
import site from '../dist/server/index.js';
import { DEFAULT_TERM, normalizedSchedules, validSchedules, validTerm } from '../shared/plans.mjs';

const SESSION_AGE = 30 * 24 * 60 * 60;

function settings() {
  const origin = process.env.PUBLIC_ORIGIN || '';
  const url = process.env.SUPABASE_URL || '';
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || '';
  const secret = process.env.SESSION_SECRET || '';
  return { origin, url, key, secret, configured: Boolean(origin && url && key && /^[0-9a-f]{64}$/i.test(secret)) };
}
function cookie(request, name) {
  const pair = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : '';
}
function sealed(value, name, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), iv);
  cipher.setAAD(Buffer.from(name));
  const body = Buffer.concat([cipher.update(deflateRawSync(Buffer.from(JSON.stringify(value)))), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}
function opened(value, name, secret) {
  if (!value || value.length > 4000) return null;
  try {
    const raw = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(secret, 'hex'), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(inflateRawSync(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]), { maxOutputLength: 32_000 }).toString());
  } catch { return null; }
}
function setCookie(name, value, age, origin) {
  if (value.length > 3800) throw new Error('Session is too large to save.');
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(origin).protocol === 'https:' ? '; Secure' : ''}`;
}
function respond(data, status = 200, cookies = []) {
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(JSON.stringify(data), { status, headers });
}
function redirect(to, cookies = []) {
  const headers = new Headers({ location: to, 'cache-control': 'no-store' });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(null, { status: 302, headers });
}
function clientWithStorage(config, initial = {}) {
  const data = { ...initial };
  const storage = {
    getItem: async key => data[key] ?? null,
    setItem: async (key, value) => { data[key] = value; },
    removeItem: async key => { delete data[key]; },
  };
  const client = createClient(config.url, config.key, {
    auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'pkce' },
  });
  return { client, data };
}
async function account(request, config) {
  const saved = opened(cookie(request, 'jaygrid_session'), 'jaygrid_session', config.secret);
  if (!saved?.storage) return null;
  const { client, data } = clientWithStorage(config, saved.storage);
  const result = await client.auth.getUser();
  if (result.error || !result.data.user) return null;
  const currentCookie = () => setCookie('jaygrid_session', sealed({ storage: data }, 'jaygrid_session', config.secret), SESSION_AGE, config.origin);
  return { client, user: result.data.user, currentCookie };
}
export async function handle(request, route = new URL(request.url).pathname) {
  const config = settings();
  if (route === '/api/search') return site.fetch(request);
  if (route === '/api/account' && request.method === 'GET') {
    if (!config.configured) return respond({ configured: false, user: null });
    const current = await account(request, config);
    return respond({ configured: true, user: current ? { id: current.user.id, email: current.user.email } : null },
      200, current ? [current.currentCookie()] : []);
  }
  if (route === '/auth/login' && request.method === 'GET') {
    if (!config.configured) return respond({ error: 'Connect Supabase to enable sign-in.' }, 503);
    const { client, data } = clientWithStorage(config);
    const { data: oauth, error } = await client.auth.signInWithOAuth({
      provider: 'google', options: { redirectTo: `${config.origin}/auth/callback`, skipBrowserRedirect: true },
    });
    if (error || !oauth.url) return respond({ error: 'Could not start Google sign-in.' }, 502);
    const flow = sealed({ storage: data, createdAt: Date.now() }, 'jaygrid_flow', config.secret);
    return redirect(oauth.url, [setCookie('jaygrid_flow', flow, 600, config.origin)]);
  }
  if (route === '/auth/callback' && request.method === 'GET') {
    if (!config.configured) return redirect('/?auth_error=signin');
    const flow = opened(cookie(request, 'jaygrid_flow'), 'jaygrid_flow', config.secret);
    const code = new URL(request.url).searchParams.get('code');
    const clearFlow = setCookie('jaygrid_flow', '', 0, config.origin);
    if (!flow?.storage || Date.now() - flow.createdAt > 600_000 || !code)
      return redirect('/?auth_error=signin', [clearFlow]);
    const { client, data } = clientWithStorage(config, flow.storage);
    const result = await client.auth.exchangeCodeForSession(code);
    if (result.error || !result.data.user) return redirect('/?auth_error=signin', [clearFlow]);
    const session = sealed({ storage: data }, 'jaygrid_session', config.secret);
    return redirect('/', [clearFlow, setCookie('jaygrid_session', session, SESSION_AGE, config.origin)]);
  }
  if (route === '/api/signout' && request.method === 'POST') {
    if (!config.configured || request.headers.get('origin') !== config.origin) return respond({ error: 'Invalid request origin.' }, 403);
    const current = await account(request, config);
    if (current) await current.client.auth.signOut({ scope: 'local' });
    return respond({ ok: true }, 200, [setCookie('jaygrid_session', '', 0, config.origin)]);
  }
  if (route === '/api/plan' && (request.method === 'GET' || request.method === 'PUT')) {
    if (!config.configured) return respond({ error: 'Connect Supabase to save plans.' }, 503);
    if (request.method === 'PUT' && request.headers.get('origin') !== config.origin) return respond({ error: 'Invalid request origin.' }, 403);
    const current = await account(request, config);
    if (!current) return respond({ error: 'Sign in to save your plan.' }, 401);
    const term = new URL(request.url).searchParams.get('term') || DEFAULT_TERM;
    if (!validTerm(term)) return respond({ error: 'Invalid semester.' }, 400);
    const query = current.client.from('jaygrid_plans');
    if (request.method === 'GET') {
      const { data, error } = await query.select('entries,version').eq('user_id', current.user.id).eq('term', term).maybeSingle();
      if (error) return respond({ error: 'Could not load your cloud plan.' }, 502, [current.currentCookie()]);
      const schedules = normalizedSchedules(data?.entries || []);
      if (!schedules) return respond({ error: 'Your cloud schedules could not be read.' }, 502, [current.currentCookie()]);
      return respond({ schedules, version: Number(data?.version) || 0 }, 200, [current.currentCookie()]);
    }
    let body;
    try { const text = await request.text(); if (text.length > 512_000) throw Error(); body = JSON.parse(text); }
    catch { return respond({ error: 'Invalid plan data.' }, 400); }
    if (!validSchedules(body.schedules) || !Number.isSafeInteger(body.version) || body.version < 0)
      return respond({ error: 'Invalid plan data.' }, 400);
    const update = { entries: body.schedules, version: body.version + 1, updated_at: new Date().toISOString() };
    let result;
    if (body.version === 0) {
      result = await query.insert({ user_id: current.user.id, term, ...update }).select('version').maybeSingle();
      if (result.error?.code === '23505') return respond({ error: 'This plan changed on another device. Reload before saving.' }, 409, [current.currentCookie()]);
    } else {
      result = await query.update(update).eq('user_id', current.user.id).eq('term', term)
        .eq('version', body.version).select('version').maybeSingle();
    }
    if (result.error) return respond({ error: 'Could not save your cloud plan.' }, 502, [current.currentCookie()]);
    if (!result.data) return respond({ error: 'This plan changed on another device. Reload before saving.' }, 409, [current.currentCookie()]);
    return respond({ version: Number(result.data.version) }, 200, [current.currentCookie()]);
  }
  return respond({ error: 'Not found.' }, 404);
}
