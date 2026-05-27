import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// E2E boots the real stack offline: the Express API (dev auth, throwaway SQLite,
// no ANTHROPIC_API_KEY → deterministic rule engine) plus the Vite dev server, which
// proxies /api to the API so the SPA is same-origin (matching local dev). Dedicated
// ports (not the 4100/5173 dev defaults) + reuseExistingServer:false guarantee the
// harness starts its own offline server and never reuses a developer's `npm run dev`.
//
// Ports are env-overridable so several E2E suites can run concurrently in isolated
// worktrees (each worktree's .ports.env sets the ports). The defaults are unchanged,
// so normal local/CI E2E behaves exactly as before. The DB is always a unique
// throwaway under tmp (isolated per run) — never a developer's VRP_DB_PATH.
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT) || 4101;
const CLIENT_PORT = Number(process.env.E2E_CLIENT_PORT) || 5174;
const E2E_DB = path.join(os.tmpdir(), `vrp-e2e-${process.pid}-${Date.now()}.db`);

export default defineConfig({
  testDir: './e2e',
  // The scenario-driven UX suite lives under e2e/ux and runs via playwright.ux.config.ts.
  // Keep the smoke suite (npm run test:e2e) from picking it up.
  testIgnore: ['**/ux/**'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm --prefix server start',
      url: `http://localhost:${SERVER_PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'development',
        AUTH_MODE: 'dev',
        AUTH_SECRET: 'e2e-secret-not-for-prod',
        PORT: String(SERVER_PORT),
        VRP_DB_PATH: E2E_DB,
        ANTHROPIC_API_KEY: '', // force the offline rule engine
      },
    },
    {
      command: 'npm --prefix client run dev',
      url: `http://localhost:${CLIENT_PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        CLIENT_DEV_PORT: String(CLIENT_PORT),
        API_PROXY_TARGET: `http://localhost:${SERVER_PORT}`,
      },
    },
  ],
});
