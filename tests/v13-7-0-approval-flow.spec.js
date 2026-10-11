// v13.7.0 close-out — the cadence-approval flow end to end on STAGING, with
// throwaway data only: a brand-new QA lead (no phone) and a brand-new
// "only when enrolled manually" cadence (manual email -> LinkedIn task).
// Never clicks Send / Call; every step is SKIPPED, so nothing goes out.
// afterAll always archives the QA cadence and soft-deletes the QA lead.
//   npx playwright test tests/v13-7-0-approval-flow.spec.js
const { test, expect } = require('@playwright/test');
const { PERSONAS, watch, login, go, shot, api, expectClean } = require('./helpers/v13-7-0-staging');

const SA = PERSONAS.sa.token;
const SDR = PERSONAS.sdr.token;
const RUN = Date.now();
const LEAD_NAME = `QA v13.7 Closeout ${RUN}`;
const CADENCE = `QA v13.7 closeout ${RUN}`;
// Never touched, even by accident (demo cadences).
const DEMO_JOURNEYS = ['df23f37b-d5c1-478b-940d-401adb2f7739', '20bea580-b7b3-436d-a4be-caa0357b6d3b'];
const DIAL = /\/(calls?\/(start|initiate|dial|outbound)|dial(er)?\/(start|call|dial)|click[-_]?to[-_]?call|aircall\/.*(dial|calls))/i;

const state = { leadId: null, journeyId: null };

