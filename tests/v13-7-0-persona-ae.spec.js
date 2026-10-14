// v13.7.0 close-out audit — AE persona (AE_TOKEN). STAGING ONLY, read-only.
// Every view the AE can open, plus the role gates. Never sends, calls, saves
// settings, enrolls, or touches the demo cadences/leads. Run alone:
//   npx playwright test tests/v13-7-0-persona-ae.spec.js
const { test, expect } = require('@playwright/test');
const { APP_VERSION, PERSONAS, watch, login, go, shot, api, expectClean } = require('./helpers/v13-7-0-staging');

const TOKEN = PERSONAS.ae.token;

const DEMO_JOURNEYS = ['df23f37b-d5c1-478b-940d-401adb2f7739', '20bea580-b7b3-436d-a4be-caa0357b6d3b'];
const DEMO_LEADS = ['bf9c2e97-c3a8-4bf4-a629-7d1e6e2fce2c', 'fcac0d6e-dbfa-43dd-accd-c96a76735a6b',
  'd8b575b1-9a81-47bb-abcb-dd7485f218bf', '6b0d4ca1-af4e-44cb-a5cb-ae1bfc5169b0'];
const DEMO_NAME = /\b(dev sharma|asha|ben|chris)\b/i;

// NavSidebar.jsx NAV_ITEMS filtered for role 'AE' (mogambo lockdown hides AE Pipeline).
const AE_NAV = ['Dashboard', 'My Tasks', 'Leads', 'Sales Tools', 'Leaderboard', 'Analytics Hub',
  'Calendar', 'Power Dialer', 'My Settings', 'Help'];
const NOT_AE_NAV = ['Daily Digest', 'POD Management', 'AE Pipeline', 'Inbox', 'Portfolio', 'Playbooks',
  'Digest', 'Pipeline & CSM', 'Activity Monitor', 'Playground', 'Control Center'];

// Safety net: anything that would dial, send or enroll is aborted and recorded.
const DANGEROUS = /\/api\/(calls\/start|dialer\/(dial|call|bridge)|.*\/send\b|.*\/send-|.*\/enroll\b|.*\/approve)/;
async function guard(page) {
  const blocked = [];
  await page.route(/\/api\//, (route) => {
    const r = route.request();
    if (r.method() !== 'GET' && DANGEROUS.test(new URL(r.url()).pathname)) {
      blocked.push(`${r.method()} ${r.url()}`);
      return route.abort();
    }
    return route.continue();
  });
  return blocked;
}

async function open(page, hash) {
  const w = watch(page);
  const blocked = await guard(page);
  await login(page, TOKEN);
  if (hash) await go(page, hash);
  return { w, blocked };
}

function finish(ctx, where) {
  expect(ctx.blocked, `${where}: dial/send/enroll request fired`).toEqual([]);
  expectClean(ctx.w.problems(), where);
}

const navLabels = (page) => page.locator('nav.nh-nav a.nh-nav__link').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
const tab = (page, key) => page.locator(`button[data-tab="${key}"]`);
const hashOf = (page) => page.evaluate(() => location.hash);

async function pickLead(request) {
  const r = await api(request, 'GET', '/api/leads?per_page=100', TOKEN);
  expect(r.status, 'GET /api/leads as AE').toBe(200);
  return (r.body?.data || []).find((l) => !DEMO_LEADS.includes(l.id)
    && !DEMO_NAME.test(`${l.first_name || ''} ${l.last_name || ''}`)) || null;
}

