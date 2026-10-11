// v13.3.5 — replies and out-of-office auto-replies drive the "replied?" branch
// on staging, end to end. Inbound emails are simulated by posting the exact
// Nylas `message.created` payload to the real /webhooks/nylas route (staging
// runs SECURITY_WEBHOOK_MODE=monitor, so unsigned events are processed and
// logged). The lead's email is a +alias of the SA mailbox, so a real reply
// can't be used: Alternate CRM ignores mail sent from a connected mailbox.
//
// Graph mirrors the demo: trigger -> wait -> condition(replied / auto-replied
// / timeout). Events land DURING the wait — the v13.3.5 fix.
//
// STAGING ONLY.  SA_TOKEN=... npx playwright test tests/v13-3-5-reply-ooo-staging.spec.js
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API = process.env.API_BASE_URL || 'https://messenger-crm-staging.onrender.com';
const SA = process.env.V_SA_TOKEN || process.env.SA_TOKEN || '';
if (!/^https:\/\/messenger-(crm|frontend)-staging\.onrender\.com$/.test(API) ||
    !/^https:\/\/messenger-frontend-staging\.onrender\.com$/.test(BASE_URL)) {
  throw new Error(`Refusing to run: not staging (${API}, ${BASE_URL})`);
}
const RUN = Date.now();
const SHOTS = 'tests/screenshots/v13-3-5-reply-ooo';

