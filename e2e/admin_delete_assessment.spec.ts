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

test.describe('Admin delete assessment', () => {
  test('admin sees Delete button on dashboard rows; analyst does not', async ({ page }) => {
    // Load a demo scenario as admin first so there is at least one assessment.
    await devLogin(page, { email: 'e2e-admin-del@example.test', role: 'Admin' });
    await page.goto('/showcase');
    await page.getByRole('button', { name: 'Load & Analyze' }).first().click();
    await expect(page).toHaveURL(/\/assessments\/\d+$/, { timeout: 30_000 });

    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Delete' }).first()).toBeVisible();

    await signOut(page);

    // Analyst must NOT see the Delete button.
    await devLogin(page, { email: 'e2e-analyst@example.test', role: 'Analyst', tenant: 'E2E Co' });
    await expect(page.getByRole('button', { name: 'Delete' })).not.toBeVisible();

    await signOut(page);
  });

  test('admin can delete an assessment from the dashboard row', async ({ page }) => {
    await devLogin(page, { email: 'e2e-admin-del2@example.test', role: 'Admin' });

    // Load a scenario so there is a fresh assessment to delete.
    await page.goto('/showcase');
    await page.getByRole('button', { name: 'Load & Analyze' }).first().click();
    await expect(page).toHaveURL(/\/assessments\/(\d+)$/, { timeout: 30_000 });

    await page.goto('/');
    const firstRow = page.locator('tbody tr').first();
    const vendorName = await firstRow.locator('td').first().innerText();

    // Dismiss the confirm dialog — assert row still present.
    page.once('dialog', (d) => d.dismiss());
    await firstRow.getByRole('button', { name: 'Delete' }).click();
    await expect(firstRow).toBeVisible();

    // Accept the confirm dialog — row should disappear.
    page.once('dialog', (d) => d.accept());
    await firstRow.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(vendorName)).not.toBeVisible({ timeout: 5_000 });

    await page.screenshot({ path: 'e2e/screenshots/admin_delete_dashboard.png', fullPage: false });
  });

  test('admin can delete an assessment from the assessment page header', async ({ page }) => {
    await devLogin(page, { email: 'e2e-admin-del3@example.test', role: 'Admin' });

    // Load a fresh scenario.
    await page.goto('/showcase');
    await page.getByRole('button', { name: 'Load & Analyze' }).first().click();
    await expect(page).toHaveURL(/\/assessments\/(\d+)$/, { timeout: 30_000 });

    // Delete button visible in page header.
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();

    // Accept confirm — should navigate to dashboard and assessment is gone.
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 5_000 });

    await page.screenshot({ path: 'e2e/screenshots/admin_delete_after.png', fullPage: false });
  });
});
