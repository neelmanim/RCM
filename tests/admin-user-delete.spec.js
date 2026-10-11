// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo, ADMIN_TOKEN, API_BASE_URL } = require('./helpers/auth');

const SUPER_ADMIN_EMAIL = 'neelmani.mishra@screen-magic.com';

async function apiCreateUser(request, overrides = {}) {
  const email = `pw-delete-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@t.invalid`;
  const res = await request.post(`${API_BASE_URL}/api/admin/users`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    // Named to sort first (admin.js's SDRs tab paginates at 10/page, sorted
    // by name ascending) — otherwise this landed on a later page the test
    // never navigates to and the row was never in the DOM at all.
    data: { email, name: '000 Playwright Delete Test', role: 'SDR', ...overrides },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  // POST /api/admin/users responds {message, user_id} — not {id} like the
  // list endpoint's user objects. Normalize so callers can just use .id.
  return { id: body.user_id, email };
}

// Bug E (2026-08-24): deleting a Pod Admin 500'd on production (a missing
// PodAdmin row cleanup) — fixed server-side, plus a richer confirm() dialog
// warning the admin which pods lose coverage. This spec verifies the
// *general* delete-user flow end-to-end (any admin could hit a 500 on any
// user, not just Pod Admins — see the DialerQueueStatus fix alongside this),
// and separately verifies the Pod Admin warning dialog's content without
// mutating a real staging Pod Admin.
test.describe('Admin — delete user', () => {
  test('Deleting a regular user succeeds end-to-end and removes them from the list', async ({ page, request }) => {
    const user = await apiCreateUser(request);

    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'admin');
    // Admin Panel is tabbed by role (Super Admins / Pod Admins / SDRs),
    // defaulting to Super Admins — the test user (role: SDR) is invisible
    // there until switching tabs.
    await page.getByRole('button', { name: /SDRs/ }).click();

    const row = page.locator(`tr[data-user-id="${user.id}"]`);
    await expect(row).toBeVisible({ timeout: 15000 });

    // RCA 2026-08-25: delete's confirmation moved from a native confirm()
    // to the app's own DOM modal (confirm_modal.js) — no browser 'dialog'
    // event fires anymore, so interact with the modal directly.
    await row.locator('.delete-user').click();
    const modal = page.locator('.modal.active');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await modal.locator('[data-action="confirm"]').click();

    await expect(row).not.toBeVisible({ timeout: 10000 });

    // /token does an explicit user lookup and 404s if missing (unlike
    // /pod-admin-of, which returns [] either way) — a real existence check.
    const check = await request.get(`${API_BASE_URL}/api/admin/users/${user.id}/token`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    expect(check.status()).toBe(404);
  });

  test('Deleting a Pod Admin with pods shows a warning naming the pods, then cancels', async ({ page, request }) => {
    // Find a real staging Pod Admin who actually has pod(s), without
    // creating/mutating one — this check is read-only, cancel-only.
    const usersRes = await request.get(`${API_BASE_URL}/api/admin/users`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    });
    const users = await usersRes.json();
    const podAdmins = users.filter((u) => u.role === 'Pod Admin');

    let target = null;
    let pods = [];
    for (const candidate of podAdmins) {
      const podsRes = await request.get(`${API_BASE_URL}/api/admin/users/${candidate.id}/pod-admin-of`, {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      const candidatePods = await podsRes.json();
      if (candidatePods.length) { target = candidate; pods = candidatePods; break; }
    }
    test.skip(!target, 'No staging Pod Admin currently has pods assigned');

    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'admin');
    await page.getByRole('button', { name: /Pod Admins/ }).click();

    const row = page.locator(`tr[data-user-id="${target.id}"]`);
    await expect(row).toBeVisible({ timeout: 15000 });

    // The modal opens after an async pod-admin-of fetch inside the click
    // handler, so wait on the modal itself rather than a fixed sleep.
    await row.locator('.delete-user').click();
    const modal = page.locator('.modal.active');
    await expect(modal).toBeVisible({ timeout: 10000 });
    const modalMessage = await modal.locator('.modal-body').innerText();
    await modal.locator('[data-action="cancel"]').click();

    for (const pod of pods) expect(modalMessage).toContain(pod.name);
    expect(modalMessage).toContain('Permanently delete this user?');

    // Cancelled — confirm the user is still there.
    await expect(row).toBeVisible();
  });
});
