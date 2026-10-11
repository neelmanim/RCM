// v13.x Playwright gap-coverage — closes the highest-priority gaps found by
// a coverage audit across v13.0.0-v13.1.0 (user directive: audit the whole
// v13 cycle across every persona, leave no gaps). Covers, in one run since
// they share one cadence/lead setup:
//   - v13.0.0 HTML table cadence emails (never exercised end to end)
//   - AE persona (existed only for login-smoke/refusal checks — never
//     completed a cadence Task via a real UI click)
//   - v13.0.4 cadence deep-linking (#sales-tools/{id})
//   - v13.0.1/13.0.3 admin UI additions (Webhook URL / Webhook Token fields)
// v13.0.6 reporting UI explicitly out of scope (deferred by user request).
// v13.0.3 SMS "+" regression already covered at the correct layer — real
// backend unit tests (test_conversations_service.py) — and can't
// be usefully re-verified live since Alternate Messenger's own delivery to
// non-Indian numbers is independently documented as unverified (not our bug).
//
// STAGING ONLY. Refuses to run against any other host.
//   V_SA_TOKEN=... V_AE_TOKEN=... npx playwright test tests/v13-gap-coverage.spec.js
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API = process.env.API_BASE_URL || 'https://messenger-crm-staging.onrender.com';
const T = { SA: process.env.V_SA_TOKEN || '', AE: process.env.V_AE_TOKEN || '' };
if (!/^https:\/\/messenger-(crm|frontend)-staging\.onrender\.com$/.test(API) ||
    !/^https:\/\/messenger-frontend-staging\.onrender\.com$/.test(BASE_URL)) {
  throw new Error(`Refusing to run: not staging (${API}, ${BASE_URL})`);
}

const RUN = Date.now();
const TEST_EMAIL = `neelmani.mishra+v13gapqa-${RUN}@screen-magic.com`;
const SHOTS = 'tests/screenshots/v13-gap-coverage';
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

