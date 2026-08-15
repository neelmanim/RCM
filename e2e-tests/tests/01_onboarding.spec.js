import { test, expect } from '@playwright/test';

test.describe('Commercial PLG Onboarding Funnel', () => {
  test('User enters sandbox, receives demo auth token, and loads CRM dashboard', async ({ page }) => {
    // 1. Visit Sandbox entry point
    await page.goto('/sandbox.html');

    // 2. Verify sandbox loading screen
    await expect(page.locator('h1')).toContainText('Preparing your sandbox');

    // 3. Verify auto-redirect to dashboard with authentication
    await page.waitForURL(/.*index\.html|.*\/$/, { timeout: 20000 });

    // 4. Verify authenticated token is set in local storage
    const token = await page.evaluate(() => localStorage.getItem('crm_token'));
    expect(token).toBeTruthy();

    // 5. Verify the dashboard app shell rendered
    const navBar = page.locator('.sidebar, nav, header, #nav-hub, .top-nav');
    await expect(navBar.first()).toBeVisible({ timeout: 15000 });
  });
});