async function poll(fn, what, timeoutMs = 240000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

const enrollment = (request) => api(request, 'GET', `/api/journeys/${state.journeyId}/enrollments/${state.leadId}`, SA);

// Scoped to THIS enrollment + node, not just the node id (another cadence can
// park its own task on the same lead).
async function taskFor(request, nodeId) {
  const enr = await enrollment(request);
  if (enr.status !== 200) return null;
  const tasks = (await api(request, 'GET', `/api/leads/${state.leadId}/tasks`, SDR)).body || [];
  return tasks.find((t) => t.journey_enrollment_id === enr.body.enrollment_id && t.journey_node_id === nodeId) || null;
}

async function myTasksRow(page, tab) {
  await go(page, '#my-tasks');
  await page.getByRole('textbox', { name: 'Search tasks' }).fill(LEAD_NAME);
  await page.locator(`[data-tab="${tab}"]`).click();
  await expect(page.locator(`[data-tab="${tab}"]`)).toHaveClass(/border-blue-600/);
  return page.locator('[data-tour="task-row"]', { hasText: LEAD_NAME });
}

test.describe.configure({ mode: 'serial', retries: 0 });

test.describe('v13.7.0 cadence approval flow — SDR, throwaway QA cadence + lead', () => {
  test.skip(!SA || !SDR, 'SA_TOKEN / SDR_DEVKAPOOR_TOKEN not set');
  test.setTimeout(300000);

  test.afterAll(async ({ request }) => {
    if (state.journeyId && !DEMO_JOURNEYS.includes(state.journeyId)) {
      const stats = await api(request, 'GET', `/api/journeys/${state.journeyId}/stats`, SA);
      let a = await api(request, 'POST', `/api/journeys/${state.journeyId}/archive`, SA, { confirm_exit_count: stats.body?.active ?? 0 });
      if (a.status === 409) {   // stats can exclude test leads; archive counts every active one
        const n = Number((/has (\d+) active/.exec(a.body?.detail || '') || [])[1] || 0);
        a = await api(request, 'POST', `/api/journeys/${state.journeyId}/archive`, SA, { confirm_exit_count: n });
      }
      console.log(`cleanup: archive QA cadence ${state.journeyId} -> ${a.status}`);
    }
    if (state.leadId) {
      const d = await api(request, 'POST', '/api/admin/leads/bulk-delete', SA, { lead_ids: [state.leadId] });
      console.log(`cleanup: soft-delete QA lead ${state.leadId} -> ${d.status}`);
    }
  });

  test('1-2. setup: QA lead (no other cadence fires) + published manual-only QA cadence', async ({ request }) => {
    // Pick an initial status no active cadence auto-enrolls on — create_lead
    // logs a status change, which is what fires status_changed triggers.
    const blocked = new Set();
    const journeys = (await api(request, 'GET', '/api/journeys', SA)).body || [];
    for (const j of journeys.filter((x) => x.status === 'active')) {
      const g = (await api(request, 'GET', `/api/journeys/${j.id}`, SA)).body?.graph_definition || {};
      for (const n of (g.nodes || []).filter((x) => x.type === 'trigger' && x.data?.event === 'status_changed')) {
        blocked.add(n.data.to_status || '*');
        console.log(`active cadence "${j.name}" triggers on status -> ${n.data.to_status || '(any)'}`);
      }
    }
    const status = blocked.has('*') ? 'Research' : (['Research', 'Lead Assigned'].find((s) => !blocked.has(s)) || 'Research');
    if (blocked.has('*') || blocked.has(status)) console.log(`WARN: every allowed initial status fires a cadence; using ${status} and removing any auto-enrollment`);

    // Created as the SDR -> auto-assigned to the SDR, so cadence tasks land on them.
    const lead = await api(request, 'POST', '/api/leads', SDR, {
      first_name: 'QA v13.7', last_name: `Closeout ${RUN}`, company: 'Alternate CRM QA — safe to delete',
      email: `qa.v137.${RUN}@example.com`, status,
    });
    expect(lead.status, JSON.stringify(lead.body)).toBe(200);
    state.leadId = lead.body.id;

    const enrolled = ((await api(request, 'GET', `/api/journeys/by-lead/${state.leadId}`, SA)).body || []).filter((e) => e.status === 'active');
    for (const e of enrolled) {
      console.log(`FINDING: creating a lead with status "${status}" auto-enrolled it in "${e.journey_name}" (${e.journey_id}); removing only the QA lead's enrollment`);
      const r = await api(request, 'POST', `/api/journeys/enrollments/${e.enrollment_id}/remove`, SA);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }

    const j = await api(request, 'POST', '/api/journeys', SA, { name: CADENCE });
    expect(j.status, JSON.stringify(j.body)).toBe(200);
    state.journeyId = j.body.id;
    const graph = {
      nodes: [
        { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { event: 'manual' } },
        { id: 'e1', type: 'email', position: { x: 0, y: 120 }, data: {
          subject: `[TEST] QA v13.7 closeout ${RUN} — please ignore`,
          body: '<p>Hi {{first_name}},</p><p><strong>QA draft</strong> — this is never sent.</p>',
          body_format: 'html', send_mode: 'manual', due_within_hours: 24,
        } },
        { id: 'k1', type: 'task', position: { x: 0, y: 240 }, data: {
          task_kind: 'linkedin_connect', title: 'Send LinkedIn connection request', instructions: 'QA — skip this step.',
          outcomes: [{ key: 'accepted', label: 'Accepted' }, { key: 'not_accepted', label: 'Not accepted' }],
          branch_on_outcome: {}, due_within_hours: 24,
        } },
      ],
      edges: [{ id: 'a', source: 't', target: 'e1' }, { id: 'b', source: 'e1', target: 'k1' }],
    };
    const put = await api(request, 'PUT', `/api/journeys/${state.journeyId}/versions/${j.body.draft_version_id}`, SA, { graph_definition: graph });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const pub = await api(request, 'POST', `/api/journeys/${state.journeyId}/publish`, SA);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  });

  test('3. SDR enrolls the QA lead from its page (Quick Actions → Enroll in Cadence)', async ({ page, request }) => {
    const w = watch(page);
    await login(page, SDR);
    await go(page, `#lead-detail/${state.leadId}`);
    await expect(page.getByText(LEAD_NAME).first()).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Enroll in Cadence' }).click();
    const item = page.getByRole('menuitem', { name: CADENCE });
    const visible = await item.waitFor({ timeout: 20000 }).then(() => true, () => false);
    if (visible) {
      await item.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(CADENCE);
      await shot(page, 'approval-flow-01-enroll-confirm');
      await dialog.getByRole('button', { name: 'Enroll', exact: true }).click();
      await expect(page.getByText(`Enrolled in "${CADENCE}"`)).toBeVisible({ timeout: 20000 });
    } else {
      console.log('FINDING: the SDR cannot see the QA cadence in the lead page Enroll in Cadence picker; enrolled via API as SA');
      await shot(page, 'approval-flow-01-picker-missing-cadence');
      await page.keyboard.press('Escape');
      const en = await api(request, 'POST', `/api/journeys/${state.journeyId}/enroll`, SA, { lead_ids: [state.leadId] });
      expect(en.body?.enrolled, JSON.stringify(en.body)).toBe(1);
    }
    expect((await enrollment(request)).status).toBe(200);
    expectClean(w.problems(), 'lead page enroll');
  });

  test('4-6. approval reaches the SDR: bell, sidebar badge, My Tasks Approvals card, lead page card', async ({ page, request }) => {
    const task = await poll(() => taskFor(request, 'e1'), 'the email-approval task for this enrollment');
    expect(task.kind).toBe('email_approval');

    const w = watch(page);
    await login(page, SDR);

    // Sidebar My Tasks badge (fed by the bell's poll).
    await expect(page.locator('.nh-nav__badge[title*="approvals waiting"]')).toHaveText(/^\d+$/, { timeout: 30000 });

    // Bell: "Approvals waiting" section lists the QA lead.
    await page.locator('#nh-notification-bell-btn').click();
    const popover = page.locator('[data-radix-popper-content-wrapper]');
    const section = popover.locator('div', { has: page.getByText('Approvals waiting', { exact: true }) }).filter({ hasText: LEAD_NAME }).last();
    await expect(section).toBeVisible({ timeout: 20000 });
    const bellItem = section.locator('button', { hasText: LEAD_NAME });
    await expect(bellItem).toContainText(/Due (in|tomorrow|today)/);
    await expect(bellItem).not.toContainText(/Overdue/);
    await shot(page, 'approval-flow-02-bell');
    await bellItem.click();

    // Lands on My Tasks → Approvals.
    await expect(page).toHaveURL(/#my-tasks/, { timeout: 20000 });
    await expect(page.locator('[data-tab="approvals"]')).toHaveClass(/border-blue-600/);
    const row = await myTasksRow(page, 'approvals');
    await expect(row).toHaveCount(1, { timeout: 20000 });
    await expect(row.getByRole('textbox', { name: 'Email subject' })).toHaveValue(new RegExp(`QA v13.7 closeout ${RUN}`));
    await expect(row.locator('[aria-label="Email body"]')).toBeVisible();
    await expect(row).toContainText(/Due (in|tomorrow|today)/);
    await expect(row).not.toContainText(/Overdue/);
    await shot(page, 'approval-flow-03-my-tasks-approval');

    // ⋯ menu on an approval: no Snooze (the cadence is paused on it).
    await row.getByRole('button', { name: 'Task actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Skip this step' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Snooze/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Lead page cadence card.
    await go(page, `#lead-detail/${state.leadId}`);
    await expect(page.getByText('Waiting for approval — email draft is in My Tasks')).toBeVisible({ timeout: 30000 });
    await shot(page, 'approval-flow-04-lead-cadence-card');
    expectClean(w.problems(), 'bell / My Tasks approvals / lead card');
  });

  test('7. Skip the approval (never Send) — moves to the task step, nothing sent', async ({ page, request }) => {
    const w = watch(page);
    await login(page, SDR);
    const row = await myTasksRow(page, 'approvals');
    await expect(row).toHaveCount(1, { timeout: 20000 });
    await row.getByRole('button', { name: 'Skip this step' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('This draft is not sent.');
    await dialog.getByRole('button', { name: 'Skip step' }).click();
    await expect(page.getByText(/Skipped — .* moves to the next step/)).toBeVisible({ timeout: 20000 });
    await expect(row).toHaveCount(0, { timeout: 20000 });
    await shot(page, 'approval-flow-05-approval-skipped');

    const enr = await poll(async () => {
      const r = await enrollment(request);
      return r.body?.current_node_id === 'k1' ? r.body : null;
    }, 'the enrollment to move to the LinkedIn task step', 120000);
    const events = enr.history.map((h) => h.event_type);
    expect(events, JSON.stringify(enr.history)).not.toContain('manual_email_sent');
    const emails = await api(request, 'GET', `/api/email/lead/${state.leadId}/emails`, SDR);
    expect(emails.status).toBe(200);
    expect((emails.body?.emails || []).filter((e) => e.direction === 'outbound'), 'no outbound email for the QA lead').toEqual([]);
    expectClean(w.problems(), 'skip approval');
  });

  test('8. task step in To do with a cadence badge; open cadence task cannot be deleted (409); Skip it → cadence completes', async ({ page, request }) => {
    const task = await poll(() => taskFor(request, 'k1'), 'the LinkedIn task for this enrollment', 120000);
    const del = await api(request, 'DELETE', `/api/leads/${state.leadId}/tasks/${task.id}`, SDR);
    expect(del.status, JSON.stringify(del.body)).toBe(409);

    const w = watch(page);
    await login(page, SDR);
    const row = await myTasksRow(page, 'todo');
    await expect(row).toHaveCount(1, { timeout: 20000 });
    await expect(row).toContainText('Cadence step');
    await expect(row).toContainText(CADENCE);
    await shot(page, 'approval-flow-06-todo-cadence-task');
    await row.getByRole('button', { name: 'Task actions' }).click();
    await page.getByRole('menuitem', { name: 'Skip this step' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Skip step' }).click();
    await expect(page.getByText(/Skipped — .* moves to the next step/)).toBeVisible({ timeout: 20000 });
    await expect(row).toHaveCount(0, { timeout: 20000 });

    const enr = await poll(async () => {
      const r = await enrollment(request);
      return r.body && r.body.status !== 'active' ? r.body : null;
    }, 'the enrollment to complete after the last step is skipped', 120000);
    expect(enr.status, JSON.stringify(enr)).toBe('completed');
    expectClean(w.problems(), 'skip task step');
  });

  test('9. FAB on the QA lead page opens the panel and never dials', async ({ page, request }) => {
    const w = watch(page);
    const dials = [];
    page.on('request', (r) => { if (r.method() !== 'GET' && DIAL.test(r.url())) dials.push(`${r.method()} ${r.url()}`); });
    await login(page, SDR);
    // The FAB is by design absent for a rep with no calling/SMS/WhatsApp grant (widget returns null until
    // init() finds something to offer). Dev Kapoor has none on staging, so there is nothing to click.
    const caps = (await api(request, 'GET', '/api/me/capabilities', SDR)).body || {};
    test.skip(!caps.calling?.enabled && !caps.sms?.enabled && !caps.whatsapp?.enabled, 'SDR has no calling/SMS/WhatsApp grant on staging — no FAB by design');
    await go(page, `#lead-detail/${state.leadId}`);
    await expect(page.getByText(LEAD_NAME).first()).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Open Alternate Messenger' }).click();
    const panel = page.locator('[role="dialog"][aria-label="Communication widget"]');
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    // Message tab (both capabilities) or the message composer (message-only SDR).
    await expect(panel.getByRole('tab', { name: /Message/ }).or(panel.getByRole('button', { name: 'Send message' })).first()).toBeVisible();
    await page.waitForTimeout(3000);   // let any stray dial request fire
    await shot(page, 'approval-flow-07-fab-panel');
    expect(dials, 'FAB click must not start a call').toEqual([]);
    expectClean(w.problems(), 'FAB panel');
  });
});
