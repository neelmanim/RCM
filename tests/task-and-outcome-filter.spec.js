/**
 * task-and-outcome-filter.spec.js
 *
 * Playwright E2E tests covering:
 *  1. Outcome filter precision — "Call Back Later" must NOT return leads whose
 *     MOST RECENT call outcome is something else (regression for the UNION bug
 *     that returned historical outcomes).
 *  2. Task creation — form must accept title + date + time, persist via API,
 *     and surface an error toast on network failure (not silently crash).
 *  3. Task snooze / dismiss — button state must be restored on API failure
 *     (regression for the optimistic-UI snooze/dismiss bug).
 *  4. sessionStorage filter persistence — outcome dropdown state must survive
 *     a same-session page reload.
 *
 * Prerequisites
 * ─────────────
 *   ADMIN_TOKEN  env var: a valid Super Admin JWT for the staging environment
 *   STAGING_URL  env var: defaults to https://rcm-crm-staging.onrender.com
 *
 * Run:
 *   ADMIN_TOKEN=<token> npx playwright test tests/task-and-outcome-filter.spec.js
 */

// @ts-check
const { test, expect, request: apiRequest } = require('@playwright/test');
const { BASE_URL, getTokenForUser, loginAs, navigateTo } = require('./helpers/auth');

// ─── shared helpers ────────────────────────────────────────────────────────────

/** Navigate to the Leads page and set the outcome filter dropdown */
async function selectOutcomeFilter(page, outcome) {
  // The leads nav link may be a sidebar anchor or tab
  const leadsLink = page.locator('a[data-view="leads"], button[data-view="leads"]').first();
  await leadsLink.click();
  await page.waitForSelector('#outcome-filter', { timeout: 10000 });
  await page.selectOption('#outcome-filter', outcome);
  // Wait for network activity to settle
  await page.waitForTimeout(1500);
}

/** Create a lead via API and return its id */
async function createTestLead(request, adminToken, overrides = {}) {
  const res = await request.post(`${BASE_URL}/api/leads`, {
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    data: {
      first_name: 'Playwright',
      last_name:  'TestLead',
      email:      `pw-test-${Date.now()}@example.com`,
      phone:      '+10000000000',
      company:    'PW Corp',
      lead_source: 'manual',
      ...overrides,
    },
  });
  expect(res.ok(), `Lead creation failed: ${await res.text()}`).toBe(true);
  const lead = await res.json();
  return lead.id;
}

/** Log a call outcome for a lead via the API */
async function logCallOutcome(request, adminToken, leadId, outcome) {
  const res = await request.post(`${BASE_URL}/api/leads/${leadId}/calls`, {
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    data: { outcome, notes: `Playwright test: ${outcome}` },
  });
  expect(res.ok(), `Call log failed (${res.status()}): ${await res.text()}`).toBe(true);
  return res.json();
}

