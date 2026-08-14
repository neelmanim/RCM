/**
 * CRM Staging Comprehensive Audit
 * 
 * Checks every major page for:
 *  - Stuck spinners / loading states
 *  - Missing pagination controls
 *  - Missing filter controls
 *  - API 404 / 500 errors
 *  - Data rendering (empty tables, zero counts)
 *  - SDR count in Analytics
 */

const { test, expect } = require('@playwright/test');

const BASE_URL = 'https://rcm-react-staging.onrender.com';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZGUwZDU2Ny0xYWNmLTRlOTgtOTQ0Yi01NDJjNzdkMzA4ZTQiLCJlbWFpbCI6Im5lZWxtYW5pLm1pc2hyYUBzY3JlZW4tbWFnaWMuY29tIiwibmFtZSI6Ik5lZWxtYW5pIE1pc2hyYSIsInJvbGUiOiJTdXBlciBBZG1pbiIsInBvZF9pZCI6bnVsbCwiZGlhbGVyX2VuYWJsZWQiOmZhbHNlLCJlbWFpbF9zeW5jX2VuYWJsZWQiOmZhbHNlLCJleHAiOjE3NzY5NjAxMjB9.vAa0RB8bJlWWQjXRCk9xZm-gTeGypf2jHyHX92SRB_E';

// Collect all issues found
const issues = [];

function logIssue(page, category, detail) {
  const entry = `[${category}] ${page}: ${detail}`;
  console.error(`❌ ${entry}`);
  issues.push(entry);
}

function logOk(page, detail) {
  console.log(`✅ ${page}: ${detail}`);
}

// ─── Setup: inject JWT before each test ─────────────────────────────────────
test.beforeEach(async ({ page }) => {
  // Navigate to base URL first so we can set localStorage on the right origin
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Inject JWT token into localStorage
  await page.evaluate((token) => {
    localStorage.setItem('ls_token', token);
  }, JWT_TOKEN);

  // Collect console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (text.includes('404') || text.includes('500') || text.includes('Failed to fetch')) {
        console.error(`🔴 Console Error: ${text.substring(0, 200)}`);
      }
    }
  });
});

// ─── Helper: wait for page to settle (no spinners) ──────────────────────────
async function waitForSettled(page, timeout = 15000) {
  // Wait for network to be mostly idle
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    // Network may never fully idle due to polling
  }
  // Additional wait for React re-renders
  await page.waitForTimeout(2000);
}

// ─── Helper: check for stuck spinners ───────────────────────────────────────
async function checkSpinners(page, pageName) {
  const spinnerSelectors = [
    '.animate-spin',
    '[class*="spinner"]',
    '[class*="loading"]',
    '.animate-pulse',
  ];

  for (const sel of spinnerSelectors) {
    const count = await page.locator(sel).count();
    if (count > 0 && sel !== '.animate-pulse') {
      // Check if it's a skeleton (acceptable) or a stuck spinner
      const visible = await page.locator(sel).first().isVisible().catch(() => false);
      if (visible) {
        logIssue(pageName, 'SPINNER', `Found ${count} element(s) matching "${sel}" still visible after load`);
      }
    }
  }
}

// ─── Helper: check for pagination ───────────────────────────────────────────
async function checkPagination(page, pageName) {
  const paginationSelectors = [
    'button:has-text("Next")',
    'button:has-text("Previous")',
    'button:has-text("Prev")',
    '[class*="pagination"]',
    'nav[aria-label*="pagination"]',
    'text=/Page \\d+ of \\d+/',
    'text=/Showing \\d+/',
  ];

  let found = false;
  for (const sel of paginationSelectors) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      found = true;
      logOk(pageName, `Pagination found: "${sel}" (${count} elements)`);
      break;
    }
  }
  return found;
}

// ─── Helper: check for filters ──────────────────────────────────────────────
async function checkFilters(page, pageName) {
  const filterSelectors = [
    'select',
    'input[type="search"]',
    'input[placeholder*="Search"]',
    'input[placeholder*="Filter"]',
    'input[type="date"]',
    'button:has-text("Filter")',
    '[class*="filter"]',
  ];

  let found = false;
  const foundTypes = [];
  for (const sel of filterSelectors) {
    const count = await page.locator(sel).count();
    if (count > 0) {
      found = true;
      foundTypes.push(`${sel}(${count})`);
    }
  }

  if (found) {
    logOk(pageName, `Filters found: ${foundTypes.join(', ')}`);
  }
  return found;
}

