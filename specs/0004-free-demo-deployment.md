# Spec 0004 — Free Demo Deployment (Cloudflare Pages + Render + Litestream/R2)

- **Status:** Implemented (2026-05-25)
- **Branch:** `main`
- **Location:** `vendor-risk-portal/` — root `Dockerfile`, `litestream.yml`, `docker-entrypoint.sh`, `.dockerignore`, `client/public/_redirects`, `.env.example`; one-line change in `server/src/index.ts`.
- **Related docs:** `specs/0002-enterprise-readiness.md` (WS-5 Deployment & Ops, Open Decision **D3** Hosting target), `specs/0003-multi-tenancy-rbac.md`, `README.md` (Deployment section)
- **Builds on:** Spec 0002 WS-5; resolves **D3** for the *demo tier*.

## 1. Problem Statement & Objective

We needed the portal **live, for free, quickly**, to demo to prospects. Spec 0002
WS-5 proposed a full enterprise deployment (multi-stage Docker, `docker-compose`,
optional Postgres/Redis, runbooks). That is the wrong size for this goal. This spec
documents the **demo-tier** deployment that was actually shipped: a free, split
static-frontend + container-backend with object-storage-backed SQLite durability,
reachable from a restricted corporate network.

Constraints: **$0** standing cost, fast to stand up, **no rewrite** of the
Express + `better-sqlite3` backend, real auth (Google SSO), and durable data on an
ephemeral-disk free host.

This realizes WS-5 in a demo shape; the full enterprise deploy (Compose/k8s, managed
DB, the D1 store abstraction from 0002) remains future work.

## 2. Architecture

```
       uptime pinger ──GET /api/health every ~10m──┐  (prevents free-tier cold start)
                                                    ▼
Browser ─> Cloudflare Pages (static SPA, client/dist) ──fetch(credentials:'include')──> Render (Docker)
   [custom domain, e.g. <app-domain>]                                                   [<service>.onrender.com]
     built with VITE_API_URL=<api-origin>                                                ├─ Express + SQLite (/data/vendor-risk.db; sessions + tenants in-DB)
                                                                                         ├─ Litestream sidecar ⇄ Cloudflare R2 (continuous backup + restore-on-boot)
                                                                                         ├─ Google OAuth (callback on the API origin)
                                                                                         └─ Anthropic API (optional; rule engine otherwise)
```

Frontend and backend are on **different origins** → the session cookie is cross-site.

> Concrete hostnames, the R2 account id, and all secrets live in private deployment
> notes / the host's env settings — intentionally **not** committed. Placeholders are
> used below.

## 3. Frontend — Cloudflare Pages

- Connect the Git repo as a **Pages** project (not a Worker). Build:
  `npm --prefix client install && npm --prefix client run build`; output `client/dist`.
- Build-time env `VITE_API_URL=<api-origin>` so the SPA (`client/src/api/client.ts`)
  calls the backend on its own origin.
- `client/public/_redirects` ships a `/* /index.html 200` SPA rule. Cloudflare's
  validator currently flags it as a redundant "infinite loop" and ignores it, but
  Pages auto-serves `index.html` for unmatched routes, so deep links still resolve.
- **Custom domain:** a CNAME (e.g. `<app-domain>` → `<project>.pages.dev`) is attached.
  This was **required** here because the demo network blocks `*.pages.dev` via TLS
  **SNI filtering**; the custom hostname's SNI is not filtered. See `README.md`/private
  notes for the gotcha.

## 4. Backend — Render free Docker + Litestream → R2

Render's free disk is **ephemeral** (reset on every deploy/restart). The backend is
deployed as a **Docker** web service so a **Litestream** sidecar can make SQLite durable:

- **`Dockerfile`** (root): `node:22-bookworm-slim` base; CA certs + `python3`/
  `build-essential` (fallback for the native `better-sqlite3` build); the Litestream
  binary copied from `litestream/litestream:0.3.14` (multi-stage). `npm --prefix server
  install` runs **without** `NODE_ENV=production` so the `tsx` devDependency (used by
  `npm start`) is installed. Runtime `NODE_ENV=production`.
- **`docker-entrypoint.sh`:** `litestream restore -if-db-not-exists -if-replica-exists
  "$VRP_DB_PATH"` then `exec litestream replicate -exec "npm --prefix server start"`.
  Litestream is PID 1 and supervises the app; on SIGTERM (deploy/restart) it flushes a
  final sync, so graceful restarts lose ~nothing.
- **`litestream.yml`:** replicates `/data/vendor-risk.db` to an S3-compatible R2 bucket
  (`vrp-litestream`); endpoint/keys come from `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` /
  `R2_SECRET_ACCESS_KEY` (env-expanded at runtime).
