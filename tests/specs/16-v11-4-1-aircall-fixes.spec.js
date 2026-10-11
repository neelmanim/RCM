/**
 * 16-v11-4-1-aircall-fixes.spec.js
 * Playwright tests for the v11.4.1 incident fixes (US SDR dialer adoption issues)
 *
 * Covers:
 *   A. SSE stream (dialer_widget.js _openSSE) connects to the absolute API
 *      origin, not a relative path — the exact RCA'd prod bug (relative URL
 *      resolved against the frontend's own origin, hit the SPA catch-all).
 *   B. Aircall Everywhere drawer trigger renders globally and opens.
 *   C. POST /dialer/everywhere-login — 401 unauthenticated, 200 authenticated
 *      (adoption telemetry added this release).
 *   D. Automated Reports SDR Performance component now includes Calls Made
 *      and Meetings columns (previously only Qualified/Disqualified).
 */
const { test, expect, JWT_TOKEN, API_BASE, navigateTo } = require('./helpers');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';

test.describe('v11.4.1 dialer + reports fixes', () => {

  test('A. SSE stream opens against the API origin, not the frontend origin', async ({ authenticatedPage: page }) => {
    let sseUrl = null;
    page.on('request', (req) => {
      if (req.url().includes('/api/calls/events')) sseUrl = req.url();
    });

    await navigateTo(page, '/dashboard', { waitMs: 4000 });

    expect(sseUrl, 'SSE request to /api/calls/events was never made').toBeTruthy();
    expect(sseUrl.startsWith(API_BASE)).toBe(true);
    expect(sseUrl.startsWith(BASE_URL)).toBe(false);
  });

  test('B. Aircall Everywhere trigger renders and nudges open with strengthened adoption copy', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/dashboard', { waitMs: 4000 });

    // Trigger renders globally (the embed mounts on every page, not just the dialer view).
    const trigger = page.locator('#nh-aircall-drawer-btn');
    await expect(trigger).toBeVisible({ timeout: 10000 });

    // Before login (status !== 'ready'), the drawer is seeded OPEN by design —
    // nudges the SDR to log in rather than requiring them to find/click a
    // hard-to-see button, which was the exact "hard to see/use, forced to
    // open Aircall separately" complaint from the incident.
    const drawer = page.locator('[role="dialog"][aria-label="Aircall"]');
    await expect(drawer).toHaveClass(/nh-aircall-drawer--open/, { timeout: 10000 });

    // Onboarding tour copy explicitly instructs logging out of the Desktop
    // app — the strengthened v11.4.1 copy (was soft/easy to miss before).
    const tour = page.locator('.nh-aircall-tour__body');
    if (await tour.count() > 0) {
      await expect(tour).toContainText(/Log out of the Aircall Desktop app/i);
    }
  });

  test('C. /dialer/everywhere-login — 401 unauthenticated, 200 authenticated', async ({ request }) => {
    const unauth = await request.post(`${API_BASE}/api/dialer/everywhere-login`);
    expect(unauth.status()).toBe(401);

    const auth = await request.post(`${API_BASE}/api/dialer/everywhere-login`, {
      headers: { Authorization: `Bearer ${JWT_TOKEN}` },
    });
    expect(auth.status()).toBe(200);
    expect((await auth.json()).ok).toBe(true);
  });

  test('D. Reports SDR Performance component includes Calls Made and Meetings', async ({ request }) => {
    const senders = await (await request.get(`${API_BASE}/api/admin/analytics/reports/senders`, {
      headers: { Authorization: `Bearer ${JWT_TOKEN}` },
    })).json();
    expect(senders.length, 'no connected-mailbox sender available on staging to test report creation').toBeGreaterThan(0);

    const create = await request.post(`${API_BASE}/api/admin/analytics/reports`, {
      headers: { Authorization: `Bearer ${JWT_TOKEN}` },
      data: {
        name: '[playwright-temp] v11.4.1 verification',
        components: ['sdr_performance'],
        date_range_rule: 'previous_7_days',
        frequency: 'weekly',
        to_recipients: [senders[0].email],
        sender_user_id: senders[0].id,
        enabled: false,
      },
    });
    expect(create.status()).toBe(200);
    const report = await create.json();

    try {
      const preview = await (await request.get(
        `${API_BASE}/api/admin/analytics/reports/${report.id}/preview`,
        { headers: { Authorization: `Bearer ${JWT_TOKEN}` } },
      )).json();

      for (const column of ['Calls Made', 'Meetings', 'Qualified', 'Disqualified']) {
        expect(preview.html).toContain(column);
      }
    } finally {
      await request.delete(`${API_BASE}/api/admin/analytics/reports/${report.id}`, {
        headers: { Authorization: `Bearer ${JWT_TOKEN}` },
      });
    }
  });
});
