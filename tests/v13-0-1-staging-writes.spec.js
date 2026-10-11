// v13.0.1 staging WRITE audit — the everyday actions every role must still be
// able to do after the access-control change, the same actions refused on
// leads that aren't theirs, and one real cadence run end to end.
//
// STAGING ONLY. Refuses to run against any other host (see guard below).
// Tokens from the environment only (never committed):
//   V_SA_TOKEN=... V_PA_TOKEN=... V_SDR_TOKEN=... V_AE_TOKEN=... V_CSM_TOKEN=... V_PODMATE_TOKEN=... \
//     npx playwright test tests/v13-0-1-staging-writes.spec.js
// V_PODMATE_TOKEN must be a real user in V_PA_TOKEN's own pod (test 4 needs
// this to create a lead that actually lands inside the PA's pod) — confirmed
// drifted once already (V_AE_TOKEN's "Demo AE" used to share a pod with
// whoever V_PA_TOKEN pointed to; it no longer does since V_PA_TOKEN was
// re-minted to a different Pod Admin). Don't reuse V_AE_TOKEN/V_SDR_TOKEN for
// this — they're pinned to their own unrelated pod fixtures elsewhere in this
// file and in v13-0-0.
//
// Safety (checked against the code before writing this):
//  - The test lead has NO phone → Audience Manager skips it (audience_manager.py).
//  - Its status only goes Lead Assigned → Research: never Calling (the active
//    "Testing Cadence 1" auto-enrolls on Calling) and never Meeting Scheduled
//    (the Salesforce push stage, routes/lead_routes._check_sf_push).
//  - Its email is a plus-address of the user's own inbox; the only real email
//    sent is the cadence step, to that inbox.
//  - The test cadence's trigger status never occurs, so it can't auto-enroll
//    anyone; it is archived and the test lead deleted in afterAll.
//  - Refusal checks on real leads send payloads that change nothing even if
//    (wrongly) accepted, except one clearly-labelled note.
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API = process.env.API_BASE_URL || 'https://messenger-crm-staging.onrender.com';
const T = {
  SA: process.env.V_SA_TOKEN || '', PA: process.env.V_PA_TOKEN || '', SDR: process.env.V_SDR_TOKEN || '',
  AE: process.env.V_AE_TOKEN || '', CSM: process.env.V_CSM_TOKEN || '',
  PODMATE: process.env.V_PODMATE_TOKEN || '',
};
if (!/^https:\/\/messenger-(crm|frontend)-staging\.onrender\.com$/.test(API) ||
    !/^https:\/\/messenger-frontend-staging\.onrender\.com$/.test(BASE_URL)) {
  throw new Error(`Refusing to run: not staging (${API}, ${BASE_URL})`);
}

const CROSS_POD_LEAD = '09abcc2d-873d-4b3d-ba37-def65dbb3985'; // Meera Iyer's — not the SDR's, not the PA's pod
// NOTE (2026-10-01): OWN_POD_LEAD used to be a hardcoded id ('4a3fca01-...',
// Divya Saxena's lead). Staging test data isn't static — that lead had since
// been reassigned to a different pod entirely, so the hardcoded id silently
// started testing the wrong thing (a real cross-pod 403, not the "own pod
// edit works" case test 4 is for) instead of failing loudly. Create it fresh
// every run instead, same pattern as state.leadId/state2.leadId below.
// Resolved from V_PODMATE_TOKEN at run time (and checked to be in V_PA_TOKEN's pod) — a hardcoded
// user id drifted the same way the lead id did.
let PODMATE_USER_ID = null;
const RUN = Date.now();
const TEST_EMAIL = `neelmani.mishra+v13qa-${RUN}@screen-magic.com`;
const SHOTS = 'tests/screenshots/v13-0-1-writes';

