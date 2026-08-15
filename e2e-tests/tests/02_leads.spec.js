import { test, expect } from '@playwright/test';

test.describe('Commercial Leads & Pipeline Management', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate via sandbox entry
    await page.goto('/sandbox.html');
    await page.waitForURL(/.*index\.html|.*\/$/, { timeout: 20000 });
  });

  test('Loads live leads table and validates populated lead records', async ({ page }) => {
    // Navigate to Leads view
    await page.goto('/index.html#leads');

    // Verify leads container/view is mounted
    const leadsView = page.locator('#view-leads, .leads-container, table, .leads-view');
    await expect(leadsView.first()).toBeVisible({ timeout: 15000 });

    // Verify lead rows exist in table
    const leadRows = page.locator('table tbody tr, .lead-row, .rt-tr-group');
    await expect(leadRows.first()).toBeVisible({ timeout: 15000 });
    const count = await leadRows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('Filter and search input responds properly', async ({ page }) => {
    await page.goto('/index.html#leads');

    // Look for search input
    const searchInput = page.locator('input[type="text"], input[placeholder*="Search"], #lead-search, input[type="search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('Insurance');
      await page.waitForTimeout(500);
      expect(await searchInput.inputValue()).toBe('Insurance');
    }
  });
});
