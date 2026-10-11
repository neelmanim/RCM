// v13.1.0 manual-email cadence approval step (Viren's request) — staging
// write audit. An email step with send_mode="manual" pauses the cadence,
// parks a merge-resolved draft as a Task (kind="email_approval") on the
// lead's rep, and only sends once the rep approves (optionally editing
// subject/body) — never auto-sends on a missed deadline.
//
// STAGING ONLY. Refuses to run against any other host (see guard below).
// Tokens from the environment only (never committed):
//   V_SA_TOKEN=... V_SDR_TOKEN=... \
//     npx playwright test tests/v13-1-0-manual-email-approval.spec.js
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API = process.env.API_BASE_URL || 'https://messenger-crm-staging.onrender.com';
const T = {
  SA: process.env.V_SA_TOKEN || '', SDR: process.env.V_SDR_TOKEN || '',
};
if (!/^https:\/\/messenger-(crm|frontend)-staging\.onrender\.com$/.test(API) ||
    !/^https:\/\/messenger-frontend-staging\.onrender\.com$/.test(BASE_URL)) {
  throw new Error(`Refusing to run: not staging (${API}, ${BASE_URL})`);
}

const SDR_USER_ID = '5635a809-52f3-44a2-b9f3-c5f2118f049b';   // Dev Kapoor, the V_SDR_TOKEN user
const RUN = Date.now();
const TEST_EMAIL = `neelmani.mishra+v1310qa-${RUN}@screen-magic.com`;
const SHOTS = 'tests/screenshots/v13-1-0-manual-email';
const state = { leadId: null, journeyId: null };

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

test.describe.configure({ mode: 'serial', retries: 0 });

