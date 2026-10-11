// v13.7.0 close-out audit — Super Admin persona (SA_TOKEN), staging only.
// Read-only walk of every SA view: open tabs/drawers/menus and close them,
// search, filter, paginate. Never sends, calls, saves settings, enrolls, or
// touches the demo cadences/leads. Selectors are taken from the component
// source (frontend-react/src/...), not guessed.
//   npx playwright test tests/v13-7-0-persona-sa.spec.js
const { test, expect } = require('@playwright/test');
const { APP_VERSION, API, PERSONAS, watch, login, go, shot, api, expectClean } = require('./helpers/v13-7-0-staging');

const TOKEN = PERSONAS.sa.token;

// Hands-off data (task rules).
const DEMO_JOURNEYS = ['df23f37b-d5c1-478b-940d-401adb2f7739', '20bea580-b7b3-436d-a4be-caa0357b6d3b'];
const DEMO_LEADS = [
  'bf9c2e97-c3a8-4bf4-a629-7d1e6e2fce2c', 'fcac0d6e-dbfa-43dd-accd-c96a76735a6b',
  'd8b575b1-9a81-47bb-abcb-dd7485f218bf', '6b0d4ca1-af4e-44cb-a5cb-ae1bfc5169b0',
];
const DEMO_NAME = /dev sharma|\basha\b|\bben\b|\bchris\b/i;

// NavSidebar.jsx NAV_ITEMS filtered for 'Super Admin' (mogambo lockdown on) + the Feedback link.
const SA_NAV = [
  'Dashboard', 'My Tasks', 'Daily Digest', 'Leads', 'Sales Tools', 'POD Management', 'Leaderboard',
  'Activity Monitor', 'Analytics Hub', 'Calendar', 'My Settings', 'Playground', 'Control Center', 'Help', 'Send Feedback',
];

// Safety net: any write the audit must never make is aborted and reported.
// PUT/PATCH/DELETE are all blocked; POST only on send/call/enroll/sync paths.
const WRITE_DENY = /\/api\/(admin\/sync$|calls\/(start|disconnect)|leads\/[^/?]+\/(calls|tasks|notes)|journeys\/[^/?]+\/(enroll|archive|pause|publish)|dialer\/(test|playground)|.*\/send(\/|\?|$))/;
async function guard(page) {
  const blocked = [];
  await page.route(`${API}/**`, (route) => {
    const r = route.request();
    const path = r.url().replace(API, '').split('?')[0];
    if (['PUT', 'PATCH', 'DELETE'].includes(r.method()) || (r.method() === 'POST' && WRITE_DENY.test(path))) {
      blocked.push(`${r.method()} ${path}`);
      return route.abort();
    }
    return route.continue();
  });
  return { blocked: () => blocked.splice(0) };
}

/** Fresh SA session with problem collector + write guard. */
async function start(page) {
  test.skip(!TOKEN, 'SA_TOKEN not set');
  const w = watch(page);
  const g = await guard(page);
  await login(page, TOKEN);
  return { w, g };
}

function finish(w, g, where) {
  expect(g.blocked(), `${where}: audit attempted a write`).toEqual([]);
  expectClean(w.problems(), where);
}

const navLink = (page, label) => page.locator('nav.nh-nav a.nh-nav__link', { has: page.locator(`text="${label}"`) })
  .or(page.locator(`nav.nh-nav a.nh-nav__link[aria-label="${label}"]`));
const tab = (page, key) => page.locator(`button[data-tab="${key}"]`);

/** A lead SA can see that is not one of the hands-off demo leads. */
async function pickLead(request) {
  const { status, body } = await api(request, 'GET', '/api/leads?per_page=100', TOKEN);
  expect(status, 'GET /api/leads as SA').toBe(200);
  const lead = (body?.data || []).find((l) => !DEMO_LEADS.includes(l.id) && l.first_name && l.last_name
    && !DEMO_NAME.test(`${l.first_name} ${l.last_name}`) && !/unknown/i.test(`${l.first_name} ${l.last_name}`));
  expect(lead, 'a non-demo lead visible to SA').toBeTruthy();
  return lead;
}

