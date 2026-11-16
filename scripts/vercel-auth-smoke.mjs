import http from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { handle } from '../server/handler.mjs';

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const plans = new Map();
const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/auth/v1/token') res.end(JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600, user }));
  else if (url.pathname === '/auth/v1/user') res.end(JSON.stringify(user));
  else if (url.pathname === '/rest/v1/jaygrid_plans' && req.method === 'GET') res.end(JSON.stringify(plans.has(url.searchParams.get('term')) ? [plans.get(url.searchParams.get('term'))] : []));
  else if (url.pathname === '/rest/v1/jaygrid_plans' && req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk;
    const plan = JSON.parse(body);
    if (plans.has('eq.' + plan.term)) { res.statusCode = 409; res.end(JSON.stringify({ code: '23505', message: 'duplicate key' })); }
    else { plans.set('eq.' + plan.term, plan); res.statusCode = 201; res.end(JSON.stringify([{ version: plan.version }])); }
  } else if (url.pathname === '/rest/v1/jaygrid_plans' && req.method === 'PATCH') {
    let body = ''; for await (const chunk of req) body += chunk;
    const plan = plans.get(url.searchParams.get('term'));
    if (plan && Number(url.searchParams.get('version')?.replace('eq.', '')) === plan.version) {
      const next = { ...plan, ...JSON.parse(body) }; plans.set(url.searchParams.get('term'), next); res.end(JSON.stringify([{ version: next.version }]));
    } else res.end('[]');
  } else { res.statusCode = 404; res.end('{}'); }
});
fake.listen(0, '127.0.0.1');
await once(fake, 'listening');
const origin = 'https://jaygrid.example';
process.env.SUPABASE_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
process.env.PUBLIC_ORIGIN = origin;
process.env.SESSION_SECRET = 'a'.repeat(64);
const request = (path, init = {}) => new Request(origin + path, init);
try {
  const login = await handle(request('/auth/login'));
  assert.equal(login.status, 302);
  assert.match(login.headers.get('location'), /provider=google/);
  const flow = login.headers.getSetCookie()[0].split(';')[0];
  const callback = await handle(request('/auth/callback?code=test-code', { headers: { cookie: flow } }));
  assert.equal(callback.status, 302);
  const session = callback.headers.getSetCookie().find(x => x.startsWith('jaygrid_session='))?.split(';')[0];
  assert.ok(session);
  assert.match(session, /^jaygrid_session=/);
  const account = await (await handle(request('/api/account', { headers: { cookie: session } }))).json();
  assert.equal(account.user.email, user.email);
  const altered = session.slice(0, -1) + (session.endsWith('A') ? 'B' : 'A');
  const invalid = await (await handle(request('/api/account', { headers: { cookie: altered } }))).json();
  assert.equal(invalid.user, null);
  const empty = await (await handle(request('/api/plan', { headers: { cookie: session } }))).json();
  assert.equal(empty.version, 0);
  const entry = { id: crypto.randomUUID(), title: 'Databases', code: 'EN.601.415', meetings: [] };
  plans.set('eq.Spring 2027', { entries: [entry], version: 3 });
  const legacy = await (await handle(request('/api/plan', { headers: { cookie: session } }))).json();
  assert.equal(legacy.version, 3);
  assert.equal(legacy.schedules[0].entries[0].code, entry.code);
  plans.delete('eq.Spring 2027');
  const schedules = [{ id: 'default', name: 'Schedule 1', entries: [entry] }, { id: crypto.randomUUID(), name: 'Alternative', entries: [] }];
  const save = await handle(request('/api/plan?term=Spring%202027', { method: 'PUT', headers: { cookie: session, origin, 'content-type': 'application/json' }, body: JSON.stringify({ schedules, version: 0 }) }));
  assert.equal(save.status, 200);
  const loaded = await (await handle(request('/api/plan', { headers: { cookie: session } }))).json();
  assert.equal(loaded.schedules[0].entries[0].code, entry.code);
  assert.equal(loaded.schedules[1].name, 'Alternative');
  const fall = await (await handle(request('/api/plan?term=Fall%202026', { headers: { cookie: session } }))).json();
  assert.equal(fall.version, 0);
  assert.equal(fall.schedules[0].entries.length, 0);
  const fallSave = await handle(request('/api/plan?term=Fall%202026', { method: 'PUT', headers: { cookie: session, origin, 'content-type': 'application/json' }, body: JSON.stringify({ schedules: [{ id: 'default', name: 'Fall plan', entries: [] }], version: 0 }) }));
  assert.equal(fallSave.status, 200);
  const springAgain = await (await handle(request('/api/plan?term=Spring%202027', { headers: { cookie: session } }))).json();
  assert.equal(springAgain.schedules[0].entries[0].code, entry.code);
  const conflict = await handle(request('/api/plan', { method: 'PUT', headers: { cookie: session, origin, 'content-type': 'application/json' }, body: JSON.stringify({ schedules, version: 0 }) }));
  assert.equal(conflict.status, 409);
  const csrf = await handle(request('/api/plan', { method: 'PUT', headers: { cookie: session, origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ schedules, version: 1 }) }));
  assert.equal(csrf.status, 403);
  console.log('Vercel sign-in, encrypted cookie, cloud plan, conflict, and origin checks passed.');
} finally { fake.close(); }
