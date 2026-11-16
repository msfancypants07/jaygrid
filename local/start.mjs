import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from '@supabase/supabase-js';
import site from './site.mjs';
import { DEFAULT_TERM, normalizedSchedules, validSchedules, validTerm } from '../shared/plans.mjs';
import { WATCHLIST_ROW, validWatchlist } from '../shared/watchlist.mjs';

const envPath = join(import.meta.dirname, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4177);
const origin = process.env.PUBLIC_ORIGIN || `http://${host}:${port}`;
const supabaseUrl = process.env.SUPABASE_URL || '';
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const configured = Boolean(supabaseUrl && publishableKey);
const secureCookie = new URL(origin).protocol === 'https:';
const dataDir = join(import.meta.dirname, 'data');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
chmodSync(dataDir, 0o700);
const dbPath = join(dataDir, 'sessions.sqlite');
const db = new DatabaseSync(dbPath);
chmodSync(dbPath, 0o600);
db.exec(`
  create table if not exists oauth_flows (id text primary key, storage text not null, created_at integer not null);
  create table if not exists sessions (id_hash text primary key, storage text not null, user_id text not null, updated_at integer not null);
`);
db.prepare('delete from oauth_flows where created_at < ?').run(Date.now() - 10 * 60 * 1000);
db.prepare('delete from sessions where updated_at < ?').run(Date.now() - 30 * 24 * 60 * 60 * 1000);