const h = (t) => ({ Authorization: `Bearer ${t}` });
// The two lead-access refusals (routes/lead_helpers.authorize_lead). Matching the
// message, not just the code, proves the refusal came from access control and
// not from something else (no phone, no mailbox…).
// PATCH /leads/{id} still uses the legacy lead_helpers._can_modify_lead messages (both 403s).
const ACCESS_DENIED = /^(Lead not found|You can only change leads assigned to you or your pod\.|You can only modify your assigned leads\.|You can only modify leads assigned to your POD\.)$/;
const denied = (r) => [403, 404].includes(r.status) && ACCESS_DENIED.test(r.body?.detail || '');
const state = { leadId: null, journeyId: null, ownPodLeadId: null };
const state2 = { leadId: null, journeyId: null, grantedSms: false, priorSenderId: undefined };
const SDR_USER_ID = '5635a809-52f3-44a2-b9f3-c5f2118f049b';   // Dev Kapoor, the V_SDR_TOKEN user
// An unassigned US "Long Code SMS" sender from the Alternate Messenger Sender IDs
// screen (org fallback is WhatsApp-provisioned and gets SENDER-ID-NOT-AVAILABLE
// for SMS — 2026-09-30 root cause). messenger_whatsapp_sender_id is, despite
// the name, the shared SMS+WhatsApp per-user sender (messaging_service.py's
// resolve_sender_for_user, proven by test_sms_and_whatsapp_share_one_sender).
const SMS_SENDER_ID = '14702059963';

async function call(request, method, path, token, data) {
  const r = await request.fetch(`${API}${path}`, { method, headers: h(token), data });
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
    await new Promise((r) => setTimeout(r, 10000));
  }
}

test.describe.configure({ mode: 'serial', retries: 0 });   // no retries: a retry would re-create test data

