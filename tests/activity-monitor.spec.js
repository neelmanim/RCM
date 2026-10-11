// ── Activity Monitor — Playwright verification against live staging ─────────
// Verifies the Calls/Email/Messages migration of Call Monitor: nav rename,
// per-tab data load, filters, tab isolation, auto-refresh toggle, and the
// SDR-blocked access-denied path (both nav-hidden and direct-hash-guarded).
// Uses the raw JWTs in .env.test via the app's `?token=` login, matching
// tests/v11-8-verification.spec.js's established pattern.
// Run: npx playwright test tests/activity-monitor.spec.js
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
  await page.waitForTimeout(2500);
}

test.describe('Activity Monitor — Super Admin', () => {

  test('1. Nav shows "Activity Monitor" (not "Call Monitor"), and the Calls tab loads with stats', async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await expect(page.getByRole('link', { name: 'Call Monitor', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Activity Monitor', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Activity Monitor' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Total Calls')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.activitymonitor').getByText('Connected', { exact: true })).toBeVisible();
  });

  test('2. SDR filter is a searchable combobox populated from the live team, not a native <select>', async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await goToHash(page, '#activity-monitor');
    await expect(page.getByText('Total Calls')).toBeVisible({ timeout: 15000 });

    expect(await page.locator('.activitymonitor select').count()).toBe(0); // no native <select> in this feature
    await page.getByRole('button', { name: 'All SDRs' }).click();
    await expect(page.getByPlaceholder('Search…')).toBeVisible({ timeout: 5000 });
    const optionCount = await page.getByRole('option').count();
    expect(optionCount).toBeGreaterThan(1); // "All SDRs" + at least one real SDR
  });

  test('3. Switching to the Email tab shows email-specific stats and clears the Calls tile', async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await goToHash(page, '#activity-monitor');
    await expect(page.getByText('Total Calls')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Email', exact: true }).click();
    await expect(page.getByText('Open Rate')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Total Calls')).toHaveCount(0);
    // Calls-only filter (Provider) must not leak onto the Email tab.
    await expect(page.getByText('All Providers')).toHaveCount(0);
  });

  test('4. Switching to the Messages tab shows channel-specific stats (WhatsApp split)', async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await goToHash(page, '#activity-monitor');
    await expect(page.getByText('Total Calls')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Messages', exact: true }).click();
    await expect(page.getByText('WhatsApp')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Delivered')).toBeVisible();
    await expect(page.getByText('All Channels')).toBeVisible(); // Messages-only filter present
  });

  test('5. Applying a search filter round-trips without an error banner', async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await goToHash(page, '#activity-monitor');
    await expect(page.getByText('Total Calls')).toBeVisible({ timeout: 15000 });

    await page.getByPlaceholder(/Search lead or company/i).fill('zzz-no-such-lead-zzz');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.waitForTimeout(1500);
    await expect(page.getByText(/Couldn't load activity/i)).toHaveCount(0);
    // A search that matches nothing must show the empty state, not a blank table.
    await expect(page.getByText('No calls found')).toBeVisible({ timeout: 10000 });
  });

  test('6. Auto-refresh toggle flips between ON and OFF', async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await goToHash(page, '#activity-monitor');
    await expect(page.getByText('Total Calls')).toBeVisible({ timeout: 15000 });

    const toggle = page.getByRole('button', { name: /Auto-refresh:/ });
    await expect(toggle).toContainText('ON');
    await toggle.click();
    await expect(toggle).toContainText('OFF');
  });

  test('7. The date-range calendar keeps the range ordered even when the later day is picked first', async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await goToHash(page, '#activity-monitor');
    await expect(page.getByText('Total Calls')).toBeVisible({ timeout: 15000 });

    // A single Radix-calendar range picker replaced the two native
    // <input type="date"> fields — react-day-picker always keeps
    // from <= to by construction, so the old "From after To" invalid-state
    // banner can no longer occur; this verifies that directly instead.
    await page.getByRole('button', { name: /Date range/ }).click();
    await expect(page.getByRole('button', { name: /10th,/ }).first()).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: /10th,/ }).first().click();
    await page.getByRole('button', { name: /\b5th,/ }).first().click();

    await expect(page.getByText(/must be on or before/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeEnabled();
  });

  test('8. Backend endpoints are live and pod-scoping-gated (401/403 without a token)', async ({ request }) => {
    const email = await request.get(`${API_BASE_URL}/api/admin/email-logs`);
    expect([401, 403]).toContain(email.status());
    const messages = await request.get(`${API_BASE_URL}/api/admin/message-logs`);
    expect([401, 403]).toContain(messages.status());
  });
});

test.describe('Activity Monitor — SDR (blocked)', () => {

  test('9. SDR does not see "Activity Monitor" in the nav', async ({ page }) => {
    await loginWithToken(page, SDR_TOKEN);
    await expect(page.getByRole('link', { name: 'Activity Monitor', exact: true })).toHaveCount(0);
  });

  test('10. SDR hitting #activity-monitor directly gets Access Denied, not the page', async ({ page }) => {
    await loginWithToken(page, SDR_TOKEN);
    await goToHash(page, '#activity-monitor');
    await expect(page.getByText('Access Denied')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Total Calls')).toHaveCount(0);
  });

  test('11. SDR token is rejected by both new backend endpoints (403)', async ({ request }) => {
    const email = await request.get(`${API_BASE_URL}/api/admin/email-logs`, {
      headers: { Authorization: `Bearer ${SDR_TOKEN}` },
    });
    expect(email.status()).toBe(403);
    const messages = await request.get(`${API_BASE_URL}/api/admin/message-logs`, {
      headers: { Authorization: `Bearer ${SDR_TOKEN}` },
    });
    expect(messages.status()).toBe(403);
  });
});
