import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VRP_DB_PATH = join(tmpdir(), `vrp-invites-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);

const inv = await import('../src/services/invites');
const { createTenant } = await import('../src/services/tenantStore');

const t = createTenant('Acme');

test('create + find + accept is single-use', () => {
  const { invite, token } = inv.createInvite({
    email: 'a@x.com',
    tenantId: t.id,
    role: 'Analyst',
    invitedBy: 'admin@x.com',
  });
  assert.equal(invite.email, 'a@x.com');
  assert.equal(invite.role, 'Analyst');
  assert.equal(invite.tenant_name, 'Acme');

  const grant = inv.findValidInvite(token);
  assert.ok(grant);
  assert.equal(grant!.tenant_id, t.id);
  assert.equal(grant!.role, 'Analyst');

  inv.markInviteAccepted(grant!.id);
  assert.equal(inv.findValidInvite(token), null); // can't be reused
});

test('invalid / empty tokens return null', () => {
  assert.equal(inv.findValidInvite('not-a-real-token'), null);
  assert.equal(inv.findValidInvite(''), null);
});

test('listing + revoke invalidates the token', () => {
  const { token } = inv.createInvite({ email: 'b@x.com', tenantId: t.id, role: 'Viewer', invitedBy: 'admin@x.com' });
  const pending = inv.listPendingInvites().find((p) => p.email === 'b@x.com');
  assert.ok(pending);
  assert.equal(inv.revokeInvite(pending!.id), true);
  assert.ok(!inv.listPendingInvites().some((p) => p.email === 'b@x.com'));
  assert.equal(inv.findValidInvite(token), null);
});

test('re-inviting the same email+tenant replaces the prior pending invite', () => {
  const first = inv.createInvite({ email: 'c@x.com', tenantId: t.id, role: 'Analyst', invitedBy: 'admin@x.com' });
  const second = inv.createInvite({ email: 'c@x.com', tenantId: t.id, role: 'Submitter', invitedBy: 'admin@x.com' });
  assert.equal(inv.findValidInvite(first.token), null); // old token no longer valid
  const grant = inv.findValidInvite(second.token);
  assert.ok(grant);
  assert.equal(grant!.role, 'Submitter');
  assert.equal(inv.listPendingInvites().filter((p) => p.email === 'c@x.com').length, 1);
});
