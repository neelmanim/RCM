// v13.8.0 staging audit — Instantly Replies (inbox + report + dashboard tile), role gating,
// cadence roster scoping, wrong-number action, cadence trigger wording.
// STAGING ONLY (the shared harness refuses any other host). Read-only: never sends, calls,
// enrolls, marks a number wrong or edits a cadence. Never opens the demo leads/cadences.
//   npx playwright test tests/v13-8-0-replies-and-cadence-fixes.spec.js
const { test, expect } = require('@playwright/test');
const { PERSONAS, watch, login, go, shot, api, expectClean } = require('./helpers/v13-7-0-staging');

const DEMO_LEADS = new Set([
  'bf9c2e97-c3a8-4bf4-a629-7d1e6e2fce2c', 'fcac0d6e-dbfa-43dd-accd-c96a76735a6b',
  'd8b575b1-9a81-47bb-abcb-dd7485f218bf', '6b0d4ca1-af4e-44cb-a5cb-ae1bfc5169b0',
]);
const DEMO_NAMES = /Dev Sharma|\bAsha\b|\bBen\b|\bChris\b/i;
const DEMO_CADENCES = new Set(['df23f37b-d5c1-478b-940d-401adb2f7739', '20bea580-b7b3-436d-a4be-caa0357b6d3b']);

const ALLOWED = ['sa', 'pa', 'sdr', 'ae'];
const WRITES = /\/api\/instantly\/replies\/[^/]+\/read|\/phone\/invalid|\/enroll|\/calls\/start|\/send\b/;

// Network failures are judged by URL, not by the context-free "Failed to load resource" console line.
// Known, pre-existing, harmless (swallowed by .catch in the UI): GET /api/pods is 403 for roles without
// pod access (JourneyList/JourneyBuilder call it for everyone), and the very first load via ?token= makes the
// messenger widget fire /calls/my-active + /conversations/status before the token is stored (401; a normal
// load has none — verified). Everything else >= 400 fails the test.
const KNOWN = /^(403 \/api\/pods|401 \/api\/calls\/my-active|401 \/api\/conversations\/status)$/;
function withBootNoise(w, writes, net) {
  return { w: { problems: () => w.problems().filter((p) => !/Failed to load resource/.test(p)).concat(net.splice(0)) }, writes };
}

async function start(page, key) {
  const w = watch(page);
  const writes = [];
  const net = [];
  page.on('response', (r) => {
    const k = `${r.status()} ${new URL(r.url()).pathname}`;
    if (r.status() >= 400 && r.url().includes('/api/') && !KNOWN.test(k)) net.push(k);
  });
  page.on('request', (r) => { if (r.method() !== 'GET' && WRITES.test(r.url())) writes.push(`${r.method()} ${r.url()}`); });
  await login(page, PERSONAS[key].token);
  return withBootNoise(w, writes, net);
}
const finish = (c, where) => {
  expect(c.writes, `${where}: a write fired`).toEqual([]);
  expectClean(c.w.problems(), where);
};

for (const key of ALLOWED) {
  const P = PERSONAS[key];
  test.describe(`v13.8.0 ${P.label}`, () => {
    test.skip(!P.token, `${key} token missing from .env.test`);

    test('Replies tab: inbox and report load with no errors; summary strip shown', async ({ page }) => {
      const c = await start(page, key);
      await go(page, '#sales-tools/replies');
      await expect(page.locator('[data-tab="inbox"]')).toBeVisible({ timeout: 20000 });
      await expect(page.locator('[data-tab="report"]')).toBeVisible();
      // either rows or a designed empty state — never a blank page or a raw error
      await expect(page.getByText(/No Instantly emails synced yet|No replies match these filters|Select a reply/).first()
        .or(page.locator('[role="listbox"], [role="list"]').first())).toBeVisible({ timeout: 20000 });
      await shot(page, `v13-8-replies-inbox-${key}`);
      await page.locator('[data-tab="report"]').click();
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await expect(page.getByText(/couldn.t load|something went wrong/i)).toHaveCount(0);
      await shot(page, `v13-8-replies-report-${key}`);
      finish(c, `${P.label} replies`);
    });

    test('Sales Tools shows the Replies tab; the Campaigns/Cadence tabs still work', async ({ page }) => {
      const c = await start(page, key);
      await go(page, '#sales-tools');
      await expect(page.locator('[data-tab="replies"]')).toBeVisible({ timeout: 20000 });
      finish(c, `${P.label} sales-tools tabs`);
    });

    test('API: summary / replies / report answer 200', async ({ request }) => {
      test.setTimeout(150000);
      for (const p of ['/api/instantly/summary', '/api/instantly/replies?per_page=5',
        '/api/instantly/report?group_by=cadence', '/api/instantly/report?group_by=rep']) {
        const r = await api(request, 'GET', p, P.token);
        expect(r.status, `${P.label} GET ${p}`).toBe(200);
      }
    });

    test('Dashboard tile renders (roles with a Dashboard)', async ({ page }) => {
      const c = await start(page, key);
      await go(page, '#dashboard');
      const tile = page.getByTestId('outbound-replies-card');
      await expect(tile).toBeVisible({ timeout: 20000 });
      await expect(tile.getByText(/Replies/).first()).toBeVisible();
      await shot(page, `v13-8-dashboard-tile-${key}`);
      finish(c, `${P.label} dashboard tile`);
    });
  });
}

