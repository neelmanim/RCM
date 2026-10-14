// v13.7.0 close-out audit — SDR persona (Dev Kapoor, SDR_DEVKAPOOR_TOKEN).
// STAGING ONLY (the shared harness refuses any other host). Read-only: never
// sends, never calls/dials, never enrolls, never saves settings, never opens
// the demo leads. Every test logs in fresh and ends with expectClean().
//   npx playwright test tests/v13-7-0-persona-sdr.spec.js
const { test, expect } = require('@playwright/test');
const { APP_VERSION, PERSONAS, watch, login, go, shot, api, expectClean } = require('./helpers/v13-7-0-staging');

const TOKEN = PERSONAS.sdr.token;
const DEMO_LEADS = new Set([
  'bf9c2e97-c3a8-4bf4-a629-7d1e6e2fce2c', 'fcac0d6e-dbfa-43dd-accd-c96a76735a6b',
  'd8b575b1-9a81-47bb-abcb-dd7485f218bf', '6b0d4ca1-af4e-44cb-a5cb-ae1bfc5169b0',
]);
const DEMO_NAMES = /Dev Sharma|\bAsha\b|\bBen\b|\bChris\b/i;
const DEMO_CADENCES = new Set(['df23f37b-d5c1-478b-940d-401adb2f7739', '20bea580-b7b3-436d-a4be-caa0357b6d3b']);

const SDR_NAV = ['Dashboard', 'My Tasks', 'Leads', 'Sales Tools', 'Leaderboard', 'Analytics Hub',
  'Calendar', 'Power Dialer', 'My Settings', 'Help', 'Send Feedback'];
const ACCESS_DENIED = ['digest', 'activity-monitor', 'pods', 'playground', 'settings', 'admin',
  'disqualify-requests', 'upload', 'audit-logs'];
// route -> what it would render if the gate failed
const h1 = (name) => (page) => page.getByRole('heading', { name, exact: true, level: 1 });
const REDIRECTS = {
  'control-center': h1('Control Center'), 'ae-pipeline': h1('AE Pipeline'),
  'pipeline-hub': (page) => page.getByRole('button', { name: 'CSM Portal' }),
  'csm-inbox': h1('Inbox'), 'csm-portfolio': h1('Portfolio'), 'csm-playbooks': h1('Playbooks'), 'csm-digest': h1('Digest'),
};

// Any mutating API call that would place a call, send, enroll or sync — the
// spec must never trigger one. Recorded, then asserted empty.
const RISKY = /\/calls\/start|\/leads\/[^/]+\/calls\b|\/calls\/[^/]+\/action|\/dialer\/(test|playground)|\/send\b|\/enroll|\/sync\b/;

test.skip(!TOKEN, 'SDR_DEVKAPOOR_TOKEN missing from .env.test');

async function start(page) {
  const w = watch(page);
  const risky = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && RISKY.test(r.url())) risky.push(`${r.method()} ${r.url()}`);
  });
  await login(page, TOKEN);
  return { w, risky };
}

function finish(ctx, where) {
  expect(ctx.risky, `${where}: call/send/enroll request fired`).toEqual([]);
  expectClean(ctx.w.problems(), where);
}

const navLinks = (page) => page.locator('aside.nh-sidebar nav a.nh-nav__link');

async function safeLead(request) {
  const r = await api(request, 'GET', '/api/leads?per_page=50', TOKEN);
  expect(r.status, 'GET /api/leads as SDR').toBe(200);
  const rows = Array.isArray(r.body) ? r.body : (r.body?.data || []);
  return rows.find((l) => !DEMO_LEADS.has(l.id) && !DEMO_NAMES.test(`${l.first_name || ''} ${l.last_name || ''}`));
}

