// v13.7.0 close-out audit — CSM persona (CSM_TOKEN), staging only, read-only.
// Never sends, calls, saves settings or touches demo cadences/leads.
// Selectors verified against: layout/NavSidebar.jsx, layout/NavTopbar.jsx,
// features/csm-portal/*, features/my-tasks/MyTasksHub.jsx, pages/Calendar/CalendarHub.jsx,
// features/my-settings/*, features/help-hub/*, features/lead-detail-hub/*, frontend/js/app.js.
const { test, expect } = require('@playwright/test');
const { APP_VERSION, PERSONAS, watch, login, go, shot, api, expectClean } = require('./helpers/v13-7-0-staging');

const TOKEN = PERSONAS.csm.token;
const T = 30000;

// CsmPortalTour keys per flat section — the shared harness only seeds inbox/playbooks.
const EXTRA_TOUR_KEYS = ['alternate:csm-portal-portfolio-tour-seen', 'alternate:csm-portal-digest-tour-seen'];

const FORBIDDEN_LEADS = new Set([
  'bf9c2e97-c3a8-4bf4-a629-7d1e6e2fce2c', 'fcac0d6e-dbfa-43dd-accd-c96a76735a6b',
  'd8b575b1-9a81-47bb-abcb-dd7485f218bf', '6b0d4ca1-af4e-44cb-a5cb-ae1bfc5169b0',
]);
const FORBIDDEN_NAMES = /\b(Dev Sharma|Asha|Ben|Chris)\b/i;

test.skip(!TOKEN, 'CSM_TOKEN missing from .env.test');

async function start(page) {
  await page.addInitScript((keys) => {
    try { keys.forEach((k) => localStorage.setItem(k, '1')); } catch { /* storage blocked */ }
  }, EXTRA_TOUR_KEYS);
  const w = watch(page);
  await login(page, TOKEN);
  return w;
}

const h1 = (page, name) => page.getByRole('heading', { level: 1, name, exact: true });
const hash = (page) => page.evaluate(() => location.hash);
const navLabels = (page) => page.locator('nav.nh-nav a.nh-nav__link')
  .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));

