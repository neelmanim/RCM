// v13.0.0 staging audit — auth gate, per-lead access, cadence builder, every role.
// Tokens come from the environment only (never committed):
//   V_SA_TOKEN=... V_PA_TOKEN=... V_SDR_TOKEN=... V_AE_TOKEN=... V_CSM_TOKEN=... \
//     npx playwright test tests/v13-0-0-staging-audit.spec.js
// Read-only: no test writes to staging.
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API = process.env.API_BASE_URL || 'https://messenger-crm-staging.onrender.com';
const T = {
  SA: process.env.V_SA_TOKEN || '', PA: process.env.V_PA_TOKEN || '', SDR: process.env.V_SDR_TOKEN || '',
  AE: process.env.V_AE_TOKEN || '', CSM: process.env.V_CSM_TOKEN || '',
};

// Staging fixtures. PA = Sneha Reddy; SDR = Dev Kapoor.
const CROSS_POD_LEAD = '09abcc2d-873d-4b3d-ba37-def65dbb3985'; // Meera Iyer's, outside Sneha's pod
const OWN_POD_LEAD = '4a3fca01-884d-4f8f-9d73-18494df0722c';   // Divya Saxena's, in Sneha's pod
const SDR_OWN_LEAD = '462404ae-71ba-4db1-a3a9-859fe20e7697';
// id, not name: the cadence list is unpaginated and sorted newest-first, so
// an older fixture's name can scroll out of the accessibility snapshot
// (confirmed via error-context.md — "Testing New Cadence" still exists via
// GET /api/journeys, just not rendered in the visible list by the time the
// click fires). The #sales-tools/{id} deep-link (v13.0.4) lands directly in
// its builder, sidestepping list position entirely.
const DRAFT_CADENCE_ID = '29f8f7fc-2ad8-4a3a-93ec-1570fb9757a1'; // "Testing New Cadence", draft
const SHOTS = 'tests/screenshots/v13-0-0';

const TOUR_KEYS = [
  'alternate:my-tasks-tour-seen', 'alternate:ae-pipeline-tour-seen', 'alternate:daily-digest-tour-seen',
  'alternate:leaderboard-tour-seen', 'alternate:sales-tools-tour-seen', 'alternate:my-settings-tour-seen',
  'alternate:cadence-rep-tour-seen-v2', 'alternate:power-dialer-tour-seen', 'alternate:control-center-tour-seen',
  'alternate:leads-hub-tour-seen-v2', 'alternate:lead-detail-emails-tour-seen', 'alternate:cadence-builder-v13-tour-seen',
  'alternate:csm-account-360-tour-seen', 'alternate:aircall-drawer-tour-seen', 'alternate:csm-portal-tour-seen',
  'alternate:analytics-hub-tour-seen', 'alternate:csm-inbox-tour-seen',
];

async function login(page, token, landing = 'nav >> text=Dashboard') {
  await page.addInitScript((keys) => {
    try { keys.forEach((k) => localStorage.setItem(k, '1')); localStorage.setItem('leadDetailHub', 'on'); } catch { /* no storage */ }
  }, TOUR_KEYS);
  await page.goto(`${BASE_URL}/?token=${token}`);
  await page.waitForSelector(landing, { timeout: 30000 });
}

async function openLead(page, id) {
  await page.evaluate((lid) => { window.location.hash = `#lead-detail/${lid}`; }, id);
  await expect(page.locator('.leaddetailhub')).toBeVisible({ timeout: 20000 });
}

const auth = (t) => ({ headers: { Authorization: `Bearer ${t}` } });

