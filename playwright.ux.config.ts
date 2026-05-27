import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

// The scenario-driven UX regression suite. It reuses the base config's offline webServer
// (Express + Vite on the dedicated E2E ports, throwaway SQLite, rule-engine mode) verbatim,
// and only diverges on what's UX-specific: the test dir, baseline location, snapshot tuning,
// and a `setup` project that mints one reusable session per role (auth.setup.ts) so the suite
// never trips the login rate limit. Pixel snapshots only run under UX_VISUAL=1 (nightly).
//
// Baselines MUST be generated on Linux CI (host font antialiasing differs from macOS →
// false-red). The {-platform} token tags them so a stray macOS baseline can't masquerade
// as the Linux one. See specs/0012-ux-tasks-harness.md and .github/workflows/ux-regression.yml.
export default defineConfig({
  ...base,
  testDir: './e2e/ux',
  testIgnore: [], // base ignores e2e/ux for the smoke suite; re-include it here.
  snapshotPathTemplate: 'e2e/ux/__screenshots__/{arg}{-projectName}{-platform}{ext}',
  expect: {
    ...(base.expect ?? {}),
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      testMatch: /ux\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
});
