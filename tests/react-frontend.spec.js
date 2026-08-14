// @ts-check
import { test, expect } from '@playwright/test';

test.describe('React Frontend Migration E2E', () => {
  // Skip: React frontend is not deployed to staging yet (returns 404)
  test.skip('Authentication flow and navigation to Dashboard and Leads', async ({ page }) => {
    // 1. Visit the local React app (we'll pass STAGING_URL in the command line)
    await page.goto('/login');
    
    // The page should have a Login header
    await expect(page.locator('h3')).toContainText('Welcome Back');
    
    // 2. Bypass backend authentication by manually injecting a CRM Token mimicking Auth Module
    await page.evaluate(() => {
      // Generate a faux JWT token that expires far in the future
      const payload = {
        sub: 'e2e-test-user',
        role: 'Admin',
        exp: Math.floor(Date.now() / 1000) + 3600
      };
      const token = `header.${btoa(JSON.stringify(payload))}.signature`;
      localStorage.setItem('crm_token', token);
    });
    
    // 3. Navigate into the application layout
    await page.goto('/dashboard');
    
    // Ensure the top layout shell wraps successfully
    await expect(page.locator('.sidebar-brand')).toContainText('RCM');
    await expect(page.locator('text=Dashboard Overview')).toBeVisible();
    
    // 4. Test Routing: Moving from Dashboard to Leads List
    await page.click('.sidebar-nav a:has-text("Leads")');
    
    // Confirm route change over to Leads Management
    await expect(page).toHaveURL(/.*\/leads/);
    await expect(page.locator('h1')).toContainText('Leads Management');
    
    // Wait for the mock 600ms latency to resolve on Leads List loading
    await page.waitForTimeout(800);
    
    // Confirm rows are populated
    const viewButtons = page.locator('button:has-text("View")');
    await expect(viewButtons.first()).toBeVisible();
    
    // 5. Test Routing: Moving from Leads List to active single Lead View
    await viewButtons.first().click();
    
    // Confirm route change parameters
    await expect(page).toHaveURL(/.*\/leads\/\d+/);
    
    // Wait for internal Lead Detail mocked load (500ms)
    await page.waitForTimeout(600);
    
    // Read sub-components to ensure layout breakdown rendered correctly
    await expect(page.locator('text=Contact Information')).toBeVisible();
    await expect(page.locator('text=Activity History')).toBeVisible();
    
    // Ensure badges load properly
    await expect(page.locator('.badge')).toBeVisible();
  });
});