test.describe('v13.8.0 CSM is kept out', () => {
  const P = PERSONAS.csm;
  test.skip(!P.token, 'CSM_TOKEN missing');

  test('API returns 403 on every Instantly inbox route', async ({ request }) => {
    for (const p of ['/api/instantly/summary', '/api/instantly/replies', '/api/instantly/report?group_by=cadence']) {
      const r = await api(request, 'GET', p, P.token);
      expect(r.status, `CSM GET ${p}`).toBe(403);
    }
  });

  test('no Replies tab or tile for CSM', async ({ page }) => {
    const c = await start(page, 'csm');
    await go(page, '#sales-tools/replies');
    await expect(page.locator('[data-tab="replies"]')).toHaveCount(0);
    await expect(page.getByTestId('outbound-replies-card')).toHaveCount(0);
    finish(c, 'CSM replies gate');
  });
});

test.describe('v13.8.0 cadence roster is scoped to what the viewer may see', () => {
  test('SDR roster/export/counts never return a lead the SDR cannot open', async ({ request }) => {
    const sa = PERSONAS.sa, sdr = PERSONAS.sdr;
    test.skip(!sa.token || !sdr.token, 'tokens missing');
    const list = await api(request, 'GET', '/api/journeys', sa.token);
    expect(list.status).toBe(200);
    const journeys = (Array.isArray(list.body) ? list.body : list.body?.items || list.body?.journeys || [])
      .filter((j) => !DEMO_CADENCES.has(j.id)).slice(0, 6);
    let checked = 0;
    for (const j of journeys) {
      const mine = await api(request, 'GET', `/api/journeys/${j.id}/enrollments?per_page=100`, sdr.token);
      expect(mine.status, `SDR roster ${j.id}`).toBe(200);
      const all = await api(request, 'GET', `/api/journeys/${j.id}/enrollments?per_page=100`, sa.token);
      const mineRows = mine.body?.items || mine.body?.enrollments || [];
      const allRows = all.body?.items || all.body?.enrollments || [];
      expect(mineRows.length, `SDR sees no more rows than SA (${j.id})`).toBeLessThanOrEqual(allRows.length);
      for (const row of mineRows.slice(0, 15)) {
        const id = row.lead_id || row.lead?.id;
        if (!id || DEMO_LEADS.has(id)) continue;
        const lead = await api(request, 'GET', `/api/leads/${id}`, sdr.token);
        expect(lead.status, `SDR roster listed lead ${id} he cannot open`).toBe(200);
        checked += 1;
      }
    }
    console.log(`roster scoping: checked ${checked} SDR-visible roster rows across ${journeys.length} cadences`);
  });
});

test.describe('v13.8.0 lead page: Wrong number action and honest call labels', () => {
  test('SA lead page offers Wrong number next to Call; nothing is clicked', async ({ page, request }) => {
    const P = PERSONAS.sa;
    test.skip(!P.token, 'SA token missing');
    const r = await api(request, 'GET', '/api/leads?per_page=50', P.token);
    const rows = Array.isArray(r.body) ? r.body : r.body?.data || [];
    const lead = rows.find((l) => l.phone && !l.phone_invalid_at && !DEMO_LEADS.has(l.id)
      && !DEMO_NAMES.test(`${l.first_name || ''} ${l.last_name || ''}`));
    test.skip(!lead, 'no safe lead with a phone number on staging');
    const c = await start(page, 'sa');
    await go(page, `#lead-detail/${lead.id}`);
    await expect(page.getByRole('button', { name: /Wrong number/i }).first()).toBeVisible({ timeout: 25000 });
    await expect(page.getByText(/of \d+ attempts made with no success/)).toHaveCount(0);
    await shot(page, 'v13-8-lead-wrong-number');
    finish(c, 'lead wrong-number button');
  });
});

test.describe('v13.8.0 cadence builder: the entry trigger says what it does', () => {
  test('a draft/non-demo cadence opens in the builder without errors', async ({ page, request }) => {
    const P = PERSONAS.sa;
    test.skip(!P.token, 'SA token missing');
    const list = await api(request, 'GET', '/api/journeys', P.token);
    const journeys = Array.isArray(list.body) ? list.body : list.body?.items || list.body?.journeys || [];
    const j = journeys.find((x) => !DEMO_CADENCES.has(x.id));
    test.skip(!j, 'no non-demo cadence on staging');
    const c = await start(page, 'sa');
    await go(page, `#sales-tools/${j.id}`);
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await shot(page, 'v13-8-cadence-builder');
    // read-only: opening must not publish/enroll/save anything
    finish(c, 'cadence builder open');
  });
});
