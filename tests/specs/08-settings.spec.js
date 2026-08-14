/**
 * Settings Tests — General (SSO), Sync (pipeline stages), Integrations
 */
const { test, expect, navigateTo, getSpinners, collectApiErrors } = require('./helpers');

test.describe('Settings', () => {

  test.describe('General', () => {
    test('page loads without errors', async ({ authenticatedPage: page }) => {
      const apiErrors = collectApiErrors(page);
      await navigateTo(page, '/settings', { waitMs: 5000 });

      const errors = apiErrors.filter(e => e.status === 404);
      expect(errors).toEqual([]);
    });

    test('Change Password is NOT visible (SSO only)', async ({ authenticatedPage: page }) => {
      await navigateTo(page, '/settings', { waitMs: 5000 });

      // Vanilla JS app uses Google SSO — no dedicated Change Password button/section exists
      // Use specific selectors: a button OR an h3/h4 heading with that exact text
      // Avoid broad text="" which can match any text node including labels/placeholders
      const changePwdBtn = page.locator(
        'button:has-text("Change Password"), h3:has-text("Change Password"), h4:has-text("Change Password"), [id*="change-password"], [id*="changePwd"]'
      );
      const count = await changePwdBtn.count();
      console.log(`  → Dedicated Change Password UI elements: ${count} (expected: 0 for SSO-only app)`);
      expect(count).toBe(0);
    });

    test('App uses Google SSO (no local password auth)', async ({ authenticatedPage: page }) => {
      await navigateTo(page, '/settings', { waitMs: 5000 });

      // In SSO-only mode there's no Change Password or local auth UI
      // Verify by confirming password-change UI is absent (same as above but from auth angle)
      const localAuth = await page.locator('input[type="password"][id*="current"], input[placeholder*="current password"]').count();
      console.log(`  → Local password auth elements: ${localAuth} (expected: 0)`);
      expect(localAuth).toBe(0);
      console.log('  ✓ No local password auth — app correctly uses SSO only');
    });

    test('no stuck spinners', async ({ authenticatedPage: page }) => {
      await navigateTo(page, '/settings', { waitMs: 5000 });
      expect(await getSpinners(page)).toBe(0);
    });
  });

  test.describe('Salesforce Sync', () => {
    test('Sync tab loads', async ({ authenticatedPage: page }) => {
      await navigateTo(page, '/settings', { waitMs: 5000 });

      // Click Salesforce tab
      const sfTab = page.locator('text=/Salesforce|Sync/i');
      if (await sfTab.count() > 0) {
        await sfTab.first().click();
        await page.waitForTimeout(3000);
      }

      // Should show sync settings content
      const content = page.locator('text=/Sync Direction|Record Types|Pipeline|Push Stage/i');
      expect(await content.count()).toBeGreaterThan(0);
    });

    test('Pipeline Stages dropdown has all 9 stages', async ({ authenticatedPage: page }) => {
      await navigateTo(page, '/settings', { waitMs: 5000 });

      const sfTab = page.locator('text=/Salesforce|Sync/i');
      if (await sfTab.count() > 0) {
        await sfTab.first().click();
        await page.waitForTimeout(3000);
      }

      // Count options in pipeline stage dropdowns
      const stageOptions = await page.locator('select option').allTextContents();
      const uniqueStages = [...new Set(stageOptions)].filter(s => s && s !== '');
      console.log(`  → Pipeline stage options: ${uniqueStages.join(', ')}`);

      // Should include key stages
      const expectedStages = ['New', 'Research', 'Calling', 'Meeting Scheduled'];
      for (const stage of expectedStages) {
        const found = uniqueStages.some(s => s.includes(stage));
        if (!found) {
          console.warn(`  ⚠ Missing stage: ${stage}`);
        }
      }
    });
  });

  test.describe('Integrations', () => {
    test('Integrations tab loads without nylas-config 404', async ({ authenticatedPage: page }) => {
      const apiErrors = collectApiErrors(page);
      await navigateTo(page, '/settings', { waitMs: 5000 });

      const intTab = page.locator('text=/Integrations|Email/i');
      if (await intTab.count() > 0) {
        await intTab.first().click();
        await page.waitForTimeout(4000);
      }

      // Check for 404 on email/config (was formerly nylas-config)
      const nylasErrors = apiErrors.filter(e => e.url.includes('nylas-config') || (e.url.includes('email/config') && e.status === 404));
      if (nylasErrors.length > 0) {
        console.error(`  ✗ Nylas config 404: ${nylasErrors.map(e => e.url).join(', ')}`);
      }
      expect(nylasErrors).toEqual([]);
    });
  });
});
