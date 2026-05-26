import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

// E2E boots the real stack offline: the Express API (dev auth, throwaway SQLite,
// no ANTHROPIC_API_KEY → deterministic rule engine) plus the Vite dev server, which
// proxies /api to the API so the SPA is same-origin (matching local dev). Dedicated
// ports (not the 4100/5173 dev defaults) + reuseExistingServer:false guarantee the
// harness starts its own offline server and never reuses a developer's `npm run dev`.
const SERVER_PORT = 4101;
const CLIENT_PORT = 5174;
const E2E_DB = path.join(os.tmpdir(), `vrp-e2e-${Date.now()}.db`);

export default defineConfig({
  testDir: './e2e',
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
