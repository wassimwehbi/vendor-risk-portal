// Playwright "setup" project: sign in once per role and persist the session so the UX
// specs can reuse it (via storageState) instead of logging in on every test. Only the
// roles actually exercised by the manifest are minted. See playwright.ux.config.ts.
import { test as setup } from '@playwright/test';
import { ROLE_STATE, devSignIn } from './auth';
import { SCENARIOS } from './scenarios';

// Mint exactly the roles the manifest actually uses (single source of truth), so a new
// scenario role can never reference a non-existent storageState file.
const ROLES = [...new Set(SCENARIOS.filter((s) => !s.public).map((s) => s.role))];

for (const role of ROLES) {
  setup(`authenticate ${role}`, async ({ page }) => {
    await devSignIn(page, role);
    await page.context().storageState({ path: ROLE_STATE[role] });
  });
}
