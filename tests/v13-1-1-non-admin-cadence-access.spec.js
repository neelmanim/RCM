// Live verification that v13.1.1's role-widening is real in the UI, not just
// backend-tested: an AE (non-admin) should now see "New Cadence" in Sales
// Tools and "Enroll in Cadence" in the Leads Hub bulk bar — both were hidden
// below Pod Admin before this release.
//
// STAGING ONLY. Refuses to run against any other host (see guard below).
//   V_AE_TOKEN=... npx playwright test tests/v13-1-1-non-admin-cadence-access.spec.js
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API = process.env.API_BASE_URL || 'https://messenger-crm-staging.onrender.com';
const AE = process.env.V_AE_TOKEN || '';
const SA = process.env.V_SA_TOKEN || ''; // only used to clean up the test lead this spec creates
if (!/^https:\/\/messenger-(crm|frontend)-staging\.onrender\.com$/.test(API) ||
    !/^https:\/\/messenger-frontend-staging\.onrender\.com$/.test(BASE_URL)) {
  throw new Error(`Refusing to run: not staging (${API}, ${BASE_URL})`);
}

test.describe.configure({ mode: 'serial', retries: 0 });

test.describe('v13.1.1 — non-admin (AE) cadence access', () => {
  test.skip(!AE, 'V_AE_TOKEN is required');
  test.setTimeout(90000);
  const state = { leadId: null };

  test.afterAll(async ({ request }) => {
    if (state.leadId && SA) {
      await request.fetch(`${API}/api/admin/leads/bulk-delete`, {
        method: 'POST', headers: { Authorization: `Bearer ${SA}` },
        data: { lead_ids: [state.leadId] },
      }).catch(() => {});
    }
  });

  test('AE sees "New Cadence" in Sales Tools', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('alternate:sales-tools-tour-seen', '1');
        localStorage.setItem('alternate:cadence-rep-tour-seen-v2', '1');
      } catch { /* */ }
    });
    await page.goto(`${BASE_URL}/?token=${AE}`);
    await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
    await page.evaluate(() => { window.location.hash = '#sales-tools'; });
    await expect(page.getByRole('button', { name: 'New Cadence' })).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: 'tests/screenshots/v13-1-1-ae-new-cadence.png', fullPage: true });
  });

  test('AE sees "Enroll in Cadence" in the Leads Hub bulk bar', async ({ page, request }) => {
    // This AE test account has zero leads assigned under default filters —
    // create one so there's an actual row to select.
    const leadName = `V1311QA${Date.now()}`;
    const r = await request.fetch(`${API}/api/leads`, {
      method: 'POST', headers: { Authorization: `Bearer ${AE}` },
      data: { first_name: leadName, last_name: 'Test', email: `${leadName}@example.com`, status: 'Lead Assigned' },
    });
    const lead = await r.json();
    state.leadId = lead.id;

    await page.addInitScript(() => {
      try {
        localStorage.setItem('leadsHub', 'on');
        localStorage.setItem('alternate:leads-hub-tour-seen-v2', '1');
      } catch { /* */ }
    });
    await page.goto(`${BASE_URL}/?token=${AE}`);
    await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
    await page.evaluate(() => { window.location.hash = '#leads'; });
    await page.waitForSelector('text=Select Leads', { timeout: 30000 });
    await page.getByPlaceholder('Search name, email, or company…').fill(leadName);
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Select Leads' }).click();

    const firstCheckbox = page.getByRole('checkbox', { name: new RegExp(leadName) });
    await expect(firstCheckbox).toBeVisible({ timeout: 30000 });
    await firstCheckbox.check();

    await expect(page.getByRole('button', { name: 'Enroll in Cadence' })).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'tests/screenshots/v13-1-1-ae-enroll-button.png', fullPage: true });
  });
});
