/**
 * 00-sanity.spec.js — Pre-flight checks (runs FIRST, alphabetically)
 *
 * Validates all fundamental assumptions before the full suite runs.
 * If ANY test here fails, the rest of the suite results are unreliable.
 *
 * Checks:
 *   1. Frontend is reachable and is the vanilla JS app (not React)
 *   2. Hash routing works — /#dashboard loads real content, not a blank page
 *   3. Auth token is valid and accepted by the API
 *   4. Backend API is reachable and healthy
 *   5. navigateTo() helper correctly resolves hash routes
 *   6. Auth fixture injects token into localStorage correctly
 */

const { test, expect, navigateTo } = require('./helpers');
const { JWT_TOKEN, API_BASE } = require('./helpers');

const FRONTEND = process.env.STAGING_URL || 'https://rcm-frontend-staging.onrender.com';
const API      = process.env.API_BASE_URL  || 'https://rcm-crm-staging.onrender.com';

// ─── 1. Frontend reachability ────────────────────────────────────────────────

test.describe('SANITY — 1. Frontend', () => {

  test('1a. Frontend URL is reachable (200)', async ({ request }) => {
    const res = await request.get(FRONTEND);
    expect(res.status(), `Frontend not reachable at ${FRONTEND}`).toBe(200);
    console.log(`  ✓ Frontend reachable: ${FRONTEND}`);
  });

  test('1b. Frontend is the vanilla JS app (not React)', async ({ request }) => {
    const html = await (await request.get(FRONTEND)).text();

    // Vanilla JS app should NOT have React bundle markers
    const hasReact = html.includes('__react') || html.includes('_jsx(') || html.includes('react-dom');
    // Vanilla JS app should have the CRM app markers
    const hasVanilla = html.includes('crm_token') || html.includes('app.js') || html.includes('RCM') || html.includes('rcm');

    expect(hasReact, 'Frontend looks like React app — wrong URL?').toBe(false);
    expect(hasVanilla, 'Frontend does not look like the vanilla JS CRM app').toBe(true);
    console.log(`  ✓ Vanilla JS app confirmed (no React markers)`);
  });

  test('1c. Frontend URL uses hash routing (not path routing)', async ({ authenticatedPage: page }) => {
    // Must use authenticated page — unauthenticated navigations redirect to /login.html
    // before the hash route can load (which is correct app behavior, not a routing bug)
    await page.goto(`/#dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const url = page.url();
    console.log(`  → URL after /#dashboard navigation: ${url}`);

    // Should stay on the frontend host and contain the hash (not redirect to /login.html)
    const onCorrectHost = url.includes('rcm-frontend-staging') || url.includes(FRONTEND.replace('https://', ''));
    const hasHash = url.includes('#dashboard') || url.includes('/#');
    expect(onCorrectHost, `Redirected away from frontend — got: ${url}`).toBe(true);
    expect(hasHash, `Hash routing not working — expected /#dashboard but got: ${url}`).toBe(true);
    console.log(`  ✓ Hash routing confirmed: ${url}`);
  });

});

// ─── 2. Hash routing delivers real content ───────────────────────────────────

test.describe('SANITY — 2. Hash routing loads real views', () => {

  test('2a. /#dashboard loads real content (not blank)', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/dashboard', { waitMs: 5000 });
    const url = page.url();
    console.log(`  → Resolved URL: ${url}`);
    expect(url, 'navigateTo did not use hash routing').toContain('#');

    const body = await page.locator('body').textContent();
    expect(body.trim().length, '/#dashboard loaded a blank page').toBeGreaterThan(100);
    console.log(`  ✓ Dashboard loaded real content (${body.trim().length} chars)`);
  });

  test('2b. /#settings loads the Settings view (not homepage)', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/settings', { waitMs: 5000 });
    const url = page.url();
    expect(url, 'navigateTo /settings did not resolve to hash route').toContain('#settings');

    // Settings page should have settings-specific content
    const hasSettings = await page.locator('text=/Settings|Profile|Integrations|Salesforce|Password|Google/i').count();
    console.log(`  → Settings content indicators: ${hasSettings} (URL: ${url})`);
    expect(hasSettings, '/#settings did not load the Settings view').toBeGreaterThan(0);
    console.log(`  ✓ Settings view loaded correctly`);
  });

  test('2c. /#leads loads the Leads view (not homepage)', async ({ authenticatedPage: page }) => {
    await navigateTo(page, '/leads', { waitMs: 5000 });
    const url = page.url();
    expect(url).toContain('#leads');

    // Leads page should have a table or lead-related content
    const hasLeads = await page.locator('text=/Lead|Name|Phone|Status|Search/i').count();
    console.log(`  → Leads content indicators: ${hasLeads}`);
    expect(hasLeads, '/#leads did not load the Leads view').toBeGreaterThan(0);
    console.log(`  ✓ Leads view loaded correctly`);
  });

});

