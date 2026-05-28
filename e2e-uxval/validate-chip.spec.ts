import { test } from '@playwright/test';
import path from 'path';
import { mkdirSync } from 'fs';

const IMG_DIR = '/home/runner/work/vendor-risk-portal/vendor-risk-portal/agents/88164cca/ux_validator/ux_img';
mkdirSync(IMG_DIR, { recursive: true });

const BASE = 'http://localhost:5173';

test('05b ReviewWorkspace internet_facing=Yes chip after toggle', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // Sign in
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Developer sign-in (local only)' }).click();
  await page.getByLabel('Email for local developer session').fill('chip-analyst@example.test');
  await page.getByLabel('Role for local developer session').selectOption('Analyst');
  await page.getByLabel('Tenant for local developer session').fill('Chip Test Co');
  await page.getByRole('button', { name: 'Sign in' }).click();

  // Load CloudPay from showcase (first button = CloudPay typically)
  await page.goto(`${BASE}/showcase`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  // Find a Load & Analyze button
  const loadBtns = page.getByRole('button', { name: /Load & Analyze|Load/i });
  const count = await loadBtns.count();
  console.log('Load buttons:', count);

  // Load the first scenario
  await loadBtns.first().click();
  await page.waitForURL(/\/assessments\/\d+/, { timeout: 30000 });
  await page.waitForTimeout(1500);

  const url = page.url();
  const assessmentId = url.match(/\/assessments\/(\d+)/)?.[1];
  console.log('Assessment:', assessmentId, url);

  // Check current internet_facing state
  const bodyText = await page.evaluate(() => document.body.innerText);
  const hasYes = /INTERNET-FACING\s*\n?\s*Yes/.test(bodyText);
  console.log('Has Yes already:', hasYes);

  // If not yet Yes, click Mark Yes
  const markYesBtn = page.getByRole('button', { name: /Mark Yes/i });
  if (await markYesBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await markYesBtn.click();
    await page.waitForTimeout(1000);
    console.log('Toggled to Yes');
  }

  const shot = path.join(IMG_DIR, '05b_after_review_workspace_internet_facing_yes_1280px.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log('Saved:', shot);

  // Also capture just the summary card
  const summaryCard = page.locator('.card').first();
  const shot5b = path.join(IMG_DIR, '05b_summary_card_internet_facing_yes.png');
  await summaryCard.screenshot({ path: shot5b });
  console.log('Saved:', shot5b);

  const updatedText = await page.evaluate(() => document.body.innerText);
  console.log('Updated text (first 500):', updatedText.slice(0, 500));

  await ctx.close();
});
