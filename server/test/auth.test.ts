import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated temp DB + policy env, set BEFORE importing the module under test.
process.env.VRP_DB_PATH = join(tmpdir(), `vrp-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
process.env.ALLOWED_EMAIL_DOMAINS = 'acme.com, partner.com';
process.env.ADMIN_EMAILS = 'boss@acme.com';
process.env.DEFAULT_ROLE = 'Analyst';
process.env.AUTH_SECRET = 'unit-test-secret';

const auth = await import('../src/services/auth');

test('domain allow-list permits configured domains and rejects others', () => {
  assert.equal(auth.isAllowedDomain('alice@acme.com'), true);
  assert.equal(auth.isAllowedDomain('bob@partner.com'), true);
  assert.equal(auth.isAllowedDomain('eve@evil.com'), false);
  assert.equal(auth.isAllowedDomain('not-an-email'), false);
});

test('role policy: admin allow-list wins, otherwise default / existing role', () => {
  assert.equal(auth.resolveRole('boss@acme.com'), 'Admin');
  assert.equal(auth.resolveRole('boss@acme.com', 'Viewer'), 'Admin'); // allow-list overrides
  assert.equal(auth.resolveRole('alice@acme.com'), 'Analyst'); // default
  assert.equal(auth.resolveRole('alice@acme.com', 'Viewer'), 'Viewer'); // existing kept
});

test('upsertUserOnLogin enforces domain and assigns role', () => {
  const admin = auth.upsertUserOnLogin({ email: 'Boss@Acme.com', name: 'Boss' });
  assert.equal(admin.email, 'boss@acme.com'); // normalised
  assert.equal(admin.role, 'Admin');

  const analyst = auth.upsertUserOnLogin({ email: 'alice@acme.com' });
  assert.equal(analyst.role, 'Analyst');

  assert.throws(() => auth.upsertUserOnLogin({ email: 'eve@evil.com' }), auth.AuthPolicyError);
  assert.throws(() => auth.upsertUserOnLogin({ email: 'garbage' }), auth.AuthPolicyError);
});

test('re-login preserves a user role and updates name', () => {
  auth.upsertUserOnLogin({ email: 'carol@acme.com', name: 'Carol' });
  const again = auth.upsertUserOnLogin({ email: 'carol@acme.com', name: 'Carol R.' });
  assert.equal(again.role, 'Analyst');
  assert.equal(again.name, 'Carol R.');
});

test('magic token round-trips, and rejects tampered or expired tokens', () => {
  const token = auth.createMagicToken('alice@acme.com');
  assert.equal(auth.verifyMagicToken(token), 'alice@acme.com');

  // Tampered signature
  const [body] = token.split('.');
  assert.equal(auth.verifyMagicToken(`${body}.deadbeef`), null);
  assert.equal(auth.verifyMagicToken('not-a-token'), null);

  // Expired (force a negative TTL just for this creation)
  const original = auth.authConfig.magicTokenTtlMs;
  auth.authConfig.magicTokenTtlMs = -1000;
  const expired = auth.createMagicToken('alice@acme.com');
  auth.authConfig.magicTokenTtlMs = original;
  assert.equal(auth.verifyMagicToken(expired), null);
});

test('email validation', () => {
  assert.equal(auth.isValidEmail('a@b.co'), true);
  assert.equal(auth.isValidEmail('bad'), false);
  assert.equal(auth.isValidEmail('a@b'), false);
});
