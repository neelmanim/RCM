/**
 * Shared fixtures, helpers, and auth setup for all CRM test specs.
 */
const { test: base, expect } = require('@playwright/test');

const JWT_TOKEN = process.env.JWT_TOKEN ||
  // Fresh 90-day Super Admin token (generated 2026-05-22, exp ~2026-08-20)
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZGUwZDU2Ny0xYWNmLTRlOTgtOTQ0Yi01NDJjNzdkMzA4ZTQiLCJlbWFpbCI6Im5lZWxtYW5pLm1pc2hyYUBzY3JlZW4tbWFnaWMuY29tIiwibmFtZSI6Ik5lZWxtYW5pIE1pc2hyYSIsInJvbGUiOiJTdXBlciBBZG1pbiIsInBvZF9pZCI6bnVsbCwiZGlhbGVyX2VuYWJsZWQiOnRydWUsImVtYWlsX3N5bmNfZW5hYmxlZCI6ZmFsc2UsImV4cCI6MTc4NzIyMDQxNn0.iHjQTRPOcMxVZthYfCLx5aA9g3Lq7_4LsE9e0U6lb1w';

const API_BASE = process.env.API_BASE_URL || 'https://rcm-crm-staging.onrender.com';

// ─── Extend base test with auth setup ───────────────────────────────────────
const test = base.extend({
  // Auto-authenticate every test via localStorage JWT injection
  authenticatedPage: async ({ page }, use) => {
    // Go to base URL to set correct origin for localStorage
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate((token) => {
      localStorage.setItem('crm_token', token);
    }, JWT_TOKEN);
    // Reload so React's AuthContext picks up the token on mount
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await use(page);
  },
});

// ─── Navigation helpers ─────────────────────────────────────────────────────

/** Navigate to a page and wait for it to settle.
 *  The vanilla JS app uses hash routing: /#settings, /#leads, /#dashboard etc.
 *  Plain paths (/settings) just load the homepage — always use /#path here.
 */
async function navigateTo(page, path, opts = {}) {
  const { waitMs = 3000, networkIdle = true } = opts;
  // Convert plain path to hash route: '/settings' → '/#settings', '/dashboard' → '/#dashboard'
  // Already-hash paths (/#foo) and root (/) are left as-is
  let hashPath = path;
  if (path && path !== '/' && !path.startsWith('/#') && !path.startsWith('#')) {
    hashPath = `/#${path.replace(/^\//, '')}`;
  }
  await page.goto(hashPath, { waitUntil: 'domcontentloaded', timeout: 30000 });
  if (networkIdle) {
    try { await page.waitForLoadState('networkidle', { timeout: 15000 }); } catch {}
  }
  await page.waitForTimeout(waitMs);
}

// ─── API helpers ────────────────────────────────────────────────────────────

/** Make an authenticated API request directly */
async function apiGet(request, endpoint) {
  const resp = await request.get(`${API_BASE}/api${endpoint}`, {
    headers: { 'Authorization': `Bearer ${JWT_TOKEN}` },
    timeout: 15000,
  });
  return { status: resp.status(), body: await resp.json().catch(() => null) };
}

// ─── DOM inspection helpers ─────────────────────────────────────────────────

/** Check if any stuck spinners remain on page */
async function getSpinners(page) {
  return page.locator('.animate-spin:visible').count();
}

/** Count visible table rows */
async function getTableRowCount(page, tableIndex = 0) {
  const tables = page.locator('table');
  const count = await tables.count();
  if (count <= tableIndex) return 0;
  return tables.nth(tableIndex).locator('tbody tr').count();
}

/** Check for pagination controls */
async function hasPagination(page) {
  const selectors = [
    'button:has-text("Next")',
    'button:has-text("Previous")',
    'button:has-text("Prev")',
    'text=/Page \\d+ of \\d+/',
    'text=/Showing \\d+/',
  ];
  for (const sel of selectors) {
    if (await page.locator(sel).count() > 0) return true;
  }
  return false;
}

/** Check for filter controls (selects, search inputs, date pickers) */
async function hasFilters(page) {
  const found = { selects: 0, searchInputs: 0, dateInputs: 0, total: 0 };
  // Selects — native <select> or class-based filter dropdowns
  found.selects = await page.locator('select:visible, .filter-select:visible').count();
  // Search inputs — may have emoji prefix (e.g. '\uD83D\uDD0D Search...'), so use broad input check
  found.searchInputs = await page.locator(
    'input[type="search"]:visible, input[placeholder*="Search" i]:visible, input[placeholder*="Filter" i]:visible, input.filter-input:visible'
  ).count();
  found.dateInputs = await page.locator('input[type="date"]:visible').count();
  found.total = found.selects + found.searchInputs + found.dateInputs;
  return found;
}

/** Collect API errors during page load */
function collectApiErrors(page) {
  const errors = [];
  page.on('response', resp => {
    const url = resp.url();
    const status = resp.status();
    if (url.includes('/api/') && (status === 404 || status >= 500)) {
      errors.push({ status, url: url.replace(API_BASE, '') });
    }
  });
  return errors;
}

module.exports = {
  test,
  expect,
  JWT_TOKEN,
  API_BASE,
  navigateTo,
  apiGet,
  getSpinners,
  getTableRowCount,
  hasPagination,
  hasFilters,
  collectApiErrors,
};
