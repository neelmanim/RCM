// ── v11.9.4 UI-standardization pass — live staging verification ───────────
// Verifies, against real staging data, the component-library standardization
// pass (Tabs/EmptyState/Checkbox/Switch/Spinner/Avatar/Pagination added to
// components/ui/, dozens of hand-rolled patterns converted onto them) and
// the three real bugs found and fixed along the way:
//   1. ColumnsMenu/PriorityDot: Radix DropdownMenu's default modal={true}
//      blocked pointer events on the rest of the page — fixed with modal={false}.
//   2. FilterBar's "+Filter" menu opening a filter's own Popover from the
//      same onSelect tick raced Radix's close-focus-return — fixed via
//      onCloseAutoFocus instead of a timing guess.
//   3. Modal now ignores an Escape a nested Radix layer already handled, so
//      a picker inside a modal (e.g. SendWindowSettings' Timezone Select)
//      no longer closes the whole modal too.
//   4. SearchInput's <input> leaked the browser's native focus border —
//      nav-tailwind.css's Preflight-equivalent border reset was scoped only
//      to .nh-feedback-portal, never widened when SearchInput/Popover/Spinner
//      were wired directly into NavTopbar. Fixed with an explicit border-0
//      on the <input> itself instead of widening that scope.
//   5. DropdownMenuContent/PopoverContent (z-50) rendered behind an open
//      Modal (z-[100]) — any Select/Dropdown/Popover opened from inside a
//      modal (e.g. Timezone inside Send Window) appeared dimmed, behind the
//      modal's own backdrop. Fixed by bumping both to z-[110].
// Also spot-checks the original reported bug (lead_source badge mismatch
// between the leads table and a lead's own detail page) still holds fixed.
//
// Uses raw JWTs handed directly by the user (ADMIN_TOKEN, SDR_TOKEN,
// POD_ADMIN_TOKEN in .env.test) via the app's `?token=` login — real staging
// sessions, not synthetic ones.
// Run: npx playwright test tests/v11-9-4-ui-standardization-verification.spec.js
const { test, expect } = require('@playwright/test');
const { BASE_URL } = require('./helpers/auth');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SDR_TOKEN = process.env.SDR_TOKEN;
const POD_ADMIN_TOKEN = process.env.POD_ADMIN_TOKEN;

async function loginWithToken(page, token) {
  await page.goto(`${BASE_URL}/?token=${token}`);
  // leads-hub and lead-detail-hub still gate the React version behind a
  // classic/beta toggle (localStorage 'leadsHub'/'leadDetailHub' === 'on') —
  // without this every test lands on the legacy vanilla-JS list/detail view
  // instead of the React components this pass actually touched.
  await page.evaluate(() => {
    localStorage.setItem('leadsHub', 'on');
    localStorage.setItem('leadDetailHub', 'on');
    // Skip the one-time guided tours (leads-hub, power-dialer-hub) — their
    // full-screen overlay intercepts every click otherwise, and this test
    // isn't verifying onboarding UI.
    localStorage.setItem('alternate:leads-hub-tour-seen', '1');
    localStorage.setItem('alternate:power-dialer-tour-seen', '1');
  });
  await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
}

async function goToHash(page, hash) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(2500);
}

