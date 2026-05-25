# Spec 0003 — Multi-Tenancy & Tenant-Scoped RBAC

- **Status:** Implemented (2026-05-25)
- **Branch:** `main` (built on `feat/multi-tenant-rbac`)
- **Location:** `vendor-risk-portal/`
- **Related docs:** `specs/0001-vendor-risk-questionnaire-portal.md`, `specs/0002-enterprise-readiness.md` (§7 deferred this as a "future spec"), `README.md`, `API_CONTRACT.md`
- **Builds on:** Spec 0001 (auth + role base), Spec 0002 (enterprise readiness)

## 1. Problem Statement & Objective

Spec 0001 delivered a single-tenant analyst tool: every signed-in user saw every
vendor and assessment, gated only by a global role. Spec 0002 §7 explicitly listed
**multi-tenant data isolation** as out of scope and a candidate for a "future spec."
This is that spec, documented **as built**.

Objective: isolate vendor / assessment / audit data per **tenant**, add a
**global-admin** control plane to manage tenants, users, memberships and
invitations, and let one deployment serve multiple customer orgs — without changing
the analysis model, the risk-scoring math, or the Spec 0001 principle that *AI is
preliminary and a human analyst decides*.

## 2. Data Model

New tables (`server/src/db.ts`):

- **`tenants`** — `id`, `name`, `slug` (UNIQUE, auto-generated + collision-suffixed), `created_at`.
- **`memberships`** — `id`, `user_id`→users, `tenant_id`→tenants, `role` (`Analyst` | `Submitter` | `Viewer`, default `Viewer`), `created_at`; **UNIQUE(user_id, tenant_id)** (one role per user per tenant).
- **`invites`** — `id`, `email`, `tenant_id`, `role`, `token_hash` (UNIQUE, SHA-256 of the raw token), `invited_by`, `created_at`, `expires_at`, `accepted_at` (nullable, marks single-use).

New columns (added via the existing `ensureColumn` migration helper):

- `users.is_admin` (INTEGER, default 0) — **global** admin flag (not a membership role).
- `vendors.tenant_id`, `assessments.tenant_id`, `audit_log.tenant_id` (→ tenants).
- `assessments.created_by` (TEXT, user email) — powers Submitter "own only" scoping.

**Startup backfill** — `bootstrapMultiTenancy()` (`server/src/services/bootstrap.ts`), idempotent, runs on every boot:

