/**
 * v12.6.8 hotfix audit — Super Admin's CSM Portal (reached via the merged
 * "AE Pipeline / CSM Portal" pipeline-hub route, NOT csm-portal-hub) must
 * show the Owner column and Inbox pagination, same as the CSM-only route
 * already verified in v12.6.5's audit.
 *
 * Token via env: SA_TOKEN.
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const SA_TOKEN = process.env.SA_TOKEN;

async function login(page, token) {
  await page.addInitScript(() => {
    try { void localStorage.length; } catch { return; }
    ['csm-portal-inbox', 'csm-portal-portfolio', 'csm-portal-playbooks', 'csm-portal-digest',
      'csm-account-360', 'csm-portal', 'control-center', 'pipeline-hub', 'ae-pipeline'].forEach((t) =>
      localStorage.setItem(`alternatecrm:${t}-tour-seen`, '1'));
  });
  await page.goto(`${BASE_URL}/?token=${token}`);
  await page.waitForTimeout(1500);
}

async function goHash(page, hash) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(1500);
}

test('Super Admin pipeline-hub CSM Portal Inbox shows Owner column and pagination', async ({ page }) => {
  test.skip(!SA_TOKEN, 'SA_TOKEN not set');
  await login(page, SA_TOKEN);
  await goHash(page, '#pipeline-hub');

  await page.getByRole('button', { name: /CSM Portal/i }).click();
  await page.waitForTimeout(500);
  // Inbox is the default sub-tab
  await expect(page.getByRole('columnheader', { name: 'Owner' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(/^Showing \d/)).toBeVisible();
});
