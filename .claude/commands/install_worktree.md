# Install Worktree

This command sets up an isolated worktree environment for the Vendor Risk Portal with custom port configuration, then installs all dependencies. The actual port NUMBERS are passed in as args by the Python caller — this command just consumes them.

## Variables

worktree_path: $1
backend_port: $2          # → PORT (Express API)
frontend_port: $3         # → CLIENT_DEV_PORT (Vite dev server)
e2e_server_port: $4       # → E2E_SERVER_PORT (Playwright offline API)
e2e_client_port: $5       # → E2E_CLIENT_PORT (Playwright offline client)

## Read
- `.nvmrc` (Node version pin — must be `22.18.0`)
- `package.json` (root scripts: `install:ci`, `dev`, `test:e2e`)
- `client/vite.config.ts` (reads `CLIENT_DEV_PORT` and `API_PROXY_TARGET`)
- `server/src/db.ts` (reads `VRP_DB_PATH`) and `server/src/index.ts` (reads `PORT`)

## Steps

1. **Navigate to the worktree directory**
   ```bash
   cd $1
   WORKTREE_PATH=$(pwd)
   ```

2. **Assert the Node version matches `.nvmrc`**
   - Read the pinned version from `.nvmrc` (expected `22.18.0`).
   - Run `node -v` and confirm it matches the pin (this is the version Cloudflare Pages / Render CI use).
   - IMPORTANT: If `node -v` does NOT match `.nvmrc`, STOP and report the mismatch — do not continue installing against the wrong Node.

3. **Create the port + environment configuration file**
   Create `.ports.env` at the worktree root with exactly these exports (substituting the arg values and the resolved `WORKTREE_PATH`):
   ```bash
   export PORT=$2
   export CLIENT_DEV_PORT=$3
   export API_PROXY_TARGET=http://localhost:$2
   export VRP_DB_PATH=${WORKTREE_PATH}/.adw-db/vendor-risk.db
   export E2E_SERVER_PORT=$4
   export E2E_CLIENT_PORT=$5
   ```
   - Create the DB directory so the path is writable: `mkdir -p ${WORKTREE_PATH}/.adw-db`

4. **Point Playwright at a shared browser cache**
   - Export `PLAYWRIGHT_BROWSERS_PATH` to a shared cache so each worktree reuses already-downloaded browsers instead of re-downloading them: `export PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright`
   - Create the directory if it doesn't exist: `mkdir -p $HOME/.cache/ms-playwright`
   - Append the same export to `.ports.env` so later commands (review, e2e) inherit it.

5. **Install all dependencies (root + server + client)**
   ```bash
   npm run install:ci
   ```
   - This runs `npm ci` at the root, then `npm ci --prefix server` and `npm ci --prefix client`.
   - IMPORTANT: This rebuilds the native `better-sqlite3` binding for the worktree's Node; confirm it completes without native build errors.

## Error Handling
- If `node -v` does not match `.nvmrc` (22.18.0), STOP and report — do not install against the wrong Node.
- Ensure all paths written into `.ports.env` are absolute to avoid confusion across the worktree.
- If `npm run install:ci` fails on the native `better-sqlite3` rebuild, report the exact error.

## Report
- List all files created/modified (notably `.ports.env`).
- Show the port assignments: `PORT`, `CLIENT_DEV_PORT`, `E2E_SERVER_PORT`, `E2E_CLIENT_PORT`.
- Show the resolved `API_PROXY_TARGET` and `VRP_DB_PATH`.
- Confirm `node -v` matches `.nvmrc` (22.18.0).
- Confirm `PLAYWRIGHT_BROWSERS_PATH` was set and the shared cache directory exists.
- Confirm dependencies installed (root + server + client) and that `better-sqlite3` rebuilt cleanly.