- Creates a **"Default"** tenant (slug `default`) if missing.
- Attaches any orphaned (pre-tenant) vendor/assessment/audit rows to Default; backfills `created_by` from `validated_by` or `'system'`.
- **First migration only** (Default didn't previously exist): seeds memberships for pre-existing users — `ADMIN_EMAILS` accounts get the global admin flag (no Default membership); everyone else gets a Default membership with their legacy role.
- Users created **after** the migration (e.g. new OAuth sign-ins) are intentionally left **unprovisioned** until an admin assigns them.

## 3. Roles & Access Model

Two distinct planes:

- **Global admin** — `users.is_admin`. Cross-tenant superuser; needs no membership. May operate in **all-tenants mode** (`activeTenantId = null`) or pin a single tenant.
- **Per-tenant membership role** — `Analyst` (analyze / override / approve in-tenant), `Submitter` (submit + view **only their own** submissions), `Viewer` (read-only). `Admin` is never a membership role.

Per-request scope (`req.scope`, built by `resolveTenant` in `server/src/middleware/tenant.ts` from the session + **live** DB reads, so admin/membership changes take effect immediately): `{ actor (email), userId, isAdmin, activeTenantId, effectiveRole, ownOnly }`. `ownOnly` is true only for Submitters.

Rules:

- Non-admin with **no membership** for `activeTenantId` (or `activeTenantId == null`) → **403 "No tenant access — contact an administrator."**
- Admin in all-tenants mode reads across all tenants; **writes/creates require a concrete tenant** (`activeTenantOrThrow`).
- `requireAdmin` (global-admin only) and `requireTenantRole(...allowed)` (admin always passes; else `effectiveRole` must be in the allow-list) replace the old inline `role === 'Viewer'` checks.

## 4. Tenant Scoping of Data

`server/src/services/store.ts` gains scope-aware SQL helpers, applied to every vendor/assessment/audit read and write:

- **`tenantClause(scope, alias)`** — empty for admin/all-tenants; else ` AND {alias}.tenant_id = ?`.
- **`ownClause(scope, alias)`** — empty unless `ownOnly`; else ` AND {alias}.created_by = ?` (Submitter sees only their own).
- **`activeTenantOrThrow(scope)`** — guards creates; rejects all-tenants writes.

Behavior: lists/gets are tenant- (and for Submitters, owner-) filtered; a cross-tenant `getAssessment` returns `undefined` → **404** (no existence leak / IDOR closed). Updates read the existing row to infer its tenant, so an admin in all-tenants mode can edit/analyze any assessment; the audit entry is stamped with the assessment's **original** `tenant_id`. Creates set `tenant_id` and `created_by = actor`.

## 5. Invitations

`server/src/services/invites.ts` + accept flow in `server/src/routes/auth.ts`:

- `createInvite({email, tenantId, role, invitedBy})` → 32-byte base64url token; **only its SHA-256 hash is stored**; **7-day TTL**; **one pending invite per (email, tenant)** (a new one replaces a prior unaccepted one); returns the raw token **once**.
- `GET /api/auth/invite/info?token=` — non-consuming preview (`{email, tenant_name, role}`) for the confirmation page.
- `POST /api/auth/invite/accept` — validates (exists, unaccepted, unexpired → else 410); upserts the user, `setMembership(userId, tenant_id, role)`, marks `accepted_at`, builds a session with that tenant active, and signs in.
- Client: `client/src/pages/InviteAccept.tsx` (public page; the token is the credential).

## 6. Admin Control Plane

Routes under **`/api/admin`** behind `requireAdmin` (`server/src/routes/admin.ts`); UI in `client/src/pages/Admin.tsx`:

- **Tenants:** `GET /tenants` (with member counts), `POST /tenants` (unique slug), `DELETE /tenants/:id` (**only when 0 assessments**; cascades memberships/invites/vendors; audit rows kept with `tenant_id → NULL`).
- **Invitations:** `GET /invites`, `POST /invites` (domain-checked; emails or logs the link), `DELETE /invites/:id`.
- **Memberships:** `POST /users/:id/memberships`, `DELETE /users/:id/memberships/:tenantId`.
- **Users:** `GET /users` (with live memberships), `PATCH /users/:id` (toggle `is_admin`), `DELETE /users/:id`.
- **Safeguards:** cannot remove/delete the **last global admin**; cannot **self-delete**; deleting a user keeps their authored assessments (`created_by` is a label, not an FK).

## 7. Auth & Session

`SessionUser` now carries `isAdmin`, `memberships: TenantMembership[]`, and `activeTenantId`. `buildSessionUser(base, preferred?)` (`server/src/services/auth.ts`) live-resolves the admin flag + memberships and picks the active tenant (honor preferred if still accessible; else first membership; else null). `POST /api/auth/active-tenant` is the **tenant switcher** (membership-verified for non-admins; admins may pick any tenant or null). `upsertUserOnLogin` sets `is_admin` from `ADMIN_EMAILS` (grants only) and never auto-provisions a tenant.

## 8. Client

`AuthContext` exposes derived permissions (`activeRole`, `canSubmit/canEdit/canApprove`, `isSubmitterScope`, `hasNoTenants`, `tenants`, `activeTenantId`) and `switchTenant()`. `Layout` adds a **TenantSwitcher** (all-tenants + tenant list for admins; memberships for others) and a **NoTenantAccess** state for unprovisioned users. New shared types: `Tenant`, `TenantMembership`, `MembershipRole`, `AdminUser`, `Invite` (`client/src/types.ts`, `server/src/types.ts`).

## 9. Configuration

- `ADMIN_EMAILS` — comma-separated global admins (case-insensitive; grant-only at login).
- `ALLOWED_EMAIL_DOMAINS` — restrict sign-in/invites by domain (empty = allow all).
- `DEFAULT_ROLE` — **only seeds the legacy `users.role` field; does NOT grant tenant access.** New users remain unprovisioned until invited/assigned.

## 10. Verification (tests added under `server/test/`)

- `tenancy.test.ts` — cross-tenant isolation on read; cross-tenant get → undefined/404; admin all-tenants sees all; Submitter own-only; cross-tenant patch (IDOR) blocked; create requires a concrete tenant; admin all-tenants write-through; audit stamped with original tenant.
- `tenantStore.test.ts` — slug uniqueness/suffixing; membership upsert/remove/list; `buildSessionUser` active-tenant resolution; admin-flag set/count + last-admin protection.
- `invites.test.ts` — single-use (accept then re-find → null); invalid tokens → null; list/revoke; re-invite replaces prior unaccepted.
- `adminDelete.test.ts` — tenant assessment counts; empty-tenant delete cascade (audit unlinked, not deleted); user delete removes memberships/invites, keeps authored assessments.
- `_scope.ts` — test helper mirroring `resolveTenant` for building `AccessScope`.

## 11. Security Properties

Scope is **always derived server-side** (never trusted from the client). Cross-tenant access returns 404, not 403-with-existence. The audit trail is stamped with the originating tenant and survives tenant deletion. Last-admin and self-delete lockouts are enforced. Invite tokens are stored only as hashes, are single-use, and expire.

## 12. Out of Scope / Follow-ups

- SCIM / directory provisioning and self-service tenant signup (admin-invite only today).
- Per-tenant branding, quotas, and cross-tenant aggregate reporting.
- The data layer is still **single-node SQLite** — Spec 0002 §D1 (pluggable store / Postgres) and WS-4 (pagination, evidence object-storage) remain the path to horizontal scale. Durable hosting of this SQLite DB is addressed in `specs/0004-free-demo-deployment.md`.
