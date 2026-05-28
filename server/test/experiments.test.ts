import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import request from 'supertest';

// Set env BEFORE importing anything that opens the DB / reads experiment config. A
// fresh temp DB + a temp registry file keep this suite isolated. experimentsConfig is
// read at module load, so EXPERIMENTS_READ_TOKEN must be set here too.
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
process.env.VRP_DB_PATH = join(tmpdir(), `vrp-exp-${suffix}.db`);
process.env.AUTH_MODE = 'dev';
process.env.AUTH_SECRET = 'test-secret-not-for-prod';
process.env.ANTHROPIC_API_KEY = '';
process.env.EXPERIMENTS_READ_TOKEN = 'test-results-token';
// GH_OAUTH_CLIENT_ID intentionally unset → the device relay returns 503 (no GitHub calls).

const REGISTRY_PATH = join(tmpdir(), `vrp-exp-registry-${suffix}.json`);
writeFileSync(
  REGISTRY_PATH,
  JSON.stringify({
    experiments: [
      {
        key: 'reg-exp',
        name: 'Registry experiment',
        status: 'running',
        variants: [
          { key: 'control', weight: 50 },
          { key: 'treatment', weight: 50 },
        ],
        targeting: { roles: ['Analyst'] },
        metrics: { primary: 'reg_converted' },
      },
    ],
  }),
);
process.env.VRP_EXPERIMENTS_PATH = REGISTRY_PATH;

const exp = await import('../src/services/experiments');
const { db } = await import('../src/db');
const { createApp } = await import('../src/app');
const { bootstrapMultiTenancy } = await import('../src/services/bootstrap');
import type { AccessScope } from '../src/routes/_helpers';
import type { Experiment } from '../src/types';

bootstrapMultiTenancy();
const app = createApp();

function scope(over: Partial<AccessScope> = {}): AccessScope {
  return {
    actor: 'u@test',
    userId: 1,
    isAdmin: false,
    activeTenantId: 1,
    effectiveRole: 'Analyst',
    ownOnly: false,
    ...over,
  };
}

const running: Experiment = {
  key: 'unit-exp',
  name: 'Unit',
  status: 'running',
  variants: [
    { key: 'control', weight: 50 },
    { key: 'treatment', weight: 50 },
  ],
};

// ---- Deterministic assignment ----------------------------------------------

test('bucket is deterministic and in range 0..99', () => {
  assert.equal(exp.bucket('k', '42'), exp.bucket('k', '42'));
  for (let i = 0; i < 200; i++) {
    const b = exp.bucket('k', String(i));
    assert.ok(b >= 0 && b < 100 && Number.isInteger(b));
  }
  // Different experiment key for the same subject generally lands elsewhere.
  assert.notEqual(exp.bucket('a', '7'), exp.bucket('b', '7'));
});

test('assignVariant is sticky and only assigns for running experiments', () => {
  const s = scope({ userId: 123 });
  const first = exp.assignVariant(running, s);
  assert.ok(first === 'control' || first === 'treatment');
  assert.equal(exp.assignVariant(running, s), first); // sticky
  assert.equal(exp.assignVariant({ ...running, status: 'draft' }, s), null);
  assert.equal(exp.assignVariant({ ...running, status: 'paused' }, s), null);
});

test('assignVariant respects the start/end window', () => {
  const s = scope({ userId: 7 });
  assert.equal(exp.assignVariant({ ...running, start: '2020-01-01', end: '2020-12-31' }, s), null); // expired
  assert.equal(exp.assignVariant({ ...running, start: '2099-01-01' }, s), null); // not started yet
  const live = { ...running, start: '2000-01-01', end: '2099-12-31' };
  assert.ok(['control', 'treatment'].includes(exp.assignVariant(live, s) as string));
  assert.ok(exp.withinWindow(live));
  assert.equal(exp.withinWindow({ ...running, end: '2000-01-01' }), false);
});

test('weights are respected across many subjects (~50/50)', () => {
  let treatment = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) {
    if (exp.assignVariant(running, scope({ userId: i })) === 'treatment') treatment++;
  }
  const share = treatment / n;
  assert.ok(share > 0.45 && share < 0.55, `treatment share ${share} should be ~0.5`);
});

