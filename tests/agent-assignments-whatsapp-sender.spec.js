// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo, ADMIN_TOKEN, API_BASE_URL } = require('./helpers/auth');

const SUPER_ADMIN_EMAIL = 'neelmani.mishra@screen-magic.com';

// The Settings page's tab-content bindings (bindConnectionTab, bindSyncTab,
// ...) run as a sequential chain of real network round trips before the
// static "＋ Assign Alternate Messenger Agent" button's own click listener attaches —
// on this staging environment that chain can take several seconds, well past
// when the button is visually present and clickable. A single click issued
// before the listener exists is simply lost (not queued), so retry the click
// itself rather than waiting once and hoping.
async function clickWithRetry(locator, checkLocator, { attempts = 12, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await locator.click();
    if (await checkLocator.isVisible().catch(() => false)) return;
    await locator.page().waitForTimeout(delayMs);
  }
  throw new Error(`clickWithRetry: ${checkLocator} never became visible after ${attempts} attempts`);
}

// RCA 2026-08-25: WhatsApp used one org-wide sender for every SDR, unlike
// calling (which already assigns each SDR their own Alternate Messenger sub-agent via
// this exact panel). This spec covers the new per-SDR WhatsApp Sender field
// added alongside Alternate Messenger User ID / Caller Number / Alternate Messenger Email.
//
// Scoped to the field's presence and wiring only, not a full add-agent
// round-trip: the "Alternate Messenger User ID" field is live-validated against the
// real Alternate Messenger API on save (staging has real credentials configured), so
// a fabricated agent ID would be rejected — and reusing a real staff
// member's already-registered agent ID to make the round trip succeed would
// mean mutating live production-adjacent config from an automated test. The
// field-level save/validate logic itself is covered by backend pytest
// (test_admin_routes.py::TestUserSettings) against the unvalidated test DB.
test.describe('Settings — Agent Assignments (WhatsApp sender field)', () => {
  test('the WhatsApp Sender field is present in both the add and edit forms', async ({ page, request }) => {
    const email = `pw-wa-field-${Date.now()}@t.invalid`;
    const createRes = await request.post(`${API_BASE_URL}/api/admin/users`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      data: { email, name: '000 Playwright WA Field Test', role: 'SDR' },
    });
    expect(createRes.ok()).toBeTruthy();
    const { user_id: userId } = await createRes.json();

    try {
      await loginAs(page, request, SUPER_ADMIN_EMAIL);
      await navigateTo(page, 'settings');
      await page.locator('.settings-tab[data-tab="channels"]').click();

      // Add form
      await clickWithRetry(page.locator('#conv-assign-agent-btn'), page.locator('#conv-add-whatsapp-sender'));
      await expect(page.locator('#conv-add-whatsapp-sender')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('label:has-text("WhatsApp Sender")')).toBeVisible();
      await page.locator('#conv-add-cancel-btn').click();

      // Edit form — on a real, already-configured staging agent, read-only:
      // open and immediately cancel, never save.
      const configuredRow = page.locator('.user-access-row').first();
      await expect(configuredRow).toBeVisible({ timeout: 10000 });
      await configuredRow.locator('.conv-menu-btn').click();
      await configuredRow.locator('.conv-edit-btn').click();
      const editRow = page.locator('.conv-edit-row');
      await expect(editRow.locator('.edit-whatsapp-sender')).toBeVisible({ timeout: 5000 });
      await editRow.locator('.edit-cancel-btn').click();
      await expect(editRow).not.toBeVisible();
    } finally {
      await request.delete(`${API_BASE_URL}/api/admin/users/${userId}`, {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
    }
  });
});
