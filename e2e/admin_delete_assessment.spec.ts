import { test, expect } from '@playwright/test';

async function devLogin(page: import('@playwright/test').Page, opts: { email: string; role: string; tenant?: string }) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Developer sign-in (local only)' }).click();
  await page.getByLabel('Email for local developer session').fill(opts.email);
  await page.getByLabel('Role for local developer session').selectOption(opts.role);
  if (opts.tenant) await page.getByLabel('Tenant for local developer session').fill(opts.tenant);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function signOut(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login$/);
}

// Load a showcase scenario as an Analyst and return the resulting assessment URL.
// Admin dev-login has no active tenant, so the showcase "Load & Analyze" button is
// disabled until a tenant is selected — we use an Analyst account to seed the DB.
async function loadScenarioAsAnalyst(page: import('@playwright/test').Page, email: string): Promise<string> {
  await devLogin(page, { email, role: 'Analyst', tenant: 'E2E Co' });
  await page.goto('/showcase');
  await page.getByRole('button', { name: 'Load & Analyze' }).first().click();
  await expect(page).toHaveURL(/\/assessments\/\d+$/, { timeout: 30_000 });
  const url = page.url();
  await signOut(page);
  return url;
}

test.describe('Admin delete assessment', () => {
  test('admin sees Delete button on dashboard rows; analyst does not', async ({ page }) => {
    // Seed a fresh assessment via an Analyst account.
    await loadScenarioAsAnalyst(page, 'e2e-analyst-del1@example.test');

    // Admin (all-tenants mode) must see a Delete button on dashboard rows.
    await devLogin(page, { email: 'e2e-admin-del@example.test', role: 'Admin' });
    await expect(page.getByRole('button', { name: 'Delete' }).first()).toBeVisible();

    await signOut(page);

    // Analyst must NOT see the Delete button.
    await devLogin(page, { email: 'e2e-analyst@example.test', role: 'Analyst', tenant: 'E2E Co' });
    await expect(page.getByRole('button', { name: 'Delete' })).not.toBeVisible();

    await signOut(page);
  });

  test('admin can delete an assessment from the dashboard row', async ({ page }) => {
    await loadScenarioAsAnalyst(page, 'e2e-analyst-del2@example.test');

    await devLogin(page, { email: 'e2e-admin-del2@example.test', role: 'Admin' });

    const firstRow = page.locator('tbody tr').first();
    const rowsBefore = await page.locator('tbody tr').count();

    // Dismiss the confirm dialog — assert row count unchanged.
    page.once('dialog', (d) => d.dismiss());
    await firstRow.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(rowsBefore);

    // Accept the confirm dialog — one row should disappear.
    page.once('dialog', (d) => d.accept());
    await firstRow.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(rowsBefore - 1, { timeout: 5_000 });

    await page.screenshot({ path: 'e2e/screenshots/admin_delete_dashboard.png', fullPage: false });
  });

  test('admin can delete an assessment from the assessment page header', async ({ page }) => {
    const assessmentUrl = await loadScenarioAsAnalyst(page, 'e2e-analyst-del3@example.test');

    await devLogin(page, { email: 'e2e-admin-del3@example.test', role: 'Admin' });
    await page.goto(assessmentUrl);

    // Delete button visible in page header.
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();

    // Accept confirm — should navigate to dashboard and assessment is gone.
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 5_000 });

    await page.screenshot({ path: 'e2e/screenshots/admin_delete_after.png', fullPage: false });
  });
});
