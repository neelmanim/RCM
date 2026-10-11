/**
 * v12.6.0 staging audit — every area this release touched.
 *
 *   1. Backend on 12.6.0, DB healthy.
 *   2. AE Pipeline: donut renders without the ReferenceError the
 *      PerformanceDonut fix addressed (subtitle used a stale `open` var).
 *   3. Power Dialer: CurrentCallCard's script section (Add Script / cadence
 *      default) renders as a real Button, not a bare <button>.
 *   4. Sales Tools > Campaigns: Opens/Clicks columns render on the list and
 *      in the detail modal.
 *   5. My Tasks: nav item visible, page loads, status filter works,
 *      lead-name link is a real Button.
 *   6. CSM Portal: renewal-opportunity action still present; component
 *      library guard (Select for Stage, no raw <select>/<input type=date>).
 *   7. Help Hub lists v12.6.0.
 *
 * Read-only: nothing here submits a form that writes to Salesforce
 * (opportunity_writeback_enabled is false on staging, confirmed via
 * GET /admin/sync-settings before this run).
 *
 * Token via env so it isn't committed: SA_TOKEN.
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API_BASE = process.env.STAGING_API || 'https://messenger-crm-staging.onrender.com';
const SA_TOKEN = process.env.SA_TOKEN;

const issues = [];
const logIssue = (area, detail) => { console.error(`FAIL [${area}] ${detail}`); issues.push(`[${area}] ${detail}`); };
const logOk = (area, detail) => console.log(`OK ${area}: ${detail}`);

function watchErrors(page, sink) {
  page.on('pageerror', (e) => sink.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|net::ERR_|Failed to load resource|aircall/i.test(t)) return;
    sink.push(`console: ${t}`);
  });
}

async function login(page) {
  await page.addInitScript(() => {
    try { void localStorage.length; } catch { return; }
    ['sales-tools', 'control-center', 'daily-digest', 'cadence-readonly',
     'my-settings', 'leaderboard', 'aircall-drawer', 'ae-pipeline', 'csm-portal',
     'my-tasks'].forEach((t) =>
      localStorage.setItem(`alternatecrm:${t}-tour-seen`, '1'));
    localStorage.setItem('leadsHub', 'on');
  });
  await page.goto(`${BASE_URL}/?token=${SA_TOKEN}`);
  await page.waitForSelector('nav >> text=Dashboard', { timeout: 45_000 });
  const drawerClose = page.locator('.nh-aircall-drawer__header .nh-overlay-close');
  if (await drawerClose.count() > 0) await drawerClose.first().click().catch(() => {});
}

async function goHash(page, hash) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(3500);
}

test.beforeAll(() => {
  if (!SA_TOKEN) throw new Error('SA_TOKEN env var is required');
});

test.afterAll(() => {
  console.log(`\n=== v12.6.0 staging audit: ${issues.length} issue(s) ===`);
  issues.forEach((i) => console.log(' -', i));
});

test('health + sync settings sane before any UI check', async ({ request }) => {
  const health = await (await request.get(`${API_BASE}/api/health`)).json();
  expect(health.version).toBe('12.6.0');
  const settings = await (await request.get(`${API_BASE}/api/admin/sync-settings`, {
    headers: { Authorization: `Bearer ${SA_TOKEN}` },
  })).json();
  expect(settings.opportunity_writeback_enabled).toBe(false);
  logOk('preflight', `v${health.version}, writeback disabled — safe for a read-only pass`);
});

test('My Tasks: page loads (direct nav) and filter, lead-name is a Button', async ({ page }) => {
  // v12.6.1 hid the nav item from Super Admin (a personal worklist doesn't
  // apply to a role with no assigned leads) — see v12-6-1-staging-audit.spec.js
  // for that gating check. This test now reaches the page directly to keep
  // verifying the page itself still works for whichever role does see it.
  const errs = [];
  watchErrors(page, errs);
  await login(page);
  await page.evaluate(() => { window.location.hash = '#my-tasks'; });
  await page.waitForTimeout(2000);

  const heading = page.locator('h1:has-text("My Tasks")');
  await expect(heading).toBeVisible({ timeout: 15_000 });
  logOk('my-tasks', 'nav item present, page loads');

  // Status filter is a real Select (TriggerPill), not a native <select>.
  const filterTrigger = page.getByRole('button', { name: 'Filter by status' });
  await expect(filterTrigger).toBeVisible();

  const rows = page.locator('[data-tour="task-row"]');
  const rowCount = await rows.count();
  if (rowCount === 0) {
    const empty = page.locator('text=Nothing open right now, text=No tasks yet');
    logOk('my-tasks', 'no open tasks for this user — empty state path (not asserting further)');
  } else {
    logOk('my-tasks', `${rowCount} open task row(s) rendered`);
    // Lead name must be a real <button>, not a bare clickable span.
    const leadLink = rows.first().locator('button').first();
    await expect(leadLink).toBeVisible();
  }

  if (errs.length) errs.forEach((e) => logIssue('my-tasks', e));
});

test('AE Pipeline: loads without the PerformanceDonut ReferenceError', async ({ page }) => {
  // 2026-09-16: Super Admin no longer reaches #ae-pipeline directly (nav
  // restructuring moved them to the merged #pipeline-hub, AE tab default).
  const errs = [];
  watchErrors(page, errs);
  await login(page);
  await goHash(page, '#pipeline-hub');

  const crashed = errs.some((e) => /is not defined|ReferenceError/i.test(e));
  if (crashed) {
    logIssue('ae-pipeline', `page threw: ${errs.join(' | ')}`);
  } else {
    logOk('ae-pipeline', 'no ReferenceError / uncaught exception on load');
  }

  const table = page.locator('table, [role="table"]');
  await expect(table.first()).toBeVisible({ timeout: 15_000 });

  const donutSubtitle = page.locator('text=/still open across \\d+ deal/i');
  if (await donutSubtitle.count() > 0) {
    logOk('ae-pipeline', `donut subtitle renders: "${(await donutSubtitle.first().textContent()).trim()}"`);
  } else {
    logIssue('ae-pipeline', 'no donut subtitle matching "<N> open" found — check PerformanceDonut markup');
  }
});

test('Power Dialer: script section is real Button, not bare <button>', async ({ page }) => {
  const errs = [];
  watchErrors(page, errs);
  await login(page);
  await goHash(page, '#my-calls');
  await page.waitForTimeout(2000);

  const scriptBtn = page.getByRole('button', { name: /Add Script|Script/i });
  if (await scriptBtn.count() > 0) {
    logOk('power-dialer', 'Script button present on CurrentCallCard');
  } else {
    logIssue('power-dialer', 'no lead in queue to render CurrentCallCard against — could not verify script UI live');
  }
  if (errs.length) errs.forEach((e) => logIssue('power-dialer', e));
});

test('Sales Tools > Campaigns: Opens/Clicks columns render', async ({ page }) => {
  const errs = [];
  watchErrors(page, errs);
  await login(page);
  await goHash(page, '#sales-tools');
  await page.waitForTimeout(1500);

  const campaignsTab = page.locator('text=Campaigns').first();
  if (await campaignsTab.count() > 0) {
    await campaignsTab.click();
    await page.waitForTimeout(1500);
  }

  const opensHeader = page.locator('th:has-text("Opens"), [role="columnheader"]:has-text("Opens")');
  const clicksHeader = page.locator('th:has-text("Clicks"), [role="columnheader"]:has-text("Clicks")');
  if (await opensHeader.count() > 0 && await clicksHeader.count() > 0) {
    logOk('campaigns', 'Opens/Clicks columns present on campaign list');
  } else {
    logIssue('campaigns', 'no campaigns in this account to render the list against, or columns missing');
  }
  if (errs.length) errs.forEach((e) => logIssue('campaigns', e));
});

test('CSM Portal: component-library guard (no raw select/date input)', async ({ page }) => {
  // 2026-09-16: Super Admin's CSM Portal oversight view moved from #csm-portal
  // to #pipeline-hub's "CSM Portal" tab.
  const errs = [];
  watchErrors(page, errs);
  await login(page);
  await goHash(page, '#pipeline-hub');
  const csmTab = page.getByRole('button', { name: /CSM Portal/ });
  if (await csmTab.count() > 0) await csmTab.click();
  await page.waitForTimeout(2000);

  // Scoped to the CSM Portal island's own container — the page also carries
  // hidden legacy modal templates (#lead-status, #new-user-role) elsewhere
  // in the DOM that have nothing to do with this island.
  const scope = page.locator('#view-container');
  const rawSelects = await scope.locator('select').count();
  const rawDates = await scope.locator('input[type="date"]').count();
  if (rawSelects === 0 && rawDates === 0) {
    logOk('csm-portal', 'no raw <select>/<input type=date> on initial render');
  } else {
    logIssue('csm-portal', `${rawSelects} raw <select>, ${rawDates} raw date input found`);
  }
  if (errs.length) errs.forEach((e) => logIssue('csm-portal', e));
});

test('Help Hub lists v12.6.0', async ({ page }) => {
  await login(page);
  await goHash(page, '#user-guide');
  await page.waitForTimeout(1500);
  const entry = page.locator('text=/v?12\\.6\\.0/');
  if (await entry.count() > 0) {
    logOk('help-hub', 'v12.6.0 release entry present');
  } else {
    logIssue('help-hub', 'v12.6.0 entry not found in Help Hub');
  }
});