test.describe('v13.1.0 manual-email cadence approval', () => {
  test.skip(!T.SA || !T.SDR, 'V_SA_TOKEN and V_SDR_TOKEN are required');
  test.setTimeout(300000);

  test.afterAll(async ({ request }) => {
    // Archiving a journey does NOT close an already-parked manual-email
    // Task — found running this spec (not a v13.1.0 regression, the same
    // would be true of any open cadence Task). Delete it explicitly so a
    // failed run never leaves a draft cluttering the SDR's My Tasks for
    // the next run (or a real person) to stumble on.
    if (state.leadId) {
      const tasks = await call(request, 'GET', `/api/leads/${state.leadId}/tasks`, T.SA).then((r) => r.body || []);
      for (const t of tasks) {
        if (t.kind === 'email_approval') await call(request, 'DELETE', `/api/leads/${state.leadId}/tasks/${t.id}`, T.SA);
      }
    }
    if (state.journeyId) {
      const a = await call(request, 'POST', `/api/journeys/${state.journeyId}/archive`, T.SA, { confirm_exit_count: 0 });
      if (a.status === 409) await call(request, 'POST', `/api/journeys/${state.journeyId}/archive`, T.SA, { confirm_exit_count: 1 });
    }
    if (state.leadId) await call(request, 'POST', '/api/admin/leads/bulk-delete', T.SA, { lead_ids: [state.leadId] });
    console.log(`cleanup: lead ${state.leadId} deleted; cadence ${state.journeyId} archived`);
  });

  test('1. SDR creates the test lead', async ({ request }) => {
    const r = await call(request, 'POST', '/api/leads', T.SDR, {
      first_name: 'Alternate CRM', last_name: `ManualEmailQA ${RUN}`, company: 'Alternate CRM QA — safe to delete',
      email: TEST_EMAIL, title: 'Ops Manager', status: 'Lead Assigned',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    state.leadId = r.body.id;
  });

  test('2. SA builds and publishes a cadence with a manual-approval email step', async ({ request }) => {
    const j = await call(request, 'POST', '/api/journeys', T.SA, { name: `QA v13.1.0 manual-email ${RUN} (auto-archived)` });
    expect(j.status, JSON.stringify(j.body)).toBe(200);
    state.journeyId = j.body.id;
    const graph = {
      nodes: [
        { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { event: 'status_changed', to_status: 'QA-never-used-status' } },
        { id: 'e1', type: 'email', position: { x: 0, y: 100 }, data: {
          subject: `[TEST] Manual approval cadence ${RUN} — please ignore`,
          body: '<p>Hi {{first_name}},</p><p>This is a manual-approval cadence email test (v13.1.0). Please ignore.</p>',
          body_format: 'html', send_mode: 'manual', due_within_hours: 24,
        } },
      ],
      edges: [{ id: 'a', source: 't', target: 'e1' }],
    };
    expect((await call(request, 'PUT', `/api/journeys/${state.journeyId}/versions/${j.body.draft_version_id}`, T.SA, { graph_definition: graph })).status).toBe(200);
    const pub = await call(request, 'POST', `/api/journeys/${state.journeyId}/publish`, T.SA);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    const en = await call(request, 'POST', `/api/journeys/${state.journeyId}/enroll`, T.SA, { lead_ids: [state.leadId] });
    expect(en.body.enrolled, JSON.stringify(en.body)).toBe(1);
  });

  let taskId;
  test('3. enrollment parks a draft on the SDR instead of sending automatically', async ({ request }) => {
    // Match on this run's enrollment, not just node id 'e1': another active
    // cadence triggering on "Lead Assigned" (e.g. the staging demo cadence)
    // can park its own 'e1' task on the same lead.
    const enrollmentId = await poll(async () => {
      const r = await call(request, 'GET', `/api/journeys/${state.journeyId}/enrollments/${state.leadId}`, T.SA);
      return r.status === 200 ? r.body.enrollment_id : null;
    }, 'the enrollment');
    const tasks = () => call(request, 'GET', `/api/leads/${state.leadId}/tasks`, T.SDR).then((r) => r.body || []);
    const task = await poll(async () => (await tasks()).find((t) => t.journey_enrollment_id === enrollmentId && t.journey_node_id === 'e1'), 'the manual-email approval task');
    taskId = task.id;
    expect(task.kind).toBe('email_approval');
    expect(task.draft_subject).toContain(String(RUN));
    expect(task.draft_body).toContain('Alternate CRM');   // {{first_name}} merge-filled

    // Nothing sent yet — enrollment is still parked on this node, not completed.
    const enr = await call(request, 'GET', `/api/journeys/${state.journeyId}/enrollments/${state.leadId}`, T.SA);
    expect(enr.body.status).toBe('active');
  });

  // My Tasks lists every open task for this SDR, not just this run's — scope
  // to the one whose value contains this run's RUN id rather than assuming
  // there's exactly one "Email subject" field on the page.
  async function findRunSubjectInput(page) {
    const inputs = page.locator('input[aria-label="Email subject"]');
    await expect(inputs.first()).toBeVisible({ timeout: 30000 });
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const el = inputs.nth(i);
      if ((await el.inputValue()).includes(String(RUN))) return el;
    }
    throw new Error(`No "Email subject" field found containing run id ${RUN} (${count} candidates on page)`);
  }

  test('4. the draft renders editable in My Tasks (SDR)', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('alternate:my-tasks-tour-seen', '1'); } catch { /* */ } });
    await page.goto(`${BASE_URL}/?token=${T.SDR}`);
    await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
    await page.evaluate(() => { window.location.hash = '#my-tasks'; });
    const subjectInput = await findRunSubjectInput(page);
    await expect(subjectInput).toHaveValue(new RegExp(String(RUN)));
    const card = subjectInput.locator('xpath=..');
    await expect(card.getByLabel('Email body')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Send' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}-my-tasks-draft.png`, fullPage: true });
  });

  test('5a. the legacy (default) Lead Detail page never offers a plain checkbox for it', async ({ page }) => {
    // Lead Detail defaults to the legacy vanilla-JS page unless 'leadDetailHub'
    // is opted in (frontend/js/app.js:513) — that page's generic task checkbox
    // (views/lead_detail.js renderTasks) used to PATCH {done:true} with no
    // subject/body override, which silently sends the UNREVIEWED parked draft
    // the instant a rep ticks it, thinking it's an ordinary task. Found live
    // on staging by this spec; fixed in views/lead_detail.js to hide the
    // checkbox for kind="email_approval" and point to My Tasks instead.
    await page.addInitScript(() => { try { localStorage.setItem('alternate:my-tasks-tour-seen', '1'); } catch { /* */ } });
    await page.goto(`${BASE_URL}/?token=${T.SDR}`);
    await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
    await page.evaluate((id) => { window.location.hash = `#lead-detail/${id}`; }, state.leadId);
    // Every approval task on the lead (other active cadences, e.g. the staging
    // demo one, can park their own) — none may offer a plain checkbox.
    const taskItems = page.locator('.task-item', { hasText: 'Review & send email' });
    await expect(taskItems.first()).toBeVisible({ timeout: 30000 });
    await expect(taskItems.locator('input.task-check')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}-legacy-no-checkbox.png`, fullPage: true });
  });

  test('5b. the draft renders editable in the React Lead Detail\'s Tasks panel (opted in)', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('alternate:my-tasks-tour-seen', '1');
        localStorage.setItem('leadDetailHub', 'on');
      } catch { /* */ }
    });
    await page.goto(`${BASE_URL}/?token=${T.SDR}`);
    await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
    await page.evaluate((id) => { window.location.hash = `#lead-detail/${id}`; }, state.leadId);
    await findRunSubjectInput(page);
    await page.screenshot({ path: `${SHOTS}-lead-detail-draft.png`, fullPage: true });
  });

  test('6. approving with an edited subject sends it and completes the cadence', async ({ request }) => {
    const editedSubject = `[TEST] EDITED by QA ${RUN}`;
    const approve = await call(request, 'PATCH', `/api/leads/${state.leadId}/tasks/${taskId}`, T.SDR,
      { done: true, subject: editedSubject });
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);

    const enr = await poll(async () => {
      const r = await call(request, 'GET', `/api/journeys/${state.journeyId}/enrollments/${state.leadId}`, T.SA);
      return r.body && ['completed', 'failed'].includes(r.body.status) ? r.body : null;
    }, 'the manual email to send and the cadence to complete');
    expect(enr.status, JSON.stringify(enr)).toBe('completed');

    // The approved send is tracked exactly like an automated one — same
    // activity/engagement pipeline, no special-casing.
    const act = await call(request, 'GET', `/api/journeys/${state.journeyId}/activity`, T.SA);
    const body = JSON.stringify(act.body);
    expect(body).toContain(editedSubject);
    console.log('activity:', body.slice(0, 1500));
  });
});
