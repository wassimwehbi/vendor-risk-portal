# Spec 0001 — AI-Assisted Vendor Risk Questionnaire Analysis Tool (v1)

- **Status:** Implemented (v1)
- **Branch:** `claude/vendor-risk-questionnaire-portal-nAj7f`
- **Location:** `vendor-risk-portal/` (self-contained Node + React project)
- **Related docs:** `vendor-risk-portal/README.md`, `vendor-risk-portal/API_CONTRACT.md`

## 1. Problem Statement & Objectives

Vendor risk analysts must manually review lengthy SIG security questionnaires and
their evidence, then map answers to compliance frameworks, judge control strength
and evidence sufficiency, score risk, and write follow-up questions. This is slow
and inconsistent.

This tool **accelerates** that work with AI assistance while keeping the human
analyst accountable for the final decision. It automates the **preliminary**
analysis of SIG questionnaires and maps responses to **ISO 27001, ISO 27002, and
GDPR** (with HIPAA flags where PHI is processed, and NIST 800-53 / NIST CSF
references in the mapping library), then routes the output to an analyst for
review and approval.

**Key design principle (non-negotiable):** AI output is preliminary; the final
vendor-risk decision is always made by a human analyst, never automatically.

## 2. Scope & Confirmed Decisions

| Decision | Choice |
| --- | --- |
| Placement | New top-level project folder `vendor-risk-portal/` |
| Stack | Node + Express + TypeScript (server); React + Vite + Tailwind (client) |
| Persistence | SQLite via `better-sqlite3` |
| AI engine | Claude (`@anthropic-ai/sdk`) when `ANTHROPIC_API_KEY` is set; deterministic rule-based fallback otherwise |
| Document intake | Parse Excel/CSV SIG into structured items; store evidence files (PDF/Word/images) as-is with metadata (no deep parsing in v1) |
| Auth | Lightweight role selector (Analyst/Admin/Viewer) via headers; no full SSO in v1 |

## 3. Architecture

```
vendor-risk-portal/
  server/  Express API + SQLite + analysis services + tests
  client/  React + Vite + Tailwind SPA
```

- AI analysis is triggered explicitly per assessment (`POST /analyze`), processed
  server-side. Framework mapping and risk scoring are **always deterministic**
  (from the mapping library + weighted-factor model) regardless of engine, so the
  result is explainable and auditable. The Claude path contributes the qualitative
  assessment (domain, strength, completeness, evidence, finding, follow-ups).
- Pinned to Node 22 (`.nvmrc`) for native-module (`better-sqlite3`) compatibility.

### Critical files

- Contract: `server/src/types.ts` (mirrored in `client/src/types.ts`)
- DB + schema: `server/src/db.ts`
- Services: `server/src/services/{extraction,ruleEngine,claudeProvider,aiEngine,riskScoring,frameworkMapping,store,exporter,demo,audit}.ts`
- Reference data: `server/src/data/{controlDomains.ts,frameworks.json,sample-sig.csv,scenarios/index.ts}`
- Routes: `server/src/routes/*.ts`; entry `server/src/index.ts`
- Client pages: `client/src/pages/*`; key component `client/src/components/FindingRow.tsx`

## 4. Data Model (SQLite)

`vendors`, `assessments`, `questionnaire_items`, `findings`, `evidence_files`,
`audit_log`. JSON columns (`data_categories`, `applicable_frameworks`,
`framework_mappings`, `follow_up_questions`, `analyst_values`, audit `details`)
stored as TEXT. Findings store AI values plus an optional `analyst_values`
override object and an `analyst_status` (`pending|accepted|overridden`).

## 5. API Surface

See `API_CONTRACT.md`. Summary: health; vendors; assessments CRUD + detail;
upload (multipart); analyze; PATCH finding / PATCH assessment (HITL); report;
CSV/XLSX export; audit; demo scenario list + load. Envelope
`{ success, data?, error? }`; role via `X-Analyst`/`X-Role`.

## 6. Risk Scoring Model (deterministic, explainable)