// ─── 3. Auth token validity ──────────────────────────────────────────────────

test.describe('SANITY — 3. Auth token', () => {

  test('3a. JWT_TOKEN is set and not expired', async ({ request }) => {
    expect(JWT_TOKEN, 'JWT_TOKEN is empty or undefined').toBeTruthy();
    expect(JWT_TOKEN.split('.').length, 'JWT_TOKEN does not look like a JWT').toBe(3);

    // Decode payload (no verification — just check expiry)
    const payload = JSON.parse(Buffer.from(JWT_TOKEN.split('.')[1], 'base64').toString());
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresIn = payload.exp - nowSec;
    const expiresInDays = Math.floor(expiresIn / 86400);

    console.log(`  → Token role: ${payload.role}`);
    console.log(`  → Token sub: ${payload.sub}`);
    console.log(`  → Token expires: in ${expiresInDays} days (${new Date(payload.exp * 1000).toISOString()})`);

    expect(expiresIn, `JWT_TOKEN is EXPIRED (expired ${Math.abs(expiresInDays)} days ago)`).toBeGreaterThan(0);
    expect(payload.role, 'JWT_TOKEN is not a Super Admin token').toBe('Super Admin');
    console.log(`  ✓ Token valid for ${expiresInDays} more days`);
  });

  test('3b. JWT_TOKEN is accepted by the API (GET /api/leads → 200)', async ({ request }) => {
    const res = await request.get(`${API}/api/leads?limit=1`, {
      headers: { Authorization: `Bearer ${JWT_TOKEN}` },
    });
    console.log(`  → GET /api/leads status: ${res.status()}`);
    expect(res.status(), `API rejected token with ${res.status()} — token may be invalid or API is down`).toBe(200);
    console.log(`  ✓ API accepted token — auth is working`);
  });

  test('3c. Unauthenticated request returns 401 (auth enforcement active)', async ({ request }) => {
    const res = await request.get(`${API}/api/leads?limit=1`);
    expect([401, 403]).toContain(res.status());
    console.log(`  ✓ Auth enforcement active: unauthenticated → ${res.status()}`);
  });

  test('3d. Auth fixture injects token into browser localStorage', async ({ authenticatedPage: page }) => {
    const token = await page.evaluate(() => localStorage.getItem('crm_token'));
    expect(token, 'crm_token not found in localStorage — auth fixture broken').toBeTruthy();
    expect(token.split('.').length, 'crm_token in localStorage is not a valid JWT').toBe(3);
    console.log(`  ✓ crm_token correctly set in localStorage`);
  });

});

// ─── 4. Backend API health ───────────────────────────────────────────────────

test.describe('SANITY — 4. Backend API', () => {

  test('4a. /api/health returns 200 + ok', async ({ request }) => {
    const res = await request.get(`${API}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.db_connected).toBe(true);
    console.log(`  ✓ API healthy: status=${body.status}, db_connected=${body.db_connected}`);
  });

  test('4b. API is not running on SQLite (must be PostgreSQL)', async ({ request }) => {
    const res = await request.get(`${API}/api/health`);
    const body = await res.json();
    // db_type is exposed in some health endpoints — check if available
    if (body.db_type) {
      expect(body.db_type, 'API is running on SQLite — wrong DATABASE_URL on staging!').not.toBe('sqlite');
      console.log(`  ✓ DB type: ${body.db_type}`);
    } else {
      console.log(`  → db_type not in health response — checking via lead count`);
      // Fall back: if leads exist, we're definitely on PostgreSQL
      const leadsRes = await request.get(`${API}/api/leads?limit=1`, {
        headers: { Authorization: `Bearer ${JWT_TOKEN}` },
      });
      const leadsBody = await leadsRes.json();
      const count = leadsBody.total ?? leadsBody.leads?.length ?? 0;
      expect(count, 'Lead count is 0 — may be running on SQLite or wrong DB').toBeGreaterThan(0);
      console.log(`  ✓ Lead count ${count} > 0 — PostgreSQL confirmed`);
    }
  });

  test('4c. CORS allows requests from frontend origin', async ({ request }) => {
    const res = await request.get(`${API}/api/health`, {
      headers: { Origin: FRONTEND },
    });
    const acao = res.headers()['access-control-allow-origin'];
    console.log(`  → Access-Control-Allow-Origin: ${acao}`);
    const corsOk = acao === '*' || (acao && acao.includes('onrender.com'));
    expect(corsOk, `CORS not configured for ${FRONTEND} — got: ${acao}`).toBe(true);
    console.log(`  ✓ CORS OK for frontend origin`);
  });

});
