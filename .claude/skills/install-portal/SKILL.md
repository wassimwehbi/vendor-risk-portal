---
name: install-portal
description: >-
  Install and run the Vendor Risk Portal (vendor-risk-portal) locally — the
  SIG → ISO 27001 / ISO 27002 / GDPR vendor-risk questionnaire analysis app.
  Use when the user wants to set up, install dependencies for, bootstrap, or
  start this app on their machine. Installs the Node/Express server and
  React/Vite client, prepares the .env file, launches both dev servers
  (API on :4100, client on :5173), and verifies they are up. Works fully
  offline — no API keys or external services are required for local dev.
---

# Install & Run the Vendor Risk Portal locally

This is an npm monorepo with two apps: a **Node + Express + TypeScript** server
(`server/`, SQLite via `better-sqlite3`, run with `tsx`) and a
**React 18 + Vite + Tailwind** client (`client/`). The client dev server proxies
`/api` to the server. The app runs **completely offline** in dev mode:
dev-login (no credentials), a rule-based analysis engine (no Claude key), and
magic links printed to the console (no SMTP).

All commands run from the project root: `vendor-risk-portal/`.

## Prerequisites

Check these before installing:

- **Node.js 22** — the repo pins **22.18.0** in `.nvmrc`, and you should use it.
  Although Node ≥ 20 can compile the code, the `better-sqlite3` native addon is
  locked to the Node **major** version it was built under (ABI / `NODE_MODULE_VERSION`),
  so the Node you run with must match the Node you installed with. Mixing them
  (e.g. installing under 22, then running under 20) crashes the server at startup
  with `ERR_DLOPEN_FAILED` (see Troubleshooting). Verify with `node -v`. If `nvm`
  is installed, run `nvm use` (it reads `.nvmrc`; `nvm install` first if 22.18.0
  is missing) **before** installing and again before starting — and make sure any
  background launch inherits that same Node by sourcing nvm in the same command.
- **npm** (ships with Node).
- A C/C++ toolchain for the `better-sqlite3` native module. macOS: Xcode
  Command Line Tools (`xcode-select --install`). Linux: `build-essential` +
  `python3`. Most machines already have this; only revisit it if install fails
  (see Troubleshooting).

## Steps

1. **Confirm the working directory** is the project root and Node is **22**
   (matching `.nvmrc`). If you use `nvm`, switch first so install and run share
   one Node major:

   ```bash
   pwd            # should end in /vendor-risk-portal
   nvm use        # selects 22.18.0 from .nvmrc (nvm install 22.18.0 if missing)
   node -v        # expect v22.18.0
   ```

2. **Create `.env`** if it does not already exist. The defaults work for local
   dev as-is, so only copy the template — do not overwrite an existing `.env`:

   ```bash
   [ -f .env ] || cp .env.example .env
   ```

   Leave it untouched for a fully offline run. Optional keys are listed under
   "Optional configuration" below.

3. **Install dependencies** for both server and client:

   ```bash
   npm run install-all
   ```

   This runs `npm --prefix server install && npm --prefix client install`.
   (No deps are installed at the repo root beyond `concurrently`, which
   `npm run install-all` does not cover — run `npm install` at the root too if
   `npm run dev` reports `concurrently` is missing.)

4. **Start both servers** together:

   ```bash
   npm run dev
   ```

   `concurrently` launches:
   - **Server** → http://localhost:4100 (`tsx watch`, auto-reloads on changes)
   - **Client** → http://localhost:5173 (Vite, proxies `/api` → :4100)

   Run them separately with `npm run dev:server` / `npm run dev:client` if needed.

   When launching in an automated/non-interactive context, start it in the
   background so it doesn't block, then watch the logs for the listening line.
   A detached/background shell won't inherit an earlier interactive `nvm use`, so
   source nvm in the launch command to keep the pinned Node:
   `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use >/dev/null && npm run dev`.

