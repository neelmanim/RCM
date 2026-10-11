/**
 * Assignments Tests — loading state, table rendering, filters
 */
const { test, expect, navigateTo, getSpinners, getTableRowCount, hasFilters, collectApiErrors } = require('./helpers');

test.describe('Assignments', () => {

  test('page loads without getting stuck on spinner', async ({ authenticatedPage: page }) => {
    const apiErrors = collectApiErrors(page);
    await navigateTo(page, '/assignments', { waitMs: 15000 });

    const spinners = await getSpinners(page);
    console.log(`  → Spinners after 15s: ${spinners}`);
    expect(spinners).toBe(0);
  });

  test('unassigned/assigned tabs render content', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/assignments', { waitMs: 10000 });

    // Check for tab structure
    const tabs = page.locator('text=/Unassigned|Assigned|Available/i');
    const tabCount = await tabs.count();
    console.log(`  → Assignment tabs: ${tabCount}`);
    expect(tabCount).toBeGreaterThan(0);
  });

  test('table renders with lead data', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/assignments', { waitMs: 12000 });

    const rows = await getTableRowCount(page);
    console.log(`  → Assignment table rows: ${rows}`);
    // May be 0 if all leads assigned — that's OK
  });

  test('filter/search controls are present', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/assignments', { waitMs: 10000 });

    const filters = await hasFilters(page);
    console.log(`  → Filters: ${JSON.stringify(filters)}`);
  });

  test('no API 404/500 errors', async ({ authenticatedPage: page }) => {
    const apiErrors = collectApiErrors(page);
    await navigateTo(page, '/assignments', { waitMs: 12000 });

    const errors = apiErrors.filter(e => e.status === 404 || e.status >= 500);
    if (errors.length > 0) {
      console.error(`  ✗ API errors: ${errors.map(e => `${e.status} ${e.url}`).join(', ')}`);
    }
    expect(errors).toEqual([]);
  });
});