function sha(value) { return createHash('sha256').update(value).digest('hex'); }
function token() { return randomBytes(32).toString('base64url'); }
function cookie(req, name) {
  const part = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  return part ? part.slice(name.length + 1) : '';
}
function setCookie(name, value, age) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secureCookie ? '; Secure' : ''}`;
}
function json(res, status, value, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(value));
}
function redirect(res, path, extraHeaders = {}) {
  res.writeHead(302, { location: path, 'cache-control': 'no-store', ...extraHeaders });
  res.end();
}
function clientWithStorage(initial = {}) {
  const data = { ...initial };
  const storage = {
    getItem: async key => data[key] ?? null,
    setItem: async (key, value) => { data[key] = value; },
    removeItem: async key => { delete data[key]; },
  };
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'pkce' },
  });
  return { client, data };
}
async function account(req) {
  const id = cookie(req, 'jaygrid_session');
  if (!id || !configured) return null;
  const idHash = sha(id);
  const row = db.prepare('select storage from sessions where id_hash = ?').get(idHash);
  if (!row) return null;
  let initial;
  try { initial = JSON.parse(row.storage); } catch { return null; }
  const { client, data } = clientWithStorage(initial);
  const result = await client.auth.getUser();
  if (result.error || !result.data.user) {
    db.prepare('delete from sessions where id_hash = ?').run(idHash);
    return null;
  }
  const save = () => db.prepare('update sessions set storage = ?, updated_at = ? where id_hash = ?')
    .run(JSON.stringify(data), Date.now(), idHash);
  save();
  return { client, user: result.data.user, save, id };
}
function sameOrigin(req) { return req.headers.origin === origin; }
async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 512_000) throw new Error('Plan is too large.');
  }
  return JSON.parse(body);
}
async function handle(req, res) {
  const url = new URL(req.url, origin);
  if (url.pathname === '/api/account' && req.method === 'GET') {
    if (!configured) return json(res, 200, { configured: false, user: null });
    const current = await account(req);
    return json(res, 200, { configured: true, user: current ? { id: current.user.id, email: current.user.email } : null });
  }
  if (url.pathname === '/auth/login' && req.method === 'GET') {
    if (!configured) return json(res, 503, { error: 'Connect a Supabase project to enable sign-in.' });
    const { client, data } = clientWithStorage();
    const { data: oauth, error } = await client.auth.signInWithOAuth({
      provider: 'google', options: { redirectTo: `${origin}/auth/callback`, skipBrowserRedirect: true },
    });
    if (error || !oauth.url) return json(res, 502, { error: 'Could not start Google sign-in.' });
    const flow = token();
    db.prepare('insert into oauth_flows (id, storage, created_at) values (?, ?, ?)')
      .run(sha(flow), JSON.stringify(data), Date.now());
    return redirect(res, oauth.url, { 'set-cookie': setCookie('jaygrid_flow', flow, 600) });
  }
  if (url.pathname === '/auth/callback' && req.method === 'GET') {
    const flow = cookie(req, 'jaygrid_flow');
    const code = url.searchParams.get('code');
    const row = flow && db.prepare('select storage, created_at from oauth_flows where id = ?').get(sha(flow));
    if (flow) db.prepare('delete from oauth_flows where id = ?').run(sha(flow));
    if (!row || Date.now() - row.created_at > 600_000 || !code) {
      return redirect(res, '/?auth_error=signin', { 'set-cookie': setCookie('jaygrid_flow', '', 0) });
    }
    const { client, data } = clientWithStorage(JSON.parse(row.storage));
    const result = await client.auth.exchangeCodeForSession(code);
    if (result.error || !result.data.user) {
      return redirect(res, '/?auth_error=signin', { 'set-cookie': setCookie('jaygrid_flow', '', 0) });
    }
    const id = token();
    db.prepare('insert into sessions (id_hash, storage, user_id, updated_at) values (?, ?, ?, ?)')
      .run(sha(id), JSON.stringify(data), result.data.user.id, Date.now());
    return redirect(res, '/', { 'set-cookie': [setCookie('jaygrid_flow', '', 0), setCookie('jaygrid_session', id, 30 * 24 * 60 * 60)] });
  }
  if (url.pathname === '/api/signout' && req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Invalid request origin.' });
    const current = await account(req);
    if (current) {
      await current.client.auth.signOut({ scope: 'local' });
      db.prepare('delete from sessions where id_hash = ?').run(sha(current.id));
    }
    return json(res, 200, { ok: true }, { 'set-cookie': setCookie('jaygrid_session', '', 0) });
  }
  if (url.pathname === '/api/watchlist' && (req.method === 'GET' || req.method === 'PUT')) {
    if (req.method === 'PUT' && !sameOrigin(req)) return json(res, 403, { error: 'Invalid request origin.' });
    const current = await account(req);
    if (!current) return json(res, 401, { error: 'Sign in to save your watchlist.' });
    const query = current.client.from('jaygrid_plans');
    if (req.method === 'GET') {
      const { data, error } = await query.select('entries,version').eq('user_id', current.user.id).eq('term', WATCHLIST_ROW).maybeSingle();
      current.save();
      if (error || (data && !validWatchlist(data.entries))) return json(res, 502, { error: 'Could not load your watchlist.' });
      return json(res, 200, { items: data?.entries || [], version: Number(data?.version) || 0 });
    }
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid watchlist data.' }); }
    if (!body || !validWatchlist(body.items) || !Number.isSafeInteger(body.version) || body.version < 0)
      return json(res, 400, { error: 'Invalid watchlist data.' });
    const update = { entries: body.items, version: body.version + 1, updated_at: new Date().toISOString() };
    let result;
    if (body.version === 0) {
      result = await query.insert({ user_id: current.user.id, term: WATCHLIST_ROW, ...update }).select('version').maybeSingle();
      if (result.error?.code === '23505') return json(res, 409, { error: 'Your watchlist changed on another device. Reload before saving.' });
    } else {
      result = await query.update(update).eq('user_id', current.user.id).eq('term', WATCHLIST_ROW)
        .eq('version', body.version).select('version').maybeSingle();
    }
    current.save();
    if (result.error) return json(res, 502, { error: 'Could not save your watchlist.' });
    if (!result.data) return json(res, 409, { error: 'Your watchlist changed on another device. Reload before saving.' });
    return json(res, 200, { version: Number(result.data.version) });
  }
  if (url.pathname === '/api/plan' && (req.method === 'GET' || req.method === 'PUT')) {
    if (req.method === 'PUT' && !sameOrigin(req)) return json(res, 403, { error: 'Invalid request origin.' });
    const current = await account(req);
    if (!current) return json(res, 401, { error: 'Sign in to save your plan.' });
    const term = url.searchParams.get('term') || DEFAULT_TERM;
    if (!validTerm(term)) return json(res, 400, { error: 'Invalid semester.' });
    const query = current.client.from('jaygrid_plans');
    if (req.method === 'GET') {
      const { data, error } = await query.select('entries,version').eq('user_id', current.user.id).eq('term', term).maybeSingle();
      current.save();
      if (error) return json(res, 502, { error: 'Could not load your cloud plan.' });
      const schedules = normalizedSchedules(data?.entries || []);
      if (!schedules) return json(res, 502, { error: 'Your cloud schedules could not be read.' });
      return json(res, 200, { schedules, version: Number(data?.version) || 0 });
    }
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid plan data.' }); }
    if (!validSchedules(body.schedules) || !Number.isSafeInteger(body.version) || body.version < 0)
      return json(res, 400, { error: 'Invalid plan data.' });
    const update = { entries: body.schedules, version: body.version + 1, updated_at: new Date().toISOString() };
    let result;
    if (body.version === 0) {
      result = await query.insert({ user_id: current.user.id, term, ...update }).select('version').maybeSingle();
      if (result.error?.code === '23505') return json(res, 409, { error: 'This plan changed on another device. Reload before saving.' });
    } else {
      result = await query.update(update).eq('user_id', current.user.id).eq('term', term)
        .eq('version', body.version).select('version').maybeSingle();
    }
    current.save();
    if (result.error) return json(res, 502, { error: 'Could not save your cloud plan.' });
    if (!result.data) return json(res, 409, { error: 'This plan changed on another device. Reload before saving.' });
    return json(res, 200, { version: Number(result.data.version) });
  }
  const response = await site.fetch(new Request(new URL(req.url, origin), { method: req.method }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

http.createServer((req, res) => {
  handle(req, res).catch(() => json(res, 500, { error: 'JayGrid server error.' }));
}).listen(port, host, () => console.log(`JayGrid is running at ${origin}/`));
