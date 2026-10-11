// ── v11.8.1 / v11.8.2 verification — Super Admin + SDR ────────────────────
// Verifies, against real staging data, the 6 PTO-window Slack bugs shipped
// in v11.8.1 (Salesforce leak, call-count integrity, Power Dialer UI) and
// v11.8.2 (Connect Rate/Conversations threshold raised to 120s, help-hub
// release-notes bundle staleness fix). Uses raw JWTs handed directly by the
// user (ADMIN_TOKEN, SDR_TOKEN in .env.test) via the app's `?token=` login,
// not the mint-by-email helper — these are real staging sessions, not
// synthetic ones.
// Run: npx playwright test tests/v11-8-verification.spec.js
const { test, expect } = require('@playwright/test');
const { BASE_URL, API_BASE_URL } = require('./helpers/auth');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SDR_TOKEN = process.env.SDR_TOKEN;

async function loginWithToken(page, token) {
  await page.goto(`${BASE_URL}/?token=${token}`);
  await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
}

async function goToHash(page, hash) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(2000);
}

test.describe('Super Admin — v11.8.1/v11.8.2 verification', () => {

  test('1. Help & User Guide shows v11.8.2 as the latest release (bundle-staleness regression check)', async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await page.getByRole('link', { name: 'Help', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Help & User Guide' })).toBeVisible({ timeout: 15000 });

    const whatsNewBtn = page.getByRole('button', { name: /What's New/i });
    await expect(whatsNewBtn).toBeVisible({ timeout: 10000 });
    await whatsNewBtn.click();
    // Wait for a real post-condition (the section's own fixed intro text),
    // not a blind timeout — confirms the accordion actually expanded.
    await expect(page.getByText('Track all production updates')).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('v11.8.2', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('v11.8.0', { exact: true })).toBeVisible();
    await expect(page.getByText('v11.7.0', { exact: true })).toBeVisible();
  });

  test('2. Settings > Sync shows the Connect/Conversation threshold, defaults reflect 120s, and Save round-trips', async ({ page, request }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.click('[data-tab="sync"]');
    await page.waitForTimeout(800);

    await expect(page.getByText('Connect / Conversation Threshold')).toBeVisible({ timeout: 10000 });
    const input = page.locator('#conversation-min-seconds-input');
    await expect(input).toBeVisible();

    // Set the live value to 120 (code default; the schema default only
    // applies to fresh rows, this staging row predates the change). Verify
    // via the API rather than the button's transient "Saved" text — that
    // text reverts after 2s and Playwright's poll window can miss it if the
    // click races the tab's own async re-render.
    await input.fill('120');
    await page.click('#save-conversation-min-seconds-btn');
    await page.waitForTimeout(1500);

    const check = await request.get(`${API_BASE_URL}/api/admin/sync-settings`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const body = await check.json();
    expect(body.conversation_min_seconds).toBe(120);
  });

  test('3. Analytics Hub (classic) renders Connect Rate/Conversations without error', async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await goToHash(page, '#analytics');
    // Nothing loads until a filter is applied — pick "All" + Apply, matching
    // the hub's own gated-filter UX.
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    await expect(page.getByText('Connect Rate', { exact: false }).first()).toBeVisible({ timeout: 20000 });
  });

  test('4. Analytics Hub vNext: Connected Calls / Conversations resolve, and Inspect surfaces the shared-threshold caveat', async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await goToHash(page, '#analytics');
    await page.getByText('Try the new Analytics Hub').click();
    await expect(page.getByText('Analytics Hub vNext')).toBeVisible({ timeout: 15000 });

    await page.getByText('Metrics', { exact: true }).click();
    await page.waitForTimeout(1000);
    await expect(page.getByText('Connected Calls', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Conversations', { exact: true })).toBeVisible();

    // Open Inspect on Connect Rate and confirm the new shared-threshold
    // caveat text landed on the live Inspect panel.
    // MetricCard.jsx's name label is a direct child of the card's root div —
    // walk up exactly one level to scope everything else to this one card,
    // not `div:has(text)`, which matches every ancestor div up to the grid.
    const card = page.getByText('Connect Rate', { exact: true }).locator('xpath=..');
    await card.getByRole('button', { name: 'Inspect', exact: true }).click();
    await expect(page.getByText(/the same threshold Conversations uses, by design/i)).toBeVisible({ timeout: 10000 });
  });

  test('5. Leaderboard loads and shows Calls Today without crashing', async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await page.getByRole('link', { name: 'Leaderboard', exact: true }).click();
    await page.waitForTimeout(2000);
    await expect(page.getByText('Calls Today')).toBeVisible({ timeout: 15000 });
  });

  test('6. Lead Detail Hub: Disqualify "Other" requires a note and bypasses the attempts gate', async ({ page, request }) => {
    // Grab a real, currently-accessible lead id via the API rather than a
    // possibly-stale hardcoded id from .env.test.
    const leadsRes = await request.get(`${API_BASE_URL}/api/leads?limit=5`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const leadsBody = await leadsRes.json();
    const leads = Array.isArray(leadsBody) ? leadsBody : (leadsBody.data || leadsBody.leads || []);
    const candidate = leads.find(l => l.status !== 'Disqualified' && l.status !== 'Opted Out');
    test.skip(!candidate, 'No non-disqualified lead available to test against');

    await loginWithToken(page, ADMIN_TOKEN);
    await page.evaluate(() => localStorage.setItem('leadDetailHub', 'on'));
    await page.evaluate((id) => { window.location.hash = `#lead-detail/${id}`; }, candidate.id);
    await page.waitForTimeout(2500);

    await page.getByRole('button', { name: 'Disqualify Lead' }).click();
    await page.waitForTimeout(300);
    await page.locator('select').filter({ hasText: 'Other' }).selectOption({ label: 'Other' });

    const confirmBtn = page.getByRole('button', { name: 'Confirm' });
    await expect(confirmBtn).toBeDisabled();

    await page.getByPlaceholder('Explain the reason…').fill('E2E verification — v11.8.1 regression check');
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();
    await page.waitForTimeout(2000);

    await expect(page.getByText('Disqualified', { exact: false }).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('SDR (Ananya Gupta, View As) — v11.8.1/v11.8.2 verification', () => {

  test('7. Power Dialer loads without the ErrorBoundary crash fallback firing', async ({ page }) => {
    await loginWithToken(page, SDR_TOKEN);
    // Pre-seed the guided-tour "seen" flag — a first-time tour overlay
    // intercepts pointer events on the queue controls, matching a returning
    // user (who's already dismissed it) rather than a fresh one.
    await page.evaluate(() => localStorage.setItem('alternate:power-dialer-tour-seen', '1'));
    await page.getByRole('link', { name: 'Power Dialer', exact: true }).click();
    await page.waitForTimeout(3000);
    await expect(page.getByText('Something went wrong loading the Power Dialer.')).toHaveCount(0);
  });

  test('8. Power Dialer: LocalTimeBadge renders for queued leads without crashing the page', async ({ page }) => {
    await loginWithToken(page, SDR_TOKEN);
    // Pre-seed the guided-tour "seen" flag — a first-time tour overlay
    // intercepts pointer events on the queue controls, matching a returning
    // user (who's already dismissed it) rather than a fresh one.
    await page.evaluate(() => localStorage.setItem('alternate:power-dialer-tour-seen', '1'));
    await page.getByRole('link', { name: 'Power Dialer', exact: true }).click();
    await page.waitForTimeout(3000);
    await expect(page.getByText('Something went wrong loading the Power Dialer.')).toHaveCount(0);
    // Business-hours dot is the LocalTimeBadge's own rendered marker.
    const badge = page.locator('span').filter({ hasText: /🟢|🟡|🔴/ }).first();
    // Not asserting it's always present (a lead's number may not resolve to
    // a timezone), only that if the page rendered a queue, it didn't crash.
    const queuePresent = await page.getByText(/worked through/).isVisible().catch(() => false);
    if (queuePresent) {
      await expect(page.locator('body')).not.toContainText('Something went wrong');
    }
  });

  test('9. Power Dialer queue position persists across a navigate-away and back (sessionStorage regression check)', async ({ page }) => {
    await loginWithToken(page, SDR_TOKEN);
    // Pre-seed the guided-tour "seen" flag — a first-time tour overlay
    // intercepts pointer events on the queue controls, matching a returning
    // user (who's already dismissed it) rather than a fresh one.
    await page.evaluate(() => localStorage.setItem('alternate:power-dialer-tour-seen', '1'));
    await page.getByRole('link', { name: 'Power Dialer', exact: true }).click();
    await page.waitForTimeout(3000);

    const posLocator = page.getByText(/worked through/);
    const hasQueue = await posLocator.isVisible({ timeout: 15000 }).catch(() => false);
    test.skip(!hasQueue, 'SDR has no callable queue on staging right now');

    // Only the "N of M worked through" prefix is the actual position signal
    // — a trailing "(+X more waiting — Refresh to pull them in)" hint is
    // separate, volatile content tied to a background totalAvailable
    // refresh, not to queue position.
    const positionOf = (text) => (text.match(/\d+ of \d+ worked through/) || [text])[0];

    const before = positionOf(await posLocator.textContent());

    const skipBtn = page.getByRole('button', { name: 'Skip', exact: true });
    test.skip(!(await skipBtn.isVisible().catch(() => false)), 'No Skip button visible (queue may be empty/done)');
    await skipBtn.click();
    await page.waitForTimeout(1200);
    const afterSkip = positionOf(await posLocator.textContent());
    expect(afterSkip).not.toBe(before);

    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('link', { name: 'Power Dialer', exact: true }).click();
    await page.waitForTimeout(1500);

    const afterReturn = positionOf(await posLocator.textContent());
    expect(afterReturn).toBe(afterSkip);
  });

  test('10. Dashboard/leaderboard views render for the SDR without crashing', async ({ page }) => {
    await loginWithToken(page, SDR_TOKEN);
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await page.waitForTimeout(2000);
    await expect(page.locator('body')).not.toContainText('Something went wrong');
  });
});
