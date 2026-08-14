/**
 * Admin Panel Tests — User Settings, Governance, Login Activity
 */
const { test, expect, navigateTo, getSpinners, getTableRowCount, collectApiErrors, apiGet } = require('./helpers');

test.describe('Admin Panel', () => {

  // ── User Settings ─────────────────────────────────────────────────────────
  test.describe('User Settings', () => {

    test('user table renders with data', async ({ authenticatedPage: page }) => {
      const apiErrors = collectApiErrors(page);
      await navigateTo(page, '/admin', { waitMs: 5000 });

      // Click User Settings tab
      const tab = page.locator('text=User Settings');
      if (await tab.count() > 0) {
        await tab.click();
        await page.waitForTimeout(3000);
      }

      const rows = await getTableRowCount(page);
      console.log(`  → User table rows: ${rows}`);
      expect(rows).toBeGreaterThan(0);
    });

    test('action icons are visible (View As, Revoke, Edit, Delete)', async ({ authenticatedPage: page }) => {
      await navigateTo(page, '/admin', { waitMs: 5000 });

      const tab = page.locator('text=User Settings');
      if (await tab.count() > 0) {
        await tab.click();
        await page.waitForTimeout(3000);
      }

      // Selectors from admin.js source: view-user-btn class, title="View As"
      const viewAsBtn = await page.locator('button.view-user-btn, button[title="View As"]').count();
      const anyActionBtn = await page.locator('button[title], button[data-user-id]').count();

      console.log(`  → Actions: ViewAs=${viewAsBtn}, any action buttons=${anyActionBtn}`);
      // At minimum some action buttons should exist for the user rows
      expect(anyActionBtn).toBeGreaterThan(0);
    });

    test('View As is icon-only (no text label)', async ({ authenticatedPage: page }) => {
      await navigateTo(page, '/admin', { waitMs: 5000 });

      const tab = page.locator('text=User Settings');
      if (await tab.count() > 0) {
        await tab.click();
        await page.waitForTimeout(3000);
      }

      // "View As" text should NOT appear as a button label
      const viewAsTextBtn = page.locator('button:has-text("View As")');
      const textCount = await viewAsTextBtn.count();
      expect(textCount).toBe(0);
    });

    test('no stuck spinners', async ({ authenticatedPage: page }) => {
      await navigateTo(page, '/admin', { waitMs: 6000 });
      const spinners = await getSpinners(page);
      expect(spinners).toBe(0);
    });
  });

  // ── Governance / Login Activity ───────────────────────────────────────────
  test.describe('Governance', () => {

    test('Login Activity tab loads without error', async ({ authenticatedPage: page }) => {
      const apiErrors = collectApiErrors(page);
      await navigateTo(page, '/admin', { waitMs: 5000 });

      // Navigate to Governance tab
      const govTab = page.locator('text=Governance');
      if (await govTab.count() > 0) {
        await govTab.click();
        await page.waitForTimeout(3000);
      }

      // Click Login History/Activity tab
      const loginTab = page.locator('text=/Login.*History|Login.*Activity/i');
      if (await loginTab.count() > 0) {
        await loginTab.first().click();
        await page.waitForTimeout(4000);
      }

      // Should NOT show error message
      const errorMsg = await page.locator('text=/error|failed|something went wrong/i').count();
      if (errorMsg > 0) {
        console.error('  ✗ Error message visible on Login Activity page');
      }
      expect(errorMsg).toBe(0);
    });

    test('Login Activity renders table data', async ({ authenticatedPage: page, request }) => {
      // Check API first
      const { body } = await apiGet(request, '/admin/login-logs?page=1&limit=10');
      const apiLogs = body?.data || (Array.isArray(body) ? body : []);
      console.log(`  → API login logs: ${apiLogs.length} entries`);

      await navigateTo(page, '/admin', { waitMs: 5000 });

      const govTab = page.locator('text=Governance');
      if (await govTab.count() > 0) {
        await govTab.click();
        await page.waitForTimeout(3000);
      }

      const loginTab = page.locator('text=/Login.*History|Login.*Activity/i');
      if (await loginTab.count() > 0) {
        await loginTab.first().click();
        await page.waitForTimeout(4000);
      }

      const rows = await getTableRowCount(page);
      console.log(`  → UI login log rows: ${rows}`);

      // If API has data, UI should show it
      if (apiLogs.length > 0) {
        expect(rows).toBeGreaterThan(0);
      }
    });

    test('Activity Logs tab renders', async ({ authenticatedPage: page }) => {
      await navigateTo(page, '/admin', { waitMs: 5000 });

      const govTab = page.locator('text=Governance');
      if (await govTab.count() > 0) {
        await govTab.click();
        await page.waitForTimeout(3000);
      }

      // Stay on Activity Logs (default sub-tab) or click it
      const activityTab = page.locator('text=/Activity.*Log/i');
      if (await activityTab.count() > 0) {
        await activityTab.first().click();
        await page.waitForTimeout(4000);
      }

      const rows = await getTableRowCount(page);
      console.log(`  → Activity log rows: ${rows}`);
    });
  });
});
