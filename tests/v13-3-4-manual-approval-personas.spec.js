// v13.3.4 — manual-approval cadence steps (email + SMS), persona coverage.
// _handle_manual_email_node / _handle_manual_sms_node (engine.py) and their
// UI (ManualEmailApprovalCard / ManualSmsApprovalCard in CadenceTaskDetails.jsx)
// already shipped in v13.1.0 and are covered for SA+SDR by
// tests/v13-1-0-manual-email-approval.spec.js. This spec closes two real
// coverage gaps found while prepping the demo cadence: (1) manual SMS
// approval had ZERO Playwright coverage (only manual email did), and (2)
// neither channel had been exercised end-to-end as AE or Pod Admin, the two
// personas who'll also own leads sitting in the demo cadence.
//
// STAGING ONLY. Refuses to run against any other host.
//   V_SA_TOKEN=... AE_TOKEN=... SDR_TOKEN=... PA_TOKEN=... \
//     npx playwright test tests/v13-3-4-manual-approval-personas.spec.js
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API = process.env.API_BASE_URL || 'https://messenger-crm-staging.onrender.com';
const SA = process.env.V_SA_TOKEN || process.env.SA_TOKEN || '';
const AE = process.env.AE_TOKEN || '';
const SDR = process.env.SDR_TOKEN || '';
const PA = process.env.PA_TOKEN || '';

if (!/^https:\/\/messenger-(crm|frontend)-staging\.onrender\.com$/.test(API) ||
    !/^https:\/\/messenger-frontend-staging\.onrender\.com$/.test(BASE_URL)) {
  throw new Error(`Refusing to run: not staging (${API}, ${BASE_URL})`);
}

const RUN = Date.now();
const SHOTS = 'tests/screenshots/v13-3-4-manual-approval';
const TOUR_KEYS = ['alternate:my-tasks-tour-seen'];

async function call(request, method, path, token, data) {
  const r = await request.fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data });
  let body = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  return { status: r.status(), body };
}

