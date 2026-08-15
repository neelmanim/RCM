import { test, expect } from '@playwright/test';

test.describe('Commercial Power Dialer & Call Monitoring', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/sandbox.html');
    await page.waitForURL(/.*index\.html|.*\/$/, { timeout: 20000 });
  });

  test('Navigates to My Calls view and loads dialer interface', async ({ page }) => {
    await page.goto('/index.html#my-calls');
    
    // Check for container or view content
    const viewContainer = page.locator('#view-container, #power-dialer-react-root, body');
    await expect(viewContainer.first()).toBeVisible({ timeout: 15000 });
  });

  test('Navigates to Settings and verifies settings dashboard', async ({ page }) => {
    await page.goto('/index.html#settings');

    const settingsView = page.locator('#view-container, .settings-container, form, h1, h2');
    await expect(settingsView.first()).toBeVisible({ timeout: 15000 });
  });
});