/** An active/paused, non-demo cadence (prefers the throwaway "QA v13.7" one). */
async function pickCadence(request) {
  const { status, body } = await api(request, 'GET', '/api/journeys', TOKEN);
  expect(status, 'GET /api/journeys as SA').toBe(200);
  const ok = (body || []).filter((j) => ['active', 'paused'].includes(j.status)
    && !DEMO_JOURNEYS.includes(j.id) && !/demo/i.test(j.name || ''));
  return ok.find((j) => /QA v13\.7/i.test(j.name)) || ok[0] || null;
}

test.describe('v13.7.0 persona audit — Super Admin', () => {
  test.describe.configure({ timeout: 150000 });

  test('SA shell: sidebar, search, bell + My Tasks badge, Ask AI, New Lead', async ({ page }) => {
    const { w, g } = await start(page);
    await expect(page.locator('h1.db-page-title', { hasText: 'Dashboard' })).toBeVisible({ timeout: 30000 });

    // Sidebar is exactly the SA set — no Power Dialer, AE Pipeline, Pipeline & CSM, CSM items.
    const labels = await page.locator('nav.nh-nav a.nh-nav__link').evaluateAll((as) => as.map((a) => a.getAttribute('aria-label')));
    expect(labels).toEqual(SA_NAV);

    // Global search → results listbox (empty state counts — it proves the round trip).
    await page.getByRole('textbox', { name: 'Search' }).first().fill('te');
    await expect(page.getByRole('listbox', { name: 'Search results' })).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');

    // Bell (v13.7.0 layout) and the sidebar My Tasks badge agree on approvals.
    await page.locator('#nh-notification-bell-btn').click();
    const caughtUp = page.getByText("You're all caught up");
    const sections = page.getByText(/^(Approvals waiting|Replies|Due tasks)$/);
    await expect(caughtUp.or(sections.first())).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Open My Tasks' })).toBeVisible();
    const apprLabel = page.locator('span', { hasText: /^Approvals waiting$/ });
    const bellApprovals = (await apprLabel.count())
      ? Number(await apprLabel.first().locator('xpath=following-sibling::*[1]').innerText()) : 0;
    await shot(page, 'v13-7-0-sa-bell');
    await page.keyboard.press('Escape');
    const badge = page.locator('.nh-nav__badge[title$="approvals waiting for you"]');
    if (bellApprovals > 0) await expect(badge).toHaveText(String(bellApprovals));
    else await expect(badge).toHaveCount(0);

    // Ask AI: open + close only.
    await page.locator('#nh-ask-ai-btn').click();
    await expect(page.getByRole('textbox', { name: 'AI query' })).toBeVisible();
    await page.locator('.nh-ai-overlay button[aria-label="Close"]').click();
    await expect(page.getByRole('textbox', { name: 'AI query' })).toBeHidden();

    // Sync Salesforce + Dial: presence only — NEVER clicked.
    await expect(page.locator('#nh-sync-sf-btn')).toBeVisible();

    // New Lead: open the legacy modal, Cancel.
    await page.locator('#nh-new-lead-btn').click();
    await expect(page.locator('#new-lead-modal')).toBeVisible();
    await expect(page.locator('#new-lead-modal h2', { hasText: 'Create New Lead' })).toBeVisible();
    await page.locator('#new-lead-modal .close-modal-btn').click();
    await expect(page.locator('#new-lead-modal')).toBeHidden();

    await shot(page, 'v13-7-0-sa-shell');
    finish(w, g, 'SA shell');
  });

  test('SA Dashboard: KPI cards and leaderboard load', async ({ page }) => {
    const { w, g } = await start(page);
    await go(page, '#dashboard');
    await expect(page.locator('h1.db-page-title', { hasText: 'Dashboard' })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-stat-label]').first()).toBeVisible({ timeout: 30000 });   // v13.9.5: built on the component library
    await expect(page.getByText('Meetings booked', { exact: true })).toBeVisible();
    await expect(page.getByText('Leaderboard', { exact: true }).first()).toBeVisible();
    await shot(page, 'v13-7-0-sa-dashboard');
    finish(w, g, 'SA Dashboard');
  });

  test('SA My Tasks: tabs, approvals deep link + due labels, To do groups, Done paging, search, open lead', async ({ page, request }) => {
    const { w, g } = await start(page);
    const mine = await api(request, 'GET', '/api/my/tasks?status=open', TOKEN);
    expect(mine.status, 'GET /api/my/tasks').toBe(200);
    const open = mine.body || [];
    const approvals = open.filter((t) => ['email_approval', 'sms_approval'].includes(t.kind));
    const pastDue = approvals.filter((t) => t.due_time && new Date(t.due_time) < new Date()).length;

    // Deep link opens the Approvals tab.
    await go(page, '#my-tasks/approvals');
    await expect(page.getByRole('heading', { level: 1, name: 'My Tasks' })).toBeVisible({ timeout: 30000 });
    await expect(tab(page, 'approvals')).toHaveClass(/border-blue-600/);
    await expect(tab(page, 'todo')).toBeVisible();
    await expect(tab(page, 'done')).toBeVisible();
    await expect(page.getByText('Waiting for you to send').or(page.getByText('No approvals waiting'))).toBeVisible({ timeout: 20000 });
    if (approvals.length) {
      const rows = page.locator('[data-tour="task-list"] [data-tour="task-row"]');
      await expect(rows).toHaveCount(approvals.length);
      // A fresh draft (due in the future) must read "Due …", not "Overdue".
      const overdueRows = await rows.filter({ hasText: /Overdue/ }).count();
      expect(overdueRows, 'approval rows labelled Overdue vs approvals actually past due').toBeLessThanOrEqual(pastDue);
    }
    await shot(page, 'v13-7-0-sa-my-tasks-approvals');

    // To do — grouped sections, or the empty state.
    await tab(page, 'todo').click();
    await expect(page.locator('[data-tour="task-list"] h2', { hasText: /^(Overdue|Due today|Upcoming|No due date|Snoozed)/ }).first()
      .or(page.getByText('Nothing to do right now'))).toBeVisible({ timeout: 15000 });
    await shot(page, 'v13-7-0-sa-my-tasks-todo');

    // Done — paginates when there is more than one page.
    await tab(page, 'done').click();
    await expect(page.locator('[data-tour="task-row"]').first().or(page.getByText('Nothing completed yet'))).toBeVisible({ timeout: 20000 });
    const pager = page.locator('[data-tour="task-list"] span.font-mono');
    if (await pager.count() && !/^1 \/ 1$/.test((await pager.innerText()).trim())) {
      await page.locator('[data-tour="task-list"]').getByRole('button', { name: /Next/ }).click();
      await expect(pager).toHaveText(/^2 \//);
    }
    await shot(page, 'v13-7-0-sa-my-tasks-done');

    // Search filters; then open a non-demo lead from a To do row.
    await tab(page, 'todo').click();
    await page.getByRole('textbox', { name: 'Search tasks' }).fill('zzqx-no-such-task');
    await expect(page.getByText('No tasks match your search')).toBeVisible();
    await page.getByRole('textbox', { name: 'Search tasks' }).fill('');
    const target = open.find((t) => !['email_approval', 'sms_approval'].includes(t.kind) && t.lead_name
      && !DEMO_LEADS.includes(t.lead_id) && !DEMO_NAME.test(t.lead_name));
    if (target) {
      await page.locator('[data-tour="task-row"]').getByRole('button', { name: new RegExp(`^${target.lead_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click();
      await expect(page).toHaveURL(new RegExp(`#lead-detail/${target.lead_id}`), { timeout: 20000 });
      await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible({ timeout: 30000 });
    } else {
      test.info().annotations.push({ type: 'note', description: 'No non-demo To-do task to open a lead from' });
    }
    finish(w, g, 'SA My Tasks');
  });

  test('SA Daily Digest: four cards render, date change reloads', async ({ page }) => {
    const { w, g } = await start(page);
    await go(page, '#digest');
    await expect(page.getByRole('heading', { level: 1, name: 'Daily Digest' })).toBeVisible({ timeout: 30000 });
    for (const t of ['Pipeline flow', 'Notable events', 'SDR performance snapshot', 'Current pipeline snapshot']) {
      await expect(page.getByRole('heading', { name: t, exact: true })).toBeVisible({ timeout: 30000 });
    }
    await page.getByRole('button', { name: 'Digest date' }).click();
    const day = page.locator('.rdp-day:not(.rdp-selected):not(.rdp-disabled) button.rdp-day_button:not([disabled])').first();
    const reload = page.waitForResponse((r) => r.url().startsWith(API) && /digest/i.test(r.url()), { timeout: 30000 });
    await day.click();
    expect((await reload).status()).toBeLessThan(500);
    await expect(page.getByRole('heading', { name: 'Pipeline flow', exact: true })).toBeVisible({ timeout: 30000 });
    await shot(page, 'v13-7-0-sa-digest');
    finish(w, g, 'SA Daily Digest');
  });

  test('SA Leads: table, search, filter apply/clear, row opens lead', async ({ page, request }) => {
    const { w, g } = await start(page);
    const lead = await pickLead(request);
    const name = `${lead.first_name} ${lead.last_name}`.trim();
    await go(page, '#leads');
    await expect(page.getByRole('heading', { level: 1, name: 'All Leads' })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30000 });

    // Filter: + Filter → Status → pick one → chip; then Clear all.
    await page.getByRole('button', { name: '+ Filter' }).click();
    await page.getByRole('menuitem', { name: 'Status' }).click();
    await page.locator('[data-radix-popper-content-wrapper] button', { hasText: /^Calling$/ }).first().click();
    await expect(page.getByRole('button', { name: 'Clear all' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByRole('button', { name: 'Clear all' })).toBeHidden();

    // Search by the picked lead's name, then open it from the row.
    await page.getByPlaceholder('Search name, email, or company…').fill(name);
    const cell = page.locator('tbody tr td', { hasText: name }).first();
    await expect(cell).toBeVisible({ timeout: 30000 });
    await shot(page, 'v13-7-0-sa-leads');
    await cell.click();
    await expect(page).toHaveURL(new RegExp(`#lead-detail/${lead.id}`), { timeout: 20000 });
    await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible({ timeout: 30000 });
    // Reset the search so later sessions don't inherit it (sessionStorage only, but be tidy).
    finish(w, g, 'SA Leads');
  });

  test('SA Lead detail: header, cards, Quick Actions, Enroll picker, Send Email compose, Message panel (no dial)', async ({ page, request }) => {
    const { w, g } = await start(page);
    const dials = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/(calls(\/start)?$|leads\/[^/?]+\/calls$|dialer\/(test|playground))/.test(r.url().replace(API, '').split('?')[0])) dials.push(r.url());
    });
    const lead = await pickLead(request);
    const name = `${lead.first_name} ${lead.last_name}`.trim();

    // Arrive from the Leads list so Previous/Next lead have a list to walk.
    await go(page, '#leads');
    await page.getByPlaceholder('Search name, email, or company…').fill(name);
    await page.locator('tbody tr td', { hasText: name }).first().click({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous lead' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next lead' })).toBeVisible();

    for (const t of ['Lead Summary', 'Contact', 'Pre-Call Intelligence', 'Activity', 'Emails', 'Tasks',
      'Quick Actions', 'Call Strategy', 'Notes', 'Related Opportunity', 'Status History']) {
      await expect(page.getByRole('heading', { name: t, exact: true }).first(), `card "${t}"`).toBeVisible({ timeout: 20000 });
    }
    // Quick Actions present; Call / danger zone are presence-only.
    for (const a of ['Call', 'Send Email', 'Add Task', 'Add Note', 'Enroll in Cadence', 'Disqualify Lead', 'Mark Opted Out', 'Delete Lead']) {
      await expect(page.getByRole('button', { name: a, exact: true }).first(), `Quick Action "${a}"`).toBeVisible();
    }

    // Enroll in Cadence: picker lists cadences or the empty line — Escape, never pick.
    await page.getByRole('button', { name: 'Enroll in Cadence', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem').first().or(menu.getByText('No published cadences yet.'))).toBeVisible({ timeout: 15000 });
    await shot(page, 'v13-7-0-sa-lead-enroll-picker');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    // Send Email: compose modal opens, Escape closes — nothing sent.
    await page.getByRole('button', { name: 'Send Email', exact: true }).click();
    const compose = page.getByRole('dialog', { name: new RegExp(`^Emails · `) });
    await expect(compose).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Escape');
    await expect(compose).toBeHidden();

    // Message → Alternate Messenger panel on the Message tab. Only offered with SMS/WhatsApp capability.
    const widget = page.getByRole('dialog', { name: 'Communication widget', includeHidden: true });
    const message = page.getByRole('button', { name: 'Message', exact: true });
    if (await message.count()) {
      await message.click();
      await expect(widget).toHaveAttribute('aria-hidden', 'false', { timeout: 10000 });
      const msgTab = widget.getByRole('tab', { name: 'Message' });
      if (await msgTab.count()) await expect(msgTab).toHaveAttribute('aria-selected', 'true');
      else await expect(widget.getByRole('button', { name: 'Send message' })).toBeVisible();
      await shot(page, 'v13-7-0-sa-lead-message-panel');
      await widget.getByRole('button', { name: 'Close widget' }).click();
      await expect(widget).toHaveAttribute('aria-hidden', 'true');
    } else {
      test.info().annotations.push({ type: 'note', description: 'Message not offered — SA has no SMS/WhatsApp capability on staging' });
    }

    // Purple Alternate Messenger button: opens the panel, never dials.
    const fab = page.getByRole('button', { name: 'Open Alternate Messenger' });
    if (await fab.isVisible().catch(() => false)) {
      await fab.click();
      await expect(widget).toHaveAttribute('aria-hidden', 'false', { timeout: 10000 });
      await widget.getByRole('button', { name: 'Close widget' }).click();
    } else {
      test.info().annotations.push({ type: 'note', description: 'Alternate Messenger button hidden for SA (no messaging/Alternate Messenger dialer)' });
    }
    await page.waitForTimeout(1500);
    expect(dials, 'a call/dial request fired').toEqual([]);

    await shot(page, 'v13-7-0-sa-lead-detail');
    finish(w, g, 'SA Lead detail');
  });

  test('SA Sales Tools: Cadence list + filter, non-demo cadence Builder/Reporting, Email + SMS campaigns', async ({ page, request }) => {
    const { w, g } = await start(page);
    await go(page, '#sales-tools');
    await expect(page.getByRole('heading', { level: 1, name: 'Sales Tools' })).toBeVisible({ timeout: 30000 });
    for (const t of ['Cadence', 'Email Campaigns', 'SMS Campaigns']) {
      await expect(page.getByRole('button', { name: t, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('heading', { level: 1, name: 'Sales Cadences' })).toBeVisible({ timeout: 30000 });
    // Status filter: Draft/Active/Paused/Archived offered; apply Active.
    await page.getByRole('button', { name: 'Filter by status' }).click();
    for (const s of ['Draft', 'Active', 'Paused', 'Archived']) await expect(page.getByRole('menuitem', { name: s, exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Active', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Filter by status' })).toContainText('Active');
    await shot(page, 'v13-7-0-sa-sales-tools-cadences');

    // Email Campaigns → Campaigns / Templates.
    await page.getByRole('button', { name: 'Email Campaigns', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Templates', exact: true })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await page.getByRole('button', { name: 'Campaigns', exact: true }).click();
    await shot(page, 'v13-7-0-sa-sales-tools-email');

    // SMS Campaigns → Campaigns / Converse Desk CTAs (CTA not clicked — it opens Alternate Messenger).
    await page.getByRole('button', { name: 'SMS Campaigns', exact: true }).click();
    const smsErr = page.getByText(/Could not prepare this Alternate Messenger link|Alternate Messenger/i).first();
    await expect(page.getByRole('link', { name: /Open Campaigns in Alternate Messenger/ }).or(page.getByRole('button', { name: 'Retry' }))).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Converse Desk', exact: true }).click();
    await expect(page.getByRole('link', { name: /Open Converse Desk in Alternate Messenger/ }).or(page.getByRole('button', { name: 'Retry' }))).toBeVisible({ timeout: 20000 });
    if (await page.getByRole('button', { name: 'Retry' }).count()) {
      test.info().annotations.push({ type: 'note', description: `SMS Campaigns link not ready for SA: ${await smsErr.innerText().catch(() => '')}` });
    }
    await shot(page, 'v13-7-0-sa-sales-tools-sms');

    // A non-demo cadence: Builder + Reporting (roster). Read-only — no edits.
    const cad = await pickCadence(request);
    if (!cad) {
      test.info().annotations.push({ type: 'note', description: 'No active/paused non-demo cadence to open' });
    } else {
      await go(page, `#sales-tools/${cad.id}`);
      await expect(tab(page, 'builder')).toBeVisible({ timeout: 30000 });
      await tab(page, 'reporting').click();
      await expect(page.getByText(/^Enrolled leads/).first()).toBeVisible({ timeout: 30000 });
      if (!(await page.getByText('Rep performance').count())) {
        test.info().annotations.push({ type: 'note', description: `Rep performance hidden for "${cad.name}" (no rep stats yet)` });
      }
      await shot(page, 'v13-7-0-sa-cadence-reporting');
      await tab(page, 'builder').click();
      await shot(page, 'v13-7-0-sa-cadence-builder');
    }
    finish(w, g, 'SA Sales Tools');
  });

  test('SA POD Management: Team Roster + Manage Pods (create form available, not submitted)', async ({ page }) => {
    const { w, g } = await start(page);
    await go(page, '#pods');
    await expect(page.getByRole('heading', { level: 1, name: 'POD Management' })).toBeVisible({ timeout: 30000 });
    await expect(tab(page, 'roster')).toBeVisible();
    await tab(page, 'manage').click();
    await expect(page.getByRole('button', { name: '+ Create POD' })).toBeVisible({ timeout: 15000 });
    await shot(page, 'v13-7-0-sa-pods');
    finish(w, g, 'SA POD Management');
  });

  test('SA Leaderboard: SDRs/AEs tabs, SDR drill-down opens performance', async ({ page }) => {
    const { w, g } = await start(page);
    await go(page, '#leaderboard');
    await expect(page.getByRole('heading', { level: 1, name: /Leaderboard/ })).toBeVisible({ timeout: 30000 });
    await tab(page, 'ae').click();
    await expect(tab(page, 'ae')).toHaveClass(/border-blue-600/);
    await tab(page, 'sdr').click();
    const person = page.locator('button.text-left.hover\\:underline').first();
    await expect(person).toBeVisible({ timeout: 30000 });
    const who = (await person.innerText()).trim();
    await shot(page, 'v13-7-0-sa-leaderboard');
    await person.click();
    await expect(page).toHaveURL(/#sdr-performance\//, { timeout: 20000 });
    await expect(page.getByRole('heading', { level: 1, name: who })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Couldn't load this SDR's performance")).toHaveCount(0);
    await shot(page, 'v13-7-0-sa-sdr-performance');
    finish(w, g, 'SA Leaderboard');
  });

  test('SA Activity Monitor: Calls/Email/Messages tables, filter apply/reset', async ({ page }) => {
    const { w, g } = await start(page);
    await go(page, '#activity-monitor');
    await expect(page.getByRole('heading', { level: 1, name: 'Activity Monitor' })).toBeVisible({ timeout: 30000 });
    for (const ch of ['calls', 'email', 'messages']) {
      await tab(page, ch).click();
      await expect(page.locator('table').first().or(page.getByText(/No .* (found|yet)|Nothing/i).first())).toBeVisible({ timeout: 30000 });
    }
    await tab(page, 'calls').click();
    await page.getByRole('button', { name: 'All Directions' }).click();
    await page.getByRole('menuitem', { name: 'Outbound', exact: true }).click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(page.getByRole('button', { name: 'All Directions' })).toBeVisible();
    await shot(page, 'v13-7-0-sa-activity-monitor');
    finish(w, g, 'SA Activity Monitor');
  });

  test('SA Analytics Hub: Dashboard, Ask AI and Reports tabs', async ({ page }) => {
    const { w, g } = await start(page);
    await go(page, '#analytics');
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics Hub' })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('#ah-tab-dashboard')).toBeVisible();
    await page.locator('#ah-tab-ask-ai').click();
    await page.locator('#ah-tab-reports').click();
    await expect(page.getByText('Automated Reports').first()).toBeVisible({ timeout: 20000 });
    await shot(page, 'v13-7-0-sa-analytics-reports');
    await page.locator('#ah-tab-dashboard').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics Hub' })).toBeVisible();
    await shot(page, 'v13-7-0-sa-analytics');
    finish(w, g, 'SA Analytics Hub');
  });

  test('SA Calendar: Day/Week/Month switch, event opens lead', async ({ page }) => {
    test.setTimeout(150000);   // a slow staging render, not a product fault (60s default was too tight)
    const { w, g } = await start(page);
    await go(page, '#calendar');
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible({ timeout: 30000 });
    for (const m of ['day', 'week', 'month']) await page.getByRole('button', { name: new RegExp(`^${m}$`, 'i') }).click();
    await page.getByRole('button', { name: 'Toggle list view' }).click();
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await shot(page, 'v13-7-0-sa-calendar');
    const row = page.locator('div[role="button"].cursor-pointer').filter({ hasNotText: DEMO_NAME }).first();
    if (await row.count()) {
      await row.click();
      await page.getByRole('button', { name: /Go to lead/ }).click();
      await expect(page).toHaveURL(/#lead-detail\//, { timeout: 20000 });
      await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible({ timeout: 30000 });
    } else {
      test.info().annotations.push({ type: 'note', description: 'No non-demo meetings this month to open' });
    }
    finish(w, g, 'SA Calendar');
  });

  test('SA Power Dialer: nav-hidden but opens on direct hash (never dials)', async ({ page }) => {
    const { w, g } = await start(page);
    await expect(navLink(page, 'Power Dialer')).toHaveCount(0);
    await go(page, '#my-calls');
    await expect(page.getByRole('heading', { level: 1, name: 'Power Dialer' })).toBeVisible({ timeout: 30000 });
    await shot(page, 'v13-7-0-sa-power-dialer');
    finish(w, g, 'SA Power Dialer');
  });

  test('SA My Settings: Email Sync, Dialer, Signature cards', async ({ page }) => {
    const { w, g } = await start(page);
    await go(page, '#my-settings');
    await expect(page.getByRole('heading', { level: 1, name: /My Settings/ })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Send and receive lead email from your own mailbox')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Make calls directly from Alternate CRM')).toBeVisible();
    await expect(page.getByText(/What gets added to the foot of every email you send/)).toBeVisible();
    await shot(page, 'v13-7-0-sa-my-settings');
    finish(w, g, 'SA My Settings');
  });

  test('SA Playground: legacy view renders, no Access Denied', async ({ page }) => {
    test.setTimeout(150000);   // a slow staging render, not a product fault (60s default was too tight)
    const { w, g } = await start(page);
    await go(page, '#playground');
    await expect(page.locator('h1.pgv2-title', { hasText: 'Playground' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Access Denied')).toHaveCount(0);
    await shot(page, 'v13-7-0-sa-playground');
    finish(w, g, 'SA Playground');
  });

  test('SA Control Center: all sections + sub-tabs, View As present (view only)', async ({ page }) => {
    const { w, g } = await start(page);
    await go(page, '#control-center');
    await expect(page.getByRole('heading', { level: 1, name: 'Control Center' })).toBeVisible({ timeout: 30000 });
    for (const k of ['integrations', 'team-access', 'automation', 'data', 'monitoring']) await expect(tab(page, k)).toBeVisible();

    await tab(page, 'integrations').click();
    await expect(tab(page, 'connections')).toBeVisible({ timeout: 15000 });
    await tab(page, 'email').click();
    await shot(page, 'v13-7-0-sa-cc-integrations');

    await tab(page, 'team-access').click();
    await expect(tab(page, 'users')).toBeVisible({ timeout: 15000 });
    await expect(tab(page, 'access')).toBeVisible();
    await tab(page, 'users').click();
    await expect(page.locator('button[title="View As"]').first()).toBeVisible({ timeout: 30000 }); // presence only — clicking swaps the session
    await shot(page, 'v13-7-0-sa-cc-team-access');
    await tab(page, 'access').click();

    await tab(page, 'automation').click();
    await tab(page, 'data').click();
    await shot(page, 'v13-7-0-sa-cc-data');

    await tab(page, 'monitoring').click();
    for (const k of ['audit', 'logins', 'feedback', 'sf', 'error-logs', 'perf-health', 'claude']) {
      await expect(tab(page, k)).toBeVisible({ timeout: 15000 });
      await tab(page, k).click();
    }
    await shot(page, 'v13-7-0-sa-cc-monitoring');
    finish(w, g, 'SA Control Center');
  });

  test('SA Help: latest release is v13.7.0 "My Tasks and approvals, redone", search works', async ({ page }) => {
    const { w, g } = await start(page);
    await go(page, '#user-guide');
    await expect(page.getByRole('heading', { level: 1, name: 'Help & User Guide' })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: "What's New — Release Notes" }).click();
    await expect(page.locator('.helphub-content strong').first()).toHaveText(`v${APP_VERSION}`);
    await expect(page.getByText('My Tasks and approvals, redone').first()).toBeVisible();
    await shot(page, 'v13-7-0-sa-help');
    await page.getByPlaceholder('Search the guide...').fill('approvals');
    await expect(page.getByText('My Tasks and approvals, redone').first()).toBeVisible({ timeout: 10000 });
    finish(w, g, 'SA Help');
  });

  test('SA gates: AE Pipeline and CSM routes redirect to Dashboard; none in the nav', async ({ page }) => {
    test.setTimeout(480000); // ~18 hash changes; go() waits up to 20s for networkidle on polling pages
    const { w, g } = await start(page);
    for (const label of ['AE Pipeline', 'Inbox', 'Portfolio', 'Playbooks', 'Digest', 'Pipeline & CSM']) {
      await expect(page.locator(`nav.nh-nav a.nh-nav__link[aria-label="${label}"]`)).toHaveCount(0);
    }
    for (const hash of ['#ae-pipeline', '#csm-inbox', '#csm-portfolio', '#csm-playbooks', '#csm-digest']) {
      await go(page, '#leads'); // leave Dashboard first so the redirect is observable
      await expect(page.getByRole('heading', { level: 1, name: 'All Leads' })).toBeVisible({ timeout: 30000 });
      await go(page, hash);
      await expect(page.locator('h1.db-page-title', { hasText: 'Dashboard' }), `${hash} → Dashboard`).toBeVisible({ timeout: 30000 });
      await expect(page.getByRole('heading', { level: 1, name: /^(AE Pipeline|Inbox|Portfolio|Playbooks|Digest)$/ })).toHaveCount(0);
    }
    await shot(page, 'v13-7-0-sa-gates');
    finish(w, g, 'SA gates');
  });

  test('SA Pipeline & CSM: nav-hidden by lockdown, direct hash renders both tabs', async ({ page }) => {
    const { w, g } = await start(page);
    await expect(page.locator('nav.nh-nav a.nh-nav__link[aria-label="Pipeline & CSM"]')).toHaveCount(0);
    await go(page, '#pipeline-hub');
    await expect(tab(page, 'ae')).toBeVisible({ timeout: 30000 });
    await expect(tab(page, 'ae')).toHaveText(/AE Pipeline/);
    await expect(tab(page, 'csm')).toHaveText(/CSM Portal/);
    await tab(page, 'csm').click();
    await expect(page.getByRole('heading', { level: 1, name: 'CSM Portal' })).toBeVisible({ timeout: 30000 });
    await shot(page, 'v13-7-0-sa-pipeline-hub');
    finish(w, g, 'SA Pipeline & CSM');
  });
});
