// v13.1.1 / v13.3.4 — full click-through for both non-admin roles: an AE
// and an SDR each (1) build, save, and publish their own cadence and (2) the
// SDR enrolls one of their own leads into a cadence via "Enroll in Cadence" —
// not just button visibility, the real actions through to a running
// cadence. Complements v13-1-1-non-admin-cadence-access.spec.js (visibility
// only) and v13-cadence-bulk-enroll-ui.spec.js (Super Admin only).
//
// STAGING ONLY. Refuses to run against any other host (see guard below).
//   V_AE_TOKEN=... V_SDR_TOKEN=... V_SA_TOKEN=... \
//     npx playwright test tests/v13-1-1-non-admin-cadence-full-flow.spec.js
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API = process.env.API_BASE_URL || 'https://messenger-crm-staging.onrender.com';
const SA = process.env.V_SA_TOKEN || ''; // owns cleanup + the owner-send-cadence case

if (!/^https:\/\/messenger-(crm|frontend)-staging\.onrender\.com$/.test(API) ||
    !/^https:\/\/messenger-frontend-staging\.onrender\.com$/.test(BASE_URL)) {
  throw new Error(`Refusing to run: not staging (${API}, ${BASE_URL})`);
}

async function call(request, method, path, token, data) {
  const r = await request.fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data });
  let body = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  return { status: r.status(), body };
}

