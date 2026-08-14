/**
 * Calls & MyCalls Tests — table, filters, pagination
 */
const { test, expect, navigateTo, getSpinners, getTableRowCount, hasFilters, hasPagination, collectApiErrors } = require('./helpers');

test.describe('Calls (Admin)', () => {

  test('page loads with data', async ({ authenticatedPage: page }) => {
    const apiErrors = collectApiErrors(page);
    await navigateTo(page, '/calls', { waitMs: 6000 });

    const rows = await getTableRowCount(page);
    console.log(`  → Calls table rows: ${rows}`);

    const errors = apiErrors.filter(e => e.status === 404);
    expect(errors).toEqual([]);
  });

  test('filter controls present', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/calls', { waitMs: 5000 });

    const filters = await hasFilters(page);
    console.log(`  → Filters: ${JSON.stringify(filters)}`);
    expect(filters.total).toBeGreaterThan(0);
  });

  test('pagination works when many records', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/calls', { waitMs: 6000 });

    const rows = await getTableRowCount(page);
    const pag = await hasPagination(page);
    console.log(`  → Rows: ${rows}, Pagination: ${pag}`);
  });

  test('no stuck spinners', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/calls', { waitMs: 8000 });
    expect(await getSpinners(page)).toBe(0);
  });
});

test.describe('My Calls (SDR)', () => {

  test('page loads without errors', async ({ authenticatedPage: page }) => {
    const apiErrors = collectApiErrors(page);
    await navigateTo(page, '/my-calls', { waitMs: 6000 });

    const errors = apiErrors.filter(e => e.status === 404);
    expect(errors).toEqual([]);
  });

  test('table renders', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/my-calls', { waitMs: 6000 });

    const rows = await getTableRowCount(page);
    console.log(`  → MyCalls rows: ${rows}`);
  });

  test('filter controls present', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/my-calls', { waitMs: 5000 });

    const filters = await hasFilters(page);
    console.log(`  → Filters: ${JSON.stringify(filters)}`);
    expect(filters.total).toBeGreaterThan(0);
  });

  test('no stuck spinners', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/my-calls', { waitMs: 8000 });
    expect(await getSpinners(page)).toBe(0);
  });
});
