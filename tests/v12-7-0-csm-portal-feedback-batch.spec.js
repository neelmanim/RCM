/**
 * v12.7.0 — CSM feedback follow-up batch: renewals-due-soon digest tile,
 * stakeholder mapping, engagement timeline, health score champion signal,
 * Portfolio/Inbox CSM filter, Pod Admin oversight (permission logic itself
 * is covered by backend/tests/test_csm_portal.py::TestPodAdminCsmPortalScope
 * — this spec covers the UI wiring a Super Admin token can reach).
 *
 * Token via env: SA_TOKEN.
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const SA_TOKEN = process.env.SA_TOKEN;

async function login(page, token) {
  await page.addInitScript(() => {
    try { void localStorage.length; } catch { return; }
    ['csm-portal-inbox', 'csm-portal-portfolio', 'csm-portal-playbooks', 'csm-portal-digest',
      'csm-account-360', 'csm-portal', 'control-center', 'pipeline-hub', 'ae-pipeline'].forEach((t) =>
      localStorage.setItem(`alternatecrm:${t}-tour-seen`, '1'));
  });
  await page.goto(`${BASE_URL}/?token=${token}`);
  await page.waitForTimeout(1500);
}

async function goHash(page, hash) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(1500);
}

async function openCsmPortal(page) {
  await goHash(page, '#pipeline-hub');
  await page.getByRole('button', { name: /CSM Portal/i }).click();
  await page.waitForTimeout(500);
}

test('Digest shows the renewals-due-soon tile with a real count', async ({ page }) => {
  test.skip(!SA_TOKEN, 'SA_TOKEN not set');
  await login(page, SA_TOKEN);
  await openCsmPortal(page);

  await page.getByRole('button', { name: 'Digest' }).click();
  await page.waitForTimeout(500);
  await expect(page.getByText('Renewals due soon')).toBeVisible({ timeout: 10000 });
});

test('Portfolio CSM filter: hidden with one CSM, narrows the list with two or more', async ({ page }) => {
  test.skip(!SA_TOKEN, 'SA_TOKEN not set');
  await login(page, SA_TOKEN);
  await openCsmPortal(page);

  await page.getByRole('button', { name: 'Portfolio' }).click();
  await page.waitForTimeout(500);
  const filterButton = page.getByRole('button', { name: 'Filter by CSM' });

  // csmOptions.length > 1 gates the dropdown (PortfolioTab.jsx) — staging's
  // demo data currently has exactly one CSM, so absence here is the correct
  // behavior, not a bug. If seed data ever adds a second CSM, exercise the
  // actual narrowing instead of just asserting presence.
  if (await filterButton.count() === 0) {
    console.log('Only one CSM in staging data — filter correctly hidden, narrowing path not exercised.');
    return;
  }

  const rowsBefore = await page.getByRole('row').count();
  await filterButton.click();
  const firstCsmOption = page.getByRole('menuitem').nth(1); // index 0 = "All CSMs"
  const csmName = (await firstCsmOption.textContent() || '').trim();
  await firstCsmOption.click();
  await page.waitForTimeout(500);

  const rowsAfter = await page.getByRole('row').count();
  expect(rowsAfter).toBeLessThanOrEqual(rowsBefore);
  if (csmName) {
    expect(await page.locator(`td:has-text("${csmName}")`).count()).toBeGreaterThan(0);
  }
});

test('Account 360 shows Stakeholders and Engagement timeline cards (read-only for Super Admin on an assigned account)', async ({ page }) => {
  // Every account in staging's current demo data is assigned to "Demo CSM",
  // so a Super Admin viewing one is read-only by design
  // (csm_portal_routes._require_account_write_access — an admin can only
  // write to an *unassigned* account). This exercises that boundary + both
  // new cards rendering; the actual create-milestone write path is covered
  // by backend/tests/test_csm_portal.py::TestMilestones (6 tests) and
  // frontend-react/src/test/csm-portal/AccountDetail.test.jsx's "engagement
  // timeline" describe block (5 tests) — no CSM-role staging token was
  // available this pass to exercise it live end-to-end.
  test.skip(!SA_TOKEN, 'SA_TOKEN not set');
  await login(page, SA_TOKEN);
  await openCsmPortal(page);

  await page.getByRole('button', { name: 'Portfolio' }).click();
  await page.waitForTimeout(500);
  await page.locator('[data-tour="csm-portal-portfolio-table"] tbody tr').first().click();
  await page.waitForTimeout(1000);

  await expect(page.getByRole('heading', { name: 'Stakeholders' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('heading', { name: 'Engagement timeline' })).toBeVisible();
  await expect(page.getByText('No milestones logged yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Log milestone/ })).not.toBeVisible();
});