async function poll(fn, what, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

test.describe.configure({ mode: 'serial', retries: 0 });

// ── Roles 1a/1b: AE and SDR each build their own cadence end to end ────────
// v13.3.4 RCA: this block used to stop as soon as the cadence existed, so it
// never noticed that the builder then opened READ-ONLY for the rep and that
// save/publish 403'd (both still gated on Pod Admin+). It now drives the
// builder through a real Save, then saves a full graph and publishes it.
for (const [label, envVar] of [['AE', 'V_AE_TOKEN'], ['SDR', 'V_SDR_TOKEN']]) {
  test.describe(`v13.3.4 — ${label} builds, saves, and publishes their own cadence`, () => {
    const TOKEN = process.env[envVar] || '';
    test.skip(!TOKEN || !SA, `${envVar} and V_SA_TOKEN are required`);
    test.setTimeout(120000);
    const state = { journeyId: null };

    test.afterAll(async ({ request }) => {
      if (state.journeyId) {
        const a = await call(request, 'POST', `/api/journeys/${state.journeyId}/archive`, SA, { confirm_exit_count: 0 });
        if (a.status === 409) await call(request, 'POST', `/api/journeys/${state.journeyId}/archive`, SA, { confirm_exit_count: 1 });
      }
    });

    test(`${label}: New Cadence opens an EDITABLE builder and Save succeeds`, async ({ page, request }) => {
      const name = `${label}-built cadence ${Date.now()} (auto-archived)`;
      await page.addInitScript(() => {
        try {
          localStorage.setItem('alternate:sales-tools-tour-seen', '1');
          localStorage.setItem('alternate:cadence-rep-tour-seen-v2', '1');
          localStorage.setItem('alternate:cadence-builder-v13-tour-seen', '1');
        } catch { /* */ }
      });
      await page.goto(`${BASE_URL}/?token=${TOKEN}`);
      await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
      await page.evaluate(() => { window.location.hash = '#sales-tools'; });
      await page.getByRole('button', { name: 'New Cadence' }).click();
      await page.getByLabel('Cadence name').fill(name);
      await page.getByRole('button', { name: 'Create', exact: true }).click();

      const created = await poll(async () => {
        const r = await call(request, 'GET', '/api/journeys', TOKEN);
        return (r.body || []).find((j) => j.name === name);
      }, `the ${label}-created cadence to appear via the API`);
      state.journeyId = created.id;
      expect(created.can_edit).toBe(true);

      // The builder must be editable for its owner — no read-only banner.
      const triggerBtn = page.getByRole('button', { name: /^Trigger$/ });
      await expect(triggerBtn).toBeVisible({ timeout: 30000 });
      await expect(page.getByText(/^Read-only/)).toHaveCount(0);

      await triggerBtn.click();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible({ timeout: 30000 });
      await page.screenshot({ path: `tests/screenshots/v13-3-4-${label.toLowerCase()}-builder-saved.png`, fullPage: true });
    });

    test(`${label}: can save a full cadence and publish it`, async ({ request }) => {
      const j = await call(request, 'GET', `/api/journeys/${state.journeyId}`, TOKEN);
      const graph = {
        nodes: [
          { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { event: 'status_changed', to_status: 'QA-never-used-status' } },
          { id: 'k1', type: 'task', position: { x: 0, y: 100 }, data: { task_kind: 'research', title: 'QA research task', instructions: '', outcomes: [], branch_on_outcome: {}, due_within_hours: 24 } },
        ],
        edges: [{ id: 'a', source: 't', target: 'k1' }],
      };
      const save = await call(request, 'PUT', `/api/journeys/${state.journeyId}/versions/${j.body.version_id}`, TOKEN, { graph_definition: graph });
      expect(save.status, JSON.stringify(save.body)).toBe(200);
      const pub = await call(request, 'POST', `/api/journeys/${state.journeyId}/publish`, TOKEN);
      expect(pub.status, JSON.stringify(pub.body)).toBe(200);
      expect(pub.body.status).toBe('active');
    });
  });
}

// ── Role 2: SDR (Dev Kapoor) — enroll their own lead end to end ─────────────
test.describe('v13.1.1 — SDR enrolls their own lead end to end', () => {
  const SDR = process.env.V_SDR_TOKEN || '';
  test.skip(!SDR || !SA, 'V_SDR_TOKEN and V_SA_TOKEN are required');
  test.setTimeout(90000);
  const RUN = Date.now();
  const LEAD_NAME = `SDRQA${RUN}`;
  const state = { leadId: null, journeyId: null };

  test.afterAll(async ({ request }) => {
    if (state.journeyId) {
      const a = await call(request, 'POST', `/api/journeys/${state.journeyId}/archive`, SA, { confirm_exit_count: 0 });
      if (a.status === 409) await call(request, 'POST', `/api/journeys/${state.journeyId}/archive`, SA, { confirm_exit_count: 1 });
    }
    if (state.leadId) await call(request, 'POST', '/api/admin/leads/bulk-delete', SA, { lead_ids: [state.leadId] });
  });

  test('setup: SA publishes a cadence; SDR creates and owns a lead', async ({ request }) => {
    const j = await call(request, 'POST', '/api/journeys', SA, { name: `QA SDR-enroll ${RUN} (auto-archived)` });
    state.journeyId = j.body.id;
    const graph = {
      nodes: [
        { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { event: 'status_changed', to_status: 'Cadence Manual Enroll Only' } },
        { id: 'e1', type: 'email', position: { x: 0, y: 100 }, data: { subject: `[TEST] SDR-enroll ${RUN}`, body: '<p>Hi {{first_name}},</p><p>Please ignore.</p>', body_format: 'html' } },
      ],
      edges: [{ id: 'a', source: 't', target: 'e1' }],
    };
    await call(request, 'PUT', `/api/journeys/${j.body.id}/versions/${j.body.draft_version_id}`, SA, { graph_definition: graph });
    const pub = await call(request, 'POST', `/api/journeys/${state.journeyId}/publish`, SA);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);

    const lead = await call(request, 'POST', '/api/leads', SDR, {
      first_name: LEAD_NAME, last_name: 'Test', email: `${LEAD_NAME}@example.com`, status: 'Lead Assigned',
    });
    expect(lead.status, JSON.stringify(lead.body)).toBe(200);
    state.leadId = lead.body.id; // POST /api/leads as the SDR assigns it to them
  });

  test('SDR selects their lead in Leads Hub and enrolls it via Enroll in Cadence', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('leadsHub', 'on');
        localStorage.setItem('alternate:leads-hub-tour-seen-v2', '1');
      } catch { /* */ }
    });
    await page.goto(`${BASE_URL}/?token=${SDR}`);
    await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
    await page.evaluate(() => { window.location.hash = '#leads'; });
    await page.waitForSelector('text=Select Leads', { timeout: 30000 });

    const search = page.getByPlaceholder('Search name, email, or company…');
    for (let attempt = 0; attempt < 4; attempt++) {
      await search.fill(LEAD_NAME);
      await page.waitForTimeout(2000);
      if (!(await page.getByText("Couldn't load leads").count())) break;
      await page.reload();
      await page.waitForSelector('text=Select Leads', { timeout: 30000 });
    }

    await page.getByRole('button', { name: 'Select Leads' }).click();
    const checkbox = page.getByRole('checkbox', { name: new RegExp(LEAD_NAME) });
    await expect(checkbox).toBeVisible({ timeout: 30000 });
    await checkbox.check();

    await page.getByRole('button', { name: 'Enroll in Cadence' }).click();
    await page.getByText(`QA SDR-enroll ${RUN}`, { exact: false }).click();
    await page.getByRole('button', { name: 'Enroll', exact: true }).click();
    await expect(page.getByText(/Enrolled 1\/1 lead/)).toBeVisible({ timeout: 30000 });
  });

  test('the enrollment is real: it ran and sent the email', async ({ request }) => {
    const enr = await poll(async () => {
      const r = await call(request, 'GET', `/api/journeys/${state.journeyId}/enrollments/${state.leadId}`, SA);
      return r.body && ['completed', 'failed'].includes(r.body.status) ? r.body : null;
    }, 'the SDR-enrolled cadence to complete');
    expect(enr.status, JSON.stringify(enr)).toBe('completed');
  });
});
