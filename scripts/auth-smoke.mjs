import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
const plans = new Map();
const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/auth/v1/token') {
    res.end(JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600, user }));
  } else if (url.pathname === '/auth/v1/user') {
    res.end(JSON.stringify(user));
  } else if (url.pathname === '/rest/v1/jaygrid_plans' && req.method === 'GET') {
    res.end(JSON.stringify(plans.has(url.searchParams.get('term')) ? [plans.get(url.searchParams.get('term'))] : []));
  } else if (url.pathname === '/rest/v1/jaygrid_plans' && req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk;
    const plan = JSON.parse(body);
    if (plans.has('eq.' + plan.term)) { res.statusCode = 409; res.end(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint' })); }
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
const fakePort = fake.address().port;
const appPort = fakePort + 1;
const appOrigin = `http://127.0.0.1:${appPort}`;
const app = spawn(process.execPath, ['start.mjs'], {
  cwd: new URL('../local/', import.meta.url),
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(appPort), PUBLIC_ORIGIN: appOrigin,
    SUPABASE_URL: `http://127.0.0.1:${fakePort}`, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
try {
  await Promise.race([once(app.stdout, 'data'), once(app, 'exit').then(() => { throw new Error('JayGrid exited before starting'); })]);
  const login = await fetch(`${appOrigin}/auth/login`, { redirect: 'manual' });
  assert.equal(login.status, 302);
  assert.match(login.headers.get('location'), /provider=google/);
  const flow = login.headers.get('set-cookie').split(';')[0];
  const callback = await fetch(`${appOrigin}/auth/callback?code=test-code`, { redirect: 'manual', headers: { cookie: flow } });
  assert.equal(callback.status, 302);
  const session = callback.headers.get('set-cookie').split(', ').find(x => x.startsWith('jaygrid_session='))?.split(';')[0];
  assert.ok(session);
  const headers = { cookie: session };
  const account = await (await fetch(`${appOrigin}/api/account`, { headers })).json();
  assert.equal(account.user.email, user.email);
  const first = await (await fetch(`${appOrigin}/api/plan`, { headers })).json();
  assert.equal(first.version, 0);
  const entry = { id: crypto.randomUUID(), title: 'Databases', code: 'EN.601.415', meetings: [] };
  const schedules = [{ id: 'default', name: 'Schedule 1', entries: [entry] }, { id: crypto.randomUUID(), name: 'Option 2', entries: [] }];
  const saved = await fetch(`${appOrigin}/api/plan`, { method: 'PUT', headers: { ...headers, origin: appOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ schedules, version: 0 }) });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).version, 1);
  const loaded = await (await fetch(`${appOrigin}/api/plan`, { headers })).json();
  assert.equal(loaded.schedules[0].entries[0].code, 'EN.601.415');
  assert.equal(loaded.schedules[1].name, 'Option 2');
  const fall = await (await fetch(`${appOrigin}/api/plan?term=Fall%202026`, { headers })).json();
  assert.equal(fall.version, 0);
  const emptyWatchlist = await (await fetch(`${appOrigin}/api/watchlist`, { headers })).json();
  assert.deepEqual(emptyWatchlist, { items: [], version: 0 });
  const watched = [{ code: 'EN.601.415', title: 'Databases', notes: 'Take later', addedAt: new Date().toISOString(), seenTerms: ['Fall 2026'], checks: {} }];
  const watchSave = await fetch(`${appOrigin}/api/watchlist`, { method: 'PUT', headers: { ...headers, origin: appOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ items: watched, version: 0 }) });
  assert.equal(watchSave.status, 200);
  assert.equal((await (await fetch(`${appOrigin}/api/watchlist`, { headers })).json()).items[0].notes, 'Take later');
  const updated = await fetch(`${appOrigin}/api/plan`, { method: 'PUT', headers: { ...headers, origin: appOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ schedules: [{ ...schedules[0], entries: [] }, schedules[1]], version: 1 }) });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).version, 2);
  const oldVersion = await fetch(`${appOrigin}/api/plan`, { method: 'PUT', headers: { ...headers, origin: appOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ schedules, version: 1 }) });
  assert.equal(oldVersion.status, 409);
  const stale = await fetch(`${appOrigin}/api/plan`, { method: 'PUT', headers: { ...headers, origin: appOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ schedules, version: 0 }) });
  assert.equal(stale.status, 409);
  const signout = await fetch(`${appOrigin}/api/signout`, { method: 'POST', headers: { ...headers, origin: appOrigin } });
  assert.equal(signout.status, 200);
  assert.equal((await (await fetch(`${appOrigin}/api/account`, { headers })).json()).user, null);
  console.log('Google callback, cloud plan, conflict protection, and sign-out passed.');
} finally {
  app.kill('SIGTERM');
  fake.close();
}