test.describe('v13.7.0 CSM persona', () => {
  test('shell: lands on Inbox, CSM-only nav, account search, bell + My Tasks badge', async ({ page }) => {
    const w = await start(page);
    await expect.poll(() => hash(page), { timeout: T }).toBe('#csm-inbox');
    await expect(h1(page, 'Inbox')).toBeVisible({ timeout: T });

    // Mogambo lockdown hides Inbox/Portfolio/Playbooks/Digest; no lead-side items.
    expect(await navLabels(page)).toEqual(['My Tasks', 'Calendar', 'My Settings', 'Help', 'Send Feedback']);

    // Topbar: CSM gets no New Lead, Ask AI or Sync Salesforce.
    await expect(page.getByRole('button', { name: 'New Lead' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ask AI' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sync Salesforce' })).toHaveCount(0);

    // Search: accounts placeholder, dropdown opens (results or "No results found.").
    const search = page.locator('#nh-search-input');
    await expect(search).toHaveAttribute('placeholder', 'Search accounts...');
    await search.fill('ac');
    await expect(page.getByRole('listbox', { name: 'Search results' })).toBeVisible({ timeout: T });
    await search.fill('');
    await expect(page.getByRole('listbox', { name: 'Search results' })).toHaveCount(0);

    // Bell: v13.7.0 layout, and the sidebar badge equals its "Approvals waiting" count.
    await page.locator('#nh-notification-bell-btn').click();
    const bell = page.getByRole('dialog').filter({ hasText: 'Notifications' });
    await expect(bell).toBeVisible();
    await expect(bell.getByText("You're all caught up")
      .or(bell.getByText(/^(Approvals waiting|Replies|Due tasks)$/)).first()).toBeVisible({ timeout: T });
    const approvalsLabel = bell.getByText('Approvals waiting', { exact: true });
    const bellApprovals = await approvalsLabel.count()
      ? Number(await approvalsLabel.locator('xpath=following-sibling::span[1]').innerText()) : 0;
    const badge = page.locator('nav.nh-nav a[aria-label="My Tasks"] .nh-nav__badge');
    const badgeCount = await badge.count() ? Number(await badge.innerText()) : 0;
    expect(badgeCount, 'My Tasks badge vs bell Approvals waiting').toBe(bellApprovals);
    if (badgeCount) await expect(badge).toHaveAttribute('title', `${badgeCount} approvals waiting for you`);
    await shot(page, 'v13-7-0-csm-shell-bell');
    await page.keyboard.press('Escape');
    await expect(bell).toBeHidden();

    expectClean(w.problems(), 'csm shell');
  });

  test('CSM Inbox: at-risk queue renders, row opens Account 360 and back', async ({ page }) => {
    const w = await start(page);
    await go(page, '#csm-inbox');
    await expect(h1(page, 'Inbox')).toBeVisible({ timeout: T });
    await expect(page.getByText('Accounts that need you today — worst health first.')).toBeVisible();
    const rows = page.locator('.csm-portal-hub tbody tr');
    await expect(rows.first()
      .or(page.getByText('Nothing at risk right now'))
      .or(page.getByText('No accounts assigned to you yet'))
      .or(page.getByText('Failed to load the inbox.')).first()).toBeVisible({ timeout: T });
    await expect(page.getByText('Failed to load the inbox.')).toHaveCount(0);
    await shot(page, 'v13-7-0-csm-inbox');

    if (await rows.count()) {
      const name = (await rows.first().locator('td').first().innerText()).trim();
      await rows.first().click();
      await expect(h1(page, name)).toBeVisible({ timeout: T });
      await expect(page.getByText('Health score')).toBeVisible();
      await expect(page.getByText('Failed to load this account.')).toHaveCount(0);
      await shot(page, 'v13-7-0-csm-inbox-account360');
      await page.getByRole('button', { name: 'Back' }).click();
      await expect(h1(page, 'Inbox')).toBeVisible();
    }
    expectClean(w.problems(), 'csm inbox');
  });

  test('CSM Portfolio: health donut, search, tier filter, Account 360', async ({ page }) => {
    const w = await start(page);
    await go(page, '#csm-portfolio');
    await expect(h1(page, 'Portfolio')).toBeVisible({ timeout: T });
    const rows = page.locator('.csm-portal-hub tbody tr');
    await expect(rows.first()
      .or(page.getByText('No accounts assigned to you yet'))
      .or(page.getByText('Failed to load the portfolio.')).first()).toBeVisible({ timeout: T });
    await expect(page.getByText('Failed to load the portfolio.')).toHaveCount(0);
    // Not an admin: no multi-CSM filter, no bulk-assign checkboxes.
    await expect(page.getByRole('button', { name: 'Filter by CSM' })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /^Select / })).toHaveCount(0);
    await shot(page, 'v13-7-0-csm-portfolio');

    if (await rows.count()) {
      await expect(page.getByText('Portfolio health')).toBeVisible();
      const search = page.getByRole('textbox', { name: 'Search accounts', exact: true });
      await search.fill('zzzz-no-such-account');
      await expect(page.getByText('No accounts match these filters')).toBeVisible();
      await search.fill('');
      await expect(rows.first()).toBeVisible();

      for (const tier of ['Critical', 'At Risk', 'Healthy', 'All tiers']) {
        await page.getByRole('button', { name: 'Filter by health tier' }).click();
        await page.getByRole('menuitem', { name: tier, exact: true }).click();
        await expect(rows.first().or(page.getByText('No accounts match these filters')).first()).toBeVisible();
      }

      const name = (await rows.first().locator('td').first().innerText()).trim();
      await rows.first().click();
      await expect(h1(page, name)).toBeVisible({ timeout: T });
      await expect(page.getByText('Health score')).toBeVisible();
      await shot(page, 'v13-7-0-csm-portfolio-account360');
      await page.getByRole('button', { name: 'Back' }).click();
      await expect(h1(page, 'Portfolio')).toBeVisible();
    }
    expectClean(w.problems(), 'csm portfolio');
  });

  test('CSM Playbooks renders', async ({ page }) => {
    const w = await start(page);
    await go(page, '#csm-playbooks');
    await expect(h1(page, 'Playbooks')).toBeVisible({ timeout: T });
    await expect(page.getByText('Plays worth acting on across your accounts.')).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page.getByText('Failed to load playbooks.')).toHaveCount(0);
    await shot(page, 'v13-7-0-csm-playbooks');
    expectClean(w.problems(), 'csm playbooks');
  });

  test('CSM Digest renders', async ({ page }) => {
    const w = await start(page);
    await go(page, '#csm-digest');
    await expect(h1(page, 'Digest')).toBeVisible({ timeout: T });
    await expect(page.getByText('Your weekly roll-up.')).toBeVisible();
    await expect(page.getByText('Estimated time saved')
      .or(page.getByText('Failed to load the digest.')).first()).toBeVisible({ timeout: T });
    await expect(page.getByText('Failed to load the digest.')).toHaveCount(0);
    await shot(page, 'v13-7-0-csm-digest');
    expectClean(w.problems(), 'csm digest');
  });

  test('My Tasks: Approvals / To do / Done tabs, deep link, search, bell', async ({ page }) => {
    const w = await start(page);
    await go(page, '#my-tasks/approvals');
    await expect(h1(page, 'My Tasks')).toBeVisible({ timeout: T });
    const tab = (k) => page.locator(`.my-tasks-hub button[data-tab="${k}"]`);
    await expect(tab('approvals')).toHaveClass(/border-blue-600/);
    const list = page.locator('.my-tasks-hub [data-tour="task-list"]');
    await expect(list.getByText('Waiting for you to send').or(list.getByText('No approvals waiting')).first())
      .toBeVisible({ timeout: T });
    // Fresh drafts read "Due in …", never "Overdue" (only checkable if the CSM has approvals).
    if (await list.getByText('Waiting for you to send').count()) {
      const overdue = await list.getByText(/^Overdue by /).count();
      if (overdue) test.info().annotations.push({ type: 'check', description: `${overdue} approval(s) show "Overdue" — confirm they are not fresh drafts` });
    }
    await shot(page, 'v13-7-0-csm-my-tasks-approvals');

    await tab('todo').click();
    await expect(tab('todo')).toHaveClass(/border-blue-600/);
    await expect(list.getByText(/^(Overdue|Due today|Upcoming|No due date|Snoozed)\b/).first()
      .or(list.getByText('Nothing to do right now')).first()).toBeVisible({ timeout: T });
    await shot(page, 'v13-7-0-csm-my-tasks-todo');

    await tab('done').click();
    await expect(tab('done')).toHaveClass(/border-blue-600/);
    await expect(list.locator('.p-0').or(list.getByText('Nothing completed yet')).first()).toBeVisible({ timeout: T });
    await shot(page, 'v13-7-0-csm-my-tasks-done');

    const search = page.getByRole('textbox', { name: 'Search tasks', exact: true });
    await search.fill('zzzz-no-such-task');
    await expect(list.getByText('No completed tasks match your search')).toBeVisible();
    await search.fill('');

    // Bell opens with the v13.7.0 layout and closes.
    await page.locator('#nh-notification-bell-btn').click();
    const bell = page.getByRole('dialog').filter({ hasText: 'Notifications' });
    await expect(bell).toBeVisible();
    await expect(bell.getByText("You're all caught up")
      .or(bell.getByText(/^(Approvals waiting|Replies|Due tasks)$/)).first()).toBeVisible({ timeout: T });
    await expect(bell.getByRole('button', { name: 'Open My Tasks' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(bell).toBeHidden();

    expectClean(w.problems(), 'csm my-tasks');
  });

  test('Calendar: Day / Week / Month switch, Today, prev/next', async ({ page }) => {
    const w = await start(page);
    await go(page, '#calendar');
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible({ timeout: T });
    await expect(page.getByText(/\d+ meetings? scheduled/)).toBeVisible({ timeout: T });
    for (const m of ['day', 'week', 'month']) {
      await page.getByRole('button', { name: new RegExp(`^${m}$`, 'i') }).click();
      await expect(page.getByRole('button', { name: new RegExp(`^${m}$`, 'i') })).toHaveClass(/bg-indigo-600/);
    }
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeDisabled();
    await shot(page, 'v13-7-0-csm-calendar');
    expectClean(w.problems(), 'csm calendar');
  });

  test('My Settings: Email Sync, Dialer, Email Sign-off cards (view only)', async ({ page }) => {
    const w = await start(page);
    await go(page, '#my-settings');
    await expect(h1(page, 'My Settings')).toBeVisible({ timeout: T });
    await expect(page.getByText('Send and receive lead email from your own mailbox')).toBeVisible({ timeout: T });
    await expect(page.getByText('Make calls directly from Alternate CRM')).toBeVisible();
    await expect(page.getByText('Email Sign-off')).toBeVisible();
    // Signature editor present; its button reads "Saved" or "Save Signature" depending on whether the rich
    // editor normalised the empty value on mount (not a v13.8 change). Existence only — never clicked.
    await expect(page.getByRole('button', { name: /^(Saved|Save Signature)$/ })).toBeVisible();
    await shot(page, 'v13-7-0-csm-my-settings');
    expectClean(w.problems(), 'csm my-settings');
  });

  test('Help: latest release is v13.7.0, guide search works', async ({ page }) => {
    const w = await start(page);
    await go(page, '#user-guide');
    await expect(h1(page, 'Help & User Guide')).toBeVisible({ timeout: T });
    await page.getByRole('button', { name: /What's New — Release Notes/ }).click();
    const versions = page.locator('.helphub strong').filter({ hasText: /^v\d+\.\d+\.\d+$/ });
    await expect(versions.first()).toHaveText(`v${APP_VERSION}`);
    await expect(page.getByText('My Tasks and approvals, redone').first()).toBeVisible();
    await shot(page, 'v13-7-0-csm-help');

    await page.getByPlaceholder('Search the guide...').fill('approvals, redone');
    await expect(page.getByText('My Tasks and approvals, redone').first()).toBeVisible();
    await page.getByPlaceholder('Search the guide...').fill('');
    expectClean(w.problems(), 'csm help');
  });

  test('Lead detail (if any lead is visible to CSM): cards, Enroll picker, Message panel, no dial', async ({ page, request }) => {
    const { status, body } = await api(request, 'GET', '/api/leads?page=1&limit=25', TOKEN);
    const leads = Array.isArray(body) ? body : (body?.leads || []);
    const lead = leads.find((l) => !FORBIDDEN_LEADS.has(l.id)
      && !FORBIDDEN_NAMES.test(`${l.first_name || ''} ${l.last_name || ''} ${l.name || ''}`));
    test.skip(!lead, `CSM sees no usable lead (GET /api/leads → ${status}, ${leads.length} rows) — leads are SDR/AE-owned`);

    const dialRequests = [];
    page.on('request', (r) => { if (/\/(calls?\/start|dial)\b/i.test(r.url())) dialRequests.push(`${r.method()} ${r.url()}`); });
    const w = await start(page);
    await go(page, `#lead-detail/${lead.id}`);
    await expect(page.getByText('Quick Actions', { exact: true })).toBeVisible({ timeout: T });
    for (const card of ['Lead Summary', 'Tasks', 'Emails', 'Notes', 'Activity', 'Status History']) {
      await expect(page.getByText(card, { exact: true }).first(), `card ${card}`).toBeVisible();
    }
    await shot(page, 'v13-7-0-csm-lead-detail');

    const enroll = page.getByRole('button', { name: 'Enroll in Cadence' });
    if (await enroll.count()) {
      await enroll.click();
      const menu = page.getByRole('menu');
      await expect(menu.getByRole('menuitem').first().or(menu.getByText('No published cadences yet.')).first())
        .toBeVisible({ timeout: T });
      await shot(page, 'v13-7-0-csm-lead-detail-enroll-picker');
      await page.keyboard.press('Escape'); // never enroll
      await expect(menu).toBeHidden();
    } else {
      test.info().annotations.push({ type: 'info', description: 'No "Enroll in Cadence" for CSM on this lead (canModify false)' });
    }

    const message = page.getByRole('button', { name: 'Message', exact: true });
    if (await message.count()) {
      await message.click();
      const panel = page.locator('[aria-label="Communication widget"]');
      await expect(panel).toHaveClass(/opacity-100/, { timeout: T });
      const msgTab = panel.getByRole('tab', { name: 'Message' });
      if (await msgTab.count()) await expect(msgTab).toHaveAttribute('aria-selected', 'true');
      await shot(page, 'v13-7-0-csm-lead-detail-message-panel');
      await panel.getByRole('button', { name: 'Close widget' }).click();
    } else {
      test.info().annotations.push({ type: 'info', description: 'No Message action (no SMS/WhatsApp capability or canModify false)' });
    }
    expect(dialRequests, 'no call/dial request may fire').toEqual([]);
    expectClean(w.problems(), 'csm lead-detail');
  });

  test('gates: admin-only legacy routes show Access Denied', async ({ page }) => {
    const w = await start(page);
    for (const h of ['#analytics', '#digest', '#activity-monitor', '#pods', '#playground', '#settings', '#admin',
      '#disqualify-requests', '#upload', '#audit-logs']) {
      await go(page, h);
      await expect(page.getByRole('heading', { name: /Access Denied/ }), h).toBeVisible({ timeout: T });
    }
    await shot(page, 'v13-7-0-csm-gate-access-denied');
    expectClean(w.problems(), 'csm access-denied gates');
  });

  test('gates: Control Center / AE Pipeline / Pipeline hub redirect to #dashboard', async ({ page }) => {
    const w = await start(page);
    for (const [h, heading] of [['#control-center', 'Control Center'], ['#ae-pipeline', 'AE Pipeline'], ['#pipeline-hub', 'AE Pipeline']]) {
      await go(page, h);
      // The shell leaves the typed hash in the URL while rendering the fallback view; assert the gated page
      // never renders (the poll lets the redirect settle).
      await expect.poll(async () => h1(page, heading).count(), { message: h, timeout: T }).toBe(0);
      await page.waitForTimeout(1500);
      await expect(h1(page, heading), h).toHaveCount(0);
      await go(page, '#csm-inbox'); // reset so the next hash is a real change
    }
    await shot(page, 'v13-7-0-csm-gate-redirects');
    expectClean(w.problems(), 'csm redirect gates');
  });

  test('gates: nav-only items absent (Dashboard, Leads, Sales Tools, Leaderboard, Power Dialer, ...)', async ({ page }) => {
    const w = await start(page);
    const labels = await navLabels(page);
    for (const absent of ['Dashboard', 'Leads', 'Sales Tools', 'Leaderboard', 'Power Dialer', 'Analytics Hub',
      'Daily Digest', 'POD Management', 'Activity Monitor', 'Playground', 'Control Center', 'AE Pipeline',
      'Pipeline & CSM', 'Inbox', 'Portfolio', 'Playbooks', 'Digest']) {
      expect(labels, `nav must not show ${absent}`).not.toContain(absent);
    }
    // These are nav-only gates (no route guard in app.js) — record, don't fail, what a direct hash shows.
    for (const h of ['#dashboard', '#leads', '#sales-tools', '#leaderboard', '#my-calls']) {
      await go(page, h);
      const shown = (await page.locator('h1').first().innerText().catch(() => '')).trim();
      test.info().annotations.push({ type: 'nav-only gate', description: `${h} → h1 "${shown}"` });
    }
    await shot(page, 'v13-7-0-csm-gate-nav-only');
    expectClean(w.problems(), 'csm nav-only gates');
  });
});
