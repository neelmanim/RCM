// v13.5.0 — Instantly step "Send from" picker, on staging. VIEW ONLY: opens an
// existing cadence's Instantly step and reads the picker; never ticks, saves,
// publishes or enrolls (the staging demo data must stay untouched).
//
// STAGING ONLY.
//   SA_TOKEN=... SDR_TOKEN=... INSTANTLY_CADENCE_ID=<cadence with an Instantly step> \
//     npx playwright test tests/v13-5-0-instantly-send-from.spec.js
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API = process.env.API_BASE_URL || 'https://messenger-crm-staging.onrender.com';
const SA = process.env.V_SA_TOKEN || process.env.SA_TOKEN || '';
const SDR = process.env.SDR_DEVKAPOOR_TOKEN || process.env.SDR_TOKEN || '';
const CADENCE = process.env.INSTANTLY_CADENCE_ID || '';

if (!/^https:\/\/messenger-crm-staging\.onrender\.com$/.test(API) ||
    !/^https:\/\/messenger-frontend-staging\.onrender\.com$/.test(BASE_URL)) {
  throw new Error(`Refusing to run: not staging (${API}, ${BASE_URL})`);
}

const get = async (request, path, token) => {
  const r = await request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status(), body: r.status() === 200 ? await r.json() : null };
};

test.describe('v13.5.0 Instantly "Send from" (staging, view only)', () => {
  test.beforeAll(() => {
    expect(SA && SDR && CADENCE, 'SA_TOKEN, SDR_TOKEN and INSTANTLY_CADENCE_ID are required').toBeTruthy();
  });

  test('the enabled-mailbox list matches Control Center, for a rep too', async ({ request }) => {
    const all = await get(request, '/api/admin/instantly/accounts', SA);
    const enabledSetting = (await get(request, '/api/dialer/config', SA)).body.instantly_sending_accounts;
    const forRep = await get(request, '/api/instantly/sending-accounts', SDR);
    expect(forRep.status).toBe(200);
    const expected = enabledSetting?.length ? enabledSetting : all.body.map((a) => a.email);
    expect(forRep.body.map((a) => a.email).sort()).toEqual([...expected].sort());
    for (const a of forRep.body) expect(a.domain).toBe(a.email.split('@')[1].toLowerCase());
    expect((await get(request, '/api/admin/instantly/accounts', SDR)).status).toBe(403);
  });

  test('the builder shows "Send from" grouped by domain on the Instantly step', async ({ page, request }) => {
    const domains = new Set((await get(request, '/api/instantly/sending-accounts', SA)).body.map((a) => a.domain));
    await page.addInitScript(() => {
      try { ['alternate:cadence-builder-tour-seen', 'alternate:sales-tools-tour-seen', 'alternate:aircall-drawer-tour-seen', 'alternate:aircall-drawer-tour-seen-v2', 'alternate:cadence-builder-v13-tour-seen', 'alternate:cadence-builder-v13-tour-seen-v2'].forEach((k) => localStorage.setItem(k, '1')); } catch { /* */ }
    });
    await page.goto(`${BASE_URL}/?token=${SA}`);
    await page.waitForSelector('nav a, nav button', { timeout: 30000 });
    await page.evaluate((id) => { window.location.hash = `#sales-tools/${id}`; }, CADENCE);
    const skip = page.getByRole('button', { name: /Skip tour/ });
    await page.locator('.react-flow__node').filter({ hasText: /Instantly/ }).first().waitFor({ timeout: 30000 });
    if (await skip.count()) await skip.click();
    await page.locator('.react-flow__node').filter({ hasText: /Instantly/ }).first().click();
    await expect(page.getByText('Send from', { exact: true })).toBeVisible({ timeout: 20000 });
    // panel summary names the real domain count; "Change" opens the searchable picker with a domain filter
    await expect(page.getByText(new RegExp(`on ${domains.size} domain${domains.size === 1 ? '' : 's'}`)).first()).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Change', exact: true }).click();
    await expect(page.getByPlaceholder('Search mailboxes…')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(new RegExp(`All domains \\(${domains.size}\\)`))).toBeVisible();
    await page.screenshot({ path: 'tests/screenshots/v13-5-0-send-from.png' });
  });
});
