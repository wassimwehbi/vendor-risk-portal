import { test, expect } from '@playwright/test';

test.describe('Vendor Risk Portal smoke', () => {
  test('an unauthenticated visit is redirected to the sign-in page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Vendor Risk Portal' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('developer sign-in → load a demo scenario → see an analyzed risk band', async ({ page }) => {
    await page.goto('/login');

    // Reveal and submit the local developer sign-in form.
    await page.getByRole('button', { name: 'Developer sign-in (local only)' }).click();
    await page.getByLabel('Email for local developer session').fill('e2e-analyst@example.test');
    await page.getByLabel('Role for local developer session').selectOption('Analyst');
    await page.getByLabel('Tenant for local developer session').fill('E2E Co');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Authenticated dashboard, with the offline rule engine reported. Assert the page
    // heading specifically — `getByText` also matches the table's sr-only <caption> when
    // the dashboard has assessments (e.g. seeded by an earlier spec in the shared run).
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Vendor risk assessments' })).toBeVisible();
    await expect(page.getByText('Rule-based (offline)')).toBeVisible();

    // Load + analyze a built-in scenario. The button only navigates once both the
    // load and the analyze calls succeed, so reaching the review URL proves the
    // full pipeline (DB → extraction → rule engine) worked end to end.
    await page.goto('/showcase');
    await page.getByRole('button', { name: 'Load & Analyze' }).first().click();
    await expect(page).toHaveURL(/\/assessments\/\d+$/, { timeout: 30_000 });

    // The assessment now carries a real preliminary risk band.
    await expect(page.getByText(/\b(Low|Medium|High|Critical)\b/).first()).toBeVisible();
  });
});
