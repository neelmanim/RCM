// v13.7.0 close-out audit — Pod Admin persona (Amit Patel, POD_ADMIN_TOKEN),
// plus the same nav smoke for the demo Pod Admin (PA_TOKEN).
// STAGING ONLY (the shared harness refuses any other host). Read-only: never
// sends, never calls/dials, never enrolls, never saves settings, never opens
// the demo leads or demo cadences. Every test logs in fresh and ends with
// expectClean().
//   npx playwright test tests/v13-7-0-persona-pa.spec.js
const { test, expect } = require('@playwright/test');
const { APP_VERSION, PERSONAS, watch, login, go, shot, api, expectClean } = require('./helpers/v13-7-0-staging');

const TOKEN = PERSONAS.pa.token;
const DEMO_LEADS = new Set([
  'bf9c2e97-c3a8-4bf4-a629-7d1e6e2fce2c', 'fcac0d6e-dbfa-43dd-accd-c96a76735a6b',
  'd8b575b1-9a81-47bb-abcb-dd7485f218bf', '6b0d4ca1-af4e-44cb-a5cb-ae1bfc5169b0',
]);
const DEMO_NAMES = /Dev Sharma|\bAsha\b|\bBen\b|\bChris\b/i;
const DEMO_CADENCES = new Set(['df23f37b-d5c1-478b-940d-401adb2f7739', '20bea580-b7b3-436d-a4be-caa0357b6d3b']);

// NavSidebar.jsx NAV_ITEMS order, minus the mogambo-locked AE Pipeline /
// Pipeline & CSM / CSM items and the SDR/AE-only Power Dialer.
const PA_NAV = ['Dashboard', 'My Tasks', 'Daily Digest', 'Leads', 'Sales Tools', 'POD Management', 'Leaderboard',
  'Activity Monitor', 'Analytics Hub', 'Calendar', 'My Settings', 'Control Center', 'Help', 'Send Feedback'];
const NOT_IN_NAV = ['Playground', 'Power Dialer', 'AE Pipeline', 'Pipeline & CSM', 'Inbox', 'Portfolio', 'Playbooks', 'Digest'];
const ACCESS_DENIED = ['upload', 'audit-logs', 'playground']; // isSuperAdmin-only legacy routes (app.js)
const h1 = (name) => (page) => page.getByRole('heading', { name, exact: true, level: 1 });
// route -> what it would render if the gate failed (app.js loadView('dashboard') redirect;
// the hash itself stays put because _skipHashUpdate is set during hashchange).
const REDIRECTS = {
  'pipeline-hub': (page) => page.getByRole('button', { name: 'CSM Portal' }),
  'csm-inbox': h1('Inbox'), 'csm-portfolio': h1('Portfolio'), 'csm-playbooks': h1('Playbooks'), 'csm-digest': h1('Digest'),
};

// Any mutating API call that would place a call, send, enroll or sync.
const RISKY = /\/calls\/start|\/leads\/[^/]+\/calls\b|\/calls\/[^/]+\/action|\/dialer\/(test|playground)|\/send\b|\/enroll|\/sync\b/;

test.skip(!TOKEN, 'POD_ADMIN_TOKEN missing from .env.test');

async function start(page, token = TOKEN) {
  const w = watch(page);
  const risky = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && RISKY.test(r.url())) risky.push(`${r.method()} ${r.url()}`);
  });
  await login(page, token);
  return { w, risky };
}

function finish(ctx, where) {
  expect(ctx.risky, `${where}: call/send/enroll request fired`).toEqual([]);
  expectClean(ctx.w.problems(), where);
}

const navLinks = (page) => page.locator('aside.nh-sidebar nav a.nh-nav__link');
const tab = (page, key) => page.locator(`button[data-tab="${key}"]`);

async function safeLead(request) {
  const r = await api(request, 'GET', '/api/leads?per_page=50', TOKEN);
  expect(r.status, 'GET /api/leads as Pod Admin').toBe(200);
  const rows = Array.isArray(r.body) ? r.body : (r.body?.data || r.body?.leads || []);
  return rows.find((l) => !DEMO_LEADS.has(l.id) && !DEMO_NAMES.test(`${l.first_name || ''} ${l.last_name || ''}`));
}

