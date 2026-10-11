// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo } = require('./helpers/auth');

const SUPER_ADMIN_EMAIL = 'neelmani.mishra@screen-magic.com';

// RCA 2026-08-24: InlineSelectCell's searchable popover (Assigned To / Status
// cells in the React Leads Hub) was clipped by its table cell's
// `overflow-hidden` (LeadRow.jsx) — the search input painted but the options
// list never did. The component's own jsdom-based unit tests never caught
// this because jsdom performs no real layout, so `overflow: hidden` never
// actually clips anything there. This spec runs in a real browser against
// staging specifically to catch that class of bug — a click at a clipped
// element's coordinates lands on whatever's actually painted underneath, so
// this fails honestly on the old code instead of false-passing.
test.describe('Leads Hub — inline select popover (real browser layout)', () => {
  // The table groups rows by company — a company-header row ("Abbott Inc · 1
  // contact") sits above each lead row and has no Reassign/Change-status
  // control, so a bare `tr:first-child` can land on a header instead of a
  // real lead row. Scope to rows that actually contain the control we need.
  const LEAD_ROW = (root, label) => root.locator(`tr:has(button[aria-label="${label}"])`);

  async function openLeadsHub(page, request) {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await page.evaluate(() => {
      localStorage.setItem('leadsHub', 'on');
      // Suppress the first-run guided tour (LeadsHubTour.jsx) — its overlay
      // blocks pointer events on the table until dismissed, and a fresh
      // browser profile has never seen it.
      localStorage.setItem('alternate:leads-hub-tour-seen', '1');
    });
    await navigateTo(page, 'leads');
    const root = page.locator('#leads-react-root');
    await expect(LEAD_ROW(root, 'Reassign lead').first()).toBeVisible({ timeout: 15000 });
    return root;
  }

  test('Assigned To popover opens unclipped and its options are really clickable', async ({ page, request }) => {
    const root = await openLeadsHub(page, request);
    let row = LEAD_ROW(root, 'Reassign lead').first();
    // Capture the lead's own name so the row can be re-found by identity
    // after the reassign below — setLeadAssignee refetches the whole list,
    // and a changed assignee can shift sort/grouping order, so re-querying
    // "the first row" post-mutation can silently land on a DIFFERENT lead.
    const leadName = (await row.locator('.font-bold').first().textContent() || '').trim();
    const trigger = row.getByLabel('Reassign lead');
    const before = (await trigger.textContent() || '').trim();

    await trigger.click();

    const popover = page.locator('[role="listbox"]');
    await expect(popover).toBeVisible({ timeout: 5000 });
    await expect(popover.locator('input[placeholder="Search…"]')).toBeVisible();

    const options = popover.locator('[role="option"]');
    await expect(options.first()).toBeVisible({ timeout: 5000 });
    const optionCount = await options.count();
    expect(optionCount).toBeGreaterThan(0);

    // Pick an option other than the current assignee so the click is a real
    // state change, not a no-op that would pass even if nothing rendered.
    let target = options.first();
    let targetName = '';
    for (let i = 0; i < optionCount; i++) {
      const text = (await options.nth(i).textContent() || '').trim();
      if (text && text !== before) { target = options.nth(i); targetName = text; break; }
    }
    // Playwright's click() resolves the element under the target's own
    // coordinates first — on the clipped/buggy version this either times out
    // (nothing paints there) or clicks whatever row is actually underneath,
    // not this button. Either way the assertion below fails honestly.
    await target.click();
    // Re-find the row by name (not position) post-refetch, then re-scope
    // the trigger from it — see the leadName comment above.
    row = LEAD_ROW(root, 'Reassign lead').filter({ hasText: leadName }).first();
    const triggerAfter = row.getByLabel('Reassign lead');
    // A pod-lock/cap/no-phone skip is a legitimate business-rule outcome
    // (already covered by backend pytest) surfaced via this toast — this
    // test only cares that the click registered SOMETHING, either the new
    // value or the skip explanation, rather than silently doing nothing
    // (the old clipped-popover bug's actual failure mode).
    const skipToast = page.locator('.fixed.left-6.bottom-6');
    await expect(triggerAfter.filter({ hasText: targetName }).or(skipToast)).toBeVisible({ timeout: 15000 });
    if (await skipToast.isVisible()) return;

    // Restore the original assignee so this test doesn't leave staging data mutated.
    await triggerAfter.click();
    const restorePopover = page.locator('[role="listbox"]');
    await expect(restorePopover).toBeVisible({ timeout: 5000 });
    const restoreOptions = restorePopover.locator('[role="option"]');
    const restoreCount = await restoreOptions.count();
    for (let i = 0; i < restoreCount; i++) {
      const text = (await restoreOptions.nth(i).textContent() || '').trim();
      if (text === before) { await restoreOptions.nth(i).click(); break; }
    }
  });

  test('Escape closes the popover without changing the value', async ({ page, request }) => {
    const root = await openLeadsHub(page, request);
    const row = LEAD_ROW(root, 'Change status').first();
    const trigger = row.getByLabel('Change status');
    const before = (await trigger.textContent() || '').trim();

    await trigger.click();
    const popover = page.locator('[role="listbox"]');
    await expect(popover).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(popover).not.toBeVisible({ timeout: 5000 });
    await expect(trigger).toContainText(before);
  });

  test('Opening a second row\'s popover closes the first', async ({ page, request }) => {
    const root = await openLeadsHub(page, request);
    const rows = LEAD_ROW(root, 'Reassign lead');
    await expect(rows.nth(1)).toBeVisible({ timeout: 10000 });

    await rows.nth(0).getByLabel('Reassign lead').click();
    await expect(page.locator('[role="listbox"]')).toBeVisible({ timeout: 5000 });

    await rows.nth(1).getByLabel('Reassign lead').click();
    // Exactly one listbox should be open at a time — the first row's closed
    // when the second row's opened (useClickOutside's cross-popover broadcast).
    await expect(page.locator('[role="listbox"]')).toHaveCount(1, { timeout: 5000 });

    await page.keyboard.press('Escape');
  });
});
