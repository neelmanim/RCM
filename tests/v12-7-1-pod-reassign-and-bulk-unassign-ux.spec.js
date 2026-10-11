/**
 * v12.7.1 — UI/UX feedback batch (2026-09-22): three bugs reported while
 * moving an SDR between PODs, none of which existing Playwright specs
 * caught because they assert "did the DOM render / did the API not error",
 * not "did the user get feedback."
 *
 *   1. Reassigning a POD member (Pods Hub or Control Center's Team & Access
 *      dropdown) resolved with no success toast — looked like a no-op.
 *   2. Control Center kept showing a user's OLD pod until a hard refresh,
 *      because it's a persisted React island (hub-entry.jsx) that never
 *      remounts on revisit, so its one-shot data fetch never re-ran.
 *   3. Bulk-unassign on Leads Hub had no busy/disabled state — the button
 *      stayed clickable with no visible change for the whole request.
 *
 * Fix: usePodsData.js / useUsersRolesData.js now toast on success and both
 * dispatch + listen for a 'alternate:pod-membership-changed' CustomEvent so
 * either hub refreshes when the other makes the change. BulkActionBar.jsx
 * now tracks assignBusy/unassignBusy and disables + relabels the button.
 *
 * These mutate real staging data (pod membership, lead assignment) — every
 * test reverts what it changed in a `finally`-equivalent so a partial
 * failure doesn't leave staging altered.
 *
 * Token via env: SA_TOKEN (Super Admin — required for POD reassignment and
 * bulk-assign/unassign).
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const SA_TOKEN = process.env.SA_TOKEN;

async function login(page, token) {
  await page.addInitScript(() => {
    try {
      // LeadsHub (React, has the bulk-unassign bar under test) is behind a
      // beta flag — default is the legacy leads view (RCA 2026-08-19).
      localStorage.setItem('leadsHub', 'on');
      localStorage.setItem('alternate:leads-hub-tour-seen-v2', '1');
      ['csm-portal-inbox', 'csm-portal-portfolio', 'control-center', 'pipeline-hub', 'pods'].forEach((t) =>
        localStorage.setItem(`alternatecrm:${t}-tour-seen`, '1'));
    } catch { /* private-mode localStorage can throw */ }
  });
  await page.goto(`${BASE_URL}/?token=${token}`);
  await page.waitForTimeout(1500);
}

async function goHash(page, hash) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(2000);
}

test.describe('POD reassignment feedback + cross-hub freshness', () => {
  test('reassigning a POD member shows a success toast, and Control Center reflects it without a hard refresh', async ({ page }) => {
    test.skip(!SA_TOKEN, 'SA_TOKEN not set');
    await login(page, SA_TOKEN);

    // Mount Control Center's Team & Access tab FIRST — this is the exact
    // repro: the bug only shows once this hub is already mounted (a fresh
    // mount always fetches current data; only a *revisit* was stale).
    await goHash(page, '#control-center');
    await page.getByRole('button', { name: 'Team & Access' }).click();
    await page.waitForTimeout(1500);

    // Track the target row by the user's own name/email via the search box
    // (not row position) — the list's row order isn't guaranteed stable
    // across refetches, so "first row" can silently become a different user
    // after a reload and produce a false failure.
    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.count() === 0) test.skip(true, 'No users on this page.');
    const userLabel = (await firstRow.locator('td').first().locator('div').first().textContent() || '').trim();
    const search = page.getByPlaceholder('Search by name or email…');
    await search.fill(userLabel);
    await page.waitForTimeout(500);

    const row = () => page.locator('table tbody tr').first();
    const podCell = row().locator('td').nth(2);
    const originalPodLabel = (await podCell.textContent() || '').trim();

    await podCell.getByRole('button').click(); // opens the POD select
    const menu = page.getByRole('menu');
    const options = await menu.getByRole('menuitem').allTextContents();
    const target = options.find((o) => o.trim() !== originalPodLabel);
    if (!target) test.skip(true, 'Only one POD exists — nothing to reassign to.');

    await menu.getByRole('menuitem', { name: target, exact: true }).click();

    // RCA 2026-09-22: an assertion failing before the revert used to abort
    // the test and leave the member stuck in the wrong POD on staging.
    // try/finally guarantees the revert always fires.
    try {
      // Bug 1: success toast.
      await expect(page.getByText(/moved to/i)).toBeVisible({ timeout: 8000 });

      // Bug 2: Pods Hub (a *different*, already-fresh-on-visit hub) should
      // show the change; more importantly, coming BACK to Control Center
      // (still mounted, not remounted) must show it updated too.
      await goHash(page, '#pods');
      await page.waitForTimeout(1500);
      await goHash(page, '#control-center');
      await page.getByRole('button', { name: 'Team & Access' }).click();
      await page.waitForTimeout(1500);
      await page.getByPlaceholder('Search by name or email…').fill(userLabel);
      await page.waitForTimeout(500);

      await expect(row().locator('td').nth(2)).toHaveText(target, { timeout: 8000 });
    } finally {
      // Revert — put the member back in their original POD so staging data
      // isn't left altered by this test.
      await row().locator('td').nth(2).getByRole('button').click();
      await page.getByRole('menu').getByRole('menuitem', { name: originalPodLabel, exact: true }).click();
      await expect(page.getByText(/moved to/i)).toBeVisible({ timeout: 8000 });
    }
  });
});