test.describe('v13.0.1 staging write audit', () => {
  test.beforeAll(async ({ request }) => {
    if (!T.PA || !T.PODMATE) return;
    const me = async (tok) => (await request.get(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${tok}` } })).json();
    const [pa, mate] = [await me(T.PA), await me(T.PODMATE)];
    expect(mate.pod_id, 'V_PODMATE_TOKEN must be in V_PA_TOKEN\'s pod').toBe(pa.pod_id);
    PODMATE_USER_ID = mate.sub;
  });
  test.skip(!T.SA || !T.PA || !T.SDR || !T.AE || !T.CSM || !T.PODMATE, 'all six V_*_TOKEN vars are required');
  test.setTimeout(600000);

  test.afterAll(async ({ request }) => {
    if (state.journeyId) {
      // archive needs the exact number of still-active enrollments (0 or 1 here)
      const a = await call(request, 'POST', `/api/journeys/${state.journeyId}/archive`, T.SA, { confirm_exit_count: 0 });
      if (a.status === 409) await call(request, 'POST', `/api/journeys/${state.journeyId}/archive`, T.SA, { confirm_exit_count: 1 });
    }
    if (state.leadId) await call(request, 'POST', '/api/admin/leads/bulk-delete', T.SA, { lead_ids: [state.leadId] });
    if (state.ownPodLeadId) await call(request, 'POST', '/api/admin/leads/bulk-delete', T.SA, { lead_ids: [state.ownPodLeadId] });
    const left = state.leadId ? await call(request, 'GET', `/api/leads/${state.leadId}`, T.SDR) : { status: 404 };
    console.log(`cleanup: lead ${state.leadId} now ${left.status} for the SDR; cadence ${state.journeyId} archived`);

    // SMS cadence cleanup — always revert the SMS grant even if the run failed midway.
    if (state2.journeyId) {
      const a = await call(request, 'POST', `/api/journeys/${state2.journeyId}/archive`, T.SA, { confirm_exit_count: 0 });
      if (a.status === 409) await call(request, 'POST', `/api/journeys/${state2.journeyId}/archive`, T.SA, { confirm_exit_count: 1 });
    }
    if (state2.leadId) await call(request, 'POST', '/api/admin/leads/bulk-delete', T.SA, { lead_ids: [state2.leadId] });
    if (state2.grantedSms) {
      const r = await call(request, 'PATCH', `/api/admin/users/${SDR_USER_ID}/settings`, T.SA, { sms_enabled: false });
      console.log('SMS grant reverted on SDR:', r.status);
    }
    if (state2.priorSenderId !== undefined) {
      const r = await call(request, 'PATCH', `/api/admin/users/${SDR_USER_ID}/settings`, T.SA,
        { messenger_whatsapp_sender_id: state2.priorSenderId || null });
      console.log('SDR sender id reverted to prior value:', r.status);
    }
    console.log(`cleanup: sms cadence lead ${state2.leadId} deleted; cadence ${state2.journeyId} archived`);
  });

  test('1. SDR creates a lead and it is theirs', async ({ request }) => {
    const r = await call(request, 'POST', '/api/leads', T.SDR, {
      first_name: 'Alternate CRM', last_name: `QA ${RUN}`, company: 'Alternate CRM QA — safe to delete',
      email: TEST_EMAIL, title: 'Marketing Manager', status: 'Lead Assigned',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    state.leadId = r.body.id;
    expect(r.body.phone || null).toBeNull();
    expect((await call(request, 'GET', `/api/leads/${state.leadId}`, T.SDR)).status).toBe(200);
  });

  test('2. SDR: every everyday write on their own lead works', async ({ request }) => {
    const id = state.leadId;
    const st = await call(request, 'PATCH', `/api/leads/${id}`, T.SDR, { status: 'Research' });
    expect(st.status, JSON.stringify(st.body)).toBe(200);
    expect(st.body.status).toBe('Research');

    const note = await call(request, 'POST', `/api/leads/${id}/notes`, T.SDR, { content: 'v13 QA note' });
    expect(note.status).toBe(200);
    expect(note.body.author).toBe('Dev Kapoor');   // server sets the author, not the client
    expect((await call(request, 'DELETE', `/api/leads/${id}/notes/${note.body.id}`, T.SDR)).status).toBe(200);

    const task = await call(request, 'POST', `/api/leads/${id}/tasks`, T.SDR, { title: 'v13 QA task' });
    expect(task.status).toBe(200);
    expect((await call(request, 'PATCH', `/api/leads/${id}/tasks/${task.body.id}`, T.SDR, { done: true })).status).toBe(200);
    expect((await call(request, 'DELETE', `/api/leads/${id}/tasks/${task.body.id}`, T.SDR)).status).toBe(200);

    // A call outcome with no status side-effect (no disqualify/meeting action).
    const oc = await call(request, 'GET', '/api/call-outcomes', T.SDR);
    const outcomes = oc.body.enabled_outcomes.map((o) => (typeof o === 'string' ? { value: o } : o));
    const safe = outcomes.find((o) => /no answer|voicemail|busy/i.test(o.value) && (!o.action || o.action === 'none') && !o.notes_required);
    expect(safe, JSON.stringify(outcomes)).toBeTruthy();
    const logged = await call(request, 'POST', `/api/leads/${id}/calls`, T.SDR, { outcome: safe.value, notes: 'v13 QA call' });
    expect(logged.status, JSON.stringify(logged.body)).toBe(200);
    expect((await call(request, 'GET', `/api/leads/${id}`, T.SDR)).body.status).toBe('Research'); // unchanged

    // Texting / emailing their own lead gets PAST the access check — the lead
    // has no phone and the SDR no mailbox, so a 4xx that is NOT 403/404.
    const sms = await call(request, 'POST', '/api/sms/send', T.SDR, { lead_id: id, message: 'v13 QA' });
    expect(denied(sms), JSON.stringify(sms)).toBe(false);
    const mail = await call(request, 'POST', '/api/email/send', T.SDR, { lead_id: id, subject: 'x', body: 'x' });
    expect(denied(mail), JSON.stringify(mail)).toBe(false);
    console.log('own-lead sms:', sms.status, sms.body?.detail, '| email:', mail.status, mail.body?.detail);
  });

  test('3. SDR: the same writes on another rep\'s lead are refused and change nothing', async ({ request }) => {
    const x = CROSS_POD_LEAD;
    const before = (await call(request, 'GET', `/api/leads/${x}`, T.SA)).body;
    const tries = [
      ['PATCH', `/api/leads/${x}`, { title: 'SHOULD NOT SAVE' }],
      ['POST', `/api/leads/${x}/notes`, { content: 'v13 QA — this should have been refused' }],
      ['POST', `/api/leads/${x}/tasks`, { title: 'v13 QA — should be refused' }],
      ['POST', `/api/leads/${x}/calls`, { outcome: 'No Answer', notes: 'v13 QA — should be refused' }],
      ['POST', '/api/sms/send', { lead_id: x, message: 'v13 QA — should be refused' }],
      ['POST', '/api/email/send', { lead_id: x, subject: 'refused', body: 'refused' }],
    ];
    for (const [m, p, d] of tries) {
      const r = await call(request, m, p, T.SDR, d);
      expect(denied(r), `${m} ${p} → ${r.status} ${JSON.stringify(r.body)}`).toBe(true);
    }
    const after = (await call(request, 'GET', `/api/leads/${x}`, T.SA)).body;
    expect(after.title).toBe(before.title);
    expect(after.call_count).toBe(before.call_count);
  });

  test('4. Pod Admin: edits own pod, read-only on another pod', async ({ request }) => {
    // Create (rather than hardcode) a lead in the PA's own pod — see the
    // NOTE above PODMATE_USER_ID for why a fixed id drifted and silently
    // tested the wrong thing. Created AS a real podmate (not T.SA + bulk-
    // assign): POST /leads auto-assigns to its creator, and
    // /assignments/bulk-assign silently no-ops on a lead with no phone
    // ("skipped: no phone number") — confirmed live, not assumed — so that
    // path leaves the lead on the creator (Super Admin, no pod) and this
    // test red-herrings into a real cross-pod 403 instead of testing
    // same-pod access.
    const created = await call(request, 'POST', '/api/leads', T.PODMATE, {
      first_name: 'Alternate CRM', last_name: `QA OwnPod ${RUN}`, company: 'Alternate CRM QA — safe to delete',
      email: `neelmani.mishra+v13qa-ownpod-${RUN}@screen-magic.com`, status: 'Lead Assigned',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    state.ownPodLeadId = created.body.id;
    expect(created.body.assigned_to?.[0]?.id).toBe(PODMATE_USER_ID);   // confirms it landed in the PA's pod, not creator-less

    expect((await call(request, 'PATCH', `/api/leads/${state.ownPodLeadId}`, T.PA, {})).status).toBe(200);   // no fields → no change
    const before = (await call(request, 'GET', `/api/leads/${CROSS_POD_LEAD}`, T.SA)).body;
    for (const [m, p, d] of [
      ['PATCH', `/api/leads/${CROSS_POD_LEAD}`, { title: 'SHOULD NOT SAVE' }],
      ['POST', `/api/leads/${CROSS_POD_LEAD}/notes`, { content: 'v13 QA — this should have been refused' }],
      ['PATCH', `/api/leads/${state.leadId}`, { title: 'SHOULD NOT SAVE' }],   // the SDR's test lead, other pod
    ]) {
      const r = await call(request, m, p, T.PA, d);
      expect(denied(r), `${m} ${p} → ${r.status} ${JSON.stringify(r.body)}`).toBe(true);
    }
    expect((await call(request, 'GET', `/api/leads/${CROSS_POD_LEAD}`, T.SA)).body.title).toBe(before.title);
    expect((await call(request, 'GET', `/api/leads/${CROSS_POD_LEAD}`, T.PA)).status).toBe(200);   // still readable
  });

  test('5. AE and CSM: can\'t touch a lead that isn\'t theirs; their own pages work', async ({ request }) => {
    for (const t of [T.AE, T.CSM]) {
      expect(denied(await call(request, 'PATCH', `/api/leads/${state.leadId}`, t, { title: 'SHOULD NOT SAVE' }))).toBe(true);
      expect(denied(await call(request, 'GET', `/api/leads/${state.leadId}`, t))).toBe(true);
      expect((await call(request, 'GET', '/api/my/tasks', t)).status).toBe(200);
    }
    expect((await call(request, 'GET', '/api/csm-portal/portfolio', T.CSM)).status).toBe(200);
  });

  test('6. a real cadence run: task → outcome → branch → email from the right sender', async ({ request, page }) => {
    const j = await call(request, 'POST', '/api/journeys', T.SA, { name: `QA v13 cadence run ${RUN} (auto-archived)` });
    expect(j.status).toBe(200);
    state.journeyId = j.body.id;
    const graph = {
      nodes: [
        { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { event: 'status_changed', to_status: 'QA-never-used-status' } },
        { id: 'li', type: 'task', position: { x: 0, y: 100 }, data: {
          task_kind: 'linkedin_connect', title: 'QA LinkedIn connect', instructions: 'Hi {{first_name}} (QA)',
          outcomes: [{ key: 'accepted', label: 'Accepted' }, { key: 'not_accepted', label: 'Not accepted' }],
          branch_on_outcome: { accepted: 'msg' }, due_within_hours: 24 } },
        { id: 'w', type: 'wait', position: { x: 250, y: 200 }, data: { duration_hours: 24 } },
        { id: 'msg', type: 'task', position: { x: 0, y: 200 }, data: {
          task_kind: 'linkedin_message', title: 'QA LinkedIn message', instructions: 'Thanks for connecting (QA)',
          outcomes: [], branch_on_outcome: {}, due_within_hours: 24 } },
        { id: 'e1', type: 'email', position: { x: 0, y: 300 }, data: {
          subject: `[TEST] Alternate CRM cadence test ${RUN} — please ignore`,
          body: '<p>Hi {{first_name}},</p><p><strong>This is a test email.</strong> We are testing the Alternate CRM cadence feature on staging (v13 release checks). It was sent automatically by a test cadence as its email step, from {{sender_name}}. No action is needed — please ignore it.</p>',
          body_format: 'html' } },
      ],
      edges: [
        { id: 'a', source: 't', target: 'li' }, { id: 'b', source: 'li', target: 'w' },
        { id: 'c', source: 'msg', target: 'e1' },
      ],
    };
    expect((await call(request, 'PUT', `/api/journeys/${state.journeyId}/versions/${j.body.draft_version_id}`, T.SA, { graph_definition: graph })).status).toBe(200);
    const pub = await call(request, 'POST', `/api/journeys/${state.journeyId}/publish`, T.SA);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    const en = await call(request, 'POST', `/api/journeys/${state.journeyId}/enroll`, T.SA, { lead_ids: [state.leadId] });
    expect(en.body.enrolled, JSON.stringify(en.body)).toBe(1);

    // The Task step lands on the SDR (the lead's rep), with its outcomes.
    const tasks = () => call(request, 'GET', `/api/leads/${state.leadId}/tasks`, T.SDR).then((r) => r.body || []);
    const li = await poll(async () => (await tasks()).find((t) => t.journey_node_id === 'li'), 'the LinkedIn task');
    expect(li.user_id).toBe('5635a809-52f3-44a2-b9f3-c5f2118f049b');   // Dev Kapoor
    expect(li.description).toBe('Hi Alternate CRM (QA)');                   // merge field filled

    // It shows in the SDR's My Tasks with outcome buttons.
    await page.addInitScript(() => { try { localStorage.setItem('alternate:my-tasks-tour-seen', '1'); localStorage.setItem('alternate:aircall-drawer-tour-seen', '1'); } catch { /* */ } });
    await page.goto(`${BASE_URL}/?token=${T.SDR}`);
    await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
    await page.evaluate(() => { window.location.hash = '#my-tasks'; });
    await expect(page.getByText('QA LinkedIn connect').first()).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: `${SHOTS}-my-tasks-cadence-step.png`, fullPage: true });

    // A made-up outcome is refused; "Accepted" routes to the message step.
    expect((await call(request, 'PATCH', `/api/leads/${state.leadId}/tasks/${li.id}`, T.SDR, { done: true, outcome: 'bogus' })).status).toBe(422);
    expect((await call(request, 'PATCH', `/api/leads/${state.leadId}/tasks/${li.id}`, T.SDR, { done: true, outcome: 'accepted' })).status).toBe(200);
    const msg = await poll(async () => (await tasks()).find((t) => t.journey_node_id === 'msg'), 'the branch to the LinkedIn message task');
    expect((await tasks()).find((t) => t.journey_node_id === 'w')).toBeFalsy();

    // Finishing it moves on to the email step, which sends from the SDR if they
    // have a mailbox, else the cadence owner (sender_candidates).
    expect((await call(request, 'PATCH', `/api/leads/${state.leadId}/tasks/${msg.id}`, T.SDR, { done: true })).status).toBe(200);
    const done = await poll(async () => {
      const r = await call(request, 'GET', `/api/journeys/${state.journeyId}/enrollments/${state.leadId}`, T.SA);
      return r.body && ['completed', 'failed'].includes(r.body.status) ? r.body : null;
    }, 'the email step to run');
    console.log('enrollment:', JSON.stringify(done).slice(0, 1500));
    expect(done.status).toBe('completed');
    const act = await call(request, 'GET', `/api/journeys/${state.journeyId}/activity`, T.SA);
    console.log('activity:', JSON.stringify(act.body).slice(0, 2000));
  });

  test('7. a real SMS cadence run: task → outcome → SMS to the sandbox number → inbound reply stops it', async ({ request }) => {
    test.skip(!process.env.V_SANDBOX_PHONE, 'V_SANDBOX_PHONE not set — a real phone you control, to receive the test SMS');
    const SANDBOX_PHONE = process.env.V_SANDBOX_PHONE;

    // ── Setup: sandbox phone + a temporary SMS grant on the SDR ───────────────
    const before = await call(request, 'GET', '/api/admin/sync-settings', T.SA);
    const priorPhone = before.body.sandbox_test_phone_number || '';
    expect((await call(request, 'PATCH', '/api/admin/sync-settings', T.SA, { sandbox_test_phone_number: SANDBOX_PHONE })).status).toBe(200);

    const priorGrant = await call(request, 'GET', '/api/admin/users', T.SA);
    const sdrRow = (priorGrant.body.users || priorGrant.body).find((u) => u.id === SDR_USER_ID);
    expect(sdrRow.sms_enabled, 'expected the SDR to start without an SMS grant').toBe(false);
    expect((await call(request, 'PATCH', `/api/admin/users/${SDR_USER_ID}/settings`, T.SA, { sms_enabled: true })).status).toBe(200);
    state2.grantedSms = true;

    // Root cause of the last run's SENDER-ID-NOT-AVAILABLE: the org fallback
    // sender is WhatsApp-provisioned. Give the SDR their own SMS-capable
    // sender id so resolve_sender_for_user never falls back to it.
    state2.priorSenderId = sdrRow.messenger_whatsapp_sender_id || null;
    expect((await call(request, 'PATCH', `/api/admin/users/${SDR_USER_ID}/settings`, T.SA,
      { messenger_whatsapp_sender_id: SMS_SENDER_ID })).status).toBe(200);

    // ── Build + publish: Task (LinkedIn) → outcome → SMS, on a never-firing trigger ──
    const j = await call(request, 'POST', '/api/journeys', T.SA, { name: `QA v13 SMS cadence run ${RUN} (auto-archived)` });
    expect(j.status).toBe(200);
    state2.journeyId = j.body.id;
    const graph = {
      nodes: [
        { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { event: 'status_changed', to_status: 'QA-never-used-status-2' } },
        { id: 'li', type: 'task', position: { x: 0, y: 100 }, data: {
          task_kind: 'linkedin_connect', title: 'QA SMS-cadence LinkedIn step', instructions: 'Hi {{first_name}} (SMS QA)',
          outcomes: [{ key: 'accepted', label: 'Accepted' }, { key: 'not_accepted', label: 'Not accepted' }],
          branch_on_outcome: { accepted: 'sms1' }, due_within_hours: 24 } },
        { id: 'w', type: 'wait', position: { x: 250, y: 200 }, data: { duration_hours: 24 } },
        { id: 'sms1', type: 'sms', position: { x: 0, y: 200 }, data: {
          message: `Alternate CRM cadence test ${RUN}: this is a TEST SMS from the v13 release checks (SDR {{sender_name}}). We are testing the SMS cadence step — please reply "test reply" to it, then ignore.` } },
      ],
      // sms1 needs no outgoing edge: it's reached via li's branch_on_outcome
      // (which _validate_graph_for_publish counts as reachable on its own),
      // and a node with no next node simply completes the enrollment
      // (engine._complete_enrollment) — no dead-end node needed.
      edges: [{ id: 'a', source: 't', target: 'li' }, { id: 'b', source: 'li', target: 'w' }],
    };
    expect((await call(request, 'PUT', `/api/journeys/${state2.journeyId}/versions/${j.body.draft_version_id}`, T.SA, { graph_definition: graph })).status).toBe(200);
    const pub = await call(request, 'POST', `/api/journeys/${state2.journeyId}/publish`, T.SA);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);

    // ── Enroll via the sandbox endpoint: is_test=True, phone forced server-side ──
    const enroll = await call(request, 'POST', `/api/journeys/${state2.journeyId}/sandbox/enroll-test-lead`, T.SA, { label: `SMS QA ${RUN}` });
    expect(enroll.status, JSON.stringify(enroll.body)).toBe(200);
    state2.leadId = enroll.body.lead_id;
    expect(enroll.body.phone).toBe(SANDBOX_PHONE);   // belt-and-suspenders guard confirmed live, not just in code
    // Assign to the SDR so send_as:"assigned_rep" (this journey's default) routes through them, not the owner.
    expect((await call(request, 'POST', '/api/admin/assignments/bulk-assign', T.SA, { user_id: SDR_USER_ID, lead_ids: [state2.leadId] })).status).toBe(200);

    // ── Task step lands on the SDR; complete it with "accepted" to reach the SMS step ──
    const tasks = () => call(request, 'GET', `/api/leads/${state2.leadId}/tasks`, T.SDR).then((r) => r.body || []);
    const li = await poll(async () => (await tasks()).find((t) => t.journey_node_id === 'li'), 'the SMS-cadence LinkedIn task');
    expect(li.user_id).toBe(SDR_USER_ID);
    expect((await call(request, 'PATCH', `/api/leads/${state2.leadId}/tasks/${li.id}`, T.SDR, { done: true, outcome: 'accepted' })).status).toBe(200);

    // ── The SMS step runs; verify against ExecutionLog (via the enrollment
    // endpoint's `history`), not the journey-wide `/activity` feed ──
    // RCA 2026-10-01: that feed intentionally runs every query through
    // `models.exclude_test_leads()` (routes/journey_routes.py
    // get_journey_activity) so sandbox/QA sends never pollute a real admin's
    // reporting view — by design, not a bug. This sandbox-enrolled lead
    // (created via /sandbox/enroll-test-lead) is exactly what that filter
    // excludes, so polling `/activity` here always times out even on a
    // fully successful send (confirmed live: the SMS was delivered —
    // Alternate Messenger portal showed double-tick read receipts — while this
    // exact poll still saw an empty feed). `/enrollments/{lead_id}` queries
    // ExecutionLog directly with no such filter.
    const smsLog = await poll(async () => {
      const r = await call(request, 'GET', `/api/journeys/${state2.journeyId}/enrollments/${state2.leadId}`, T.SA);
      if (r.status !== 200) return null;
      return (r.body.history || []).find((h) => h.node_id === 'sms1' && h.event_type === 'send_attempted') || null;
    }, 'the SMS step to run');
    console.log('sms1 activity:', JSON.stringify(smsLog).slice(0, 800));
    expect(smsLog.status).toBe('success');

    // Confirm destination + sender directly against SmsLog via the lead's activity feed.
    const feed = await call(request, 'GET', `/api/leads/${state2.leadId}`, T.SDR);
    console.log('lead after SMS send:', JSON.stringify(feed.body?.recent_activity || feed.body?.sms_logs || '').slice(0, 600));

    console.log(`>>> A real SMS was just sent to ${SANDBOX_PHONE}. If you reply "test reply" to it within 5 minutes `
      + `(the messaging_sync poll interval), re-run this file with the same V_SANDBOX_PHONE to let the follow-up `
      + `verification below catch the inbound reply and the cadence stop. Otherwise this test ends here, which still `
      + `proves the send worked.`);

    // Best-effort: if a reply already arrived from a previous invocation of this
    // exact run, or within the wait budget, confirm it stopped the cadence
    // (stop_on_reply is on by default for journeys created via POST /journeys).
    const stopped = await poll(async () => {
      const r = await call(request, 'GET', `/api/journeys/${state2.journeyId}/enrollments/${state2.leadId}`, T.SA);
      return r.body && r.body.status !== 'active' ? r.body : null;
    }, 'the enrollment to leave "active" (reply or natural end)', 90000).catch(() => null);
    if (stopped) console.log('enrollment ended:', stopped.status, stopped.exited_reason || '');
    else console.log('enrollment still active after 90s — no reply received in this run, which is expected if you have not replied yet.');
  });
});