async function call(request, method, path, data) {
  const r = await request.fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${SA}` }, data });
  let body = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  return { status: r.status(), body };
}

async function poll(fn, what, timeoutMs = 240000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function inbound(request, lead, tag, subject, headers) {
  const object_data = {
    id: `qa-${RUN}-${lead.id}-${tag}`, thread_id: `qa-thread-${RUN}-${lead.id}`,
    from: [{ email: lead.email }], to: [{ email: 'neelmani.mishra@screen-magic.com' }],
    subject, body: subject.startsWith('Re:') ? "Sounds good, let's talk Thursday." : 'I am out of the office until Monday.',
  };
  if (headers) object_data.headers = headers;
  const r = await request.post(`${API}/webhooks/nylas`, { data: { data: { type: 'message.created', object_data } } });
  expect(r.status()).toBe(200);
}

const state = { leadIds: [], journeyIds: [] };

async function setup(request, label, withOooBranch) {
  const lead = await call(request, 'POST', '/api/leads', {
    first_name: 'Alternate CRM', last_name: `ReplyQA ${label} ${RUN}`, company: 'Alternate CRM QA — safe to delete',
    email: `neelmani.mishra+v1335${label}-${RUN}@screen-magic.com`, status: 'Lead Assigned',
  });
  expect(lead.status, JSON.stringify(lead.body)).toBe(200);
  state.leadIds.push(lead.body.id);
  const j = await call(request, 'POST', '/api/journeys', { name: `QA v13.3.5 reply/OOO ${label} ${RUN} (auto-archived)` });
  state.journeyIds.push(j.body.id);
  const branchOnEvent = { email_replied: 'replied' };
  if (withOooBranch) branchOnEvent.email_auto_replied = 'ooo';
  const task = (id, text) => ({ id, type: 'task', position: { x: 0, y: 300 }, data: { task_kind: 'custom', instructions: text, due_within_hours: 24 } });
  const graph = {
    nodes: [
      { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { event: 'status_changed', to_status: `QA-never-${RUN}` } },
      { id: 'w', type: 'wait', position: { x: 0, y: 100 }, data: { duration_hours: 0.03 } },
      { id: 'c', type: 'condition', position: { x: 0, y: 200 }, data: { timeout_hours: 24, branch_on_event: branchOnEvent, branch_on_timeout: 'no_reply' } },
      task('replied', '{{first_name}} replied — respond personally'),
      ...(withOooBranch ? [task('ooo', '{{first_name}} is away — follow up next week')] : []),
      task('no_reply', 'No reply yet — send the SMS'),
    ],
    edges: [{ id: 'a', source: 't', target: 'w' }, { id: 'b', source: 'w', target: 'c' }, { id: 'x', source: 'c', target: 'no_reply' }],
  };
  expect((await call(request, 'PUT', `/api/journeys/${j.body.id}/versions/${j.body.draft_version_id}`, { graph_definition: graph })).status).toBe(200);
  // A reply branch only runs with "Stop on reply" off (new cadences start with
  // it on; v13.4.0 refuses to publish the conflict).
  expect((await call(request, 'PATCH', `/api/journeys/${j.body.id}`, { stop_on_reply: false })).status).toBe(200);
  const pub = await call(request, 'POST', `/api/journeys/${j.body.id}/publish`);
  expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  expect((await call(request, 'POST', `/api/journeys/${j.body.id}/enroll`, { lead_ids: [lead.body.id] })).body.enrolled).toBe(1);
  const enr = await poll(async () => {
    const r = await call(request, 'GET', `/api/journeys/${j.body.id}/enrollments/${lead.body.id}`);
    return r.status === 200 && r.body.current_node_id === 'w' ? r.body : null;
  }, 'the lead to be on the wait step');
  return { lead: lead.body, journeyId: j.body.id, enr };
}

function nodeAfter(request, s, skip) {
  return poll(async () => {
    const r = await call(request, 'GET', `/api/journeys/${s.journeyId}/enrollments/${s.lead.id}`);
    return r.body && !skip.includes(r.body.current_node_id) ? r.body : null;
  }, `the lead to move past ${skip.join('/')}`, 300000);
}
const nodeAfterWait = (request, s) => nodeAfter(request, s, ['w', 'c']);

test.describe.configure({ mode: 'default', retries: 0 });

test.describe('v13.3.5 replies & out-of-office during a wait (staging)', () => {
  test.skip(!SA, 'SA_TOKEN not set');
  test.setTimeout(420000);

  test.afterAll(async ({ request }) => {
    for (const id of state.journeyIds) {
      const a = await call(request, 'POST', `/api/journeys/${id}/archive`, { confirm_exit_count: 0 });
      if (a.status === 409) await call(request, 'POST', `/api/journeys/${id}/archive`, { confirm_exit_count: 1 });
    }
    if (state.leadIds.length) await call(request, 'POST', '/api/admin/leads/bulk-delete', { lead_ids: state.leadIds });
  });

  test('an out-of-office during the wait takes the "auto-replied" branch', async ({ request, page }) => {
    const s = await setup(request, 'ooo', true);
    await inbound(request, s.lead, 'ooo', 'Automatic reply: Out of Office');
    const enr = await nodeAfterWait(request, s);
    expect(enr.current_node_id, JSON.stringify(enr.history)).toBe('ooo');
    expect(enr.history.map((h) => h.event_type)).toContain('event_received');   // remembered during the wait

    // The rep sees the auto-reply on the lead, flagged as such.
    const emails = await call(request, 'GET', `/api/email/lead/${s.lead.id}/emails`);
    const ooo = (emails.body.emails || emails.body || []).find((e) => (e.subject || '').includes('Out of Office'));
    expect(ooo && ooo.is_auto_reply, JSON.stringify(emails.body).slice(0, 500)).toBe(true);

    await page.addInitScript(() => { try { localStorage.setItem('leadDetailHub', 'on'); localStorage.setItem('alternate:my-tasks-tour-seen', '1'); } catch { /* */ } });
    await page.goto(`${BASE_URL}/?token=${SA}`);
    await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
    await page.evaluate((id) => { window.location.hash = `#lead-detail/${id}`; }, s.lead.id);
    // The OOO branch's follow-up task exists for this run's enrollment.
    // (created one scheduler tick after the branch, so poll for it)
    await poll(async () => {
      const tasks = (await call(request, 'GET', `/api/leads/${s.lead.id}/tasks`)).body || [];
      return tasks.find((t) => t.journey_node_id === 'ooo' && t.journey_enrollment_id === enr.enrollment_id);
    }, 'the out-of-office follow-up task', 120000);
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${SHOTS}-ooo-branch.png`, fullPage: true });
  });

  test('a real reply after an out-of-office wins: "replied" branch', async ({ request }) => {
    const s = await setup(request, 'oooreply', true);
    await inbound(request, s.lead, 'ooo', 'Out of Office: back Monday');
    await inbound(request, s.lead, 'reply', 'Re: quick question');
    const enr = await nodeAfterWait(request, s);
    expect(enr.current_node_id, JSON.stringify(enr.history)).toBe('replied');
  });

  test('a cadence with no auto-reply branch keeps waiting after an out-of-office (it is not a reply)', async ({ request }) => {
    const s = await setup(request, 'ooowait', false);
    await inbound(request, s.lead, 'ooo', 'Automatic reply: away this week', [{ name: 'Auto-Submitted', value: 'auto-replied' }]);
    await nodeAfter(request, s, ['w']);                 // reached the condition...
    await new Promise((r) => setTimeout(r, 75000));     // ...and 2+ scheduler ticks later is STILL there
    const enr = (await call(request, 'GET', `/api/journeys/${s.journeyId}/enrollments/${s.lead.id}`)).body;
    expect(enr.current_node_id, JSON.stringify(enr.history)).toBe('c');   // an OOO is not a reply
    expect(enr.pending_status.reason).toBe('waiting');
    await inbound(request, s.lead, 'reply', 'Re: actually, yes');   // ...which now branches at once
    const after = await poll(async () => {
      const r = await call(request, 'GET', `/api/journeys/${s.journeyId}/enrollments/${s.lead.id}`);
      return r.body && r.body.current_node_id !== 'c' ? r.body : null;
    }, 'the real reply to branch the condition', 60000);
    expect(after.current_node_id).toBe('replied');
  });
});