test('targeting gates by role and tenant', () => {
  const roleTargeted: Experiment = { ...running, targeting: { roles: ['Analyst'] } };
  assert.ok(exp.eligible(roleTargeted, scope({ effectiveRole: 'Analyst' })));
  assert.equal(exp.eligible(roleTargeted, scope({ effectiveRole: 'Viewer' })), false);
  assert.equal(exp.assignVariant(roleTargeted, scope({ effectiveRole: 'Viewer' })), null);

  const tenantTargeted: Experiment = { ...running, targeting: { tenants: [12, 14] } };
  assert.ok(exp.eligible(tenantTargeted, scope({ activeTenantId: 12 })));
  assert.equal(exp.eligible(tenantTargeted, scope({ activeTenantId: 99 })), false);
  // Admin "all tenants" mode (activeTenantId null) is not in any tenant-targeted experiment.
  assert.equal(exp.eligible(tenantTargeted, scope({ activeTenantId: null })), false);
});

test('evaluateAll returns only running + eligible experiments from the registry', () => {
  const analyst = exp.evaluateAll(scope({ effectiveRole: 'Analyst' }));
  assert.ok(analyst['reg-exp'] === 'control' || analyst['reg-exp'] === 'treatment');
  const viewer = exp.evaluateAll(scope({ effectiveRole: 'Viewer' }));
  assert.equal(viewer['reg-exp'], undefined); // not targeted
});

// ---- Telemetry + results ----------------------------------------------------

test('recordExposure is idempotent per (experiment, user)', () => {
  const s = scope({ userId: 5001 });
  exp.recordExposure('idem-exp', 'control', s);
  exp.recordExposure('idem-exp', 'treatment', s); // ignored: PK already exists
  const row = db
    .prepare('SELECT COUNT(*) AS n, MAX(variant) AS v FROM experiment_exposures WHERE exp_key = ? AND user_id = ?')
    .get('idem-exp', 5001) as { n: number; v: string };
  assert.equal(row.n, 1);
  assert.equal(row.v, 'control'); // first write wins
});

test('recordEvent attributes only to exposed experiments that declare the metric (exp_key-bound)', () => {
  const s = scope({ userId: 7777 });
  assert.equal(exp.recordEvent('reg_converted', s), 0); // not exposed yet → nothing recorded
  exp.recordExposure('reg-exp', 'treatment', s);
  assert.equal(exp.recordEvent('reg_converted', s), 1); // exposed + declared metric → one bound row
  assert.equal(exp.recordEvent('not-a-real-metric', s), 0); // undeclared metric → allow-listed out
  const rows = db.prepare('SELECT exp_key, metric FROM experiment_events WHERE user_id = ?').all(7777) as Array<{
    exp_key: string;
    metric: string;
  }>;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].exp_key, 'reg-exp'); // event is bound to the specific experiment
});

test('computeResults: per-variant rates + a significant z-test', () => {
  const seed: Experiment = {
    key: 'seed-exp',
    name: 'Seed',
    status: 'running',
    variants: [
      { key: 'control', weight: 50 },
      { key: 'treatment', weight: 50 },
    ],
    metrics: { primary: 'converted' },
  };
  const insE = db.prepare(
    'INSERT OR IGNORE INTO experiment_exposures (exp_key, variant, user_id, tenant_id, first_seen) VALUES (?,?,?,?,?)',
  );
  const insEv = db.prepare(
    'INSERT INTO experiment_events (exp_key, metric, user_id, tenant_id, ts) VALUES (?,?,?,?,?)',
  );
  const FS = '2026-01-01T00:00:00.000Z';
  const TS = '2026-01-02T00:00:00.000Z';
  db.transaction(() => {
    for (let u = 1; u <= 100; u++) insE.run('seed-exp', 'control', u, 1, FS);
    for (let u = 101; u <= 200; u++) insE.run('seed-exp', 'treatment', u, 1, FS);
    for (let u = 1; u <= 10; u++) insEv.run('seed-exp', 'converted', u, 1, TS); // 10/100 control
    for (let u = 101; u <= 125; u++) insEv.run('seed-exp', 'converted', u, 1, TS); // 25/100 treatment
  })();

  const r = exp.computeResults(seed);
  const control = r.variants.find((v) => v.key === 'control');
  const treatment = r.variants.find((v) => v.key === 'treatment');
  assert.deepEqual([control?.exposed, control?.converted, control?.rate], [100, 10, 0.1]);
  assert.deepEqual([treatment?.exposed, treatment?.converted, treatment?.rate], [100, 25, 0.25]);
  assert.equal(r.comparisons.length, 1);
  const cmp = r.comparisons[0];
  assert.equal(cmp.variant, 'treatment');
  assert.ok(cmp.pValue !== null && cmp.pValue < 0.05, `p-value ${cmp.pValue} should be < 0.05`);
  assert.ok((cmp.ciLow ?? 0) > 0, '95% CI for the lift should exclude 0');
});

