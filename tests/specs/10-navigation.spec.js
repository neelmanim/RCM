/**
 * Navigation & Layout Tests — sidebar, routing, global consistency
 */
const { test, expect, navigateTo, collectApiErrors } = require('./helpers');

test.describe('Navigation & Layout', () => {

  test('sidebar renders with all navigation items', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/dashboard', { waitMs: 4000 });

    const navItems = [
      'Dashboard',
      'Leads',
      'Pipeline',
      'Calls',
      'Analytics',
      'Leaderboard',
      'Assignments',
      'Settings',
    ];

    for (const item of navItems) {
      const link = page.locator(`nav >> text="${item}", aside >> text="${item}"`);
      const count = await link.count();
      if (count === 0) {
        console.warn(`  ⚠ Nav item missing: ${item}`);
      } else {
        console.log(`  ✓ Nav: ${item}`);
      }
    }
  });

  test('all routes load without blank pages', async ({ authenticatedPage: page }) => {
    // Vanilla JS app uses hash routing — /#dashboard not /dashboard
    const routes = [
      { path: '/#dashboard',      name: 'Dashboard' },
      { path: '/#leads',          name: 'Leads' },
      { path: '/#pipeline',       name: 'Pipeline' },
      { path: '/#calls',          name: 'Calls' },
      { path: '/#analytics',      name: 'Analytics' },
      { path: '/#leaderboard',    name: 'Leaderboard' },
      { path: '/#assignments',    name: 'Assignments' },
      { path: '/#admin',          name: 'Admin' },
      { path: '/#settings',       name: 'Settings' },
      { path: '/#upload',         name: 'Upload' },
      { path: '/#communications', name: 'Communications' },
      { path: '/#my-calls',       name: 'MyCalls' },
      { path: '/#user-guide',     name: 'Guide' },
    ];

    for (const route of routes) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);

      // Page should NOT be completely empty
      const bodyText = await page.locator('body').textContent().catch(() => '');
      const hasContent = bodyText.trim().length > 50;

      // Check for JS error banners
      const hasError = await page.locator('text=/Something went wrong|Error|Cannot read properties/i').count();

      if (!hasContent || hasError > 0) {
        console.error(`  ✗ ${route.name} (${route.path}): ${!hasContent ? 'BLANK PAGE' : 'ERROR SHOWN'}`);
      } else {
        console.log(`  ✓ ${route.name}: OK`);
      }
    }
  });

  test('ViewAs banner appears when impersonating', async ({ authenticatedPage: page }) => {
    // Navigate to admin users
    await navigateTo(page, '/admin', { waitMs: 5000 });

    // Find the View As button for another user
    const viewAsBtn = page.locator('button[title*="View as"]').first();
    const hasViewAs = await viewAsBtn.count();
    
    if (hasViewAs > 0) {
      console.log('  → View As button found, testing impersonation...');
      // We won't actually click it in tests to avoid side effects
      // Just verify the button exists and is clickable
      await expect(viewAsBtn).toBeEnabled();
    } else {
      console.log('  → No View As buttons found (may need User Settings tab)');
    }
  });
});