test.describe('v13.7.0 close-out — AE', () => {
  test.skip(!TOKEN, 'AE_TOKEN not set');
  test.setTimeout(180000);

  test('AE shell: sidebar, search, bell, My Tasks badge, topbar buttons', async ({ page }) => {
    const ctx = await open(page, '#dashboard');
    await expect(page.locator('nav >> text=My Tasks')).toBeVisible();
    expect(await navLabels(page)).toEqual([...AE_NAV, 'Send Feedback']);

    // Topbar: no Ask AI / Sync Salesforce for AE; New Lead opens + cancels.
    await expect(page.getByRole('button', { name: 'Ask AI' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sync Salesforce' })).toHaveCount(0);
    await page.getByRole('button', { name: 'New Lead' }).click();
    const modal = page.locator('#new-lead-modal');
    await expect(modal.getByText('Create New Lead')).toBeVisible();
    await modal.locator('.close-modal-btn').click();
    await expect(modal).toBeHidden();

    // Global search.
    const search = page.getByPlaceholder('Search leads, phone, SDRs...');
    await search.fill('te');
    await expect(page.getByRole('listbox', { name: 'Search results' })).toBeVisible({ timeout: 15000 });
    await search.fill('');

    // Bell (v13.7.0 layout) + badge parity.
    await page.locator('#nh-notification-bell-btn').click();
    const bell = page.getByRole('dialog').filter({ hasText: 'Open My Tasks' });
    await expect(bell.getByText('Notifications', { exact: true })).toBeVisible();
    await expect(bell.getByText(/You're all caught up|Approvals waiting|Replies|Due tasks/).first()).toBeVisible({ timeout: 15000 });
    const approvalsLabel = bell.getByText('Approvals waiting', { exact: true });
    const bellApprovals = await approvalsLabel.count()
      ? Number(await approvalsLabel.locator('xpath=following-sibling::*[1]').innerText()) : 0;
    await shot(page, 'v13-7-0-ae-shell-bell');
    await page.keyboard.press('Escape');
    await expect(bell).toBeHidden();
    const badge = page.locator('nav.nh-nav a[aria-label="My Tasks"] .nh-nav__badge');
    if (bellApprovals) await expect(badge).toHaveText(String(bellApprovals));
    else await expect(badge).toHaveCount(0);
    finish(ctx, 'shell');
  });

  test('AE dashboard renders', async ({ page }) => {
    const ctx = await open(page, '#dashboard');
    await expect(page.locator('h1.db-page-title')).toHaveText('Dashboard', { timeout: 30000 });
    await expect(page.locator('[data-stat-label]', { hasText: 'Meetings+' }).first()).toBeVisible({ timeout: 30000 });   // v13.9.5 rep cards
    await shot(page, 'v13-7-0-ae-dashboard');
    finish(ctx, 'dashboard');
  });

  test('AE My Tasks: Approvals / To do / Done, deep link, search', async ({ page }) => {
    const ctx = await open(page, '#my-tasks/approvals');
    await expect(page.locator('h1', { hasText: 'My Tasks' })).toBeVisible({ timeout: 30000 });
    await expect(tab(page, 'approvals')).toHaveClass(/border-blue-600/);
    const body = page.locator('[data-tour="task-list"]');
    await expect(body.getByText(/Waiting for you to send|No approvals waiting/).first()).toBeVisible({ timeout: 30000 });
    const overdue = await body.getByText(/Overdue by/).count();
    if (overdue) test.info().annotations.push({ type: 'approvals-overdue', description: `${overdue} approval row(s) read "Overdue" — check they are genuinely old drafts` });
    await shot(page, 'v13-7-0-ae-my-tasks-approvals');

    await tab(page, 'todo').click();
    await expect(body.getByText(/Overdue|Due today|Upcoming|No due date|Snoozed|Nothing to do right now/).first()).toBeVisible({ timeout: 15000 });
    await shot(page, 'v13-7-0-ae-my-tasks-todo');

    await tab(page, 'done').click();
    await expect(body.getByText(/Showing|Nothing completed yet/).first()).toBeVisible({ timeout: 30000 });
    const next = body.getByRole('button', { name: /Next/ });
    if (await next.count() && await next.isEnabled()) {
      await next.click();
      await expect(body.getByText(/^2 \//)).toBeVisible();
    }
    await shot(page, 'v13-7-0-ae-my-tasks-done');

    await page.getByRole('textbox', { name: 'Search tasks' }).fill('zzqx-no-such-task');
    await expect(body.getByText('No completed tasks match your search')).toBeVisible();
    await page.getByRole('textbox', { name: 'Search tasks' }).fill('');
    // ponytail: opening a lead from a task row is skipped (rows can be demo leads); the Leads test covers lead open.
    finish(ctx, 'my-tasks');
  });

  test('AE Leads: list, search, filter, open lead', async ({ page, request }) => {
    const lead = await pickLead(request);
    const ctx = await open(page, '#leads');
    await expect(page.locator('h1', { hasText: 'All Leads' })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30000 });
    await shot(page, 'v13-7-0-ae-leads');

    // Filter: Status = Lead Assigned, then Clear all.
    await page.getByRole('button', { name: '+ Filter' }).click();
    await page.getByRole('menuitem', { name: 'Status' }).click();
    await page.locator('[data-radix-popper-content-wrapper]').getByRole('button', { name: 'Lead Assigned', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByRole('button', { name: 'Clear all' })).toHaveCount(0);

    test.skip(!lead, 'AE has no non-demo lead to open');
    await page.getByPlaceholder('Search name, email, or company…').fill(lead.email || lead.last_name);
    const name = `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
    const row = page.locator('table tbody tr span.font-bold', { hasText: name }).first();
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.click();
    await expect.poll(() => hashOf(page), { timeout: 20000 }).toBe(`#lead-detail/${lead.id}`);
    await expect(page.getByText('Quick Actions')).toBeVisible({ timeout: 30000 });
    finish(ctx, 'leads');
  });

  test('AE lead detail: cards, Quick Actions, Enroll picker, Message panel, purple button', async ({ page, request }) => {
    const lead = await pickLead(request);
    test.skip(!lead, 'AE has no non-demo lead to open');
    const ctx = await open(page, `#lead-detail/${lead.id}`);
    await expect(page.getByText('Quick Actions')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('h1').first()).toBeVisible();
    // Previous/Next lead only render when the lead was opened from a list (the hub knows its position);
    // this spec deep-links by hash, so the arrows are correctly absent.
    await expect(page.getByRole('button', { name: 'Previous lead' })).toHaveCount(0);
    for (const title of ['Lead Summary', 'Tasks', 'Emails', 'Notes', 'Activity', 'Status History', 'Contact',
      'Pre-Call Intelligence', 'Call Strategy', 'Related Opportunity']) {
      await expect(page.locator('h3', { hasText: new RegExp(`^${title}$`) }).first(), `card ${title}`).toBeVisible();
    }
    const qa = page.locator('h3', { hasText: /^Quick Actions$/ }).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    for (const b of ['Call', 'Send Email', 'Add Task', 'Add Note', 'Enroll in Cadence', 'Mark Opted Out']) {
      await expect(qa.getByRole('button', { name: b, exact: true }), `Quick Action ${b}`).toBeVisible();
    }
    await shot(page, 'v13-7-0-ae-lead-detail');

    // Send Email: open compose only, then close.
    await qa.getByRole('button', { name: 'Send Email', exact: true }).click();
    const emails = page.getByRole('dialog', { name: /^Emails · / });
    await expect(emails).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(emails).toBeHidden();

    // Enroll in Cadence: open the picker, never pick.
    await qa.getByRole('button', { name: 'Enroll in Cadence', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByText(/No published cadences yet/).or(menu.getByRole('menuitem').first())).toBeVisible({ timeout: 15000 });
    await shot(page, 'v13-7-0-ae-lead-enroll-picker');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    // Message (only when SMS/WhatsApp is granted): opens the panel on the Message tab, no dial.
    const widget = page.locator('[role="dialog"][aria-label="Communication widget"]');
    const msg = qa.getByRole('button', { name: 'Message', exact: true });
    if (await msg.count()) {
      await msg.click();
      await expect(widget).toHaveAttribute('aria-hidden', 'false');
      const msgTab = widget.getByRole('tab', { name: 'Message' });
      if (await msgTab.count()) await expect(msgTab).toHaveAttribute('aria-selected', 'true');
      await expect(widget.getByPlaceholder('Type a message…')).toBeVisible();
      await shot(page, 'v13-7-0-ae-lead-message-panel');
      await widget.getByRole('button', { name: 'Close widget' }).click();
      await expect(widget).toHaveAttribute('aria-hidden', 'true');
    } else {
      test.info().annotations.push({ type: 'message', description: 'No Message action — AE has no SMS/WhatsApp capability' });
    }

    // Purple button: opens the panel, never dials.
    const fab = page.getByRole('button', { name: 'Open Alternate Messenger' });
    if (await fab.count()) {
      await fab.click();
      await expect(widget).toHaveAttribute('aria-hidden', 'false');
      await page.waitForTimeout(1500); // a dial would fire right away
      await shot(page, 'v13-7-0-ae-lead-purple-button');
      await widget.getByRole('button', { name: 'Close widget' }).click();
    }
    finish(ctx, 'lead-detail');
  });

  test('AE Sales Tools: Cadence / Email Campaigns / SMS Campaigns, non-demo cadence Builder + Reporting', async ({ page, request }) => {
    const j = await api(request, 'GET', '/api/journeys', TOKEN);
    expect(j.status, 'GET /api/journeys as AE').toBe(200);
    const list = Array.isArray(j.body) ? j.body : (j.body?.data || []);
    const cadence = list.find((x) => !DEMO_JOURNEYS.includes(x.id) && !/demo/i.test(x.name || '')
      && ['active', 'paused'].includes(x.status));

    const ctx = await open(page, '#sales-tools');
    await expect(page.locator('h1', { hasText: 'Sales Tools' })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('h1', { hasText: 'Sales Cadences' })).toBeVisible({ timeout: 30000 });
    if (list.length) {
      await page.getByRole('button', { name: 'Filter by status' }).click();
      await page.getByRole('menuitem', { name: 'Active' }).click();
      await page.getByRole('button', { name: 'Filter by status' }).click();
      await page.getByRole('menuitem', { name: 'Draft' }).click();
    }
    await shot(page, 'v13-7-0-ae-sales-tools-cadence');

    await page.getByRole('button', { name: 'Email Campaigns', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Templates', exact: true })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await shot(page, 'v13-7-0-ae-sales-tools-email');

    await page.getByRole('button', { name: 'SMS Campaigns', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Inbox', exact: true })).toBeVisible();
    await expect(page.getByText(/Open Campaigns in Alternate Messenger|Could not prepare|Preparing your Alternate Messenger session/).first()).toBeVisible({ timeout: 15000 });
    await shot(page, 'v13-7-0-ae-sales-tools-sms');

    if (cadence) {
      await go(page, `#sales-tools/${cadence.id}`);
      await expect(tab(page, 'builder')).toBeVisible({ timeout: 30000 });
      await tab(page, 'reporting').click();
      await expect(page.getByText(/Enrolled leads/).first()).toBeVisible({ timeout: 30000 });
      await expect(page.getByText('Rep performance').first()).toBeVisible({ timeout: 30000 });
      await shot(page, 'v13-7-0-ae-sales-tools-cadence-reporting');
      await tab(page, 'builder').click();
    } else {
      test.info().annotations.push({ type: 'cadence', description: 'No non-demo active/paused cadence visible to AE' });
    }
    finish(ctx, 'sales-tools');
  });

  test('AE Leaderboard: own AE board, ranges', async ({ page }) => {
    const ctx = await open(page, '#leaderboard');
    await expect(page.locator('h1', { hasText: 'Leaderboard' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText(/AE performance · Ranked by meetings booked/)).toBeVisible();
    await expect(page.locator('[data-tour="leaderboard-tabs"]')).toHaveCount(0); // admins only
    for (const r of ['7 Days', '30 Days', 'All Time']) {
      await page.getByRole('button', { name: r }).click();
      await expect(page.getByRole('button', { name: r })).toHaveAttribute('aria-pressed', 'true');
    }
    await shot(page, 'v13-7-0-ae-leaderboard');
    finish(ctx, 'leaderboard');
  });

  test('AE Analytics Hub: self-scoped, no Ask AI / Reports', async ({ page }) => {
    const ctx = await open(page, '#analytics');
    await expect(page.locator('h1', { hasText: 'Analytics Hub' })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#ah-tab-dashboard')).toBeVisible();
    await expect(page.locator('#ah-tab-ask-ai')).toHaveCount(0);
    await expect(page.locator('#ah-tab-reports')).toHaveCount(0);
    await expect(page.getByText('All Pods', { exact: true })).toHaveCount(0);
    await shot(page, 'v13-7-0-ae-analytics');
    finish(ctx, 'analytics');
  });

  test('AE Calendar: month / week / day', async ({ page }) => {
    const ctx = await open(page, '#calendar');
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible({ timeout: 30000 });
    for (const m of ['week', 'day', 'month']) {
      await page.getByRole('button', { name: new RegExp(`^${m}$`, 'i') }).click();
      await expect(page.getByRole('button', { name: new RegExp(`^${m}$`, 'i') })).toHaveClass(/bg-indigo-600/);
    }
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await shot(page, 'v13-7-0-ae-calendar');
    finish(ctx, 'calendar');
  });

  test('AE Power Dialer: opens, never dials', async ({ page }) => {
    const ctx = await open(page, '#my-calls');
    await expect(page.locator('h1', { hasText: 'Power Dialer' })).toBeVisible({ timeout: 30000 });
    // exact: 'Yes, Connected' in the (hidden) post-call modal also matches a loose getByText
    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 30000 });
    await shot(page, 'v13-7-0-ae-power-dialer');
    finish(ctx, 'power-dialer');
  });

  test('AE Pipeline (route allowed, nav hidden): stage filter', async ({ page }) => {
    const ctx = await open(page, '#ae-pipeline');
    await expect.poll(() => hashOf(page)).toBe('#ae-pipeline');
    await expect(page.locator('h1', { hasText: 'AE Pipeline' })).toBeVisible({ timeout: 30000 });
    const stage = page.getByRole('button', { name: 'Filter by stage' });
    await expect(stage.or(page.getByText('No Opportunities yet'))).toBeVisible({ timeout: 30000 });
    if (await stage.count()) {
      await stage.click();
      await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
      await stage.click();
      await page.getByRole('menuitem', { name: 'All stages' }).click();
    }
    await shot(page, 'v13-7-0-ae-ae-pipeline');
    finish(ctx, 'ae-pipeline');
  });

  test('AE My Settings: Email Sync, Dialer, Signature cards', async ({ page }) => {
    const ctx = await open(page, '#my-settings');
    await expect(page.locator('h1', { hasText: 'My Settings' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Send and receive lead email from your own mailbox')).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Make calls directly from Alternate CRM')).toBeVisible();
    await expect(page.getByText(/What gets added to the foot of every email you send/)).toBeVisible();
    await shot(page, 'v13-7-0-ae-my-settings');
    finish(ctx, 'my-settings');
  });

  test('AE Help: top release is v13.7.0, search works', async ({ page }) => {
    const ctx = await open(page, '#user-guide');
    await expect(page.locator('h1', { hasText: 'Help & User Guide' })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: /What's New — Release Notes/ }).click();
    await expect(page.locator('.helphub strong.text-sm').first()).toHaveText(`v${APP_VERSION}`);
    await expect(page.getByText('My Tasks and approvals, redone').first()).toBeVisible();
    await shot(page, 'v13-7-0-ae-help');
    await page.getByPlaceholder('Search the guide...').fill('cadence');
    await expect(page.locator('.helphub button').first()).toBeVisible();
    await expect(page.getByText(/No results for/)).toHaveCount(0);
    finish(ctx, 'help');
  });

  test('AE gates: admin-only routes show Access Denied', async ({ page }) => {
    const ctx = await open(page);
    for (const h of ['#digest', '#activity-monitor', '#pods', '#playground', '#settings', '#admin',
      '#disqualify-requests', '#upload', '#audit-logs']) {
      await go(page, '#dashboard');
      await expect(page.locator('h1.db-page-title')).toBeVisible({ timeout: 30000 });
      await go(page, h);
      await expect(page.getByText('Access Denied'), h).toBeVisible({ timeout: 15000 });
    }
    await shot(page, 'v13-7-0-ae-gate-access-denied');
    finish(ctx, 'gates-access-denied');
  });

  test('AE gates: control-center / pipeline-hub / csm-* redirect to dashboard; hidden nav items', async ({ page }) => {
    const ctx = await open(page);
    const labels = await navLabels(page);
    for (const l of NOT_AE_NAV) expect(labels, `nav item ${l}`).not.toContain(l);
    for (const [h, marker] of [['#control-center', 'Control Center'], ['#pipeline-hub', 'Pipeline'],
      ['#csm-inbox', 'Inbox'], ['#csm-portfolio', 'Portfolio'], ['#csm-playbooks', 'Playbooks'], ['#csm-digest', 'Digest']]) {
      await go(page, '#my-settings');
      await go(page, h);
      // The shell renders the Dashboard but leaves the typed hash in the URL (a hash change sets
      // _skipHashUpdate for the nested loadView) — long-standing behaviour, so assert what is rendered.
      await expect(page.locator('h1.db-page-title')).toBeVisible({ timeout: 30000 });
      await expect(page.locator('h1', { hasText: new RegExp(`^${marker}`) }), h).toHaveCount(0);
    }
    await shot(page, 'v13-7-0-ae-gate-redirects');
    finish(ctx, 'gates-redirects');
  });
});