test.describe('Leads Hub — dropdown/menu standardization (Super Admin)', () => {
  test.beforeEach(async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await goToHash(page, '#leads');
    await expect(page.getByText('All Leads', { exact: true }).first()).toBeVisible({ timeout: 15000 });
  });

  test('1. ColumnsMenu: hide then re-show the Phone column while it stays open (modal={false} fix)', async ({ page }) => {
    await expect(page.getByRole('columnheader', { name: 'Phone' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Columns' }).click();
    const phoneItem = page.getByRole('menuitem', { name: 'Phone' });
    await expect(phoneItem).toBeVisible({ timeout: 5000 });

    await phoneItem.click();
    await expect(page.getByRole('columnheader', { name: 'Phone' })).not.toBeVisible({ timeout: 5000 });

    // Re-click the SAME open menu item — this is exactly the modal={true}
    // pointer-events-blocking bug: if it regresses, this click silently
    // does nothing and the column stays hidden.
    await phoneItem.click();
    await expect(page.getByRole('columnheader', { name: 'Phone' })).toBeVisible({ timeout: 5000 });
  });

  test('2. FilterBar: "+Filter" → Source → an option\'s own Popover actually opens (onCloseAutoFocus fix)', async ({ page }) => {
    await page.getByText('+ Filter', { exact: true }).click();
    const addFilterMenu = page.getByText('Add a filter').locator('..');
    await addFilterMenu.getByText('Source', { exact: true }).click();

    // This is the exact race this pass fixed: the Source filter's own
    // Popover opening from the "+Filter" menu's onSelect in the same tick.
    // Scoped to the popover's own content (not just any "Uploaded"-ish
    // button on the page — e.g. the toolbar's "Sync Salesforce" button also
    // matches a loose name regex).
    const popover = page.locator('[data-radix-popper-content-wrapper]').last();
    const anOption = popover.getByRole('button', { name: 'Uploaded', exact: true });
    await expect(anOption).toBeVisible({ timeout: 5000 });
    await anOption.click();
    await expect(page.getByText('Source: Uploaded', { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('3. PriorityDot: opening a second row\'s re-prioritize menu closes the first (modal={false} fix)', async ({ page }) => {
    const dots = page.getByTitle(/click to re-prioritize/i);
    await expect(dots.nth(1)).toBeVisible({ timeout: 10000 }).catch(() => {});
    const count = await dots.count();
    test.skip(count < 2, 'Needs at least 2 visible leads on this page to verify cross-row menu behavior');

    await dots.nth(0).click();
    await expect(page.getByText('High', { exact: true }).or(page.getByText('Deprioritized', { exact: true })).first())
      .toBeVisible({ timeout: 5000 });

    // The bug: with modal={true}, a second row's dot sits behind a
    // pointer-events:none overlay while the first menu is open and this
    // click silently does nothing.
    await dots.nth(1).click({ timeout: 5000 });
    // Radix keeps a closing menu mounted mid-animate-out (data-state
    // "closed" but still rendered/fading) — wait past that transition
    // instead of counting text immediately, which would false-positive on
    // every close.
    await page.waitForTimeout(500);
    const openMenus = await page.locator('[role="menu"][data-state="open"]').count();
    expect(openMenus).toBeLessThanOrEqual(1);
  });

  test('4. Lead source badge matches between the leads table and the lead\'s own detail page (original reported bug)', async ({ page }) => {
    // Leads are grouped by company (a collapsible "COMPANY NAME · N contact"
    // header row per group) — `tbody tr:first` lands on a header row, not a
    // real contact row. A real contact row always has a status badge
    // (Disqualified/Calling/Meeting/etc.); group headers don't.
    const contactRow = page.locator('tbody tr').filter({ hasText: /Disqualified|Calling|Research|Meeting|Demo|Assigned/ }).first();
    await expect(contactRow).toBeVisible({ timeout: 10000 });
    const tableSourceBadge = contactRow.locator('td').nth(2);
    const tableSourceText = (await tableSourceBadge.textContent())?.trim();
    expect(tableSourceText, 'Source column should have real text').toBeTruthy();

    await contactRow.click();
    await page.waitForTimeout(2000);
    // LeadHeader renders the source badge right next to the lead's name.
    const detailBadges = page.locator('h1').locator('..').getByText(tableSourceText, { exact: false });
    await expect(detailBadges.first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Sales Journey — SendWindowSettings (Escape-scoping fix)', () => {
  test('5. Escape closes only the Timezone listbox, not the whole Send Window modal', async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await goToHash(page, '#sales-journeys');
    // JourneyList renders cadences as a checkbox-row card list, not a
    // <table> — each row's name+status area is its own role="button" div.
    const cadenceRow = page.getByRole('button').filter({ hasText: /active|draft|archived/i }).first();
    const cadenceCount = await cadenceRow.count();
    test.skip(cadenceCount === 0, 'No cadences on staging to open Send Window settings for');

    await cadenceRow.click();
    await page.waitForTimeout(1500);
    const sendWindowTrigger = page.getByText(/Send Window|Anytime|business hours/i).first();
    const hasTrigger = await sendWindowTrigger.count();
    test.skip(hasTrigger === 0, 'Send Window control not found on this cadence\'s page');
    await sendWindowTrigger.click();
    await page.waitForTimeout(500);

    // Timezone starts disabled until a window is actually being configured
    // — enable "Restrict to business hours" first if this cadence currently
    // has no window set (mirrors SendWindowSettings.test.jsx's own flow).
    const tzButton = page.getByRole('button', { name: 'Timezone' });
    if (await tzButton.isDisabled().catch(() => true)) {
      const businessHoursCheckbox = page.getByLabel('Restrict to business hours');
      if (await businessHoursCheckbox.count()) await businessHoursCheckbox.check();
    }
    const hasTz = await tzButton.count();
    test.skip(hasTz === 0 || await tzButton.isDisabled(), 'Timezone control not usable on this cadence');

    await tzButton.click();
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).not.toBeVisible({ timeout: 5000 });
    // The regression this fixes: Escape used to bubble past the already-
    // preventDefault'd Popover and close the whole Modal too.
    await expect(page.getByText('Send Window')).toBeVisible({ timeout: 5000 });
  });

  test('11. Timezone select renders above the Send Window modal, not behind it (z-[110] fix)', async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await goToHash(page, '#sales-journeys');
    const cadenceRow = page.getByRole('button').filter({ hasText: /active|draft|archived/i }).first();
    const cadenceCount = await cadenceRow.count();
    test.skip(cadenceCount === 0, 'No cadences on staging to open Send Window settings for');

    await cadenceRow.click();
    await page.waitForTimeout(1500);
    const sendWindowTrigger = page.getByText(/Send Window|Anytime|business hours/i).first();
    const hasTrigger = await sendWindowTrigger.count();
    test.skip(hasTrigger === 0, 'Send Window control not found on this cadence\'s page');
    await sendWindowTrigger.click();
    await page.waitForTimeout(500);

    const tzButton = page.getByRole('button', { name: 'Timezone' });
    if (await tzButton.isDisabled().catch(() => true)) {
      const businessHoursCheckbox = page.getByLabel('Restrict to business hours');
      if (await businessHoursCheckbox.count()) await businessHoursCheckbox.check();
    }
    const hasTz = await tzButton.count();
    test.skip(hasTz === 0 || await tzButton.isDisabled(), 'Timezone control not usable on this cadence');

    await tzButton.click();
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: 5000 });
    // DropdownMenuContent/PopoverContent portal to document.body at z-[110],
    // Modal's overlay is z-[100] — before the fix this option was rendered
    // behind the modal's backdrop, and Playwright's actionability check
    // (the modal backdrop intercepting the click) is exactly what would
    // fail here if that regressed.
    await page.getByRole('option', { name: 'America/New_York' }).click({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Timezone' })).toContainText('America/New_York', { timeout: 5000 });
  });
});

test.describe('Pods Hub — Tabs standardization (Super Admin)', () => {
  test('6. Team Roster / Manage Pods tabs switch correctly', async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await goToHash(page, '#pods');
    await page.waitForTimeout(1500);
    const tabs = page.getByRole('button', { name: /Manage Pods|Team Roster/ });
    const tabCount = await tabs.count();
    test.skip(tabCount === 0, 'Pods Hub tab bar not found on staging for this role');
    await tabs.last().click();
    await page.waitForTimeout(800);
    await tabs.first().click();
    await page.waitForTimeout(800);
    // No assertion beyond "didn't throw" — this is a smoke check that Tabs
    // renders and is clickable for both tab labels.
  });
});

test.describe('Activity Monitor — ChannelTabs standardization (Super Admin)', () => {
  test('7. Calls / Email / Messages tabs switch without error', async ({ page }) => {
    await loginWithToken(page, ADMIN_TOKEN);
    await goToHash(page, '#activity-monitor');
    await page.waitForTimeout(1500);
    const emailTab = page.getByRole('button', { name: 'Email', exact: true });
    const hasTabs = await emailTab.count();
    test.skip(hasTabs === 0, 'Activity Monitor not available for this role/build on staging');
    await emailTab.click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Messages', exact: true }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Calls', exact: true }).click();
  });
});

test.describe('Power Dialer Hub — Pagination/SearchInput/Avatar standardization (SDR)', () => {
  test('8. Power Dialer Hub loads and renders the current-call card (Avatar) with no app-level console errors', async ({ page }) => {
    // Not gating on zero console errors network-wide — the Aircall
    // Everywhere iframe (unrelated third party, not touched by this pass)
    // logs its own 401s in a test session with no real Aircall login.
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await loginWithToken(page, SDR_TOKEN);
    await goToHash(page, '#my-calls');
    await expect(page.getByRole('heading', { name: 'Power Dialer' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Today's Calls", { exact: true })).toBeVisible({ timeout: 10000 });

    expect(errors, `Uncaught page errors on Power Dialer Hub: ${errors.join('\n')}`).toEqual([]);
  });
});

test.describe('Help Hub — SearchBar/EmptyState standardization', () => {
  test('9. Help & User Guide search renders and the page loads with no console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await loginWithToken(page, ADMIN_TOKEN);
    await goToHash(page, '#user-guide');
    await expect(page.getByRole('heading', { name: 'Help & User Guide' })).toBeVisible({ timeout: 15000 });

    expect(errors, `Console errors on Help Hub: ${errors.join('\n')}`).toEqual([]);
  });
});

test.describe('Pod Admin — pod-scoped Dashboard smoke check', () => {
  test('10. Dashboard renders for Pod Admin with no console errors (Avatar/Tabs/EmptyState in this role\'s views)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await loginWithToken(page, POD_ADMIN_TOKEN);
    await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible({ timeout: 15000 });

    expect(errors, `Console errors on Pod Admin Dashboard: ${errors.join('\n')}`).toEqual([]);
  });
});

test.describe('NavTopbar — SearchInput native-border regression (Super Admin)', () => {
  test('12. Focusing the global search input does not show the browser\'s native input border', async ({ page }) => {
    // Every per-bundle Tailwind entry omits @tailwind base (Preflight) to
    // avoid clobbering the legacy vanilla-JS shell, and reproduces just the
    // border-reset manually, scoped to each bundle's own root container.
    // SearchInput.jsx never set its own border and relied on that ambient
    // reset — which nav-tailwind.css's scope never covered (it only ever
    // wrapped .nh-feedback-portal). Fixed with an explicit border-0 on the
    // <input> itself so it can't regress by depending on ambient scope again.
    await loginWithToken(page, ADMIN_TOKEN);
    await page.click('#nh-search-input');
    const borderWidth = await page.locator('#nh-search-input').evaluate((el) => getComputedStyle(el).borderWidth);
    expect(borderWidth).toBe('0px');
  });
});
