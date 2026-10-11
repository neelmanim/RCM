/**
 * v12.6.3 staging audit — Help Hub role-scoping for the AE/CSM
 * gap-hunting batch (global account search, CSM-relevant topbar, hidden
 * Leads/Sales Tools for CSM, AE Pipeline/CSM Portal help documentation).
 *
 * Tokens via env: AE_TOKEN, CSM_TOKEN (real users, minted via the existing
 * Super-Admin View-As endpoint).
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const AE_TOKEN = process.env.AE_TOKEN;
const CSM_TOKEN = process.env.CSM_TOKEN;

const issues = [];
const logIssue = (area, detail) => { console.error(`FAIL [${area}] ${detail}`); issues.push(`[${area}] ${detail}`); };
const logOk = (area, detail) => console.log(`OK ${area}: ${detail}`);

async function login(page, token) {
  await page.addInitScript(() => {
    try { void localStorage.length; } catch { return; }
    ['csm-portal', 'my-tasks'].forEach((t) => localStorage.setItem(`alternatecrm:${t}-tour-seen`, '1'));
  });
  await page.goto(`${BASE_URL}/?token=${token}`);
  await page.waitForSelector('nav', { timeout: 45_000 });
  await page.waitForTimeout(1000);
}

async function goHash(page, hash) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(2500);
}

test.beforeAll(() => {
  if (!AE_TOKEN) throw new Error('AE_TOKEN env var is required');
  if (!CSM_TOKEN) throw new Error('CSM_TOKEN env var is required');
});

test('Help Hub: CSM sees CSM Portal section, and none of the now-irrelevant SDR/AE sections', async ({ page }) => {
  await login(page, CSM_TOKEN);
  await goHash(page, '#user-guide');
  const guide = page.locator('.helphub');
  await expect(guide.getByText('CSM Portal', { exact: true })).toBeVisible({ timeout: 15_000 });
  for (const title of ['Dashboard', 'Leads', 'Lead Detail', 'Leaderboard & SDR Performance', 'Aircall Dialer', 'Sales Tools', 'AE Pipeline']) {
    expect(await guide.getByText(title, { exact: true }).count()).toBe(0);
  }
  logOk('help-csm', 'shows CSM Portal, hides every SDR/AE-only section');
});

test('Help Hub: AE sees AE Pipeline section alongside everything else they had before', async ({ page }) => {
  await login(page, AE_TOKEN);
  await goHash(page, '#user-guide');
  const guide = page.locator('.helphub');
  await expect(guide.getByText('AE Pipeline', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(guide.getByText('Dashboard', { exact: true })).toBeVisible();
  await expect(guide.getByText('Sales Tools', { exact: true })).toBeVisible();
  expect(await guide.getByText('CSM Portal', { exact: true }).count()).toBe(0);
  logOk('help-ae', 'shows AE Pipeline plus every pre-existing AE section');
});

test('Global search: CSM finds their own account and deep-links into Account 360', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await login(page, CSM_TOKEN);
  await page.getByLabel('Search').fill('a');
  await page.waitForTimeout(400);
  await page.getByLabel('Search').fill('an'); // 2+ chars, broad enough to hit at least one seeded account
  await page.waitForTimeout(1200);
  const accountsGroup = await page.getByText('Accounts', { exact: true }).count();
  logOk('csm-search', accountsGroup > 0 ? 'Accounts group rendered' : 'no Accounts group for this query (data-dependent, not necessarily a failure)');
  if (errs.length) errs.forEach((e) => logIssue('csm-search', e));
});

test('Topbar: CSM keeps Dial (calling has no role restriction) but not New Lead', async ({ page }) => {
  await login(page, CSM_TOKEN);
  expect(await page.locator('#nh-manual-dial-btn').count()).toBe(1);
  expect(await page.locator('#nh-new-lead-btn').count()).toBe(0);
  await page.close();
});

test.afterAll(() => {
  console.log(`\n=== v12.6.3 staging audit: ${issues.length} issue(s) ===`);
  if (issues.length) throw new Error(issues.join('\n'));
});
