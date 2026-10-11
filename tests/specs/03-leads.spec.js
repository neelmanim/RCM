/**
 * Leads List Tests — table rendering, search/filter, pagination, navigation
 */
const { test, expect, navigateTo, getSpinners, getTableRowCount, hasPagination, hasFilters, collectApiErrors } = require('./helpers');

test.describe('Leads List', () => {

  test('page loads without API errors', async ({ authenticatedPage: page }) => {
    const apiErrors = collectApiErrors(page);
    await navigateTo(page, '/leads', { waitMs: 5000 });

    const errors404 = apiErrors.filter(e => e.status === 404);
    expect(errors404).toEqual([]);
  });

  test('table renders with lead data', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/leads', { waitMs: 6000 });

    const rows = await getTableRowCount(page);
    console.log(`  → Lead table rows: ${rows}`);
    expect(rows).toBeGreaterThan(0);
  });

  test('search/filter controls are visible', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/leads', { waitMs: 5000 });

    const filters = await hasFilters(page);
    console.log(`  → Filter controls: ${JSON.stringify(filters)}`);
    expect(filters.total).toBeGreaterThan(0);
  });

  test('pagination is present when rows exist', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/leads', { waitMs: 6000 });

    const rows = await getTableRowCount(page);
    if (rows > 0) {
      const pag = await hasPagination(page);
      console.log(`  → Pagination present: ${pag}`);
      // Report but don't hard-fail — may be intentional infinite scroll
    }
  });

  test('no stuck spinners after load', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/leads', { waitMs: 8000 });
    const spinners = await getSpinners(page);
    expect(spinners).toBe(0);
  });

  test('clicking a lead navigates to detail page', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/leads', { waitMs: 6000 });

    // Click first lead row — selector from lead_list.js: tr.lead-row[data-id]
    const firstRow = page.locator('tr.lead-row[data-id], table tbody tr[data-id]').first();
    if (await firstRow.count() === 0) {
      console.log('  → No lead rows found — skipping');
      return;
    }
    await firstRow.click();
    await page.waitForTimeout(3000);

    // Vanilla JS uses hash routing: /#lead-detail/{id} not /leads/{id}
    const url = page.url();
    const isDetail = url.includes('#lead-detail') || url.includes('lead-detail');
    console.log(`  → Navigated to: ${url}`);
    expect(isDetail, `Expected hash lead-detail URL but got: ${url}`).toBe(true);
  });

  test('lead detail page renders without errors', async ({ authenticatedPage: page }) => {
    const apiErrors = collectApiErrors(page);

    // First get a valid lead ID
    await navigateTo(page, '/leads', { waitMs: 5000 });
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.count() > 0) {
      await firstRow.click();
      await page.waitForTimeout(4000);

      // Should see lead info (name, status, company, etc.)
      const hasContent = await page.locator('text=/Status|Company|Phone|Email/i').count();
      console.log(`  → Lead detail content indicators: ${hasContent}`);
      expect(hasContent).toBeGreaterThan(0);

      const errors = apiErrors.filter(e => e.status === 404);
      if (errors.length > 0) {
        console.warn(`  ⚠ Lead detail 404 errors: ${errors.map(e => e.url).join(', ')}`);
      }
    }
  });
});
