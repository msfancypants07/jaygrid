import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const user = { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
let plan = null;
const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('content-type', 'application/json');
  if (url.pathname === '/auth/v1/token') {
    res.end(JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600, user }));
  } else if (url.pathname === '/auth/v1/user') {
    res.end(JSON.stringify(user));
  } else if (url.pathname === '/rest/v1/jaygrid_plans' && req.method === 'GET') {
    res.end(JSON.stringify(plan ? [plan] : []));
  } else if (url.pathname === '/rest/v1/jaygrid_plans' && req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk;
    if (plan) { res.statusCode = 409; res.end(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint' })); }
    else { plan = JSON.parse(body); res.statusCode = 201; res.end(JSON.stringify([{ version: plan.version }])); }
  } else if (url.pathname === '/rest/v1/jaygrid_plans' && req.method === 'PATCH') {
    let body = ''; for await (const chunk of req) body += chunk;
    if (plan && Number(url.searchParams.get('version')?.replace('eq.', '')) === plan.version) {
      plan = { ...plan, ...JSON.parse(body) }; res.end(JSON.stringify([{ version: plan.version }]));
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
  const saved = await fetch(`${appOrigin}/api/plan`, { method: 'PUT', headers: { ...headers, origin: appOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ entries: [entry], version: 0 }) });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).version, 1);
  const loaded = await (await fetch(`${appOrigin}/api/plan`, { headers })).json();
  assert.equal(loaded.entries[0].code, 'EN.601.415');
  const updated = await fetch(`${appOrigin}/api/plan`, { method: 'PUT', headers: { ...headers, origin: appOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ entries: [], version: 1 }) });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).version, 2);
  const oldVersion = await fetch(`${appOrigin}/api/plan`, { method: 'PUT', headers: { ...headers, origin: appOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ entries: [entry], version: 1 }) });
  assert.equal(oldVersion.status, 409);
  const stale = await fetch(`${appOrigin}/api/plan`, { method: 'PUT', headers: { ...headers, origin: appOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ entries: [], version: 0 }) });
  assert.equal(stale.status, 409);
  const signout = await fetch(`${appOrigin}/api/signout`, { method: 'POST', headers: { ...headers, origin: appOrigin } });
  assert.equal(signout.status, 200);
  assert.equal((await (await fetch(`${appOrigin}/api/account`, { headers })).json()).user, null);
  console.log('Google callback, cloud plan, conflict protection, and sign-out passed.');
} finally {
  app.kill('SIGTERM');
  fake.close();
}