test.describe('v13.7.0 SDR persona', () => {
  test('shell: sidebar items, search, bell, My Tasks badge, topbar buttons', async ({ page, request }) => {
    const ctx = await start(page);
    await go(page, '#dashboard');

    await expect(navLinks(page).first()).toBeVisible();
    const labels = await navLinks(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(labels).toEqual(SDR_NAV);

    // Topbar: no Ask AI / Sync Salesforce for SDR; New Lead opens + cancels.
    await expect(page.getByRole('button', { name: 'Ask AI' })).toHaveCount(0);
    await expect(page.locator('#nh-sync-sf-btn')).toHaveCount(0);
    await page.locator('#nh-new-lead-btn').click();
    await expect(page.locator('#new-lead-modal')).toBeVisible();
    await page.locator('#new-lead-modal .close-modal-btn').click();
    await expect(page.locator('#new-lead-modal')).toBeHidden();

    // Global search with a real lead name.
    const lead = await safeLead(request);
    const q = (lead?.last_name || lead?.first_name || 'test').slice(0, 6);
    await page.locator('#nh-search-input').fill(q);
    await expect(page.getByRole('listbox', { name: 'Search results' })).toBeVisible({ timeout: 15000 });
    await page.locator('#nh-search-input').press('Escape');
    await expect(page.getByRole('listbox', { name: 'Search results' })).toHaveCount(0);

    // Bell (v13.7.0 layout) opens, and its Approvals count matches the nav badge.
    await page.locator('#nh-notification-bell-btn').click();
    const pop = page.locator('[data-radix-popper-content-wrapper]').filter({ hasText: 'Open My Tasks' });
    await expect(pop).toBeVisible();
    await expect(pop.getByText('Notifications', { exact: true })).toBeVisible();
    await expect(pop.getByText(/^(You're all caught up|Approvals waiting|Replies|Due tasks)$/).first()).toBeVisible();
    const approvalsLabel = pop.getByText('Approvals waiting', { exact: true });
    const badge = page.locator('aside.nh-sidebar .nh-nav__badge[title$="approvals waiting for you"]');
    if (await approvalsLabel.count()) {
      const n = (await approvalsLabel.locator('xpath=following-sibling::*[1]').innerText()).trim();
      await expect(badge).toHaveText(n);
    } else {
      await expect(badge).toHaveCount(0);
    }
    await shot(page, 'v13-7-0-sdr-shell-bell');
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);

    finish(ctx, 'shell');
  });

  test('dashboard: own KPIs render', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#dashboard');
    await expect(page.locator('h1.db-page-title', { hasText: 'Dashboard' })).toBeVisible();
    for (const k of ['Assigned to me', 'Given today', 'Not yet called', 'Calls today', 'Calling stage', 'Meetings+']) {   // v13.9.5 rep cards
      await expect(page.locator('[data-stat-label]', { hasText: k }).first()).toBeVisible({ timeout: 30000 });
    }
    await shot(page, 'v13-7-0-sdr-dashboard');
    finish(ctx, 'dashboard');
  });

  test('my tasks: Approvals / To do / Done tabs, deep link, search', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#my-tasks/approvals');
    const hub = page.locator('.my-tasks-hub');
    await expect(hub.getByRole('heading', { name: 'My Tasks', level: 1 })).toBeVisible();
    await expect(hub.getByText(/^(Waiting for you to send|No approvals waiting)/).first()).toBeVisible({ timeout: 20000 });

    // Approval rows: fresh drafts should read "Due in …", not "Overdue". Older
    // drafts can be legitimately overdue, so record rather than fail.
    const overdue = await hub.locator('[data-tour="task-list"]').getByText(/^Overdue/).count();
    if (overdue) test.info().annotations.push({ type: 'approvals-overdue', description: `${overdue} approval row(s) show Overdue — check they are genuinely old` });
    await shot(page, 'v13-7-0-sdr-my-tasks-approvals');

    await hub.locator('button[data-tab="todo"]').click();
    await expect(hub.getByText(/^(Overdue|Due today|Upcoming|No due date|Snoozed|Nothing to do right now)/).first()).toBeVisible();
    await shot(page, 'v13-7-0-sdr-my-tasks-todo');

    await hub.locator('button[data-tab="done"]').click();
    await expect(hub.getByText(/^Nothing completed yet$/).or(hub.locator('[data-tour="task-list"] .p-0')).first()).toBeVisible({ timeout: 20000 });
    await hub.getByLabel('Search tasks').fill('zzzz-no-such-task');
    await expect(hub.getByText('No completed tasks match your search')).toBeVisible();
    await hub.getByLabel('Search tasks').fill('');
    await shot(page, 'v13-7-0-sdr-my-tasks-done');

    finish(ctx, 'my-tasks');
  });

  test('leads: list, search, filter, open a non-demo lead', async ({ page, request }) => {
    const ctx = await start(page);
    await go(page, '#leads');
    await expect(page.getByRole('heading', { name: 'All Leads', level: 1 })).toBeVisible();
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 20000 });

    const lead = await safeLead(request);
    const search = page.getByPlaceholder('Search name, email, or company…');
    if (lead) {
      await search.fill(lead.last_name || lead.first_name);
      await expect(rows.first()).toBeVisible({ timeout: 15000 });
      await search.fill('');
    }

    // Add a Status filter, toggle one value, then clear.
    await page.getByRole('button', { name: '+ Filter' }).click();
    await page.getByRole('menuitem', { name: 'Status' }).click();
    await page.locator('[data-radix-popper-content-wrapper]').getByRole('button', { name: 'Calling', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByRole('button', { name: 'Clear all' })).toHaveCount(0);
    await shot(page, 'v13-7-0-sdr-leads');

    // Grouped by company: group-header rows have one cell (clicking one only collapses the group).
    await rows.filter({ has: page.locator('td:nth-child(2)') }).filter({ hasNotText: DEMO_NAMES }).first().locator('td').first().click();
    await expect(page).toHaveURL(/#lead-detail\//);
    await expect(page.getByText('Quick Actions', { exact: true })).toBeVisible({ timeout: 20000 });
    const id = page.url().split('#lead-detail/')[1];
    expect(DEMO_LEADS.has(id), 'opened a demo lead').toBe(false);
    finish(ctx, 'leads');
  });

  test('lead detail: cards, Quick Actions, Enroll picker, Message panel, purple button', async ({ page, request }) => {
    const lead = await safeLead(request);
    test.skip(!lead, 'no non-demo lead visible to this SDR');
    const ctx = await start(page);
    await go(page, `#lead-detail/${lead.id}`);
    await expect(page.getByText('Quick Actions', { exact: true })).toBeVisible({ timeout: 25000 });
    await expect(page.locator('.leaddetailhub h1').first()).toBeVisible();

    for (const h of ['Lead Summary', 'Contact', 'Pre-Call Intelligence', 'Activity', 'Emails', 'Tasks',
      'Quick Actions', 'Call Strategy', 'Notes', 'Status History']) {
      await expect(page.getByRole('heading', { name: h, exact: true }).first(), `card ${h}`).toBeVisible();
    }
    // Quick Actions present — none of these are clicked except Enroll/Message.
    for (const b of ['Call', 'Send Email', 'Add Task', 'Add Note', 'Enroll in Cadence', 'Disqualify Lead', 'Mark Opted Out']) {
      await expect(page.getByRole('button', { name: b, exact: true }).first(), `action ${b}`).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Delete Lead', exact: true })).toHaveCount(0);

    // Enroll in Cadence (role-widened in v13.7.0): picker opens, nothing enrolled.
    await page.getByRole('button', { name: 'Enroll in Cadence', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem').first().or(menu.getByText('No published cadences yet.'))).toBeVisible({ timeout: 15000 });
    await shot(page, 'v13-7-0-sdr-lead-enroll-picker');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    // Message opens the Alternate Messenger panel on the Message tab — no dial.
    const widget = page.getByRole('dialog', { name: 'Communication widget', includeHidden: true });
    const message = page.getByRole('button', { name: 'Message', exact: true });
    if (await message.count()) {
      await message.click();
      await expect(widget).toHaveAttribute('aria-hidden', 'false');
      const tab = widget.getByRole('tab', { name: 'Message' });
      if (await tab.count()) await expect(tab).toHaveAttribute('aria-selected', 'true');
      await shot(page, 'v13-7-0-sdr-lead-message-panel');
      await widget.getByRole('button', { name: 'Close widget' }).click();
      await expect(widget).toHaveAttribute('aria-hidden', 'true');
    } else {
      test.info().annotations.push({ type: 'no-message', description: 'Message hidden: SDR has no SMS/WhatsApp capability' });
    }

    // Purple button (FAB) with a lead open: opens the panel, never dials.
    const fab = page.getByRole('button', { name: 'Open Alternate Messenger' });
    if (await fab.isVisible().catch(() => false)) {
      await fab.click();
      await expect(widget).toHaveAttribute('aria-hidden', 'false');
      await page.waitForTimeout(1500);
      await shot(page, 'v13-7-0-sdr-lead-fab-panel');
      await widget.getByRole('button', { name: 'Close widget' }).click();
    } else {
      test.info().annotations.push({ type: 'no-fab', description: 'Alternate Messenger FAB not shown (widget not initialised for this SDR)' });
    }
    await shot(page, 'v13-7-0-sdr-lead-detail');
    finish(ctx, 'lead-detail');
  });

  test('sales tools: Cadence / Email / SMS tabs, open a non-demo cadence', async ({ page, request }) => {
    const ctx = await start(page);
    await go(page, '#sales-tools');
    const hub = page.locator('.salestools-hub');
    await expect(hub.getByRole('heading', { name: 'Sales Tools', level: 1 })).toBeVisible();
    await expect(hub.getByRole('heading', { name: 'Sales Cadences' })).toBeVisible({ timeout: 20000 });
    const statusFilter = hub.getByLabel('Filter by status');
    if (await statusFilter.count()) {
      await statusFilter.click();
      await page.getByRole('menuitem', { name: 'Active', exact: true }).click();
    }
    await shot(page, 'v13-7-0-sdr-sales-tools-cadence');

    await hub.getByRole('button', { name: 'Email Campaigns' }).click();
    await expect(hub.getByRole('button', { name: 'Templates', exact: true })).toBeVisible({ timeout: 15000 });
    await hub.getByRole('button', { name: 'Templates', exact: true }).click();
    await shot(page, 'v13-7-0-sdr-sales-tools-email');

    await hub.getByRole('button', { name: 'SMS Campaigns' }).click();
    await expect(hub.getByRole('button', { name: 'Inbox' })).toBeVisible();
    await shot(page, 'v13-7-0-sdr-sales-tools-sms');

    // Open a live, non-demo cadence (QA v13.7 preferred) read-only: Builder + Reporting.
    const r = await api(request, 'GET', '/api/journeys', TOKEN);
    expect(r.status, 'GET /api/journeys as SDR').toBe(200);
    const live = (r.body || []).filter((j) => ['active', 'paused'].includes(j.status)
      && !DEMO_CADENCES.has(j.id) && !/demo/i.test(j.name || ''));
    const j = live.find((x) => /QA v13\.7/i.test(x.name)) || live[0];
    if (j) {
      await go(page, `#sales-tools/${j.id}`);
      await expect(page.locator('button[data-tab="builder"]')).toBeVisible({ timeout: 20000 });
      await page.locator('button[data-tab="reporting"]').click();
      await expect(page.getByText('Enrolled leads').or(page.getByText('Rep performance')).first()).toBeVisible({ timeout: 20000 });
      await shot(page, 'v13-7-0-sdr-sales-tools-cadence-reporting');
    } else {
      test.info().annotations.push({ type: 'no-cadence', description: 'no active/paused non-demo cadence to open' });
    }
    finish(ctx, 'sales-tools');
  });

  test('leaderboard: SDRs / AEs tabs, others locked', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#leaderboard');
    const hub = page.locator('.leaderboard-hub');
    await expect(hub.getByRole('heading', { name: 'Leaderboard', level: 1 })).toBeVisible();
    // An SDR sees the SDR board only (no SDR/AE switcher); roles that get the switcher are checked below if present.
    if (await hub.locator('button[data-tab="ae"]').count()) {
      await hub.locator('button[data-tab="ae"]').click();
      await expect(hub.getByText(/^AE performance/)).toBeVisible();
      await hub.locator('button[data-tab="sdr"]').click();
    }
    await expect(hub.getByText(/^SDR performance/)).toBeVisible();
    const locked = await hub.locator('[title="You can only view your own performance"]').count();
    if (!locked) test.info().annotations.push({ type: 'no-locked-rows', description: 'no other-rep rows to check the lock on' });
    await shot(page, 'v13-7-0-sdr-leaderboard');
    finish(ctx, 'leaderboard');
  });

  test('analytics: self-scoped, no Ask AI / Reports, no pod picker', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#analytics');
    await expect(page.getByRole('heading', { name: 'Analytics Hub', level: 1 })).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#ah-tab-dashboard')).toBeVisible();
    await expect(page.locator('#ah-tab-ask-ai')).toHaveCount(0);
    await expect(page.locator('#ah-tab-reports')).toHaveCount(0);
    await expect(page.getByText('① POD')).toHaveCount(0);
    await expect(page.getByText('Date Range').first()).toBeVisible();
    await shot(page, 'v13-7-0-sdr-analytics');
    finish(ctx, 'analytics');
  });

  test('calendar: Month / Week / Day switch', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#calendar');
    await expect(page.getByRole('button', { name: 'Today' })).toBeVisible({ timeout: 20000 });
    for (const m of ['week', 'day', 'month']) {
      await page.getByRole('button', { name: new RegExp(`^${m}$`, 'i') }).click();
      await page.waitForTimeout(500);
    }
    await shot(page, 'v13-7-0-sdr-calendar');
    finish(ctx, 'calendar');
  });

  test('power dialer: queue + today stats render, never dial', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#my-calls');
    const hub = page.locator('.powerdialerhub');
    await expect(hub.getByRole('heading', { name: 'Power Dialer', level: 1 })).toBeVisible({ timeout: 20000 });
    await expect(hub.getByText("Today's Calls")).toBeVisible({ timeout: 20000 });
    for (const s of ['Total', 'Connected', 'Voicemail', 'Callback', 'Meeting']) {
      await expect(hub.getByText(s, { exact: true }).first(), `stat ${s}`).toBeVisible();
    }
    await expect(hub.getByText('Sequence:')).toBeVisible();
    await shot(page, 'v13-7-0-sdr-power-dialer');
    finish(ctx, 'power-dialer');
  });

  test('my settings: Email Sync / Dialer / Signature cards (no save)', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#my-settings');
    await expect(page.getByRole('heading', { name: 'My Settings', level: 1 })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Send and receive lead email from your own mailbox')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Make calls directly from Alternate CRM')).toBeVisible();
    await expect(page.getByText(/What gets added to the foot of every email you send/)).toBeVisible();
    await shot(page, 'v13-7-0-sdr-my-settings');
    finish(ctx, 'my-settings');
  });

  test('help: latest release is v13.7.0, search works', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#user-guide');
    const hub = page.locator('.helphub');
    await expect(hub.getByRole('heading', { name: 'Help & User Guide', level: 1 })).toBeVisible();
    await hub.getByRole('button', { name: /What's New — Release Notes/ }).click();
    await expect(hub.locator('.helphub-content strong').first()).toHaveText(`v${APP_VERSION}`);
    await expect(hub.getByText('My Tasks and approvals, redone').first()).toBeVisible();
    await shot(page, 'v13-7-0-sdr-help');
    await hub.getByPlaceholder('Search the guide...').fill('cadence');
    await expect(hub.locator('.helphub-content').first()).toBeVisible();
    finish(ctx, 'help');
  });

  test('role gates: admin-only routes show Access Denied, not in nav', async ({ page }) => {
    const ctx = await start(page);
    for (const v of ACCESS_DENIED) {
      await go(page, `#${v}`);
      await expect(page.locator('h2', { hasText: 'Access Denied' }), `#${v}`).toBeVisible();
    }
    const labels = await navLinks(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    for (const hidden of ['Daily Digest', 'Activity Monitor', 'POD Management', 'Playground', 'Control Center']) {
      expect(labels, `nav must not show ${hidden}`).not.toContain(hidden);
    }
    await shot(page, 'v13-7-0-sdr-gate-access-denied');
    finish(ctx, 'gates-access-denied');
  });

  test('role gates: control-center / pipeline / CSM routes redirect to dashboard', async ({ page }) => {
    const ctx = await start(page);
    for (const [v, target] of Object.entries(REDIRECTS)) {
      await go(page, '#leads');
      await go(page, `#${v}`);
      await expect(page.locator('h1.db-page-title', { hasText: 'Dashboard' }), `#${v} → dashboard`).toBeVisible();
      await expect(target(page), `#${v} rendered`).toHaveCount(0);
    }
    const labels = await navLinks(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    for (const hidden of ['AE Pipeline', 'Pipeline & CSM', 'Inbox', 'Portfolio', 'Playbooks', 'Digest']) {
      expect(labels, `nav must not show ${hidden}`).not.toContain(hidden);
    }
    await shot(page, 'v13-7-0-sdr-gate-redirects');
    finish(ctx, 'gates-redirects');
  });
});
