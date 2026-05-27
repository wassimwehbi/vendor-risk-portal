// Shared dev sign-in used by the auth.setup.ts project to mint one reusable session
// per role. Reusing storageState (instead of signing in per test) keeps us well under
// the server's 20-logins / 15-min rate limit (server/src/routes/auth.ts) and makes the
// suite much faster. See playwright.ux.config.ts (the `setup` project dependency).
import { expect, type Page } from '@playwright/test';
import type { Role } from './scenarios';

/** Where each role's saved session cookies live (gitignored — see .gitignore). */
export const ROLE_STATE: Record<Role, string> = {
  Admin: 'playwright/.auth/Admin.json',
  Analyst: 'playwright/.auth/Analyst.json',
  Submitter: 'playwright/.auth/Submitter.json',
  Viewer: 'playwright/.auth/Viewer.json',
};

/** Drive the local "Developer sign-in" form (same flow as e2e/smoke.spec.ts). The tenant
 *  field is disabled for Admin (global admin, no tenant) per client/src/pages/Login.tsx. */
export async function devSignIn(page: Page, role: Role): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Developer sign-in (local only)' }).click();
  await page.getByLabel('Email for local developer session').fill(`e2e-${role.toLowerCase()}@example.test`);
  await page.getByLabel('Role for local developer session').selectOption(role);
  if (role !== 'Admin') {
    await page.getByLabel('Tenant for local developer session').fill('UX Co');
  }
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
}