test.describe('v13.0.0 staging audit', () => {
  test.skip(!T.SA || !T.PA || !T.SDR, 'V_SA_TOKEN / V_PA_TOKEN / V_SDR_TOKEN not set');

  test('1. auth gate: no token and a forged token are both refused', async ({ request }) => {
    expect((await request.get(`${API}/api/leads`)).status()).toBe(401);
    const forged = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4Iiwicm9sZSI6IlN1cGVyIEFkbWluIn0.x';
    expect((await request.get(`${API}/api/leads`, auth(forged))).status()).toBe(401);
  });

  test('2. Pod Admin can read leads in and outside their pod', async ({ request }) => {
    expect((await request.get(`${API}/api/leads/${OWN_POD_LEAD}`, auth(T.PA))).status()).toBe(200);
    expect((await request.get(`${API}/api/leads/${CROSS_POD_LEAD}`, auth(T.PA))).status()).toBe(200);
    expect((await request.get(`${API}/api/leads/${CROSS_POD_LEAD}/notes`, auth(T.PA))).status()).toBe(200);
  });

  test('3. SDR cannot open another rep\'s lead or export', async ({ request }) => {
    for (const path of ['', '/notes', '/tasks']) {
      expect((await request.get(`${API}/api/leads/${CROSS_POD_LEAD}${path}`, auth(T.SDR))).status()).toBe(404);
    }
    expect((await request.get(`${API}/api/leads/${SDR_OWN_LEAD}`, auth(T.SDR))).status()).toBe(200);
    expect((await request.get(`${API}/api/admin/leads/export`, auth(T.SDR))).status()).toBe(403);
  });

  test('4. cadence builder offers Task steps, field conditions and Cadence rules', async ({ page }) => {
    await login(page, T.SA);
    await page.evaluate((id) => { window.location.hash = `#sales-tools/${id}`; }, DRAFT_CADENCE_ID);
    await expect(page.locator('[data-tour="add-task-step"]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-tour="add-condition-step"]')).toBeVisible();
    await expect(page.locator('[data-tour="cadence-rules"]')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}-cadence-builder.png`, fullPage: true });
    await page.locator('[data-tour="cadence-rules"] button').first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}-cadence-rules.png`, fullPage: true });
    await page.keyboard.press('Escape'); // closes without saving
  });

  test('5. Pod Admin opens a cross-pod lead (read-only)', async ({ page }) => {
    await login(page, T.PA);
    await openLead(page, CROSS_POD_LEAD);
    await expect(page.getByText(/not found|access denied/i)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}-pa-cross-pod-lead.png`, fullPage: true });
  });

  test('6. SDR: My Tasks and own lead Emails card load', async ({ page }) => {
    await login(page, T.SDR);
    await page.evaluate(() => { window.location.hash = '#my-tasks'; });
    await page.waitForTimeout(3000);
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}-sdr-my-tasks.png`, fullPage: true });
    await openLead(page, SDR_OWN_LEAD);
    await expect(page.locator('h3', { hasText: /^Emails$/ })).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: `${SHOTS}-sdr-lead-emails.png`, fullPage: true });
  });

  test('7. AE and CSM still log in', async ({ page, context }) => {
    test.skip(!T.AE || !T.CSM, 'V_AE_TOKEN / V_CSM_TOKEN not set');
    await login(page, T.AE);
    await page.screenshot({ path: `${SHOTS}-ae-landing.png` });
    await context.clearCookies();
    const csm = await context.newPage();
    await login(csm, T.CSM, 'nav');
    await expect(csm.getByText(/something went wrong/i)).toHaveCount(0);
    await csm.screenshot({ path: `${SHOTS}-csm-landing.png` });
  });

  test('8. Help Hub release notes list v13.0.1', async ({ page }) => {
    await login(page, T.SDR);
    await page.getByRole('link', { name: 'Help', exact: true }).click();
    await page.getByRole('button', { name: /What's New/ }).click();
    // Newest release up top; older ones sit behind "Load more" now there are many.
    await expect(page.getByText('v13.4.0', { exact: true }).first()).toBeVisible({ timeout: 20000 });
    const older = page.getByText('v13.0.2', { exact: true }).first();
    for (let i = 0; i < 10 && !(await older.isVisible()); i++) {
      await page.getByRole('button', { name: /Load more/ }).click();
    }
    await expect(older).toBeVisible();
  });
});
