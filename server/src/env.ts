import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load the project-root .env (vendor-risk-portal/.env) if it exists — as
// documented in the README — regardless of the process CWD (the dev script runs
// from server/). dotenv silently no-ops when the file is absent, so .env is
// optional: the app runs fully offline on built-in defaults without one.
// Imported first in index.ts so env vars are available before any other module
// (db.ts, services/auth.ts, …) reads process.env at import time.
const here = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(here, '..', '..', '.env') });
