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

test('DELETE /assessments/:id: non-admin gets 403', async () => {
  const { agent, csrf } = await login({ email: 'analyst-nodelete@acme.test', role: 'Analyst', tenant: 'Acme' });
  const res = await agent.delete('/api/assessments/1').set('x-csrf-token', csrf);
  assert.equal(res.status, 403);
});

test('DELETE /assessments/:id: admin deletes successfully and assessment is gone', async () => {
  // Create the assessment as an analyst (needs a tenant context for writes).
  const analyst = await login({ email: 'analyst-for-del@acme.test', role: 'Analyst', tenant: 'DelCo' });
  const created = await analyst.agent.post('/api/demo/scenarios/securehealth/load').set('x-csrf-token', analyst.csrf);
  assert.equal(created.status, 201, `scenario load failed: ${JSON.stringify(created.body)}`);
  const id = created.body.data.id as number;

  // Admin in all-tenants mode can delete any assessment.
  const admin = await login({ email: 'admin-delete@acme.test', role: 'Admin' });
  const deleted = await admin.agent.delete(`/api/assessments/${id}`).set('x-csrf-token', admin.csrf);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.data.deleted, true);

  // Assessment is gone from the analyst's view too.
  const check = await analyst.agent.get(`/api/assessments/${id}`);
  assert.equal(check.status, 404);
});

test('DELETE /assessments/:id: 404 for non-existent id', async () => {
  const { agent, csrf } = await login({ email: 'admin-404del@acme.test', role: 'Admin' });
  const res = await agent.delete('/api/assessments/999999').set('x-csrf-token', csrf);
  assert.equal(res.status, 404);
});

test('GET /api/assessments/:id/export.json: valid JSON with correct shape', async () => {
  const { agent, csrf } = await login({ email: 'grc-export@acme.test', role: 'Analyst', tenant: 'GRC Co' });

  const loaded = await agent.post('/api/demo/scenarios/securehealth/load').set('x-csrf-token', csrf);
  assert.equal(loaded.status, 201, `scenario load failed: ${JSON.stringify(loaded.body)}`);
  const id = loaded.body.data.id as number;

  const analyzed = await agent.post(`/api/assessments/${id}/analyze`).set('x-csrf-token', csrf);
  assert.equal(analyzed.status, 200, `analyze failed: ${JSON.stringify(analyzed.body)}`);

  const res = await agent.get(`/api/assessments/${id}/export.json`);
  assert.equal(res.status, 200);
  assert.ok(res.headers['content-type'].includes('application/json'), 'content-type must be application/json');

  const body = JSON.parse(res.text as string);
  for (const key of [
    'schema_version',
    'disclaimer',
    'vendor',
    'assessment',
    'summary',
    'controls',
    'follow_up_questions',
  ]) {
    assert.ok(key in body, `missing top-level key: ${key}`);
  }
  assert.equal(body.summary.control_count, body.controls.length, 'control_count must equal controls.length');
  assert.ok(Array.isArray(body.controls), 'controls must be an array');
  if (body.controls.length > 0) {
    const ctrl = body.controls[0];
    assert.ok('question_id' in ctrl, 'control missing question_id');
    assert.ok('control_domain' in ctrl, 'control missing control_domain');
    assert.ok('risk_level' in ctrl, 'control missing risk_level');
    assert.ok(Array.isArray(ctrl.framework_mappings), 'framework_mappings must be an array');
  }
  assert.equal(body.schema_version, '1.0');
  assert.ok(typeof body.disclaimer === 'string' && body.disclaimer.length > 0);
});

test('GET /api/assessments/:id/export.json: analyst overrides are reflected via effectiveFinding', async () => {
  const { agent, csrf } = await login({ email: 'grc-override@acme.test', role: 'Analyst', tenant: 'Override Co' });

  const loaded = await agent.post('/api/demo/scenarios/securehealth/load').set('x-csrf-token', csrf);
  assert.equal(loaded.status, 201, `scenario load failed: ${JSON.stringify(loaded.body)}`);
  const id = loaded.body.data.id as number;

  const analyzed = await agent.post(`/api/assessments/${id}/analyze`).set('x-csrf-token', csrf);
  assert.equal(analyzed.status, 200, `analyze failed: ${JSON.stringify(analyzed.body)}`);
  const findings = analyzed.body.data.findings as Array<{ id: number; risk_level: string }>;
  assert.ok(findings.length > 0, 'need at least one finding to override');

  const target = findings[0];
  const overriddenRisk = target.risk_level === 'Critical' ? 'Low' : 'Critical';
  const overrideFuq = 'Analyst override follow-up question';

  const patched = await agent
    .patch(`/api/findings/${target.id}`)
    .set('x-csrf-token', csrf)
    .send({ risk_level: overriddenRisk, follow_up_questions: [overrideFuq], analyst_status: 'overridden' });
  assert.equal(patched.status, 200, `PATCH finding failed: ${JSON.stringify(patched.body)}`);

  const res = await agent.get(`/api/assessments/${id}/export.json`);
  assert.equal(res.status, 200);
  const body = JSON.parse(res.text as string);

  const overriddenControl = body.controls.find((c: { follow_up_questions: string[] }) =>
    c.follow_up_questions.includes(overrideFuq),
  );
  assert.ok(overriddenControl, 'export must contain the control with the overridden follow-up question');
  assert.equal(overriddenControl.risk_level, overriddenRisk, 'export control must use analyst-overridden risk_level');

  assert.ok(
    (body.follow_up_questions as string[]).includes(overrideFuq),
    'top-level follow_up_questions must include the analyst-overridden question',
  );

  const dist: Record<string, number> = body.summary.risk_distribution;
  assert.ok((dist[overriddenRisk] ?? 0) >= 1, `risk_distribution must count at least one ${overriddenRisk}`);
});

test('GET /api/assessments/:id/export.json: 404 for nonexistent assessment', async () => {
  const { agent } = await login({ email: 'grc-404@acme.test', role: 'Analyst', tenant: 'Acme' });
  const res = await agent.get('/api/assessments/999999/export.json');
  assert.equal(res.status, 404);
});

test('GET /api/assessments/:id/export.json: unauthenticated request returns 401', async () => {
  const res = await request(app).get('/api/assessments/1/export.json');
  assert.equal(res.status, 401);
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