async function poll(fn, what, timeoutMs = 120000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function login(page, token) {
  await page.addInitScript((keys) => {
    try { keys.forEach((k) => localStorage.setItem(k, '1')); localStorage.setItem('leadDetailHub', 'on'); } catch { /* */ }
  }, TOUR_KEYS);
  await page.goto(`${BASE_URL}/?token=${token}`);
  await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
  await page.evaluate(() => { window.location.hash = '#my-tasks'; });
}

async function findDraftInput(page, ariaLabel, mustContain) {
  const inputs = page.locator(`[aria-label="${ariaLabel}"]`);
  await expect(inputs.first()).toBeVisible({ timeout: 30000 });
  const count = await inputs.count();
  for (let i = 0; i < count; i++) {
    const el = inputs.nth(i);
    const val = await el.inputValue();
    if (val && val.includes(mustContain)) return el;
  }
  throw new Error(`No "${ariaLabel}" field found containing "${mustContain}" (${count} candidates)`);
}

// Scoped to THIS run's enrollment, not just the node id: any other active
// cadence on staging (e.g. the long-lived demo cadence, which also triggers on
// "Lead Assigned" and also has nodes named e1/s1) can park its own task on the
// same lead — matching on journey_node_id alone grabbed that one instead.
async function taskFor(request, token, journeyId, leadId, nodeId) {
  const enr = await call(request, 'GET', `/api/journeys/${journeyId}/enrollments/${leadId}`, SA);
  if (enr.status !== 200) return null;
  const tasks = (await call(request, 'GET', `/api/leads/${leadId}/tasks`, token)).body || [];
  return tasks.find((t) => t.journey_enrollment_id === enr.body.enrollment_id && t.journey_node_id === nodeId) || null;
}

// Builds a 2-step manual-approval cadence (email then SMS, both send_mode:
// "manual") owned by the given role (any role can own a cadence since
// v13.3.4), enrolls leadId, and returns journeyId.
async function buildManualCadence(request, ownerToken, leadId, label) {
  const j = await call(request, 'POST', '/api/journeys', ownerToken,
    { name: `QA v13.3.4 manual-approval ${label} ${RUN} (auto-archived)` });
  expect(j.status, JSON.stringify(j.body)).toBe(200);
  const journeyId = j.body.id;
  const graph = {
    nodes: [
      { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { event: 'status_changed', to_status: `QA-never-used-${label}-${RUN}` } },
      { id: 'e1', type: 'email', position: { x: 0, y: 100 }, data: {
        subject: `[TEST] Manual email ${label} ${RUN} — please ignore`,
        body: `<p>Hi {{first_name}},</p><p>Manual-approval email test (${label}). Please ignore.</p>`,
        body_format: 'html', send_mode: 'manual', due_within_hours: 24,
      } },
      { id: 's1', type: 'sms', position: { x: 0, y: 200 }, data: {
        message: `Hi {{first_name}}, manual SMS approval test ${label} ${RUN} — please ignore`,
        send_mode: 'manual', due_within_hours: 24,
      } },
    ],
    edges: [{ id: 'a', source: 't', target: 'e1' }, { id: 'b', source: 'e1', target: 's1' }],
  };
  expect((await call(request, 'PUT', `/api/journeys/${journeyId}/versions/${j.body.draft_version_id}`, ownerToken, { graph_definition: graph })).status).toBe(200);
  const pub = await call(request, 'POST', `/api/journeys/${journeyId}/publish`, ownerToken);
  expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  const en = await call(request, 'POST', `/api/journeys/${journeyId}/enroll`, ownerToken, { lead_ids: [leadId] });
  expect(en.body.enrolled, JSON.stringify(en.body)).toBe(1);
  return journeyId;
}

async function cleanup(request, state) {
  for (const leadId of state.leadIds) {
    const tasks = await call(request, 'GET', `/api/leads/${leadId}/tasks`, SA).then((r) => r.body || []);
    for (const t of tasks) {
      if (t.kind === 'email_approval' || t.kind === 'sms_approval') {
        await call(request, 'DELETE', `/api/leads/${leadId}/tasks/${t.id}`, SA);
      }
    }
  }
  for (const journeyId of state.journeyIds) {
    const a = await call(request, 'POST', `/api/journeys/${journeyId}/archive`, SA, { confirm_exit_count: 0 });
    if (a.status === 409) await call(request, 'POST', `/api/journeys/${journeyId}/archive`, SA, { confirm_exit_count: 1 });
  }
  if (state.leadIds.length) await call(request, 'POST', '/api/admin/leads/bulk-delete', SA, { lead_ids: state.leadIds });
  if (state.testLeads) await call(request, 'DELETE', '/api/journeys/sandbox/test-leads', SA);
}

test.describe.configure({ mode: 'default', retries: 0 });

test.describe('v13.3.4 manual-approval cadence steps — AE / SDR / Pod Admin', () => {
  test.skip(!SA, 'V_SA_TOKEN / SA_TOKEN not set');
  test.setTimeout(300000);

  const state = { leadIds: [], journeyIds: [] };
  test.afterAll(async ({ request }) => { await cleanup(request, state); console.log('cleanup done', state); });

  // v13.3.5: on staging only the SA account has a connected mailbox — exactly
  // the real-world case of a rep who hasn't connected one yet. Clicking Send
  // must explain why (naming them), keep the draft, and leave the cadence
  // active — not 200 + a silently failed enrollment (found by this spec).
  // Then "Remove from cadence" must close the parked draft.
  for (const [role, token] of [['AE', AE], ['SDR', SDR], ['Pod Admin', PA]]) {
    test(`${role}: builds own manual-approval cadence; Send without a mailbox explains why and keeps the draft; Remove closes it`, async ({ request, page }) => {
      test.skip(!token, `${role} token not set`);
      const tag = role.replace(' ', '').toLowerCase();
      const lead = await call(request, 'POST', '/api/leads', token, {
        first_name: 'Alternate CRM', last_name: `ManualApproval${tag} ${RUN}`, company: 'Alternate CRM QA — safe to delete',
        email: `neelmani.mishra+v1335${tag}-${RUN}@screen-magic.com`, status: 'Lead Assigned',
      });
      expect(lead.status, JSON.stringify(lead.body)).toBe(200);
      state.leadIds.push(lead.body.id);
      const journeyId = await buildManualCadence(request, token, lead.body.id, tag);
      state.journeyIds.push(journeyId);
      const task = await poll(() => taskFor(request, token, journeyId, lead.body.id, 'e1'), `${role} manual-email approval task`);
      expect(task.kind).toBe('email_approval');
      expect(task.draft_body).toContain('Alternate CRM');

      await login(page, token);
      const subject = await findDraftInput(page, 'Email subject', String(RUN));
      await subject.fill(`[TEST] edited by ${role} ${RUN}`);
      const card = subject.locator('xpath=..');
      await card.getByRole('button', { name: 'Send' }).click();
      const alert = card.getByRole('alert');
      await expect(alert).toContainText('No connected mailbox', { timeout: 30000 });
      await expect(alert).toContainText('draft is kept');
      await expect(subject).toHaveValue(`[TEST] edited by ${role} ${RUN}`);   // edits survive
      await page.screenshot({ path: `${SHOTS}-${tag}-refused-send.png`, fullPage: true });

      const enr = await call(request, 'GET', `/api/journeys/${journeyId}/enrollments/${lead.body.id}`, SA);
      expect(enr.body.status).toBe('active');
      expect(enr.body.current_node_id).toBe('e1');

      const removed = await call(request, 'POST', `/api/journeys/enrollments/${enr.body.enrollment_id}/remove`, token);
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      const tasks = (await call(request, 'GET', `/api/leads/${lead.body.id}/tasks`, token)).body || [];
      const closed = tasks.find((t) => t.id === task.id);
      expect(closed.done === true || closed.done === 'true', JSON.stringify(closed)).toBe(true);
      expect(closed.outcome).toBe('cadence_ended');
    });
  }

  test('SDR approves the email draft in the UI on a cadence that can send (SA-owned) — sends and moves to the SMS step', async ({ request, page }) => {
    test.skip(!SDR, 'SDR_TOKEN not set');
    const lead = await call(request, 'POST', '/api/leads', SDR, {
      first_name: 'Alternate CRM', last_name: `ManualApprovalSend ${RUN}`, company: 'Alternate CRM QA — safe to delete',
      email: `neelmani.mishra+v1335send-${RUN}@screen-magic.com`, status: 'Lead Assigned',
    });
    expect(lead.status, JSON.stringify(lead.body)).toBe(200);
    state.leadIds.push(lead.body.id);
    const journeyId = await buildManualCadence(request, SA, lead.body.id, 'send');
    state.journeyIds.push(journeyId);
    await poll(() => taskFor(request, SDR, journeyId, lead.body.id, 'e1'), 'SDR manual-email approval task');

    await login(page, SDR);
    const subject = await findDraftInput(page, 'Email subject', String(RUN));
    await subject.fill(`[TEST] EDITED by SDR ${RUN}`);
    await subject.locator('xpath=..').getByRole('button', { name: 'Send' }).click();
    await poll(async () => {
      const r = await call(request, 'GET', `/api/journeys/${journeyId}/enrollments/${lead.body.id}`, SA);
      return r.body && r.body.current_node_id === 's1' ? r.body : null;
    }, 'the approved email to send and the cadence to reach the SMS step');
    const act = await call(request, 'GET', `/api/journeys/${journeyId}/activity`, SA);
    expect(JSON.stringify(act.body)).toContain(`EDITED by SDR ${RUN}`);   // the edit is what went out
    await page.screenshot({ path: `${SHOTS}-sdr-email-sent.png`, fullPage: true });
  });

  test('SA approves an SMS draft in the UI (Cadence Sandbox test lead — texts only the sandbox number)', async ({ request, page }) => {
    const j = await call(request, 'POST', '/api/journeys', SA, { name: `QA v13.3.5 manual-SMS ${RUN} (auto-archived)` });
    expect(j.status).toBe(200);
    state.journeyIds.push(j.body.id);
    const graph = {
      nodes: [
        { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { event: 'status_changed', to_status: `QA-sms-${RUN}` } },
        { id: 's1', type: 'sms', position: { x: 0, y: 100 }, data: {
          message: `Hi {{first_name}}, manual SMS approval test ${RUN} — please ignore`, send_mode: 'manual', due_within_hours: 24 } },
      ],
      edges: [{ id: 'a', source: 't', target: 's1' }],
    };
    expect((await call(request, 'PUT', `/api/journeys/${j.body.id}/versions/${j.body.draft_version_id}`, SA, { graph_definition: graph })).status).toBe(200);
    expect((await call(request, 'POST', `/api/journeys/${j.body.id}/publish`, SA)).status).toBe(200);
    const sandbox = await call(request, 'POST', `/api/journeys/${j.body.id}/sandbox/enroll-test-lead`, SA, { label: `SMS ${RUN}` });
    expect(sandbox.status, JSON.stringify(sandbox.body)).toBe(200);
    state.testLeads = true;
    const leadId = sandbox.body.lead_id;
    await poll(() => taskFor(request, SA, j.body.id, leadId, 's1'), 'SA manual-SMS approval task');

    await login(page, SA);
    const msg = await findDraftInput(page, 'SMS message', String(RUN));
    await msg.locator('xpath=..').getByRole('button', { name: 'Send' }).click();
    const enr = await poll(async () => {
      const r = await call(request, 'GET', `/api/journeys/${j.body.id}/enrollments/${leadId}`, SA);
      return r.body && ['completed', 'failed'].includes(r.body.status) ? r.body : null;
    }, 'the approved SMS to send and the cadence to complete');
    expect(enr.status, JSON.stringify(enr)).toBe('completed');
    await page.screenshot({ path: `${SHOTS}-sa-sms-sent.png`, fullPage: true });
  });

  test('a missed deadline never auto-sends (regression guard for the demo graph)', async ({ request }) => {
    const email = `neelmani.mishra+v1334timeout-${RUN}@screen-magic.com`;
    const lead = await call(request, 'POST', '/api/leads', SA, {
      first_name: 'Alternate CRM', last_name: `ManualApprovalTimeout ${RUN}`, company: 'Alternate CRM QA — safe to delete', email, status: 'Lead Assigned',
    });
    expect(lead.status, JSON.stringify(lead.body)).toBe(200);
    state.leadIds.push(lead.body.id);

    const j = await call(request, 'POST', '/api/journeys', SA, { name: `QA v13.3.4 manual-timeout ${RUN} (auto-archived)` });
    state.journeyIds.push(j.body.id);
    const graph = {
      nodes: [
        { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { event: 'status_changed', to_status: `QA-timeout-${RUN}` } },
        { id: 'e1', type: 'email', position: { x: 0, y: 100 }, data: {
          subject: `[TEST] timeout ${RUN}`, body: '<p>should never send</p>', body_format: 'html',
          send_mode: 'manual', due_within_hours: 0.001,
        } },
      ],
      edges: [{ id: 'a', source: 't', target: 'e1' }],
    };
    await call(request, 'PUT', `/api/journeys/${j.body.id}/versions/${j.body.draft_version_id}`, SA, { graph_definition: graph });
    await call(request, 'POST', `/api/journeys/${j.body.id}/publish`, SA);
    await call(request, 'POST', `/api/journeys/${j.body.id}/enroll`, SA, { lead_ids: [lead.body.id] });

    const enr = await poll(async () => {
      const r = await call(request, 'GET', `/api/journeys/${j.body.id}/enrollments/${lead.body.id}`, SA);
      return r.body && ['completed', 'failed', 'exited_early'].includes(r.body.status) ? r.body : null;
    }, 'the timed-out manual step to skip without sending', 180000);
    // The engine's own step history (ExecutionLog), not /activity — which
    // only lists email engagement, so a skip never appears there.
    const events = enr.history.map((h) => h.event_type);
    expect(events, JSON.stringify(enr.history)).toContain('manual_email_timeout');
    expect(events).not.toContain('manual_email_sent');
    expect(enr.status).toBe('completed');
  });
});