Additive weighted factors → Low (<3) / Medium (3–4) / High (5–7) / Critical (≥8):
control strength (None +4 / Weak +3 / Medium +1), evidence (None/Expired/Misaligned
+2, Insufficient +1), completeness (Missing +3 / Vague +2 / Partial +1),
critical-domain penalty (+2 when a critical control is None/Weak), data sensitivity
(PHI/sensitive/financial/children +2; personal/cross-border +1). Overall = worst
case across items. Implemented in `server/src/services/riskScoring.ts`.

## 7. Demo Showcase Scenarios (also test fixtures)

Five scenarios in `server/src/data/scenarios/index.ts`, each verified to compute
its band: TrustVault → **Low**, DataFlow → **Medium** (GDPR), SecureHealth →
**High** (HIPAA/PHI), CloudPay → **Critical**, VagueVendor → **High** (evidence-gap).

## 8. Testing & Verification (results)

- `server`: typecheck clean; **21/21** tests pass (`riskScoring`, `extraction`,
  5-scenario regression with signature-finding assertions).
- `client`: typecheck clean; production build succeeds.
- HTTP e2e (manual, rule engine): demo load → analyze (correct bands + GDPR/HIPAA
  flags) → finding override → Viewer approve blocked (403) → Analyst approve →
  12-field report → CSV + XLSX export → 6 audit entries → CSV upload path extract+analyze.
- Client served on :5173 with working `/api` proxy to :4100.

---

## 9. Validation against the Original Plan

Source: approved plan `~/.claude/plans/resume-here-tingly-sloth.md`.
Legend: ✅ Done · 🟡 Partial/Deviation · ⬜ Not done.

| Plan item | Status | Evidence / notes |
| --- | --- | --- |
| New top-level folder `vendor-risk-portal/` | ✅ | Created |
| Node + React + TypeScript | ✅ | Express server, React/Vite client |
| Claude + rule-based fallback | ✅ | `aiEngine.ts` selects provider; per-item fallback |
| Excel/CSV parse + evidence stored as-is | ✅ | `extraction.ts`, `evidence_files` |
| Directory structure | ✅ | Matches; added `store.ts`/`exporter.ts`/`demo.ts` helpers (enhancement); scenarios as one module not many files |
| Data model (6 tables) | ✅ | `db.ts` |
| Upload / analyze / HITL / reports / audit / demo endpoints | ✅ | `routes/*.ts` |
| AI engine contract (shared `ItemAnalysis`, prompt-cached system block) | ✅ | `claudeProvider.ts` (cache_control type-asserted; see deviations) |
| Configurable framework mapping library + version | ✅ | `frameworks.json` (`_version` `fwmap-v2`), `frameworkMapping.ts`; version stored on assessment |
| Lightweight RBAC via headers + approve gating | ✅ | `_helpers.getContext`, route checks |
| Frontend pages: Dashboard, Demo Showcase, New Assessment, Review Workspace, Report, Audit | ✅ | `client/src/pages/*` |
| Control-by-control table + inline Accept/Override + preliminary banner | ✅ | `FindingRow.tsx`, `PreliminaryBanner.tsx` |
| Analyst override of framework mapping (in UI) | ✅ | **Resolved** — `FindingRow.tsx` now has a framework-mapping editor (one `Framework: ref1; ref2` per line) sent via `PATCH /findings/:id` |
| 5 demo scenarios spanning bands, reused as tests | ✅ | `scenarios/index.ts` + `scenarios.test.ts` |
| Build/run scripts (`install-all`, `dev`, `build`, `test`) | ✅ | root + workspace `package.json` |
| Frontend design system (Tailwind palette, risk colors, banner, accessible) | ✅ | `tailwind.config.js`, `index.css`, components |
| Verification steps 1–6, 8 | ✅ | See §8 |
| Verification step 7 (set real `ANTHROPIC_API_KEY`, confirm Claude path) | 🟡 | Not executed — no API key in environment. Code path implemented + typechecked; fallback verified |
| Out-of-scope items honored (no SSO, no PDF/Word parse, no GRC integration) | ✅ | As scoped |
| Quality Loop: code/security review pass | ✅ | **Resolved** — manual review performed (see §13): parameterized SQL, no dangerous sinks, input validation (zod), typecheck/tests/build green |
| Build Orchestration: scaffold + parallel builder subagents | 🟡 | **Deviation:** the `Agent`/skill tools were disabled in the resumed session; built directly instead of via subagents |

