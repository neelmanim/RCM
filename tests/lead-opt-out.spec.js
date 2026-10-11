// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAs, ADMIN_TOKEN, API_BASE_URL } = require('./helpers/auth');

const SUPER_ADMIN_EMAIL = 'neelmani.mishra@screen-magic.com';
const LEAD_ID = process.env.LEAD_DEMO_ID || '';

// Bug F (2026-08-24): a lead had no way to be marked "do not contact" — the
// only opt-out marker in the system, flagged CRITICAL by a super-admin
// standup report. lead_detail.js gained a "Mark Opted Out" button + badge.
test.describe('Lead detail — opt-out toggle', () => {
  test.skip(!LEAD_ID, 'LEAD_DEMO_ID not set in .env.test');

  test.afterEach(async ({ request }) => {
    // Restore state so this test doesn't leave the shared demo lead opted
    // out for other specs (sdr-lead-page-p2.spec.js also loads this lead).
    await request.patch(`${API_BASE_URL}/api/leads/${LEAD_ID}`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      data: { do_not_contact: false },
    }).catch(() => {});
  });

  test('Marking a lead opted out shows the badge and persists', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await page.evaluate((id) => { window.location.hash = `#lead-detail/${id}`; }, LEAD_ID);
    await page.waitForSelector('#opt-out-btn, .badge', { timeout: 30000 });

    const optOutBtn = page.locator('#opt-out-btn');
    await expect(optOutBtn).toBeVisible({ timeout: 10000 });

    page.once('dialog', (d) => d.accept());
    await optOutBtn.click();

    await expect(page.getByText('🚫 Opted Out')).toBeVisible({ timeout: 10000 });
    await expect(optOutBtn).not.toBeVisible();

    // Reload to confirm the marker actually persisted server-side, not just
    // an optimistic UI update. The hash is already `#lead-detail/{id}` from
    // above and survives the reload, so the router picks it up on init.
    await page.reload();
    await expect(page.getByText('🚫 Opted Out')).toBeVisible({ timeout: 15000 });
  });
});
