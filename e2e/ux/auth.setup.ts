// Playwright "setup" project: sign in once per role and persist the session so the UX
// specs can reuse it (via storageState) instead of logging in on every test. Only the
// roles actually exercised by the manifest are minted. See playwright.ux.config.ts.
import { test as setup } from '@playwright/test';
import type { Role } from './scenarios';
import { ROLE_STATE, devSignIn } from './auth';

const ROLES: Role[] = ['Analyst', 'Admin'];

for (const role of ROLES) {
  setup(`authenticate ${role}`, async ({ page }) => {
    await devSignIn(page, role);
    await page.context().storageState({ path: ROLE_STATE[role] });
  });
}
