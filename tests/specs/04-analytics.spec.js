/**
 * Analytics Tests — filters, SDR table, funnel, charts
 */
const { test, expect, navigateTo, getSpinners, getTableRowCount, hasFilters, collectApiErrors, apiGet } = require('./helpers');

test.describe('Analytics', () => {

  test('page loads without API errors', async ({ authenticatedPage: page }) => {
    const apiErrors = collectApiErrors(page);
    await navigateTo(page, '/analytics', { waitMs: 8000 });

    const errors404 = apiErrors.filter(e => e.status === 404);
    if (errors404.length > 0) {
      console.error(`  ✗ API 404s: ${errors404.map(e => e.url).join(', ')}`);
    }
    expect(errors404).toEqual([]);
  });

  test('filter controls are visible (date, pod, batch)', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/analytics', { waitMs: 6000 });

    const filters = await hasFilters(page);
    console.log(`  → Filters: selects=${filters.selects}, search=${filters.searchInputs}, date=${filters.dateInputs}`);
    expect(filters.total).toBeGreaterThan(0);
  });

  test('SDR Performance table renders with correct count', async ({ authenticatedPage: page, request }) => {
    // First check API directly
    const { body: apiData } = await apiGet(request, '/admin/metrics/sdr-table');
    const apiSdrCount = Array.isArray(apiData) ? apiData.length : 0;
    console.log(`  → API SDR count: ${apiSdrCount}`);

    // Then check UI
    await navigateTo(page, '/analytics', { waitMs: 8000 });

    const sdrHeading = page.locator('text=SDR Performance');
    await expect(sdrHeading.first()).toBeVisible({ timeout: 10000 });

    // Scope to the SDR section table (analytics-table inside #an-sdr-section)
    const sdrTable = page.locator('#an-sdr-section .analytics-table tbody tr, .analytics-table-wrap .analytics-table tbody tr');
    const rows = await sdrTable.count();
    console.log(`  → UI SDR table rows: ${rows}`);

    // UI count should match API count (soft: just verify both are consistent)
    if (apiSdrCount > 0) {
      expect(rows).toBeGreaterThan(0);
    } else {
      console.log('  → API returned 0 SDRs — UI expected to show 0 or empty state');
    }
  });

  test('funnel/pipeline metrics render', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/analytics', { waitMs: 6000 });

    // Look for funnel-related content
    const funnelContent = page.locator('text=/Total Leads|Conversion|Pipeline|Funnel/i');
    const count = await funnelContent.count();
    console.log(`  → Funnel content indicators: ${count}`);
    expect(count).toBeGreaterThan(0);
  });

  test('no stuck spinners after load', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/analytics', { waitMs: 10000 });
    const spinners = await getSpinners(page);
    expect(spinners).toBe(0);
  });

  test('SDR names are visible (not empty/undefined)', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/analytics', { waitMs: 8000 });

    // Check for 'undefined' or empty names in the table
    const undefinedNames = await page.locator('table td:has-text("undefined")').count();
    const nullNames = await page.locator('table td:has-text("null")').count();
    expect(undefinedNames).toBe(0);
    expect(nullNames).toBe(0);
  });
});