5. **Verify** the server is up (in a second terminal, while `npm run dev` runs):

   ```bash
   curl -s http://localhost:4100/api/health
   ```

   Expect: `{"success":true,"data":{"status":"ok","aiEngineAvailable":false}}`
   (`aiEngineAvailable` is `true` only when `ANTHROPIC_API_KEY` is set.)

   The server also logs on startup:

   ```
   [vendor-risk-portal] server listening on http://localhost:4100
   [vendor-risk-portal] AI engine: rule-based fallback
   [vendor-risk-portal] auth providers: dev-login
   ```

   Then open **http://localhost:5173** and use **Developer sign-in** (enabled
   because `AUTH_MODE=dev`): enter any email and pick a role (Admin / Analyst /
   Viewer). The SQLite DB (`server/vendor-risk.db`) and tables are created
   automatically on first start — no migration or seed step is required.

## Sanity checks (optional)

- `npm run typecheck` — type-checks both server and client.
- `npm test` — runs the server unit + scenario regression tests (`node:test` via `tsx`).

## Optional configuration

All of these are optional and edited in `.env`; none are needed for local dev.

- **Claude AI analysis** — set `ANTHROPIC_API_KEY` (and optionally
  `ANTHROPIC_MODEL`, default `claude-sonnet-4-5`). Without a key the app uses
  the deterministic rule-based engine.
- **Google / Microsoft SSO** — set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`
  and/or `MICROSOFT_CLIENT_ID` + `MICROSOFT_CLIENT_SECRET` (+ `MICROSOFT_TENANT`).
  Callback URLs are `${PUBLIC_URL}/api/auth/<provider>/callback`.
- **Email magic links** — set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
  `EMAIL_FROM`. Without SMTP, magic-link URLs are printed to the server console.
- **Access control** — `ALLOWED_EMAIL_DOMAINS`, `ADMIN_EMAILS`, `DEFAULT_ROLE`.
- **Production** — set `NODE_ENV=production`, a strong `AUTH_SECRET` (required),
  `CLIENT_ORIGIN`, and `PUBLIC_URL`. `AUTH_MODE=dev` (the default outside
  production) is what enables passwordless Developer sign-in.

## Build for production (optional)

```bash
npm run build      # type-checks + builds the client into client/dist
npm --prefix server start   # runs the server once (no watch) via tsx
```

## Troubleshooting

- **`better-sqlite3` fails to build/install** — it compiles a native addon.
  Install build tools (macOS: `xcode-select --install`; Linux: `build-essential`
  + `python3`), then re-run `npm --prefix server install`.
- **Server crashes at startup with `ERR_DLOPEN_FAILED` / "compiled against a
  different Node.js version ... NODE_MODULE_VERSION"** — the `better-sqlite3`
  native addon was built under a different Node **major** than the one now
  running (e.g. installed under 22, started under 20). The client stays up but
  every `/api` call fails with `ECONNREFUSED` because the server died. Fix:
  switch to the pinned Node and either rebuild or reinstall the addon —

  ```bash
  nvm use                                  # 22.18.0 from .nvmrc
  npm --prefix server rebuild better-sqlite3   # or: npm --prefix server install
  ```

  then start with that same Node active. When launching in the background, the
  detached shell does **not** inherit an interactive `nvm use`; source nvm in the
  launch command itself, e.g.
  `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use >/dev/null && npm run dev`.
- **Port already in use (4100 or 5173)** — stop the other process, or set
  `PORT` in `.env` for the server. The client port `5173` is set in
  `client/vite.config.ts`; if you change it, also update `CLIENT_ORIGIN`.
- **Client loads but API calls 404 / fail** — the server isn't running; the
  Vite proxy forwards `/api` to `http://localhost:4100`. Confirm the health
  check above passes.
- **`concurrently: command not found` on `npm run dev`** — run `npm install` at
  the repo root (it provides `concurrently`), then retry.
- **Reset local data** — stop the app and delete `server/vendor-risk.db` (and
  the `-wal`/`-shm` files) plus `server/uploads/`; they are recreated on next
  start. Both are git-ignored.
