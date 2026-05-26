import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';

// Set the env BEFORE importing the app so the DB opens at a throwaway path and
// dev-login is enabled (same pattern as the unit tests). A fresh temp DB keeps
// this suite isolated from the others.
process.env.VRP_DB_PATH = join(tmpdir(), `vrp-api-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.AUTH_MODE = 'dev';
process.env.AUTH_SECRET = 'test-secret-not-for-prod';
// Force the deterministic rule engine. Set to '' (not delete): dotenv never overrides
// an already-set var, so even if something loads a dev .env, the key stays empty and
// Boolean(process.env.ANTHROPIC_API_KEY) is false. (`createApp()` no longer imports
// `./env`, so nothing reintroduces it here anyway.)
process.env.ANTHROPIC_API_KEY = '';

const { createApp } = await import('../src/app');
const { bootstrapMultiTenancy } = await import('../src/services/bootstrap');

bootstrapMultiTenancy();
const app = createApp();

const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'];

/** Logs in via dev-login and returns a cookie-persisting agent + its CSRF token. */
async function login(opts: { email: string; role?: string; tenant?: string }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/dev-login').send(opts);
  assert.equal(res.status, 200, `dev-login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, csrf: res.body.data.csrfToken as string };
}

test('GET /api/health is public and reports the engine status', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, 'ok');
  assert.equal(res.body.data.aiEngineAvailable, false); // no ANTHROPIC_API_KEY in tests
});

test('unauthenticated API requests are rejected with 401', async () => {
  const res = await request(app).get('/api/assessments');
  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
});

test('an authenticated analyst can list assessments', async () => {
  const { agent } = await login({ email: 'analyst@acme.test', role: 'Analyst', tenant: 'Acme' });
  const res = await agent.get('/api/assessments');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
});

test('mutations without the CSRF token are rejected with 403', async () => {
  const { agent } = await login({ email: 'csrf@acme.test', role: 'Analyst', tenant: 'Acme' });
  const res = await agent
    .post('/api/assessments')
    .send({ vendor_name: 'No CSRF Co', questionnaire_type: 'SIG', date_submitted: '2026-05-25' });
  assert.equal(res.status, 403);
});

test('analyst flow: load scenario → analyze → approve', async () => {
  const { agent, csrf } = await login({ email: 'flow@acme.test', role: 'Analyst', tenant: 'Flow Co' });

  // Load a built-in demo scenario as a fixture (status `extracted`).
  const loaded = await agent.post('/api/demo/scenarios/securehealth/load').set('x-csrf-token', csrf);
  assert.equal(loaded.status, 201, `scenario load failed: ${loaded.status} ${JSON.stringify(loaded.body)}`);
  const id = loaded.body.data.id as number;
  assert.equal(loaded.body.data.status, 'extracted');

  // Analyze with the deterministic rule engine.
  const analyzed = await agent.post(`/api/assessments/${id}/analyze`).set('x-csrf-token', csrf);
  assert.equal(analyzed.status, 200, `analyze failed: ${analyzed.status} ${JSON.stringify(analyzed.body)}`);
  assert.ok(RISK_LEVELS.includes(analyzed.body.data.overall_risk), 'overall_risk is a valid band');
  assert.ok(analyzed.body.data.findings.length > 0, 'analysis produced findings');

  // The human analyst approves (validation is the human-in-the-loop gate).
  const approved = await agent
    .patch(`/api/assessments/${id}`)
    .set('x-csrf-token', csrf)
    .send({ validation_status: 'approved' });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.data.validation_status, 'approved');
});

test('RBAC: a Viewer cannot create an assessment', async () => {
  const { agent, csrf } = await login({ email: 'viewer@acme.test', role: 'Viewer', tenant: 'Acme' });
  const res = await agent
    .post('/api/assessments')
    .set('x-csrf-token', csrf)
    .send({ vendor_name: 'Viewer Co', questionnaire_type: 'SIG', date_submitted: '2026-05-25' });
  assert.equal(res.status, 403);
});

test('tenant isolation: one tenant cannot read another tenant’s assessment', async () => {
  const a = await login({ email: 'analyst@tenant-a.test', role: 'Analyst', tenant: 'Tenant A' });
  const b = await login({ email: 'analyst@tenant-b.test', role: 'Analyst', tenant: 'Tenant B' });

  const created = await a.agent.post('/api/demo/scenarios/securehealth/load').set('x-csrf-token', a.csrf);
  assert.equal(created.status, 201);
  const id = created.body.data.id as number;

  // Tenant A's owner can read it; Tenant B gets a 404 (no existence leak / IDOR closed).
  assert.equal((await a.agent.get(`/api/assessments/${id}`)).status, 200);
  assert.equal((await b.agent.get(`/api/assessments/${id}`)).status, 404);
});