## 10. Validation against the Original Requirements Spec

| Req. section | Status | Notes |
| --- | --- | --- |
| 1. Objective (SIG → ISO 27001/27002/GDPR) | ✅ | + HIPAA flag when PHI |
| 2. Use-case steps (extract→classify→map→gaps→risk→follow-ups→route to human) | ✅ | Full pipeline |
| 3A. Document intake | 🟡 | Excel/CSV parsed; Word/PDF/evidence stored (not parsed) — per agreed scope |
| 3B. Response extraction fields | ✅ | All fields incl. evidence, dates, expiration |
| 3C. Control classification (domains) | ✅ | 18 standardized domains |
| 3D. Framework mapping | ✅ | **Resolved** — configurable library now includes ISO 27001/27002, GDPR, HIPAA **and NIST 800-53 / NIST CSF** references per domain (`frameworks.json` v2) |
| 4. AI risk analysis (completeness, strength, evidence sufficiency, privacy relevance) | ✅ | Incl. PHI/children/cross-border/subprocessor detection |
| 5. Preliminary risk scoring (Low/Med/High/Critical, weighted) | ✅ | `riskScoring.ts` |
| 6. Follow-up generation | ✅ | Domain-specific + gap-driven |
| 7. Human-in-the-loop validation | ✅ | Accept/override (incl. framework mapping), adjust risk, edit follow-ups, notes, mark evidence, approve; AI never final |
| 8. Output report (12 fields) | ✅ | `ReportData`, Report view + exports |
| 9. Example output table | ✅ | Review table mirrors the spec's example columns |
| 10. Non-functional (secure, RBAC, auditable, explainable, configurable, confidential, history, export) | 🟡 | All present at v1 level; auth is lightweight (no SSO); parameterized SQL; exports to CSV/XLSX/PDF(print) |
| 11. Audit trail (files, extraction, scoring, analyst changes, final decision, date+user, mapping version) | ✅ | `audit_log` + `mapping_version` |
| 12. Key design principle (assist, not replace) | ✅ | Enforced; banner + approval gating |

## 11. Remaining Deviations & Rationale

1. **Build orchestration without subagents** — the `Agent`/skill tools were
   disabled in the resumed session; replaced by direct implementation plus the
   manual review in §13. (Environment limitation, not a design choice.)
2. **Claude live-path not exercised** — no API key available; the code path is
   implemented and typechecked, and graceful fallback is verified.
3. **Prompt caching** — applied on the stable `/v1/messages` endpoint with a typed
   assertion because the installed SDK declares `cache_control` only on its beta types.
4. **Document intake** — Word/PDF evidence is stored with metadata but not text-extracted (per agreed v1 scope).

## 12. Out of Scope (v1)

Real authentication/SSO, multi-tenant isolation, deep PDF/Word text extraction,
live GRC-platform integration, and a background job queue. The AI never makes the
final risk decision (enforced by design).

## 13. Code & Security Review (v1 pass)

A manual review was performed in lieu of the (unavailable) review subagents:

- **SQL** — all queries use `better-sqlite3` prepared statements with bound
  parameters; no string interpolation into SQL. ✓
- **Dangerous sinks** — no `eval`, `child_process`, or `exec*` usage. ✓
- **Input validation** — `zod` schemas validate create/patch bodies; `parseId`
  guards numeric ids; upload requires a questionnaire file and handles parse
  failures with `422`. ✓
- **File handling** — uploads are stored under `uploads/` with server-generated
  random names (no path traversal); files are not served or executed; 25 MB limit;
  export filenames are sanitized. ✓
- **RBAC** — mutating endpoints reject `Viewer`; approval requires `Analyst`/`Admin`.
  Known v1 limitation: roles are self-asserted via headers (no real auth). ✓ (documented)
- **Dependency advisories** — `xlsx` and `multer` carry known low/moderate
  advisories; acceptable for an internal v1 tool, flagged in the README.
- **Build health** — server + client typecheck clean; **21/21** tests pass;
  client production build succeeds.
