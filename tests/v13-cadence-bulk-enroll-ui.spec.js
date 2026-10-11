// Live repro, for the stakeholder call: does the Leads Hub "Enroll in
// Cadence" bulk action genuinely work end to end (Super Admin selects a
// lead, enrolls it, cadence actually runs)? Not previously click-tested —
// earlier v13.1.0 coverage enrolled via direct API call, not this UI path.
//
// STAGING ONLY. Refuses to run against any other host (see guard below).
//   V_SA_TOKEN=... npx playwright test tests/v13-cadence-bulk-enroll-ui.spec.js
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API = process.env.API_BASE_URL || 'https://messenger-crm-staging.onrender.com';
const SA = process.env.V_SA_TOKEN || '';
if (!/^https:\/\/messenger-(crm|frontend)-staging\.onrender\.com$/.test(API) ||
    !/^https:\/\/messenger-frontend-staging\.onrender\.com$/.test(BASE_URL)) {
  throw new Error(`Refusing to run: not staging (${API}, ${BASE_URL})`);
}

const RUN = Date.now();
const TEST_EMAIL = `neelmani.mishra+bulkenrollqa-${RUN}@screen-magic.com`;
const LEAD_NAME = `BulkEnrollQA-${RUN}`;
const JOURNEY_NAME = `QA bulk-enroll UI ${RUN} (auto-archived)`;
const SHOTS = 'tests/screenshots/v13-cadence-bulk-enroll';
const state = { leadId: null, journeyId: null };

async function call(request, method, path, token, data) {
  const r = await request.fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data });
  let body = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  return { status: r.status(), body };
}

test.describe.configure({ mode: 'serial', retries: 0 });

test.describe('v13 cadence enroll via Leads Hub bulk action (Super Admin)', () => {
  test.skip(!SA, 'V_SA_TOKEN is required');
  test.setTimeout(180000);

  test.afterAll(async ({ request }) => {
    if (state.journeyId) {
      const a = await call(request, 'POST', `/api/journeys/${state.journeyId}/archive`, SA, { confirm_exit_count: 0 });
      if (a.status === 409) await call(request, 'POST', `/api/journeys/${state.journeyId}/archive`, SA, { confirm_exit_count: 1 });
    }
    if (state.leadId) await call(request, 'POST', '/api/admin/leads/bulk-delete', SA, { lead_ids: [state.leadId] });
    console.log(`cleanup: lead ${state.leadId} deleted; cadence ${state.journeyId} archived`);
  });

  test('setup: a test lead and a published single-email cadence (dead trigger, matching the prod fix)', async ({ request }) => {
    const lead = await call(request, 'POST', '/api/leads', SA, {
      first_name: 'BulkEnrollQA', last_name: `${RUN}`, company: 'Alternate CRM QA — safe to delete',
      email: TEST_EMAIL, title: 'Ops Manager', status: 'Lead Assigned',
    });
    expect(lead.status, JSON.stringify(lead.body)).toBe(200);
    state.leadId = lead.body.id;

    const j = await call(request, 'POST', '/api/journeys', SA, { name: JOURNEY_NAME });
    expect(j.status, JSON.stringify(j.body)).toBe(200);
    state.journeyId = j.body.id;
    const graph = {
      nodes: [
        { id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: { event: 'status_changed', to_status: 'Cadence Manual Enroll Only' } },
        { id: 'e1', type: 'email', position: { x: 0, y: 100 }, data: {
          subject: `[TEST] Bulk-enroll UI check ${RUN} — please ignore`,
          body: `<p>Hi {{first_name}},</p><p>This confirms the Leads Hub Enroll-in-Cadence button works end to end. Please ignore.</p>`,
          body_format: 'html',
        } },
      ],
      edges: [{ id: 'a', source: 't', target: 'e1' }],
    };
    expect((await call(request, 'PUT', `/api/journeys/${state.journeyId}/versions/${j.body.draft_version_id}`, SA, { graph_definition: graph })).status).toBe(200);
    const pub = await call(request, 'POST', `/api/journeys/${state.journeyId}/publish`, SA);
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
  });

  test('SA selects the lead in Leads Hub and enrolls it via "Enroll in Cadence"', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('leadsHub', 'on');
        localStorage.setItem('alternate:leads-hub-tour-seen-v2', '1');
      } catch { /* */ }
    });
    await page.goto(`${BASE_URL}/?token=${SA}`);
    await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
    await page.evaluate(() => { window.location.hash = '#leads'; });
    await page.waitForSelector('text=Assign mode', { timeout: 30000 });

    const skipTour = page.getByRole('button', { name: 'Skip tour' });
    if (await skipTour.count()) await skipTour.click();
    // The Aircall drawer auto-opens and overlaps the fixed bottom BulkActionBar
    // (unrelated dialer widget, not part of this flow) — close it so later
    // clicks on "Enroll in Cadence" aren't intercepted by its iframe.
    const aircallClose = page.locator('[aria-label="Aircall"] button[aria-label="Close"], [aria-label="Aircall"] button:has-text("Close")');
    if (await aircallClose.count()) await aircallClose.first().click({ timeout: 5000 }).catch(() => {});
    const gotIt = page.getByRole('button', { name: 'Got it' });
    if (await gotIt.count()) await gotIt.click({ timeout: 5000 }).catch(() => {});

    // The test lead won't be on page 1 of 20,046 by default — search for it
    // within the Leads Hub's own filter bar, not the global nav search.
    // The list fetch occasionally fails client-side right after the Assign
    // mode toggle (direct curl against the same search confirms the backend
    // itself is fine) — reload and retry rather than fail on that blip.
    const search = page.getByPlaceholder('Search name, email, or company…');
    for (let attempt = 0; attempt < 4; attempt++) {
      await search.fill(LEAD_NAME);
      await page.waitForTimeout(2000);
      if (!(await page.getByText("Couldn't load leads").count())) break;
      await page.reload();
      await page.waitForSelector('text=Assign mode', { timeout: 30000 });
      const skip2 = page.getByRole('button', { name: 'Skip tour' });
      if (await skip2.count()) await skip2.click();
    }

    await page.getByRole('button', { name: 'Assign mode' }).click();
    const checkbox = page.getByRole('checkbox', { name: new RegExp(`Select.*${RUN}`) });
    await expect(checkbox).toBeVisible({ timeout: 30000 });
    await checkbox.check();

    await page.getByRole('button', { name: 'Enroll in Cadence' }).click();
    await page.getByText(JOURNEY_NAME, { exact: false }).click();
    await page.getByRole('button', { name: 'Enroll', exact: true }).click();

    await expect(page.getByText(/Enrolled 1\/1 lead/)).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: `${SHOTS}-enrolled-toast.png`, fullPage: true });
  });

  test('the enrollment is real: cadence actually ran and sent the email', async ({ request }) => {
    let enr;
    const end = Date.now() + 90000;
    while (Date.now() < end) {
      const r = await call(request, 'GET', `/api/journeys/${state.journeyId}/enrollments/${state.leadId}`, SA);
      enr = r.body;
      if (enr && ['completed', 'failed'].includes(enr.status)) break;
      await new Promise((res) => setTimeout(res, 5000));
    }
    expect(enr && enr.status, JSON.stringify(enr)).toBe('completed');

    const act = await call(request, 'GET', `/api/journeys/${state.journeyId}/activity`, SA);
    expect(JSON.stringify(act.body)).toContain(`Bulk-enroll UI check ${RUN}`);
  });
});