test.describe('Bulk-unassign busy state', () => {
  test('Unassign button disables and relabels while the request is in flight, then confirms completion', async ({ page }) => {
    test.skip(!SA_TOKEN, 'SA_TOKEN not set');
    await login(page, SA_TOKEN);
    await goHash(page, '#leads');

    // The persistent Aircall dialer drawer opens on load and covers the
    // right side of the screen — including where the bulk-action bar's
    // Assign/Unassign buttons render — so close it before interacting.
    const aircallClose = page.locator('.nh-aircall-drawer__header button').first();
    if (await aircallClose.count() > 0) await aircallClose.click();

    // Row checkboxes only render once bulk-select mode is active (Super
    // Admin's toggle is "Assign mode") — LeadsHub.jsx's `bulkSelectActive`.
    await page.getByRole('button', { name: 'Assign mode' }).click();
    await page.waitForTimeout(500);

    const rows = page.locator('table tbody tr');
    if (await rows.count() === 0) test.skip(true, 'No leads on staging to test against.');

    // Pick a row that already has a real assignee, so this test's unassign
    // is a real state change we can (and do) reverse afterward via the same
    // row's inline "Reassign lead" picker — not one already unassigned,
    // which would silently no-op and prove nothing about the busy state.
    let targetRow = null;
    let originalAssignee = '';
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const r = rows.nth(i);
      const cell = r.getByRole('button', { name: 'Reassign lead' });
      if (await cell.count() === 0) continue; // a company group-header row, not a lead row
      const fullLabel = (await cell.textContent() || '').trim();
      if (!fullLabel || fullLabel === 'Unassigned') continue;
      // The button's text is a leading initials badge ("SJ") immediately
      // followed by the full name ("Sneha Joshi") with no separator — strip
      // the initials prefix so this matches the plain-name menuitem label
      // used to reassign, both here and in the revert step below.
      const initials = (await cell.locator('span.rounded-full').textContent() || '').trim();
      const label = fullLabel.startsWith(initials) ? fullLabel.slice(initials.length) : fullLabel;
      targetRow = r; originalAssignee = label; break;
    }
    if (!targetRow) test.skip(true, 'No assigned lead on this page to test unassign against.');

    const checkbox = targetRow.getByRole('checkbox');
    if (await checkbox.count() === 0) test.skip(true, 'Leads Hub bulk-select checkboxes not visible for this role.');
    await checkbox.check();

    const unassignBtn = page.getByRole('button', { name: 'Unassign' });
    await expect(unassignBtn).toBeVisible();
    await unassignBtn.click();

    // RCA 2026-09-22: an assertion failing between the unassign click and the
    // revert used to abort the test before the revert ran, leaving a real
    // lead unassigned on staging (caught the hard way — a failed run here
    // orphaned a lead and it had to be found and fixed by hand afterward).
    // try/finally guarantees the revert always fires.
    try {
      // The bug: this button used to give zero visual feedback for the whole
      // request. Now it must disable and relabel immediately.
      await expect(page.getByRole('button', { name: 'Unassigning…' })).toBeDisabled();

      // And a completion toast once the request resolves. Scoped to LeadsHub's
      // own fixed-position toast (bottom-left) — "Unassigned" is also the
      // per-row AssigneeCell's label once this action lands, so an unscoped
      // text match is ambiguous the moment both are on screen.
      await expect(page.locator('div.fixed.left-6.bottom-6', { hasText: /unassigned/i })).toBeVisible({ timeout: 10000 });
    } finally {
      // Revert — reassign the lead back to its original SDR so staging data
      // isn't left altered by this test. This picker is a searchable Select
      // (Select.jsx: searchable → Radix Popover + role="option" buttons), not
      // the plain DropdownMenu (role="menuitem") the POD-reassignment test
      // above uses — the two Select variants expose different ARIA roles.
      await targetRow.getByRole('button', { name: 'Reassign lead' }).click();
      await page.getByRole('option', { name: originalAssignee, exact: true }).click();
    }
    await expect(targetRow.getByRole('button', { name: 'Reassign lead' })).toContainText(originalAssignee);
    await expect(page.getByRole('button', { name: 'Unassign' })).toHaveCount(0); // selection cleared after action, bar unmounts
  });
});