test.describe('v13.x gap coverage (HTML tables, AE persona, deep-links, admin UI)', () => {
  test.skip(!T.SA || !T.AE, 'V_SA_TOKEN and V_AE_TOKEN are required');
  test.setTimeout(300000);

  test.afterAll(async ({ request }) => {
    // Archiving a journey does NOT close an already-open Task (same finding
    // as tests/v13-1-0-manual-email-approval.spec.js) — delete it explicitly
    // so a failed run never leaves a stray task for a real person (or the
    // next run's My Tasks locator) to collide with.
    if (state.leadId) {
      const tasks = await call(request, 'GET', `/api/leads/${state.leadId}/tasks`, T.SA).then((r) => r.body || []);
      for (const t of tasks) await call(request, 'DELETE', `/api/leads/${state.leadId}/tasks/${t.id}`, T.SA);
    }
    if (state.journeyId) {
      const a = await call(request, 'POST', `/api/journeys/${state.journeyId}/archive`, T.SA, { confirm_exit_count: 0 });
      if (a.status === 409) await call(request, 'POST', `/api/journeys/${state.journeyId}/archive`, T.SA, { confirm_exit_count: 1 });
    }
    if (state.leadId) await call(request, 'POST', '/api/admin/leads/bulk-delete', T.SA, { lead_ids: [state.leadId] });
    console.log(`cleanup: lead ${state.leadId} deleted; cadence ${state.journeyId} archived`);
  });

  test('1. AE creates their own lead', async ({ request }) => {
    const r = await call(request, 'POST', '/api/leads', T.AE, {
      first_name: 'Alternate CRM', last_name: `GapQA ${RUN}`, company: 'Alternate CRM QA — safe to delete',
      email: TEST_EMAIL, title: 'VP Sales', status: 'Lead Assigned',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    state.leadId = r.body.id;
  });

  test('2. SA builds a cadence: plain task -> HTML table email', async ({ request }) => {
    const j = await call(request, 'POST', '/api/journeys', T.SA, { name: `QA v13 gap coverage ${RUN} (auto-archived)` });
    expect(j.status, JSON.stringify(j.body)).toBe(200);
    state.journeyId = j.body.id;
    const graph = {
      nodes: [
        { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { event: 'status_changed', to_status: 'QA-never-used-status' } },
        { id: 'task', type: 'task', position: { x: 0, y: 100 }, data: {
          task_kind: 'research', title: 'QA plain research task', instructions: 'Look up {{company}} (QA)',
          outcomes: [], branch_on_outcome: {}, due_within_hours: 24 } },
        { id: 'e1', type: 'email', position: { x: 0, y: 200 }, data: {
          subject: `[TEST] HTML table cadence ${RUN} — please ignore`,
          body: '<p>Hi {{first_name}},</p><table border="1"><tr><th>Field</th><th>Value</th></tr>'
              + '<tr><td>Company</td><td>{{company}}</td></tr><tr><td>Title</td><td>{{title}}</td></tr></table>',
          body_format: 'html' } },
      ],
      edges: [{ id: 'a', source: 't', target: 'task' }, { id: 'b', source: 'task', target: 'e1' }],
    };
    expect((await call(request, 'PUT', `/api/journeys/${state.journeyId}/versions/${j.body.draft_version_id}`, T.SA, { graph_definition: graph })).status).toBe(200);
    const pub = await call(request, 'POST', `/api/journeys/${state.journeyId}/publish`, T.SA);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    const en = await call(request, 'POST', `/api/journeys/${state.journeyId}/enroll`, T.SA, { lead_ids: [state.leadId] });
    expect(en.body.enrolled, JSON.stringify(en.body)).toBe(1);
  });

  // ── AE persona: completes a cadence Task via a real UI click, not an API call ──
  test('3. AE completes the cadence Task step from My Tasks (real UI click)', async ({ page, request }) => {
    // The trigger -> task dispatch runs on the engine's scheduler tick, not
    // synchronously on enroll — confirm the task exists via the API first so
    // a slow tick doesn't look like a flaky selector miss in the UI.
    await poll(async () => (await call(request, 'GET', `/api/leads/${state.leadId}/tasks`, T.AE))
      .body?.find((t) => t.journey_node_id === 'task'), 'the Task step to be dispatched', 60000);

    await page.addInitScript(() => { try { localStorage.setItem('alternate:my-tasks-tour-seen', '1'); } catch { /* */ } });
    await page.goto(`${BASE_URL}/?token=${T.AE}`);
    await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
    await page.evaluate(() => { window.location.hash = '#my-tasks'; });
    // This run's own cadence row: the long-lived staging demo cadence also
    // triggers on "Lead Assigned" and parks its own task on the same lead.
    const row = page.locator('[data-tour="task-row"]', { hasText: String(RUN) }).filter({ hasText: 'QA v13 gap coverage' });
    await expect(row).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: `${SHOTS}-ae-my-tasks-before.png`, fullPage: true });
    // The checkbox optimistically updates the DOM before its PATCH resolves
    // (MyTasksHub.jsx toggleDone) — wait for the actual response, not just
    // the client-side class, or Playwright can tear down the page (closing
    // the in-flight request) before the server ever processes it.
    const [patchResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/tasks/') && r.request().method() === 'PATCH'),
      row.locator('input[type="checkbox"]').click(),
    ]);
    expect(patchResp.status()).toBe(200);
    await expect(row.locator('span, p', { hasText: 'QA plain research task' })).toHaveClass(/line-through/, { timeout: 15000 });
  });

  test('4. the HTML table email sends with merge fields resolved inside the table', async ({ request }) => {
    const done = await poll(async () => {
      const r = await call(request, 'GET', `/api/journeys/${state.journeyId}/enrollments/${state.leadId}`, T.SA);
      return r.body && ['completed', 'failed'].includes(r.body.status) ? r.body : null;
    }, 'the cadence to reach the email step and complete');
    expect(done.status, JSON.stringify(done)).toBe('completed');

    const emails = await call(request, 'GET', `/api/email/lead/${state.leadId}/emails`, T.AE);
    expect(emails.status, JSON.stringify(emails.body)).toBe(200);
    const sent = (emails.body.emails || []).find((e) => e.direction === 'outbound' && e.subject?.includes(String(RUN)));
    expect(sent, JSON.stringify(emails.body)).toBeTruthy();
    expect(sent.body_preview).toContain('<table');
    expect(sent.body_preview).toContain('Alternate CRM QA — safe to delete');   // {{company}} resolved
    expect(sent.body_preview).not.toContain('{{company}}');                 // never raw/unresolved
  });

  // ── v13.0.4 cadence deep-linking ──
  test('5. #sales-tools/{id} lands directly in the builder, not the list', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('alternate:cadence-builder-tour-seen', '1'); } catch { /* */ } });
    await page.goto(`${BASE_URL}/?token=${T.SA}`);
    await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
    await page.evaluate((id) => { window.location.hash = `#sales-tools/${id}`; }, state.journeyId);
    await expect(page.getByRole('heading', { name: new RegExp(`QA v13 gap coverage ${RUN}`) })).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: `${SHOTS}-deep-link-builder.png`, fullPage: true });
  });

  // ── v13.0.1/13.0.3 admin UI additions (read-only presence check — staging's
  // dialer provider is already "aircall", so no config is changed) ──
  test('6. Control Center Integrations shows the Webhook URL and Webhook Token fields', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('alternate:control-center-tour-seen', '1'); } catch { /* */ } });
    await page.goto(`${BASE_URL}/?token=${T.SA}`);
    await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
    await page.evaluate(() => { window.location.hash = '#control-center'; });
    await page.locator('[data-tab="integrations"]').click();
    await page.locator('[data-tab="calling"]').click();   // Integrations inner tabs since the 2026-10-05 reorg: Connections / Email Sending / Calling & Messaging / CRM Settings
    await expect(page.getByText('Aircall Configuration')).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabel('Webhook URL')).toBeVisible();
    await expect(page.getByLabel('Webhook Token')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}-admin-webhook-fields.png`, fullPage: true });
  });
});
