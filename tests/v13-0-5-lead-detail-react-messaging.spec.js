// v13.0.5 regression — the React "new experience" lead-detail page never
// called MessengerWidget.setLead() on load, so the floating widget bubble
// showed "No lead selected" even on a lead's own page (classic view always
// synced it; the React page didn't). Fixed in LeadDetailHub.jsx. This checks
// the ambient sync directly via window._currentLead, which is what feeds
// MessengerWidget.setLead() — doesn't depend on SMS being enabled for the
// test account, since the sync itself isn't gated on messaging capability.
//
// Run: SDR_TOKEN=... LEAD_ASSIGNED_ID=... npx playwright test tests/v13-0-5-lead-detail-react-messaging.spec.js
const { test, expect } = require('@playwright/test');

const BASE = process.env.CRM_URL || 'https://messenger-frontend-staging.onrender.com';
const SDR_TOKEN = process.env.SDR_TOKEN || '';
const LEAD_IN_ASSIGNED = process.env.LEAD_ASSIGNED_ID || '';

test.describe('v13.0.5 — React lead-detail page syncs lead into the Alternate Messenger widget', () => {
  test('window._currentLead is set to the open lead on the React lead-detail page', async ({ page }) => {
    if (!SDR_TOKEN || !LEAD_IN_ASSIGNED) { test.skip(); return; }

    // Pre-seed the "new experience" opt-in flag the same way app.js reads it
    // (localStorage 'leadDetailHub' === 'on') — see frontend/js/app.js:513.
    await page.addInitScript(() => localStorage.setItem('leadDetailHub', 'on'));

    await page.goto(`${BASE}/?token=${SDR_TOKEN}`);
    await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
    await page.evaluate((id) => { window.location.hash = `#lead-detail/${id}`; }, LEAD_IN_ASSIGNED);

    // The React page's own "classic view" toggle link only renders there —
    // confirms we actually landed on the new experience, not the fallback.
    await page.waitForSelector('text=Switch to classic view', { timeout: 30000 });

    await expect.poll(() => page.evaluate(() => window._currentLead?.id), { timeout: 10000 })
      .toBe(LEAD_IN_ASSIGNED);
  });
});