test('computeResults: a control-only experiment has a null comparison (no treatment exposures)', () => {
  const e: Experiment = {
    key: 'lonely',
    name: 'Lonely',
    status: 'running',
    variants: [
      { key: 'control', weight: 50 },
      { key: 'treatment', weight: 50 },
    ],
    metrics: { primary: 'm' },
  };
  db.prepare(
    'INSERT OR IGNORE INTO experiment_exposures (exp_key, variant, user_id, tenant_id, first_seen) VALUES (?,?,?,?,?)',
  ).run('lonely', 'control', 9001, 1, '2026-01-01T00:00:00.000Z');
  const r = exp.computeResults(e);
  assert.equal(r.comparisons[0].pValue, null);
});

// ---- Routes -----------------------------------------------------------------

async function login(opts: { email: string; role?: string; tenant?: string }) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/dev-login').send(opts);
  assert.equal(res.status, 200, `dev-login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, csrf: res.body.data.csrfToken as string };
}

test('GET /api/flags requires auth', async () => {
  const res = await request(app).get('/api/flags');
  assert.equal(res.status, 401);
});

test('GET /api/flags returns the targeted experiment for an Analyst', async () => {
  const { agent } = await login({ email: 'an@acme.test', role: 'Analyst', tenant: 'Acme' });
  const res = await agent.get('/api/flags');
  assert.equal(res.status, 200);
  assert.ok(['control', 'treatment'].includes(res.body.data['reg-exp']));
});

test('GET /api/flags omits the experiment for a non-targeted Viewer', async () => {
  const { agent } = await login({ email: 'vw@acme.test', role: 'Viewer', tenant: 'Acme' });
  const res = await agent.get('/api/flags');
  assert.equal(res.status, 200);
  assert.equal(res.body.data['reg-exp'], undefined);
});

test('POST expose records once, returns 404 for unknown experiment, and tracks events', async () => {
  const { agent, csrf } = await login({ email: 'ex@acme.test', role: 'Analyst', tenant: 'Acme' });

  const first = await agent.post('/api/experiments/reg-exp/expose').set('x-csrf-token', csrf);
  assert.equal(first.status, 200);
  assert.equal(first.body.data.recorded, true);
  assert.ok(['control', 'treatment'].includes(first.body.data.variant));

  const again = await agent.post('/api/experiments/reg-exp/expose').set('x-csrf-token', csrf);
  assert.equal(again.body.data.variant, first.body.data.variant); // stable

  const unknown = await agent.post('/api/experiments/does-not-exist/expose').set('x-csrf-token', csrf);
  assert.equal(unknown.status, 404);

  const ev = await agent.post('/api/events').set('x-csrf-token', csrf).send({ metric: 'reg_converted' });
  assert.equal(ev.status, 201);

  const badEv = await agent.post('/api/events').set('x-csrf-token', csrf).send({ metric: '' });
  assert.equal(badEv.status, 400);
});

test('GET results: 401 without token, 200 with the bearer token', async () => {
  const noToken = await request(app).get('/api/experiments/reg-exp/results');
  assert.equal(noToken.status, 401);

  const ok = await request(app)
    .get('/api/experiments/reg-exp/results')
    .set('authorization', 'Bearer test-results-token');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.key, 'reg-exp');
  assert.equal(ok.body.data.metric, 'reg_converted');
  assert.ok(Array.isArray(ok.body.data.variants));

  const unknown = await request(app)
    .get('/api/experiments/nope/results')
    .set('authorization', 'Bearer test-results-token');
  assert.equal(unknown.status, 404);
});

test('GET results: a GitHub token is gated on repo-collaborator (push) access', async () => {
  const realFetch = globalThis.fetch;
  // Distinct tokens per case so the per-token verification cache doesn't cross over.
  const ghJson = (body: unknown, status = 200) =>
    (async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })) as unknown as typeof fetch;
  try {
    globalThis.fetch = ghJson({ permissions: { push: false } }); // public-repo reader, not a collaborator
    const denied = await request(app).get('/api/experiments/reg-exp/results').set('authorization', 'Bearer gh_reader');
    assert.equal(denied.status, 403);

    globalThis.fetch = ghJson({ permissions: { push: true } }); // collaborator with write
    const allowed = await request(app).get('/api/experiments/reg-exp/results').set('authorization', 'Bearer gh_collab');
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.data.key, 'reg-exp');

    globalThis.fetch = ghJson({}, 401); // invalid/expired GitHub token
    const bad = await request(app).get('/api/experiments/reg-exp/results').set('authorization', 'Bearer gh_bad');
    assert.equal(bad.status, 401);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('POST /api/gh-device/code returns 503 when no GitHub client_id is configured', async () => {
  const res = await request(app).post('/api/gh-device/code').send({});
  assert.equal(res.status, 503);
});
