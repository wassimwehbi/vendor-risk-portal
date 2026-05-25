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
  attach supporting evidence files (SOC 2, ISO certs, policies, screenshots).
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
cp .env.example .env       # optional: set ANTHROPIC_API_KEY to enable Claude
npm run install-all
```

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

## Roles (lightweight, v1)

There is no full authentication in v1. A role selector (Analyst / Admin /
Viewer) in the header is sent as `X-Analyst` / `X-Role` headers; the server
records the actor in the audit log and gates the approve action. Viewers are
read-only.

## Project structure

```
vendor-risk-portal/
  server/   Express API, SQLite, extraction, rule + Claude engines, scoring, scenarios, tests
  client/   React + Vite + Tailwind UI (Dashboard, Demo Showcase, New Assessment,
            Review Workspace, Report, Audit Trail)
```

## Security notes

- All SQL uses parameterized prepared statements.
- Uploaded files are stored under `server/uploads/` (git-ignored) and the DB is
  `server/vendor-risk.db` (git-ignored).
- `xlsx` and `multer` carry known low-severity advisories; acceptable for this
  internal v1 tool. Lock down / replace before handling untrusted public input.

## v1 limitations (not yet implemented)

- Real authentication / SSO and multi-tenant isolation.
- Deep text extraction from PDF / Word evidence (evidence is stored with
  metadata, not parsed in v1).
- Direct GRC-platform integration and a background job queue.
- The AI never makes the final risk decision — this is enforced by design.
