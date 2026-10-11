/**
 * v12.7.6 verification — Public API usage stats on the Control Center card,
 * CSM filter visibility gate relaxed (Inbox/Portfolio), Activity Monitor's
 * rep dropdown now includes CSM/AE alongside SDR/Pod Admin/Admin.
 */
const { test, expect, navigateTo, collectApiErrors } = require('./helpers');

test.describe('v12.7.6 — Public API usage, CSM filter, Activity Monitor roles', () => {

  test('Public API card shows usage stats, not just Generate/Revoke', async ({ authenticatedPage: page }) => {
    const apiErrors = collectApiErrors(page);
    await navigateTo(page, '/control-center', { waitMs: 4000 });
    await expect(page.locator('text=Public API — CMT')).toBeVisible();
    // Either "No requests yet." (no key / unused) or "Used N times — last used ..."
    // — either string confirms the new usage block rendered, not the old
    // Generate/Revoke-only card.
    const usageLine = page.locator('text=/No requests yet\\.|Used \\d+ times? — last used/');
    await expect(usageLine).toBeVisible({ timeout: 10000 });
    expect(apiErrors.filter((e) => e.url.includes('/public-api-key/status'))).toHaveLength(0);
  });

  // Super Admin sees the merged 'pipeline-hub' route (AE Pipeline + CSM
  // Portal as two plain-button tabs in PipelineHub.jsx, default tab is
  // 'ae') — 'csm-portal' alone 404s for this role ("View not found"), see
  // frontend/js/app.js:1204 ("Super Admin oversight moved to the merged
  // 'pipeline-hub' route").
  async function gotoCsmPortalViaPipelineHub(page) {
    await navigateTo(page, '/pipeline-hub', { waitMs: 4000 });
    await page.getByRole('button', { name: 'CSM Portal' }).click();
    await expect(page.getByRole('heading', { name: 'CSM Portal' })).toBeVisible({ timeout: 10000 });
  }

  test('CSM Portal Inbox shows a CSM filter whenever at least one CSM exists', async ({ authenticatedPage: page }) => {
    await gotoCsmPortalViaPipelineHub(page);
    // Default inner tab is Inbox (CsmPortalHub.jsx's SECTION_TABS[0]).
    const csmFilter = page.getByLabel('Filter by CSM');
    // Super Admin token is admin-scoped, so isAdmin=true — the filter renders
    // as soon as csmOptions has 1+ entries (was previously gated on >1).
    await expect(csmFilter).toBeVisible({ timeout: 10000 }).catch(async () => {
      // If staging genuinely has 0 CSM users, the gate correctly hides it —
      // fail loudly with that context instead of a bare timeout.
      throw new Error('CSM filter not visible — staging may have 0 CSM-role users; check /api/admin/users');
    });
  });

  test('CSM Portal Portfolio also shows the CSM filter', async ({ authenticatedPage: page }) => {
    await gotoCsmPortalViaPipelineHub(page);
    await page.getByRole('button', { name: 'Portfolio' }).click();
    await page.waitForTimeout(1500);
    await expect(page.getByLabel('Filter by CSM')).toBeVisible({ timeout: 10000 });
  });

  test('Activity Monitor rep dropdown (_sdr_dropdown) includes CSM/AE users, not just SDR', async ({ request }) => {
    const { apiGet } = require('./helpers');
    const [usersRes, emailLogsRes] = await Promise.all([
      apiGet(request, '/admin/users'),
      apiGet(request, '/admin/email-logs'),
    ]);
    expect(usersRes.status).toBe(200);
    expect(emailLogsRes.status).toBe(200);

    const csmOrAeEmails = new Set(
      (usersRes.body || [])
        .filter((u) => u.role === 'CSM' || u.role === 'AE')
        .map((u) => u.email)
    );
    if (csmOrAeEmails.size === 0) {
      test.skip(true, 'No CSM/AE users on staging to verify against — nothing to assert.');
    }
    const dropdownEmails = new Set((emailLogsRes.body.sdrs || []).map((s) => s.email));
    const found = [...csmOrAeEmails].filter((e) => dropdownEmails.has(e));
    expect(found.length, '_sdr_dropdown should now include CSM/AE reps').toBeGreaterThan(0);
  });
});
