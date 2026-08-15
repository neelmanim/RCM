import { test, expect } from '@playwright/test';

test.describe('Commercial Analytics & Calendar Hub', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sandbox.html');
    await page.waitForURL(/.*index\.html|.*\/$/, { timeout: 20000 });
  });

  test('Navigates to Analytics Hub and verifies mounting', async ({ page }) => {
    await page.goto('/index.html#analytics');
    const analyticsContainer = page.locator('#analytics-react-root, #view-container, body');
    await expect(analyticsContainer.first()).toBeVisible({ timeout: 15000 });
  });

  test('Navigates to Calendar Hub and verifies grid/schedule container', async ({ page }) => {
    await page.goto('/index.html#calendar');
    const calendarContainer = page.locator('#calendar-react-root, #view-container, body');
    await expect(calendarContainer.first()).toBeVisible({ timeout: 15000 });
  });
});
