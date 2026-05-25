# AI-Assisted Vendor Risk Questionnaire Analysis Tool

A web portal that automates the **preliminary** analysis of vendor security
questionnaires (SIG format) and maps vendor responses to **ISO 27001**,
**ISO 27002**, and **GDPR** (with HIPAA flags where PHI is processed).

It extracts vendor responses, classifies them into control domains, maps them to
framework requirements, flags weak / missing / unsupported answers, assigns a
preliminary risk level, generates analyst-ready follow-up questions, and routes
everything to a human analyst for review and approval.

> ⚠️ **AI output is preliminary.** Classifications, mappings, risk levels and
> follow-up questions are AI-assisted *suggestions* to accelerate review. **The
> final vendor-risk decision is made by a human analyst — never automatically by
> the AI.** Every change is recorded in an audit trail.

---

## Highlights

- **Document intake** — upload SIG questionnaires as `.xlsx` / `.xls` / `.csv`;
  attach supporting evidence files (SOC 2, ISO certs, policies, screenshots). Evidence
  is type-checked (PDF, Word, CSV, Excel, image) and **parsed on upload** — text is
  extracted from PDF / Word / CSV / Excel (images are stored with dimensions, not OCR'd).
  The original is preserved and a structured extraction layer is created.
- **Response extraction** — Question ID, text, response, response type
  (Yes / No / Partial / N/A / Free text), evidence, evidence location, comments,
  dates and expiration dates.
- **Control classification** into 18 standardized domains (MFA, IAM, PAM,
  encryption at rest / in transit, logging, incident response, vulnerability &
  patch management, backup, BCP, DR, privacy governance, DSR, retention, TPRM,
  HIPAA, GDPR processor obligations).
- **Configurable framework mapping library** (`server/src/data/frameworks.json`,
  versioned) → ISO 27001 / ISO 27002 / GDPR / HIPAA references per domain.
- **AI risk analysis** — completeness, control strength, evidence sufficiency
  (no / generic / expired / misaligned evidence), data-sensitivity detection
  (personal, sensitive, PHI, children, employee, financial, cross-border,
  subprocessors), and applicable-framework derivation.
- **Preliminary risk scoring** — explainable, deterministic weighted-factor
  model → Low / Medium / High / Critical (per-item and overall).
- **Follow-up question generation** — targeted, domain-specific.
- **Human-in-the-loop** — accept / override classification, framework mapping,
  risk level, evidence sufficiency and follow-ups; edit overall risk and notes;
  approve. Approval is role-gated and AI never auto-approves.
- **Reports & export** — full analyst review report, CSV and Excel export, and a
  print-friendly view (Print → Save as PDF).
- **Audit trail** — every upload, analysis, override and approval is logged with
  actor, role, timestamp and the framework-mapping version used.
- **Demo Showcase** — five one-click scenarios spanning every risk band.

## AI engine: Claude with a deterministic fallback

- If `ANTHROPIC_API_KEY` is set, item analysis uses the **Claude** API
  (`@anthropic-ai/sdk`, with the large instruction block **prompt-cached**).
- If no key is present (or a call fails), it transparently falls back to a
  **deterministic rule-based engine** — so the app runs fully offline.
- In **both** cases the framework mapping and risk score are computed
  deterministically from the mapping library and the weighted-factor model, so
  results are explainable and auditable regardless of engine.

## Tech stack

- **Server:** Node + Express + TypeScript, `better-sqlite3`, `tsx`, `multer`,
  `xlsx`, `zod`, `@anthropic-ai/sdk`.
- **Client:** React 18 + Vite + TypeScript + Tailwind CSS + React Router.

## Prerequisites

- Node 22 (an `.nvmrc` is provided): `nvm use`
- npm

## Setup

```bash
cd vendor-risk-portal
npm install                # root: provides `concurrently` (used by `npm run dev`)
npm run install-all        # installs the server and client deps
```

No `.env` is needed for local dev — the app runs fully offline with built-in
defaults. Create one in the project root (it is git-ignored) only to enable an
optional integration, e.g. `ANTHROPIC_API_KEY` to use Claude instead of the
rule-based engine; see the configuration notes below.

## Run

```bash
npm run dev
```

- Client: http://localhost:5173
- Server API: http://localhost:4100 (the client proxies `/api` to it)

Run the server or client individually with `npm run dev:server` / `npm run dev:client`.

## Try it

1. **Demo Showcase** (fastest): open the app → **Demo Showcase** → click
   **Load & Analyze** on any of the five vendors:
   - *TrustVault Security* → **Low**
   - *DataFlow Analytics* → **Medium** (GDPR)
   - *SecureHealth Systems* → **High** (HIPAA / PHI)
   - *CloudPay Inc.* → **Critical**
   - *VagueVendor LLC* → **High** (evidence-gap showcase)
2. **Upload path:** **New Assessment** → choose a **Questionnaire type**, click
   **Download a sample … questionnaire** to get a matching CSV template (SIG Lite /
   Core / Full), fill in the response columns, then upload it (plus any dummy evidence
   file) → open the assessment → **Run AI analysis**.
3. In the **Review Workspace**, override a finding's risk / mapping / evidence,
   edit follow-ups, adjust the overall risk, add notes, then **Approve**
   (as an Analyst or Admin — use the role selector, top-right).
4. Open **View report** to export CSV / Excel or print to PDF, and **Audit
   trail** to see the recorded history.

## Testing

```bash
npm test        # server unit + scenario regression tests (node:test via tsx)
npm run typecheck
```

The test suite includes the weighted-factor scoring, the Excel/CSV column
extraction, and a regression test that runs all five demo scenarios through the
rule engine and asserts their expected risk bands and signature findings.

## Authentication & access control

Sign-in is required for the whole app. Supported methods (each enabled only when
configured):

- **Google** and **Microsoft** SSO (OAuth/OIDC).
- **Email magic link** (passwordless; needs SMTP — in dev the link is logged).
- **Dev login** (offline) — enabled when `AUTH_MODE=dev` so the demo works with no
  identity provider.

Access policy (server-side, never trusted from the client):

- Sign-in can be restricted to your org via `ALLOWED_EMAIL_DOMAINS`.
- **The portal is multi-tenant.** Emails listed in `ADMIN_EMAILS` become
  **global admins** on first sign-in — they see every tenant and manage tenants,
  users, memberships and invitations. Any other user who signs in has **no access
  until an admin assigns them** to a tenant with a role: **Analyst** (analyze /
  override / approve within their tenant), **Submitter** (submit and view
  outcomes for their own submissions only), or **Viewer** (read-only). Admins
  invite/assign via the **Admin** page (or an invite link). The audit log records
  the authenticated email as the actor.

All configuration is via environment variables, set in a project-root `.env`
(git-ignored). Copy **`.env.example`** to `.env` and fill it in for a
production / shared deployment — it documents the required prod settings
(`AUTH_SECRET`, `CLIENT_ORIGIN`, `PUBLIC_URL`) and `ADMIN_EMAILS` (the global
admin). OAuth redirect URIs are
`${PUBLIC_URL}/api/auth/{google,microsoft}/callback`.

## Deployment

The portal deploys for **free** as a split static frontend + container backend.
See `specs/0004-free-demo-deployment.md` for the full as-built design; the short
version:

- **Frontend → Cloudflare Pages.** Host `client/dist` as a static site. Build
  command `npm --prefix client install && npm --prefix client run build`, output
  `client/dist`. Set **`VITE_API_URL`** (build-time) to the backend origin so the
  SPA calls the API; `client/public/_redirects` provides SPA routing. A custom
  domain can be attached via CNAME (needed if a network blocks `*.pages.dev`).
- **Backend → any container host** (e.g. a Render free Docker service). The root
  **`Dockerfile`** builds the Node 22 server and bundles a **Litestream** sidecar.
  Free hosts have ephemeral disk, so Litestream continuously replicates the SQLite
  DB to S3-compatible object storage (e.g. Cloudflare R2) and restores it on boot
  (`litestream.yml`, `docker-entrypoint.sh`); point **`VRP_DB_PATH`** at that DB.
  Sessions live in the same DB, so logins also survive restarts.

Because the SPA and API are on **different origins**, the session cookie is sent
cross-site: in production it is `SameSite=None; Secure` (automatic when
`NODE_ENV=production`), and **`CLIENT_ORIGIN` must exactly match the SPA origin
(no trailing slash)** for CORS to allow the credentialed fetch.

**Required production env vars**

| Var | Purpose |
| --- | --- |
| `NODE_ENV=production` | Secure cross-site cookie; dev-login disabled. |
| `AUTH_SECRET` | Session/token signing (server won't boot without it). |
| `CLIENT_ORIGIN` | SPA origin — exact, no trailing slash. |
| `PUBLIC_URL` | API public base (OAuth callback + invite links). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google SSO. |
| `ADMIN_EMAILS` | Global-admin email(s). |
| `VRP_DB_PATH` | SQLite path on the Litestream-managed volume (e.g. `/data/vendor-risk.db`). |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Litestream → R2. |
| `ANTHROPIC_API_KEY` *(optional)* | Enables Claude analysis; omit for the rule engine. |

Free container hosts idle out; a simple uptime pinger on `/api/health` keeps the
service warm. See **`.env.example`** for the complete list (incl. Microsoft SSO and
SMTP for magic-link / invite email).

## Project structure

```
vendor-risk-portal/
  server/   Express API, SQLite, extraction, rule + Claude engines, scoring, scenarios, tests
  client/   React + Vite + Tailwind UI (Dashboard, New Assessment, Review
            Workspace, Report, Audit Trail, Admin)
  specs/    Numbered design specs (0001 portal · 0002 enterprise · 0003 tenancy · 0004 deploy)
  Dockerfile · litestream.yml · docker-entrypoint.sh   Backend container + SQLite→R2 replication
```

## Security notes

- Authenticated, server-side sessions (HttpOnly + SameSite cookies; Secure in
  production) stored in SQLite; session id is regenerated on login.
- CSRF protection: state-changing requests require a per-session token header
  (`x-csrf-token`); combined with locked-down CORS (to `CLIENT_ORIGIN`) and
  SameSite cookies.
- `helmet` security headers and rate limiting (stricter on `/api/auth`).
- Roles are derived from the server user record — never from client headers.
- All SQL uses parameterized prepared statements; uploads are validated by type
  and stored under `server/uploads/` (git-ignored); the DB is git-ignored.
- Secrets (`AUTH_SECRET`, OAuth client secrets, SMTP) come only from env;
  `AUTH_SECRET` is required in production.
- `xlsx` and `multer` carry known low-severity advisories; acceptable for this
  internal tool. Lock down / replace before handling untrusted public input.

## v1 limitations (not yet implemented)

- SCIM / directory provisioning and an in-app MFA enrollment UI (MFA is delegated
  to Google/Microsoft). (Authentication, SSO and **multi-tenant isolation** are now
  implemented — see "Authentication & access control" and
  `specs/0003-multi-tenancy-rbac.md`.)
- OCR of image evidence (images are stored with dimensions but their text is not
  extracted) and parsing of legacy binary `.doc` files. PDF / Word (`.docx`) / CSV /
  Excel evidence **is** text-extracted on upload.
- Direct GRC-platform integration and a background job queue.
- The AI never makes the final risk decision — this is enforced by design.

## License

**Proprietary — all rights reserved.** Copyright (c) 2026 Wassim Wehbi.

This software is proprietary and confidential. No license is granted to use,
copy, modify, or distribute it without prior written permission. See
[`LICENSE`](./LICENSE) for the full terms. For licensing inquiries, contact
wassim.wehbi@gmail.com.