async function navSmoke(page, token, label, shotName) {
  const ctx = await start(page, token);
  await go(page, '#dashboard');
  await expect(navLinks(page).first()).toBeVisible();
  const labels = await navLinks(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  expect(labels, `${label} sidebar`).toEqual(PA_NAV);
  for (const name of NOT_IN_NAV) expect(labels, `${label}: ${name} must be hidden`).not.toContain(name);
  // Topbar: Ask AI (admin) yes, Sync Salesforce (Super Admin) no, New Lead yes.
  await expect(page.getByRole('button', { name: 'Ask AI' })).toBeVisible();
  await expect(page.locator('#nh-sync-sf-btn')).toHaveCount(0);
  await expect(page.locator('#nh-new-lead-btn')).toBeVisible();
  await shot(page, shotName);
  finish(ctx, `${label} nav`);
}

test.describe('v13.7.0 Pod Admin persona', () => {
  test('shell: sidebar, search, bell, My Tasks badge, Ask AI, New Lead', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#dashboard');

    await expect(navLinks(page).first()).toBeVisible();
    const labels = await navLinks(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(labels).toEqual(PA_NAV);
    await expect(page.locator('#nh-sync-sf-btn')).toHaveCount(0);

    // Global search -> results dropdown (read only; Escape closes it).
    const search = page.locator('#nh-search-input');
    await expect(search).toHaveAttribute('placeholder', 'Search leads, phone, SDRs...');
    await search.fill('test');
    await expect(page.getByRole('listbox', { name: 'Search results' })).toBeVisible({ timeout: 15000 });
    await search.press('Escape');
    await search.fill('');

    // Bell: v13.7.0 layout — sections or the empty state; badge == Approvals waiting.
    await page.locator('#nh-notification-bell-btn').click();
    const caughtUp = page.getByText("You're all caught up", { exact: true });
    const sections = page.getByText(/^(Approvals waiting|Replies|Due tasks)$/);
    await expect(caughtUp.or(sections).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Open My Tasks' })).toBeVisible();
    const approvalsLabel = page.getByText('Approvals waiting', { exact: true });
    const bellApprovals = (await approvalsLabel.count())
      ? Number(await approvalsLabel.locator('xpath=following-sibling::*[1]').innerText()) : 0;
    await shot(page, 'v13-7-0-pa-bell');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open My Tasks' })).toHaveCount(0);

    const badge = page.locator('aside.nh-sidebar .nh-nav__badge[title$="approvals waiting for you"]');
    if (bellApprovals > 0) {
      await expect(badge).toHaveText(String(bellApprovals));
      await expect(badge).toHaveAttribute('title', `${bellApprovals} approvals waiting for you`);
    } else {
      await expect(badge).toHaveCount(0);
    }

    // Ask AI: open + close only, never submit.
    await page.locator('#nh-ask-ai-btn').click();
    await expect(page.getByRole('textbox', { name: 'AI query' })).toBeVisible();
    await page.locator('.nh-ai-overlay').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('textbox', { name: 'AI query' })).toHaveCount(0);

    // New Lead: open the modal, cancel — never Save Lead.
    await page.locator('#nh-new-lead-btn').click();
    const modal = page.locator('#new-lead-modal');
    await expect(modal.getByRole('heading', { name: 'Create New Lead' })).toBeVisible();
    await modal.locator('.close-modal-btn').click();
    await expect(modal).toBeHidden();

    await shot(page, 'v13-7-0-pa-shell');
    finish(ctx, 'shell');
  });

  test('nav smoke: demo Pod Admin (PA_TOKEN)', async ({ page }) => {
    test.skip(!PERSONAS.pa2.token, 'PA_TOKEN missing from .env.test');
    await navSmoke(page, PERSONAS.pa2.token, 'Pod Admin (demo)', 'v13-7-0-pa2-nav');
  });

  test('dashboard: pod-scoped KPIs load', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#dashboard');
    await expect(page.locator('h1.db-page-title')).toHaveText('Dashboard');
    await expect(page.locator('[data-stat-value]').first()).toBeVisible({ timeout: 30000 });   // v13.9.5: built on the component library
    await expect(page.getByText('Meetings booked', { exact: true })).toBeVisible();
    await shot(page, 'v13-7-0-pa-dashboard');
    finish(ctx, 'dashboard');
  });

  test('my tasks: Approvals / To do / Done tabs, deep link, search', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#my-tasks/approvals');
    await expect(h1('My Tasks')(page)).toBeVisible();
    const list = page.locator('[data-tour="task-list"]');
    await expect(tab(page, 'approvals')).toHaveClass(/border-blue-600/);
    await expect(list.getByText('Waiting for you to send', { exact: true })
      .or(list.getByText('No approvals waiting', { exact: true }))).toBeVisible({ timeout: 20000 });
    // Fresh drafts must read "Due in …"; record any Overdue (could be genuinely stale).
    const overdue = await list.getByText(/^Overdue/).count();
    if (overdue) test.info().annotations.push({ type: 'note', description: `${overdue} approval(s) show Overdue — check they are older than 24h` });
    await shot(page, 'v13-7-0-pa-my-tasks-approvals');

    await tab(page, 'todo').click();
    await expect(list.getByText(/^(Overdue|Due today|Upcoming|No due date|Snoozed|Nothing to do right now)$/).first())
      .toBeVisible({ timeout: 20000 });
    await shot(page, 'v13-7-0-pa-my-tasks-todo');

    await tab(page, 'done').click();
    await expect(page.getByText(/^Showing \d/).or(list.getByText('Nothing completed yet', { exact: true })))
      .toBeVisible({ timeout: 20000 });
    const next = page.getByRole('button', { name: 'Next' });
    if (await next.count() && await next.isEnabled()) {
      await next.click();
      await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();
    }
    await shot(page, 'v13-7-0-pa-my-tasks-done');

    await page.getByRole('textbox', { name: 'Search tasks' }).fill('zzqqxx-no-such-task');
    await expect(list.getByText('No completed tasks match your search', { exact: true })).toBeVisible();
    finish(ctx, 'my tasks');
  });

  test('daily digest: cards render, date change reloads', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#digest');
    await expect(page.getByRole('heading', { name: 'Daily Digest', level: 1 })).toBeVisible();
    for (const t of ['Pipeline flow', 'Notable events', 'SDR performance snapshot', 'Current pipeline snapshot']) {
      await expect(page.getByRole('heading', { name: t, exact: true })).toBeVisible({ timeout: 20000 });
    }
    await page.getByRole('button', { name: 'Digest date' }).click();
    const day = page.locator('.rdp-day_button:not([disabled])').first();
    await expect(day).toBeVisible();
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/admin/analytics/daily-digest'), { timeout: 20000 }),
      day.click(),
    ]);
    await expect(page.getByRole('heading', { name: 'Pipeline flow', exact: true })).toBeVisible({ timeout: 20000 });
    await shot(page, 'v13-7-0-pa-digest');
    finish(ctx, 'daily digest');
  });

  test('leads: list, search, filter apply/clear, open a row', async ({ page, request }) => {
    const ctx = await start(page);
    await go(page, '#leads');
    await expect(h1('All Leads')(page)).toBeVisible();
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 20000 });

    const search = page.getByPlaceholder('Search name, email, or company…');
    await search.fill('zzqqxx-no-such-lead');
    await expect(page.getByText('No leads match these filters.')).toBeVisible({ timeout: 20000 });
    await search.fill('');
    await expect(rows.first()).not.toContainText('No leads match these filters.', { timeout: 20000 });

    // + Filter -> Status -> pick the first option, then Clear all.
    await page.getByRole('button', { name: '+ Filter' }).click();
    await page.getByRole('menuitem', { name: 'Status' }).click();
    await page.getByRole('dialog').getByRole('button').first().click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Remove Status filter' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByRole('button', { name: 'Remove Status filter' })).toHaveCount(0);
    await expect(rows.first()).toBeVisible({ timeout: 20000 });
    await shot(page, 'v13-7-0-pa-leads');

    // Open a non-demo lead the API says this Pod Admin can see (the table is grouped by company and a
    // cleared filter can leave the groups collapsed, so don't rely on which rows happen to be expanded).
    const lead = await safeLead(request);
    test.skip(!lead, 'no non-demo lead visible to this Pod Admin');
    await search.fill(lead.last_name || lead.first_name);
    const cell = page.locator('tbody tr td', { hasText: lead.first_name }).first();
    await expect(cell).toBeVisible({ timeout: 20000 });
    await cell.click();
    await expect(page.getByText('Quick Actions', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Previous lead' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next lead' })).toBeVisible();
    finish(ctx, 'leads');
  });

  test('lead detail: cards, Quick Actions, Enroll picker, Send Email compose, Message panel', async ({ page, request }) => {
    const lead = await safeLead(request);
    test.skip(!lead, 'no non-demo lead visible to this Pod Admin');
    const ctx = await start(page);
    await go(page, `#lead-detail/${lead.id}`);
    await expect(page.getByText('Quick Actions', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    for (const t of ['Lead Summary', 'Contact', 'Pre-Call Intelligence', 'Activity', 'Emails', 'Tasks',
      'Quick Actions', 'Call Strategy', 'Notes', 'Related Opportunity', 'Status History']) {
      await expect(page.getByRole('heading', { name: t, exact: true }).first(), `card ${t}`).toBeVisible();
    }
    // Present, never clicked: Call, Disqualify, Opt Out, Delete, Remove from cadence.
    for (const b of ['Call', 'Send Email', 'Add Task', 'Add Note', 'Enroll in Cadence', 'Disqualify Lead', 'Delete Lead']) {
      await expect(page.getByRole('button', { name: b, exact: true }).first(), `action ${b}`).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Mark Opted Out' }).first()).toBeVisible();

    // Enroll in Cadence: open the picker, assert it lists cadences, Escape — never pick one.
    await page.getByRole('button', { name: 'Enroll in Cadence', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem').first().or(menu.getByText('No published cadences yet.')))
      .toBeVisible({ timeout: 15000 });
    await shot(page, 'v13-7-0-pa-lead-enroll-picker');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    // Send Email: compose opens in a modal; close it — never send.
    await page.getByRole('button', { name: 'Send Email', exact: true }).click();
    const emailModal = page.getByRole('dialog', { name: /^Emails · / });
    await expect(emailModal).toBeVisible();
    await shot(page, 'v13-7-0-pa-lead-compose');
    await emailModal.locator('h2').locator('xpath=following-sibling::button').click();
    await expect(emailModal).toHaveCount(0);

    // Message: Alternate Messenger panel opens on the Message tab and dials nothing.
    const message = page.getByRole('button', { name: 'Message', exact: true });
    const widget = page.getByRole('dialog', { name: 'Communication widget', includeHidden: true });
    if (await message.count()) {
      await message.click();
      await expect(widget).toHaveAttribute('aria-hidden', 'false');
      const msgTab = widget.getByRole('tab', { name: 'Message' });
      if (await msgTab.count()) await expect(msgTab).toHaveAttribute('aria-selected', 'true');
      // Not on the Call tab (its manual-dial input would be showing).
      await expect(widget.getByPlaceholder('+1 555 123 4567')).toHaveCount(0);
      await shot(page, 'v13-7-0-pa-lead-message');
      await widget.getByRole('button', { name: 'Close widget' }).click();
      await expect(widget).toHaveAttribute('aria-hidden', 'true');
    } else {
      test.info().annotations.push({ type: 'note', description: 'Message hidden: this Pod Admin has no SMS/WhatsApp capability' });
    }
    // The purple button opens the panel for the open lead — it never dials.
    const fab = page.getByRole('button', { name: 'Open Alternate Messenger' });
    if (await fab.count()) {
      await fab.click();
      await expect(widget).toHaveAttribute('aria-hidden', 'false');
      await page.waitForTimeout(1500);
      await widget.getByRole('button', { name: 'Close widget' }).click();
    }
    await shot(page, 'v13-7-0-pa-lead-detail');
    finish(ctx, 'lead detail');
  });

  test('sales tools: tabs, cadence list filter, non-demo cadence Builder + Reporting', async ({ page, request }) => {
    const ctx = await start(page);
    await go(page, '#sales-tools');
    await expect(h1('Sales Tools')(page)).toBeVisible();
    await expect(h1('Sales Cadences')(page)).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Filter by status' }).click();
    for (const s of ['Draft', 'Active', 'Paused', 'Archived']) await expect(page.getByRole('menuitem', { name: s, exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Active', exact: true }).click();
    await shot(page, 'v13-7-0-pa-sales-tools-cadences');

    await page.getByRole('button', { name: 'Email Campaigns', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Campaigns', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await shot(page, 'v13-7-0-pa-sales-tools-email');
    await page.getByRole('button', { name: 'SMS Campaigns', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Inbox', exact: true })).toBeVisible();
    await expect(page.getByText('Create and send SMS campaigns via Alternate Messenger.')).toBeVisible();
    await shot(page, 'v13-7-0-pa-sales-tools-sms');

    // Open a non-demo active/paused cadence (Builder + Reporting tabs only exist then).
    const r = await api(request, 'GET', '/api/journeys', TOKEN);
    expect(r.status, 'GET /api/journeys as Pod Admin').toBe(200);
    const ok = (r.body || []).filter((j) => !DEMO_CADENCES.has(j.id) && !/demo/i.test(j.name || '')
      && ['active', 'paused'].includes(j.status));
    const j = ok.find((x) => /QA v13\.7/i.test(x.name)) || ok[0];
    if (j) {
      await go(page, `#sales-tools/${j.id}`);
      await expect(tab(page, 'builder')).toBeVisible({ timeout: 20000 });
      await shot(page, 'v13-7-0-pa-cadence-builder');
      await tab(page, 'reporting').click();
      await expect(page.getByText('Rep performance', { exact: true })).toBeVisible({ timeout: 20000 });
      await expect(page.getByText(/^Enrolled leads/)).toBeVisible({ timeout: 20000 });
      await shot(page, 'v13-7-0-pa-cadence-reporting');
    } else {
      test.info().annotations.push({ type: 'note', description: 'no non-demo active/paused cadence visible to Pod Admin' });
    }
    finish(ctx, 'sales tools');
  });

  test('pod management: Team Roster, Manage Pods without create form', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#pods');
    await expect(h1('POD Management')(page)).toBeVisible();
    await expect(tab(page, 'roster')).toBeVisible();
    await shot(page, 'v13-7-0-pa-pods-roster');
    await tab(page, 'manage').click();
    await expect(tab(page, 'manage')).toHaveClass(/border-blue-600/);
    await expect(page.getByRole('button', { name: '+ Create POD' })).toHaveCount(0);
    await shot(page, 'v13-7-0-pa-pods-manage');
    finish(ctx, 'pod management');
  });

  test('leaderboard: SDRs / AEs tabs, SDR drill-down', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#leaderboard');
    await expect(page.getByRole('heading', { name: 'Leaderboard', level: 1 })).toBeVisible();
    await tab(page, 'ae').click();
    await expect(tab(page, 'ae')).toHaveClass(/border-blue-600/);
    await shot(page, 'v13-7-0-pa-leaderboard-ae');
    await tab(page, 'sdr').click();
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await shot(page, 'v13-7-0-pa-leaderboard-sdr');
    const person = page.locator('button[class*="hover:underline"]').first();
    if (await person.count()) {
      await person.click();
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20000 });
      await expect(page.getByText("Couldn't load this SDR's performance")).toHaveCount(0);
      await shot(page, 'v13-7-0-pa-sdr-performance');
    } else {
      test.info().annotations.push({ type: 'note', description: 'no openable SDR on the leaderboard' });
    }
    finish(ctx, 'leaderboard');
  });

  test('activity monitor: Calls / Email / Messages, filter apply + reset', async ({ page }) => {
    test.setTimeout(150000);   // a slow staging render, not a product fault (60s default was too tight)
    const ctx = await start(page);
    await go(page, '#activity-monitor');
    await expect(h1('Activity Monitor')(page)).toBeVisible();
    for (const k of ['email', 'messages', 'calls']) {
      await tab(page, k).click();
      await expect(tab(page, k)).toHaveClass(/border-blue-600/);
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await shot(page, `v13-7-0-pa-activity-${k}`);
    }
    await page.getByRole('button', { name: 'All Directions' }).click();
    await page.getByRole('menuitem', { name: 'Outbound', exact: true }).click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    finish(ctx, 'activity monitor');
  });

  test('analytics hub: Dashboard with pod filter, Ask AI + Reports tabs', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#analytics');
    await expect(page.getByRole('heading', { name: 'Analytics Hub', level: 1 })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'All Pods' })).toBeVisible();
    await shot(page, 'v13-7-0-pa-analytics-dashboard');
    await page.locator('#ah-tab-ask-ai').click();
    await expect(page.locator('#ah-tab-ask-ai')).toHaveClass(/active/);
    await shot(page, 'v13-7-0-pa-analytics-ask-ai');
    await page.locator('#ah-tab-reports').click();
    await expect(page.getByText('Automated Reports')).toBeVisible({ timeout: 20000 });
    await shot(page, 'v13-7-0-pa-analytics-reports');
    finish(ctx, 'analytics hub');
  });

  test('calendar: Month / Week / Day switch', async ({ page }) => {
    test.setTimeout(150000);   // a slow staging render, not a product fault (60s default was too tight)
    const ctx = await start(page);
    await go(page, '#calendar');
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible({ timeout: 20000 });
    for (const m of ['week', 'day', 'month']) {
      await page.getByRole('button', { name: new RegExp(`^${m}$`, 'i') }).click();
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await shot(page, `v13-7-0-pa-calendar-${m}`);
    }
    finish(ctx, 'calendar');
  });

  test('ae pipeline: route allowed (nav hidden), stage + owner filters', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#ae-pipeline');
    await expect(page.getByRole('heading', { name: 'AE Pipeline', level: 1 })).toBeVisible({ timeout: 20000 });
    const stage = page.getByRole('button', { name: 'Filter by stage' });
    if (await stage.count()) {
      await stage.click();
      for (const s of ['All stages', 'Open', 'Closed Won', 'Closed Lost']) await expect(page.getByRole('menuitem', { name: s, exact: true })).toBeVisible();
      await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
      const owner = page.getByRole('button', { name: 'Filter by AE' });
      if (await owner.count()) {
        await owner.click();
        await expect(page.getByRole('menuitem', { name: 'All AEs', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
      }
    }
    await shot(page, 'v13-7-0-pa-ae-pipeline');
    finish(ctx, 'ae pipeline');
  });

  test('my settings: Email Sync, Dialer, Signature cards (no save)', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#my-settings');
    await expect(page.getByRole('heading', { name: 'My Settings', level: 1 })).toBeVisible();
    await expect(page.getByText('Send and receive lead email from your own mailbox')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Make calls directly from Alternate CRM')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Email Sign-off' })).toBeVisible();
    await shot(page, 'v13-7-0-pa-my-settings');
    finish(ctx, 'my settings');
  });

  test('control center: only Team & Access, only Users & PODs, no View As', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#control-center');
    await expect(h1('Control Center')(page)).toBeVisible();
    await expect(tab(page, 'team-access')).toBeVisible();
    for (const k of ['integrations', 'automation', 'data', 'monitoring']) await expect(tab(page, k)).toHaveCount(0);
    await expect(page.getByPlaceholder('Search by name or email…')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("Couldn't load users")).toHaveCount(0);
    await expect(tab(page, 'access')).toHaveCount(0); // User Access is Super Admin only
    await expect(page.locator('[title="View As"]')).toHaveCount(0);
    await shot(page, 'v13-7-0-pa-control-center');
    finish(ctx, 'control center');
  });

  test('help: latest release is v13.7.0, search works', async ({ page }) => {
    const ctx = await start(page);
    await go(page, '#user-guide');
    await expect(h1('Help & User Guide')(page)).toBeVisible();
    await page.getByRole('button', { name: /What's New — Release Notes/ }).click();
    await expect(page.locator('.helphub strong.text-sm').first()).toHaveText(`v${APP_VERSION}`);
    await expect(page.getByText('My Tasks and approvals, redone').first()).toBeVisible();
    // Footer version comes from frontend-react/src/generated/version.js (sync-version.mjs from /VERSION).
    await expect(page.getByText(new RegExp(`· v${APP_VERSION.replace(/\./g, '\\.')} · Last updated`)), `Help footer shows app version v${APP_VERSION}`).toBeVisible();
    await shot(page, 'v13-7-0-pa-help');
    const q = page.getByPlaceholder('Search the guide...');
    await q.fill('zzqqxx-no-such-topic');
    await expect(page.getByText('No results for "zzqqxx-no-such-topic".')).toBeVisible();
    await q.fill('cadence');
    await expect(page.getByText(/^No results for/)).toHaveCount(0);
    finish(ctx, 'help');
  });

  test('role gates: Access Denied, redirects, nav-only hidden items', async ({ page }) => {
    test.setTimeout(480000); // ~18 hash changes; go() waits up to 20s for networkidle on polling pages
    const ctx = await start(page);
    const labels = await navLinks(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    for (const name of NOT_IN_NAV) expect(labels, `${name} in nav`).not.toContain(name);

    for (const route of ACCESS_DENIED) {
      await go(page, `#${route}`);
      await expect(page.getByText('Access Denied'), `#${route}`).toBeVisible({ timeout: 15000 });
      await go(page, '#my-tasks'); // leave so the next hash is a real change
    }
    for (const [route, rendered] of Object.entries(REDIRECTS)) {
      await go(page, `#${route}`);
      await expect(page.locator('h1.db-page-title'), `#${route} -> dashboard`).toHaveText('Dashboard', { timeout: 15000 });
      await expect(rendered(page), `#${route} must not render`).toHaveCount(0);
      await go(page, '#my-tasks');
    }
    // Power Dialer is nav-gated only (no route guard in app.js) — nav absence asserted above.
    await shot(page, 'v13-7-0-pa-gates');
    finish(ctx, 'role gates');
  });
});
