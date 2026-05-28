import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { mkdirSync } from 'fs';

const IMG_DIR = '/home/runner/work/vendor-risk-portal/vendor-risk-portal/agents/88164cca/ux_validator/ux_img';
mkdirSync(IMG_DIR, { recursive: true });

const BASE = 'http://localhost:5173';

async function devSignIn(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Developer sign-in (local only)' }).click();
  await page.getByLabel('Email for local developer session').fill('ux-analyst@example.test');
  await page.getByLabel('Role for local developer session').selectOption('Analyst');
  await page.getByLabel('Tenant for local developer session').fill('UX Validate Co');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 10000 });
}

// ==================
// 1. NewAssessment at 375px
// ==================
test('01 NewAssessment 375px - exposure context section', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();

  await devSignIn(page);
  await page.goto(`${BASE}/assessments/new`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const shot = path.join(IMG_DIR, '01_after_new_assessment_375px.png');
  await page.screenshot({ path: shot, fullPage: true });
  console.log('Saved:', shot);

  // Exposure context fieldset
  await expect(page.locator('legend').first()).toContainText(/exposure context/i);

  // Checkbox and select visible
  await expect(page.locator('#na-internet-facing')).toBeVisible();
  await expect(page.locator('#na-data-volume')).toBeVisible();

  // No horizontal overflow at 375px
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  console.log('375px scrollWidth:', scrollW);
  expect(scrollW).toBeLessThanOrEqual(395);

  await ctx.close();
});

// ==================
// 2. NewAssessment at 1280px
// ==================
test('02 NewAssessment 1280px - exposure context visible', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  await devSignIn(page);
  await page.goto(`${BASE}/assessments/new`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const shot = path.join(IMG_DIR, '02_after_new_assessment_1280px.png');
  await page.screenshot({ path: shot, fullPage: true });
  console.log('Saved:', shot);

  await expect(page.locator('legend').first()).toContainText(/exposure context/i);
  await expect(page.locator('#na-internet-facing')).toBeVisible();
  await expect(page.locator('#na-data-volume')).toBeVisible();

  // Default unknown option present
  const defaultOpt = page.locator('#na-data-volume option[value=""]');
  await expect(defaultOpt).toContainText(/unknown/i);

  await ctx.close();
});

// ==================
// 3-5. ReviewWorkspace - load demo and take summary grid screenshots
// ==================
test('03-05 ReviewWorkspace summary grid with new cells', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  await devSignIn(page);

  // Load the CloudPay demo from the showcase page
  await page.goto(`${BASE}/showcase`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  // Check if showcase is available
  const loadBtn = page.getByRole('button', { name: /Load & Analyze|Load/i }).first();
  let assessmentId: number | null = null;

  if (await loadBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await loadBtn.click();
    await expect(page).toHaveURL(/\/assessments\/\d+/, { timeout: 30000 });
    const url = page.url();
    assessmentId = Number(url.match(/\/assessments\/(\d+)/)?.[1]);
    console.log('Loaded demo from showcase, ID:', assessmentId);
  } else {
    // Try listing existing assessments
    const listResp = await page.evaluate(async () => {
      const r = await fetch('/api/assessments', { credentials: 'include' });
      if (!r.ok) return null;
      return r.json();
    });
    console.log('List resp:', JSON.stringify(listResp)?.slice(0, 200));
    if (listResp?.data?.length > 0) {
      assessmentId = listResp.data[0].id;
      console.log('Using existing assessment:', assessmentId);
      await page.goto(`${BASE}/assessments/${assessmentId}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
    }
  }

  if (!assessmentId) {
    console.log('No assessment available — skipping ReviewWorkspace screenshots');
    await ctx.close();
    return;
  }

  // Desktop 1280px — navigate to the assessment
  if (!page.url().includes(`/assessments/${assessmentId}`)) {
    await page.goto(`${BASE}/assessments/${assessmentId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
  }

  const shot4 = path.join(IMG_DIR, '04_after_review_workspace_summary_1280px.png');
  await page.screenshot({ path: shot4, fullPage: false });
  console.log('Saved:', shot4);

  // Verify new cells exist
  await expect(page.getByText('Internet-facing', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Personal data volume', { exact: false }).first()).toBeVisible();

  // Screenshot just the summary card
  const summaryCard = page.locator('.card').first();
  const shot5 = path.join(IMG_DIR, '05_after_review_workspace_chips_desktop.png');
  await summaryCard.screenshot({ path: shot5 });
  console.log('Saved:', shot5);

  // Log page text for chip values
  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log('Body text excerpt:', bodyText.slice(0, 600));

  await ctx.close();

  // Mobile 375px
  const ctx2 = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page2 = await ctx2.newPage();
  await devSignIn(page2);
  await page2.goto(`${BASE}/assessments/${assessmentId}`, { waitUntil: 'domcontentloaded' });
  await page2.waitForTimeout(2000);

  const shot3 = path.join(IMG_DIR, '03_after_review_workspace_summary_375px.png');
  await page2.screenshot({ path: shot3, fullPage: false });
  console.log('Saved:', shot3);

  const scrollW = await page2.evaluate(() => document.documentElement.scrollWidth);
  console.log('ReviewWorkspace 375px scrollWidth:', scrollW);

  await expect(page2.getByText('Internet-facing', { exact: false }).first()).toBeVisible();
  await expect(page2.getByText('Personal data volume', { exact: false }).first()).toBeVisible();

  await ctx2.close();
});