// ─── Helper: count table rows ───────────────────────────────────────────────
async function countTableRows(page, pageName) {
  const rows = await page.locator('table tbody tr').count();
  if (rows === 0) {
    const noDataMsg = await page.locator('text=/No .*(found|available|data|records)/i').count();
    if (noDataMsg > 0) {
      logOk(pageName, 'Table empty with "No data" message');
    } else {
      logIssue(pageName, 'EMPTY_TABLE', 'Table has 0 rows and no empty-state message');
    }
  } else {
    logOk(pageName, `Table has ${rows} row(s)`);
  }
  return rows;
}

// ─── Helper: capture API errors ─────────────────────────────────────────────
function captureApiErrors(page, pageName) {
  const errors = [];
  page.on('response', response => {
    const status = response.status();
    const url = response.url();
    if (url.includes('/api/') && (status === 404 || status >= 500)) {
      const short = url.replace(BASE_URL, '');
      logIssue(pageName, `API_${status}`, short);
      errors.push({ status, url: short });
    }
  });
  return errors;
}


// ═════════════════════════════════════════════════════════════════════════════
// TEST: Dashboard
// ═════════════════════════════════════════════════════════════════════════════
test('1. Dashboard — Growth Intelligence & widgets', async ({ page }) => {
  const apiErrors = captureApiErrors(page, 'Dashboard');

  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForSettled(page);

  // Check Growth Intelligence card loaded
  const giCard = page.locator('text=Growth Intelligence');
  const giVisible = await giCard.count();
  if (giVisible > 0) {
    logOk('Dashboard', 'Growth Intelligence card found');

    // Check if it shows error state or actual data
    const errorState = await page.locator('text=Unable to load insights').count();
    if (errorState > 0) {
      logIssue('Dashboard', 'GI_ERROR', 'Growth Intelligence showing "Unable to load insights" fallback');
    } else {
      // Check for health score / insights
      const hasInsights = await page.locator('text=/health|velocity|conversion|pipeline/i').count();
      logOk('Dashboard', `Growth Intelligence has ${hasInsights} insight keyword(s)`);
    }
  } else {
    logIssue('Dashboard', 'MISSING', 'Growth Intelligence card not found');
  }

  await checkSpinners(page, 'Dashboard');

  // Screenshot
  await page.screenshot({ path: 'tests/screenshots/01-dashboard.png', fullPage: true });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST: Leads List
// ═════════════════════════════════════════════════════════════════════════════
test('2. Leads List — table, filters, pagination', async ({ page }) => {
  captureApiErrors(page, 'Leads');

  await page.goto(`${BASE_URL}/leads`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForSettled(page);

  // Check for search/filter
  const hasFilters = await checkFilters(page, 'Leads');
  if (!hasFilters) {
    logIssue('Leads', 'NO_FILTERS', 'No search bar or filter controls visible');
  }

  // Check table rows
  const rows = await countTableRows(page, 'Leads');

  // Check pagination
  if (rows > 0) {
    const hasPag = await checkPagination(page, 'Leads');
    if (!hasPag) {
      logIssue('Leads', 'NO_PAGINATION', `Table has ${rows} rows but no pagination controls found`);
    }
  }

  await checkSpinners(page, 'Leads');
  await page.screenshot({ path: 'tests/screenshots/02-leads.png', fullPage: true });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST: Analytics
// ═════════════════════════════════════════════════════════════════════════════
test('3. Analytics — SDR count, filters, charts', async ({ page }) => {
  captureApiErrors(page, 'Analytics');

  await page.goto(`${BASE_URL}/analytics`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForSettled(page, 20000);

  // Check filters (date range, pod, batch dropdowns)
  const hasFilters = await checkFilters(page, 'Analytics');
  if (!hasFilters) {
    logIssue('Analytics', 'NO_FILTERS', 'No filter controls (date, pod, batch) visible');
  }

  // Count select dropdowns specifically
  const selects = await page.locator('select').count();
  logOk('Analytics', `Found ${selects} dropdown(s)`);

  // Check SDR Performance table
  const sdrSection = page.locator('text=SDR Performance');
  const sdrVisible = await sdrSection.count();
  if (sdrVisible > 0) {
    logOk('Analytics', 'SDR Performance section found');

    // Count SDR rows
    const sdrRows = await page.locator('table tbody tr').count();
    logOk('Analytics', `SDR table has ${sdrRows} rows`);

    if (sdrRows > 0 && sdrRows < 6) {
      logIssue('Analytics', 'LOW_SDR_COUNT', `Only ${sdrRows} SDR(s) visible — expected more`);
    }

    // Check the subtitle for SDR count
    const subtitle = await page.locator('text=/\\d+ SDR/').textContent().catch(() => '');
    if (subtitle) {
      logOk('Analytics', `SDR subtitle: "${subtitle}"`);
    }
  } else {
    logIssue('Analytics', 'MISSING', 'SDR Performance section not found');
  }

  // Check for charts/funnel
  const hasFunnel = await page.locator('text=/funnel|pipeline/i').count();
  logOk('Analytics', `Funnel/pipeline references: ${hasFunnel}`);

  await checkSpinners(page, 'Analytics');
  await page.screenshot({ path: 'tests/screenshots/03-analytics.png', fullPage: true });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST: Admin > User Settings
// ═════════════════════════════════════════════════════════════════════════════
test('4. Admin Users — table, actions, icons', async ({ page }) => {
  captureApiErrors(page, 'AdminUsers');

  await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForSettled(page);

  // Click "User Settings" tab if present
  const userTab = page.locator('text=User Settings');
  if (await userTab.count() > 0) {
    await userTab.click();
    await waitForSettled(page, 8000);
  }

  // Count users in the table
  const rows = await countTableRows(page, 'AdminUsers');

  // Check action buttons (should be icon-only <button> elements)
  const actionButtons = await page.locator('table button[title]').count();
  logOk('AdminUsers', `Found ${actionButtons} action button(s) with titles`);

  // Check for "View As" icon specifically (should NOT show as text anymore)
  const viewAsText = await page.locator('text="View As"').count();
  if (viewAsText > 0) {
    logIssue('AdminUsers', 'VIEW_AS_TEXT', '"View As" still showing as text instead of icon');
  }

  // Check for Revoke/Delete actions visibility
  const revokeBtn = await page.locator('button[title="Revoke Access"]').count();
  const deleteBtn = await page.locator('button[title="Delete User"]').count();
  logOk('AdminUsers', `Revoke buttons: ${revokeBtn}, Delete buttons: ${deleteBtn}`);

  // Check pagination
  if (rows > 10) {
    const hasPag = await checkPagination(page, 'AdminUsers');
    if (!hasPag) {
      logIssue('AdminUsers', 'NO_PAGINATION', `${rows} users but no pagination`);
    }
  }

  await checkSpinners(page, 'AdminUsers');
  await page.screenshot({ path: 'tests/screenshots/04-admin-users.png', fullPage: true });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST: Admin > Governance > Login Activity
// ═════════════════════════════════════════════════════════════════════════════
test('5. Login Activity — data rendering, pagination', async ({ page }) => {
  captureApiErrors(page, 'LoginActivity');

  await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForSettled(page);

  // Navigate to Governance tab
  const govTab = page.locator('text=Governance');
  if (await govTab.count() > 0) {
    await govTab.click();
    await waitForSettled(page, 8000);
  }

  // Look for Login Activity / Login History sub-tab or section
  const loginTab = page.locator('text=/Login (Activity|History)/i');
  if (await loginTab.count() > 0) {
    await loginTab.first().click();
    await waitForSettled(page, 8000);
  }

  // Check for error messages
  const errorMsg = await page.locator('text=/error|failed|something went wrong/i').count();
  if (errorMsg > 0) {
    logIssue('LoginActivity', 'ERROR_MSG', 'Error message visible on page');
  }

  const rows = await countTableRows(page, 'LoginActivity');

  // Check "1 record found but not visible" scenario
  const recordCount = await page.locator('text=/\\d+ record/i').textContent().catch(() => '');
  if (recordCount && rows === 0) {
    logIssue('LoginActivity', 'GHOST_RECORDS', `Shows "${recordCount}" but table has 0 visible rows`);
  }

  await checkSpinners(page, 'LoginActivity');
  await page.screenshot({ path: 'tests/screenshots/05-login-activity.png', fullPage: true });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST: Assignments page
// ═════════════════════════════════════════════════════════════════════════════
test('6. Assignments — loading state', async ({ page }) => {
  captureApiErrors(page, 'Assignments');

  await page.goto(`${BASE_URL}/assignments`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForSettled(page, 20000);

  // Check if still showing spinner after 20s
  await checkSpinners(page, 'Assignments');

  // Check for table or content
  const hasTable = await page.locator('table').count();
  const hasCards = await page.locator('[class*="card"]').count();
  logOk('Assignments', `Tables: ${hasTable}, Cards: ${hasCards}`);

  if (hasTable === 0 && hasCards === 0) {
    // Check if stuck on loading
    const loadingText = await page.locator('text=/loading|fetching/i').count();
    if (loadingText > 0) {
      logIssue('Assignments', 'STUCK_LOADING', 'Page stuck on loading state');
    }
  }

  const rows = await countTableRows(page, 'Assignments');

  // Check filters
  const hasFilters = await checkFilters(page, 'Assignments');
  if (!hasFilters && rows > 0) {
    logIssue('Assignments', 'NO_FILTERS', 'Table loaded but no filters visible');
  }

  await page.screenshot({ path: 'tests/screenshots/06-assignments.png', fullPage: true });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST: Settings pages
// ═════════════════════════════════════════════════════════════════════════════
test('7. Settings — General, Sync, Integrations', async ({ page }) => {
  captureApiErrors(page, 'Settings');

  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForSettled(page);

  // Check General tab - password section should be gone
  const changePwd = await page.locator('text=/Change Password/i').count();
  if (changePwd > 0) {
    logIssue('Settings', 'CHANGE_PWD', '"Change Password" still visible (should be SSO only)');
  }

  // Check SSO notice
  const ssoNotice = await page.locator('text=/Google SSO|Single Sign-On/i').count();
  if (ssoNotice > 0) {
    logOk('Settings', 'Google SSO notice visible');
  }

  // Navigate to Sync tab
  const syncTab = page.locator('text=Salesforce');
  if (await syncTab.count() > 0) {
    await syncTab.first().click();
    await waitForSettled(page, 8000);

    // Check pipeline stages dropdown
    const selects = await page.locator('select').count();
    logOk('Settings/Sync', `Found ${selects} dropdown(s) on Sync page`);
  }

  await checkSpinners(page, 'Settings');
  await page.screenshot({ path: 'tests/screenshots/07-settings.png', fullPage: true });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST: MyCalls page
// ═════════════════════════════════════════════════════════════════════════════
test('8. MyCalls — table, filters, pagination', async ({ page }) => {
  captureApiErrors(page, 'MyCalls');

  await page.goto(`${BASE_URL}/my-calls`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForSettled(page);

  const hasFilters = await checkFilters(page, 'MyCalls');
  if (!hasFilters) {
    logIssue('MyCalls', 'NO_FILTERS', 'No filter/search controls visible');
  }

  const rows = await countTableRows(page, 'MyCalls');
  if (rows > 0) {
    const hasPag = await checkPagination(page, 'MyCalls');
    if (!hasPag) {
      logIssue('MyCalls', 'NO_PAGINATION', `${rows} rows but no pagination`);
    }
  }

  await checkSpinners(page, 'MyCalls');
  await page.screenshot({ path: 'tests/screenshots/08-mycalls.png', fullPage: true });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST: Calls (Admin)
// ═════════════════════════════════════════════════════════════════════════════
test('9. Calls — table, filters, pagination', async ({ page }) => {
  captureApiErrors(page, 'Calls');

  await page.goto(`${BASE_URL}/calls`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForSettled(page);

  const hasFilters = await checkFilters(page, 'Calls');
  if (!hasFilters) {
    logIssue('Calls', 'NO_FILTERS', 'No filter/search controls visible');
  }

  const rows = await countTableRows(page, 'Calls');
  if (rows > 10) {
    const hasPag = await checkPagination(page, 'Calls');
    if (!hasPag) {
      logIssue('Calls', 'NO_PAGINATION', `${rows} rows but no pagination`);
    }
  }

  await checkSpinners(page, 'Calls');
  await page.screenshot({ path: 'tests/screenshots/09-calls.png', fullPage: true });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST: Leaderboard
// ═════════════════════════════════════════════════════════════════════════════
test('10. Leaderboard — data rendering', async ({ page }) => {
  captureApiErrors(page, 'Leaderboard');

  await page.goto(`${BASE_URL}/leaderboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForSettled(page);

  const rows = await countTableRows(page, 'Leaderboard');

  const hasFilters = await checkFilters(page, 'Leaderboard');
  if (!hasFilters) {
    logIssue('Leaderboard', 'NO_FILTERS', 'No filter controls visible');
  }

  await checkSpinners(page, 'Leaderboard');
  await page.screenshot({ path: 'tests/screenshots/10-leaderboard.png', fullPage: true });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST: User Guide / Release Notes
// ═════════════════════════════════════════════════════════════════════════════
test('11. User Guide — Release Notes', async ({ page }) => {
  captureApiErrors(page, 'UserGuide');

  await page.goto(`${BASE_URL}/user-guide`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForSettled(page);

  // Navigate to release notes
  const releaseTab = page.locator('text=Release Notes');
  if (await releaseTab.count() > 0) {
    await releaseTab.click();
    await waitForSettled(page, 5000);
  }

  // Check for v5.1.0 release notes
  const v51 = await page.locator('text=v5.1.0').count();
  const v50 = await page.locator('text=v5.0.0').count();
  if (v51 > 0) {
    logOk('UserGuide', 'v5.1.0 release notes present');
  } else {
    logIssue('UserGuide', 'MISSING_RELEASE', 'v5.1.0 release notes not found');
  }
  if (v50 > 0) {
    logOk('UserGuide', 'v5.0.0 release notes present');
  }

  await page.screenshot({ path: 'tests/screenshots/11-user-guide.png', fullPage: true });
});


// ═════════════════════════════════════════════════════════════════════════════
// TEST: API Health Check — direct calls
// ═════════════════════════════════════════════════════════════════════════════
test('12. API Health — critical endpoints', async ({ page }) => {
  const endpoints = [
    { url: '/api/health', label: 'Health' },
    { url: '/api/leads?page=1&limit=10', label: 'Leads' },
    { url: '/api/admin/users', label: 'Admin Users' },
    { url: '/api/admin/activity-logs?page=1&limit=10', label: 'Activity Logs' },
    { url: '/api/admin/login-logs?page=1&limit=10', label: 'Login Logs' },
    { url: '/api/growth-intelligence', label: 'Growth Intelligence' },
    { url: '/api/analytics/sdr-table', label: 'SDR Table' },
    { url: '/api/analytics/funnel', label: 'Analytics Funnel' },
    { url: '/api/email/config', label: 'Email/Nylas Config' },
    { url: '/api/admin/sync-settings', label: 'Sync Settings' },
  ];

  for (const ep of endpoints) {
    try {
      const response = await page.request.get(`${BASE_URL}${ep.url}`, {
        headers: { 'Authorization': `Bearer ${JWT_TOKEN}` },
        timeout: 15000,
      });
      const status = response.status();
      if (status === 200) {
        // Parse response to check structure
        const body = await response.json().catch(() => null);
        if (body) {
          if (ep.label === 'SDR Table') {
            const sdrs = body.sdrs || body.data?.sdrs || body.data || [];
            logOk('API', `${ep.label}: ${status} OK — ${Array.isArray(sdrs) ? sdrs.length : '?'} SDR(s)`);
          } else if (ep.label === 'Growth Intelligence') {
            logOk('API', `${ep.label}: ${status} OK — health_score=${body.ai?.health_score || 'N/A'}`);
          } else if (ep.label === 'Admin Users') {
            const users = Array.isArray(body) ? body : (body.data || []);
            logOk('API', `${ep.label}: ${status} OK — ${users.length} user(s)`);
          } else if (ep.label === 'Login Logs') {
            const logs = Array.isArray(body) ? body : (body.data || []);
            logOk('API', `${ep.label}: ${status} OK — ${Array.isArray(logs) ? logs.length : typeof body} entries, keys: ${Object.keys(body).join(',')}`);
          } else {
            logOk('API', `${ep.label}: ${status} OK`);
          }
        } else {
          logOk('API', `${ep.label}: ${status} OK (non-JSON)`);
        }
      } else {
        logIssue('API', `HTTP_${status}`, `${ep.label} (${ep.url}) returned ${status}`);
      }
    } catch (err) {
      logIssue('API', 'TIMEOUT', `${ep.label} (${ep.url}) — ${err.message}`);
    }
  }
});


// ═════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═════════════════════════════════════════════════════════════════════════════
test.afterAll(async () => {
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('  STAGING AUDIT SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');

  if (issues.length === 0) {
    console.log('✅ No issues found! All pages passed audit.');
  } else {
    console.log(`❌ ${issues.length} issue(s) found:\n`);
    issues.forEach((issue, i) => {
      console.log(`  ${i + 1}. ${issue}`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════\n');
});