- `VRP_DB_PATH=/data/vendor-risk.db` points the app (`server/src/db.ts`) at the
  replicated DB. Because **sessions** also live in that SQLite DB
  (`better-sqlite3-session-store`), logins survive restarts too.
- WAL is already enabled in `db.ts` (Litestream requires it).
- Original uploaded files are **not** replicated (they are never served back — only
  their extracted text, which lives in the DB and *is* replicated).

## 5. Auth & Cross-Origin

- Sign-in is **Google OAuth**; redirect URI `${PUBLIC_URL}/api/auth/google/callback`.
  `ADMIN_EMAILS` makes the chosen account a global admin (see Spec 0003).
- **Required code change:** the session cookie in `server/src/index.ts` is now
  `sameSite: isProd ? 'none' : 'lax'`. With the SPA and API on different origins the
  cookie is third-party, so production needs **`SameSite=None; Secure`** (already
  `secure: isProd`, and `trust proxy` is set so it's marked Secure behind the host's
  TLS). Locally the SPA is same-origin via the Vite proxy, so `Lax` is kept.
- `CLIENT_ORIGIN` must **exactly** match the SPA origin (scheme, host, **no trailing
  slash**) — the CORS allow-list is an exact-string compare; a mismatch blocks the
  credentialed fetch and the UI shows "No sign-in methods configured."

## 6. Configuration (production env)

| Var | Purpose |
| --- | --- |
| `NODE_ENV=production` | Secure cross-site cookie; dev-login disabled. |
| `AUTH_SECRET` | Session/token signing (server refuses to boot without it). |
| `CLIENT_ORIGIN` | SPA origin, exact, no trailing slash. |
| `PUBLIC_URL` | API public base (OAuth callback + invite links). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth. |
| `ADMIN_EMAILS` | Global-admin email(s). |
| `VRP_DB_PATH` | SQLite path on the Litestream-managed volume (`/data/vendor-risk.db`). |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Litestream → R2. |
| `ANTHROPIC_API_KEY` *(optional)* | Enables Claude analysis; omit → rule engine. |

`.env.example` documents the full set (incl. Microsoft SSO and SMTP for
magic-link/invite email, both optional). Secrets live only in the host's env.

## 7. Operations

- **Cold start:** free Render services idle out after ~15 min (first hit then ~30–60 s).
  A free uptime pinger (cron-job.org / UptimeRobot) on `/api/health` every ~10 min keeps
  it warm.
- **Durability:** verified — R2 holds Litestream generations; a redeploy/restart restores
  the DB (and sessions) on boot.
- **Deploy / update:** push to `main` → Render rebuilds the image and Cloudflare Pages
  rebuilds the SPA automatically (both Git-connected).
- **Cost:** $0 (Render free + Pages free + R2 free tier); only optional `ANTHROPIC_API_KEY`
  usage is billable. A Claude **Max** subscription does **not** grant API access.

## 8. Key Decisions & Rationale

- **Why not a full Cloudflare-native rewrite (Workers + D1 + R2)?** The backend uses the
  native `better-sqlite3` addon, disk-based `multer` uploads, a SQLite session store, and
  `pdf-parse` — none run on Workers without a multi-day rewrite, and the AI analysis would
  want the paid Workers plan. Out of scope here; captured as a future option.
- **Why Litestream (not periodic snapshots)?** Continuous WAL replication → near-zero data
  loss, restore-on-boot, and **no app code change** (runs as a sidecar).
- **Why a custom domain?** The demo network's SNI filter blocks `*.pages.dev`; a custom
  hostname bypasses it and gives a cleaner URL.

## 9. Verification

1. `GET <api-origin>/api/health` → `200 {status:ok}`.
2. `GET <api-origin>/api/auth/providers` → `google:true`; with `Origin: <app-domain>` the
   response carries `access-control-allow-origin: <app-domain>`.
3. Cross-site **Google sign-in** (incognito) lands logged in as admin; `vrp.sid` cookie is
   `SameSite=None; Secure` and sent on `/api/*`.
4. **Durability:** seed data → redeploy/Restart → data **and** session persist (restored
   from R2); R2 bucket shows objects under `vendor-risk/`.
5. Deep link (`<app-domain>/login`) returns the SPA (HTTP 200).

## 10. Known Limitations / Follow-ups

- Free tier: cold starts (mitigated by the pinger); single small instance; **single-node
  SQLite** (see Spec 0002 §D1 / WS-4 for the path to Postgres + pagination + evidence
  object storage).
- Uploaded **original** files are not durably stored (extracted text is); add an R2-backed
  evidence store (0002 WS-4) if originals must survive restarts.
- For a production tier: managed DB, the full enterprise deploy from 0002 WS-5
  (Compose/k8s + runbook), and/or the Cloudflare-native (Workers/D1/R2) rewrite noted in §8.
