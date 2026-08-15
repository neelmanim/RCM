import { test, expect } from '@playwright/test';

test.describe('PLG Onboarding Funnel', () => {
  test('User can enter the live sandbox and see data', async ({ page }) => {
    // 1. Visit the Sandbox URL directly (simulating a click from the marketing site)
    await page.goto('https://frontend-beta-two-85.vercel.app/sandbox.html');

    // 2. The sandbox page automatically logs us in and redirects to the dashboard
    // Wait for the URL to change to the dashboard (/index.html or /)
    await page.waitForURL(/.*index\.html|.*\/$/);
    
    // 4. Verify we are authenticated by checking for the dashboard UI elements
    const dashboardHeader = page.locator('h1:has-text("Dashboard")');
    await expect(dashboardHeader).toBeVisible({ timeout: 15000 });

    // 5. Navigate to the Leads view to verify data loaded
    await page.goto('https://frontend-beta-two-85.vercel.app/index.html#leads');
    
    // 6. Verify that data (Leads) has actually loaded from the DB
    const firstRow = page.locator('.lead-row, table tbody tr, .rt-tr-group').first();
    // Ensure there's at least one lead visible
    await expect(firstRow).toBeVisible({ timeout: 15000 });
  });
});
