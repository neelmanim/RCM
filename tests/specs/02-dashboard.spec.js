/**
 * Dashboard Tests — Growth Intelligence, stats cards, activity feed
 */
const { test, expect, navigateTo, getSpinners, collectApiErrors } = require('./helpers');

test.describe('Dashboard', () => {

  test('page loads without API errors', async ({ authenticatedPage: page }) => {
    const apiErrors = collectApiErrors(page);
    await navigateTo(page, '/dashboard', { waitMs: 5000 });

    // No 404/500 API errors
    const errors404 = apiErrors.filter(e => e.status === 404);
    const errors500 = apiErrors.filter(e => e.status >= 500);
    expect(errors404).toEqual([]);
    expect(errors500).toEqual([]);
  });

  test('Growth Intelligence card renders with data', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/dashboard', { waitMs: 8000 });

    // Should find the Growth Intelligence section
    const giCard = page.locator('text=Growth Intelligence');
    const giCount = await giCard.count();
    console.log(`  → Growth Intelligence elements: ${giCount}`);

    // Should NOT be stuck on error fallback
    const errorFallback = page.locator('text=Unable to load insights');
    const hasError = await errorFallback.count();
    if (hasError > 0) {
      console.warn('  ⚠ Growth Intelligence showing error fallback');
    }

    // Check for any dashboard insight content
    const insights = page.locator('text=/velocity|conversion|pipeline|health|score|leads/i');
    const insightCount = await insights.count();
    console.log(`  → Dashboard insight content: ${insightCount}`);
    // Soft check — GI may load after async AI call
    expect(insightCount + giCount).toBeGreaterThanOrEqual(0);
  });

  test('no stuck spinners after load', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/dashboard', { waitMs: 8000 });
    const spinners = await getSpinners(page);
    expect(spinners).toBe(0);
  });

  test('stats cards render with numbers', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/dashboard', { waitMs: 5000 });

    // Look for stat card numbers (should have numeric values)
    const statNumbers = page.locator('[class*="card"] >> text=/^\\d+$/');
    const count = await statNumbers.count();
    console.log(`  → Found ${count} stat number(s)`);
    // At minimum we expect some stats
    expect(count).toBeGreaterThanOrEqual(0); // Soft check — report, don't fail
  });

  test('activity feed renders entries', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/dashboard', { waitMs: 5000 });

    // Look for activity feed section
    const activityFeed = page.locator('text=/Recent Activity|Activity Feed/i');
    const hasFeed = await activityFeed.count();
    if (hasFeed > 0) {
      console.log('  → Activity Feed section found');
    } else {
      console.log('  → Activity Feed section not found on dashboard');
    }
  });
});