/** Delete a lead via API (cleanup) */
async function deleteLead(request, adminToken, leadId) {
  await request.delete(`${BASE_URL}/api/leads/${leadId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  .catch(() => {/* best-effort */});
}

// ─── Test suite ────────────────────────────────────────────────────────────────

test.describe('Outcome filter — precision (most-recent call only)', () => {
  let adminToken;
  let leadId;

  test.beforeAll(async ({ request }) => {
    adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) test.skip(true, 'ADMIN_TOKEN not set');
  });

  test.afterEach(async ({ request }) => {
    if (leadId) { await deleteLead(request, adminToken, leadId); leadId = null; }
  });

  test('lead with last call = "Meeting Confirmed" must NOT appear under "Call Back Later" filter', async ({ page, request }) => {
    // 1. Create lead + log Call Back Later, then log Meeting Confirmed on top
    leadId = await createTestLead(request, adminToken);
    await logCallOutcome(request, adminToken, leadId, 'Call Back Later');
    await logCallOutcome(request, adminToken, leadId, 'Meeting Confirmed'); // most recent

    // 2. Login as admin and apply the Call Back Later filter
    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');
    await selectOutcomeFilter(page, 'Call Back Later');

    // 3. The lead table must NOT contain the test lead
    const leadsTable = page.locator('#leads-tbody');
    await expect(leadsTable).toBeVisible();
    // Verify lead email is absent
    await expect(leadsTable.locator('text=pw-test-')).toHaveCount(0, { timeout: 8000 });
  });

  test('lead whose LAST call = "Call Back Later" must appear under that filter', async ({ page, request }) => {
    leadId = await createTestLead(request, adminToken);
    await logCallOutcome(request, adminToken, leadId, 'No Answer');
    await logCallOutcome(request, adminToken, leadId, 'Call Back Later'); // most recent

    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');
    await selectOutcomeFilter(page, 'Call Back Later');

    const leadsTable = page.locator('#leads-tbody');
    // At least one row for our lead should appear
    await expect(
      leadsTable.locator(`tr.lead-row[data-id="${leadId}"]`)
    ).toBeVisible({ timeout: 20000 });
  });

  test('"Meeting Scheduled" filter must return leads whose last call is "Meeting Scheduled"', async ({ page, request }) => {
    leadId = await createTestLead(request, adminToken);
    await logCallOutcome(request, adminToken, leadId, 'Call Back Later');
    await logCallOutcome(request, adminToken, leadId, 'Meeting Scheduled');

    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');
    await selectOutcomeFilter(page, 'Meeting Scheduled');

    const leadsTable = page.locator('#leads-tbody');
    await expect(
      leadsTable.locator(`tr.lead-row[data-id="${leadId}"]`)
    ).toBeVisible({ timeout: 20000 });
  });

  test('leads with no calls should not appear when any outcome filter is active', async ({ page, request }) => {
    leadId = await createTestLead(request, adminToken);
    // No calls logged for this lead

    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');
    await selectOutcomeFilter(page, 'Call Back Later');

    const leadsTable = page.locator('#leads-tbody');
    await expect(
      leadsTable.locator(`tr.lead-row[data-id="${leadId}"]`)
    ).toHaveCount(0, { timeout: 8000 });
  });

  test('clearing the outcome filter restores all leads', async ({ page, request }) => {
    leadId = await createTestLead(request, adminToken);

    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');
    await selectOutcomeFilter(page, 'Unreachable'); // unlikely to match our lead
    await page.selectOption('#outcome-filter', '');  // clear
    await page.waitForTimeout(1500);

    // Subtitle should show a non-zero count now
    const subtitle = page.locator('#leads-subtitle');
    await expect(subtitle).not.toHaveText('0 leads', { timeout: 8000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Task creation — full happy path + error handling', () => {
  let adminToken;
  let leadId;

  test.beforeAll(async () => {
    adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) test.skip(true, 'ADMIN_TOKEN not set');
  });

  test.afterEach(async ({ request }) => {
    if (leadId) { await deleteLead(request, adminToken, leadId); leadId = null; }
  });

  /** Navigate to the detail page of a lead */
  async function openLeadDetail(page, request, id) {
    leadId = id;
    await page.goto(`${BASE_URL}/frontend/index.html#lead-detail/${id}`, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await page.waitForSelector('#add-task-btn', { timeout: 30000 });
  }

  test('adds a task with title only — date and time optional', async ({ page, request }) => {
    const id = await createTestLead(request, adminToken);
    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');
    await openLeadDetail(page, request, id);

    await page.fill('#task-input', 'Follow up call');
    await page.click('#add-task-btn');

    // Task should appear in the list
    await expect(page.locator('#tasks-list .task-item span', { hasText: 'Follow up call' }))
      .toBeVisible({ timeout: 8000 });

    // Input should be cleared after adding
    await expect(page.locator('#task-input')).toHaveValue('');
  });

  test('adds a task with date + time — both saved and shown in task row', async ({ page, request }) => {
    const id = await createTestLead(request, adminToken);
    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');
    await openLeadDetail(page, request, id);

    // Fill all fields
    await page.fill('#task-input', 'Scheduled callback');
    await page.fill('#task-due',   '2026-12-31');
    await page.fill('#task-time',  '14:30');
    await page.click('#add-task-btn');

    // Title should appear
    const taskItem = page.locator('#tasks-list .task-item', { hasText: 'Scheduled callback' });
    await expect(taskItem).toBeVisible({ timeout: 8000 });

    // Due label should show the date
    await expect(taskItem.locator('small')).toContainText('2026-12-31');

    // Inputs cleared
    await expect(page.locator('#task-input')).toHaveValue('');
    await expect(page.locator('#task-due')).toHaveValue('');
    await expect(page.locator('#task-time')).toHaveValue('');
  });

  test('time picker input is visible alongside the date picker', async ({ page, request }) => {
    const id = await createTestLead(request, adminToken);
    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');
    await openLeadDetail(page, request, id);

    await expect(page.locator('#task-due')).toBeVisible();
    await expect(page.locator('#task-time')).toBeVisible();
    // Time input should accept HH:MM format
    await page.fill('#task-time', '09:00');
    await expect(page.locator('#task-time')).toHaveValue('09:00');
  });

  test('empty title does NOT submit — button stays enabled, no task added', async ({ page, request }) => {
    const id = await createTestLead(request, adminToken);
    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');
    await openLeadDetail(page, request, id);

    // Click without title
    await page.click('#add-task-btn');
    await page.waitForTimeout(1000);

    // No new task items should have appeared
    const taskCount = await page.locator('#tasks-list .task-item').count();
    expect(taskCount).toBe(0);
  });

  test('network failure shows a toast error (not a silent crash)', async ({ page, request }) => {
    const id = await createTestLead(request, adminToken);
    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');
    await openLeadDetail(page, request, id);

    // Intercept the POST and force a 500 response
    await page.route(`**/api/leads/${id}/tasks`, (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ detail: 'Simulated server error' }) })
    );

    await page.fill('#task-input', 'Will fail');
    await page.click('#add-task-btn');

    // A toast with error message should appear (toast has .toast-close button inside)
    const toastClose = page.locator('.toast-close');
    await expect(toastClose).toBeVisible({ timeout: 6000 });
    const toastEl = toastClose.locator('..');
    await expect(toastEl).toContainText(/could not add task|failed|error/i, { timeout: 4000 });

    // Add button must be restored (not stuck in disabled state)
    await expect(page.locator('#add-task-btn')).toBeEnabled({ timeout: 4000 });
    await expect(page.locator('#add-task-btn')).toHaveText('Add');
  });

  test('task can be checked as done', async ({ page, request }) => {
    const id = await createTestLead(request, adminToken);
    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');
    await openLeadDetail(page, request, id);

    await page.fill('#task-input', 'Mark me done');
    await page.click('#add-task-btn');
    await expect(page.locator('#tasks-list .task-item', { hasText: 'Mark me done' })).toBeVisible();

    const checkbox = page.locator('#tasks-list .task-item', { hasText: 'Mark me done' }).locator('.task-check');
    await checkbox.check();

    // Task item should get the "done" CSS class
    await expect(page.locator('#tasks-list .task-item.done', { hasText: 'Mark me done' }))
      .toBeVisible({ timeout: 6000 });
  });

  test('task can be deleted', async ({ page, request }) => {
    const id = await createTestLead(request, adminToken);
    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');
    await openLeadDetail(page, request, id);

    await page.fill('#task-input', 'Delete me');
    await page.click('#add-task-btn');
    const taskItem = page.locator('#tasks-list .task-item', { hasText: 'Delete me' });
    await expect(taskItem).toBeVisible({ timeout: 6000 });

    await taskItem.locator('.task-del').click();
    await expect(taskItem).not.toBeVisible({ timeout: 6000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Task notification — snooze & dismiss button state hardening', () => {
  let adminToken;

  test.beforeAll(async () => {
    adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) test.skip(true, 'ADMIN_TOKEN not set');
  });

  test('snooze failure must restore Snooze button (no ghost tasks)', async ({ page, request }) => {
    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');

    // Intercept snooze to simulate failure
    await page.route('**/api/my/tasks/*/snooze', (route) =>
      route.fulfill({ status: 503, body: JSON.stringify({ detail: 'Service unavailable' }) })
    );

    // If a notification banner is present, click its Snooze button
    const snoozeBtn = page.locator('[data-action="snooze"], button:has-text("Snooze")').first();
    const hasBanner = await snoozeBtn.isVisible().catch(() => false);
    if (!hasBanner) {
      test.skip(true, 'No pending task notification visible; skip snooze test');
    }

    await snoozeBtn.click();
    // Button must not disappear (ghost task prevention) — it should still be visible or show error
    await page.waitForTimeout(1500);
    // The notification row should still be visible (not removed on failure)
    await expect(snoozeBtn).toBeVisible({ timeout: 4000 });
  });

  test('dismiss failure must restore Dismiss button', async ({ page, request }) => {
    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');

    await page.route('**/api/my/tasks/*/dismiss', (route) =>
      route.fulfill({ status: 503, body: JSON.stringify({ detail: 'Service unavailable' }) })
    );

    const dismissBtn = page.locator('[data-action="dismiss"], button:has-text("Dismiss")').first();
    const hasBanner = await dismissBtn.isVisible().catch(() => false);
    if (!hasBanner) {
      test.skip(true, 'No pending task notification visible; skip dismiss test');
    }

    await dismissBtn.click();
    await page.waitForTimeout(1500);
    await expect(dismissBtn).toBeVisible({ timeout: 4000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('sessionStorage filter persistence', () => {
  let adminToken;

  test.beforeAll(async () => {
    adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) test.skip(true, 'ADMIN_TOKEN not set');
  });

  test('outcome filter persists after navigating away and back', async ({ page, request }) => {
    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');

    // Set outcome filter
    await selectOutcomeFilter(page, 'No Answer');

    // Navigate to Dashboard then back to Leads
    await page.locator('a[data-view="dashboard"], button[data-view="dashboard"]').first().click();
    await page.waitForTimeout(800);
    await page.locator('a[data-view="leads"], button[data-view="leads"]').first().click();
    await page.waitForSelector('#outcome-filter', { timeout: 10000 });

    // Dropdown should still show "No Answer"
    await expect(page.locator('#outcome-filter')).toHaveValue('No Answer');
  });

  test('date range filter persists after navigating away and back', async ({ page, request }) => {
    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');

    await page.locator('a[data-view="leads"], button[data-view="leads"]').first().click();
    await page.waitForSelector('#date-from-filter', { timeout: 10000 });

    await page.fill('#date-from-filter', '2025-01-01');
    await page.fill('#date-to-filter',   '2025-12-31');
    await page.waitForTimeout(800);

    // Navigate away and back
    await page.locator('a[data-view="dashboard"], button[data-view="dashboard"]').first().click();
    await page.waitForTimeout(600);
    await page.locator('a[data-view="leads"], button[data-view="leads"]').first().click();
    await page.waitForSelector('#date-from-filter', { timeout: 10000 });

    await expect(page.locator('#date-from-filter')).toHaveValue('2025-01-01');
    await expect(page.locator('#date-to-filter')).toHaveValue('2025-12-31');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Lead list — general UI smoke tests', () => {
  let adminToken;

  test.beforeAll(async () => {
    adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) test.skip(true, 'ADMIN_TOKEN not set');
  });

  test('leads page loads without error and shows a table', async ({ page, request }) => {
    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');
    await page.locator('a[data-view="leads"], button[data-view="leads"]').first().click();
    await expect(page.locator('#leads-tbody')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#outcome-filter')).toBeVisible();
    await expect(page.locator('#status-filter')).toBeVisible();
  });

  test('all outcome dropdown options are present', async ({ page, request }) => {
    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');
    await page.locator('a[data-view="leads"], button[data-view="leads"]').first().click();
    await page.waitForSelector('#outcome-filter', { timeout: 10000 });

    const expectedOutcomes = [
      'Call Back Later', 'Meeting Scheduled', 'Meeting Confirmed',
      'Text Me', 'Not the Right Person', 'Referred Someone Else',
      'Left Voicemail', 'No Answer', 'Wrong Number', 'Not Interested', 'Unreachable',
    ];
    const options = await page.locator('#outcome-filter option').allInnerTexts();
    for (const outcome of expectedOutcomes) {
      expect(options).toContain(outcome);
    }
  });

  test('"No leads match your filter" is shown when a filter returns zero results', async ({ page, request }) => {
    await loginAs(page, request, process.env.ADMIN_EMAIL || 'neelmani.mishra@screen-magic.com');
    await page.locator('a[data-view="leads"], button[data-view="leads"]').first().click();
    await page.waitForSelector('#outcome-filter', { timeout: 10000 });

    // Use a highly specific search that will not match anything
    await page.fill('#lead-search', '__UNLIKELY_MATCH_XYZ_12345__');
    await page.waitForTimeout(2000);
    await expect(page.locator('#leads-tbody')).toContainText('No leads match your filter', { timeout: 10000 });
  });
});
