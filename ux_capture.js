const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const IMG_DIR = '/home/runner/work/vendor-risk-portal/vendor-risk-portal/agents/d6f82d83/ux_validator/ux_img';
const BASE_URL = 'http://localhost:5173';

async function devLogin(page, role = 'Analyst') {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForSelector('input[type="email"], input[name="email"], form', { timeout: 10000 });
  // Try dev login form
  try {
    await page.fill('input[type="email"]', 'analyst@acme.test');
  } catch {}
  try {
    const roleSelect = page.locator('select');
    await roleSelect.selectOption({ label: role });
  } catch {}
  await page.click('button[type="submit"]');
  await page.waitForURL('**/', { timeout: 10000 });
}

async function loadScenario(page, index = 0) {
  await page.goto(`${BASE_URL}/showcase`);
  await page.waitForLoadState('networkidle');
  const buttons = page.locator('button:has-text("Load"), button:has-text("Analyze"), a:has-text("Load")');
  const count = await buttons.count();
  console.log(`Found ${count} load buttons`);
  if (count > index) {
    await buttons.nth(index).click();
  } else if (count > 0) {
    await buttons.first().click();
  }
  // Wait for navigation to assessment page
  await page.waitForURL('**/assessments/**', { timeout: 30000 });
  const url = page.url();
  console.log('Assessment URL:', url);
  return url;
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // CAPTURE BEFORE - check out origin/main's ReportView code
  // Since we can't truly check out origin/main easily, we'll note that
  // and capture only AFTER for this feature addition.
  
  // AFTER screenshots - current branch
  for (const viewport of [
    { name: 'mobile', width: 375, height: 812 },
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'tablet', width: 768, height: 1024 },
  ]) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
    
    try {
      // Sign in
      await devLogin(page, 'Analyst');
      console.log(`Signed in at ${viewport.name}`);

      // Load scenario
      const assessmentUrl = await loadScenario(page, 0);
      const assessmentId = assessmentUrl.match(/assessments\/(\d+)/)?.[1];
      if (!assessmentId) {
        console.error('Could not extract assessment ID from', assessmentUrl);
        await page.screenshot({ path: `${IMG_DIR}/debug_${viewport.name}.png`, fullPage: true });
        continue;
      }
      
      // Navigate to report page
      await page.goto(`${BASE_URL}/assessments/${assessmentId}/report`);
      await page.waitForLoadState('networkidle');
      
      // Check if Export GRC JSON button is visible
      const grcBtn = page.locator('a:has-text("Export GRC JSON")');
      const visible = await grcBtn.isVisible();
      console.log(`[${viewport.name}] Export GRC JSON visible:`, visible);
      
      // Take screenshot of toolbar area
      await page.screenshot({ 
        path: `${IMG_DIR}/02_after_report-toolbar-${viewport.name}.png`,
        fullPage: false 
      });
      
      // Also take full page screenshot
      await page.screenshot({ 
        path: `${IMG_DIR}/02_after_report-fullpage-${viewport.name}.png`,
        fullPage: true 
      });
      
      // Check href of GRC JSON button
      if (visible) {
        const href = await grcBtn.getAttribute('href');
        console.log(`[${viewport.name}] GRC JSON button href:`, href);
      }
      
      // Also capture all export buttons text
      const exportButtons = page.locator('.btn-secondary, .btn-primary');
      const buttonCount = await exportButtons.count();
      console.log(`[${viewport.name}] Total export buttons:`, buttonCount);
      for (let i = 0; i < buttonCount; i++) {
        const text = await exportButtons.nth(i).textContent();
        console.log(`  Button ${i}: ${text?.trim()}`);
      }
      
    } catch (e) {
      console.error(`Error at ${viewport.name}:`, e.message);
      await page.screenshot({ path: `${IMG_DIR}/error_${viewport.name}.png`, fullPage: true });
    }
    
    await page.close();
  }
  
  await browser.close();
  console.log('Screenshots captured!');
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
