/**
 * v12.5.0 staging audit — covers every area touched by this release:
 *   1. Backend on 12.5.0 and healthy.
 *   2. Login page responsive at desktop / tablet(768) / mobile(375), plus
 *      the new access-request copy and terms/privacy links.
 *   3. terms.html / privacy.html load standalone.
 *   4. Call List lead_count matches the scoped /leads?call_list_id= queue
 *      (the "Outbound 6, nothing displayed" bug).
 *   5. Control Center > Team & Access renders the pending-access-requests
 *      card path without erroring (Super Admin only).
 *   6. AE Pipeline / CSM Portal islands still mount (StageSelect refactor).
 *   7. Power Dialer island still mounts (CurrentCallCard last-note change).
 *
 * Token via env so it isn't committed: SA_TOKEN.
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API_BASE = process.env.STAGING_API || 'https://messenger-crm-staging.onrender.com';
const SA_TOKEN = process.env.SA_TOKEN;

const issues = [];
const logIssue = (area, detail) => { console.error(`FAIL [${area}] ${detail}`); issues.push(`[${area}] ${detail}`); };
const logOk = (area, detail) => console.log(`OK ${area}: ${detail}`);

function watchErrors(page, sink) {
  page.on('pageerror', (e) => sink.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|net::ERR_|Failed to load resource|aircall/i.test(t)) return;
    sink.push(`console: ${t}`);
  });
}

async function login(page) {
  await page.addInitScript(() => {
    try { void localStorage.length; } catch { return; }
    ['sales-tools', 'control-center', 'daily-digest', 'cadence-readonly',
     'my-settings', 'leaderboard', 'aircall-drawer', 'ae-pipeline', 'csm-portal'].forEach((t) =>
      localStorage.setItem(`alternatecrm:${t}-tour-seen`, '1'));
    localStorage.setItem('leadsHub', 'on');
  });
  await page.goto(`${BASE_URL}/?token=${SA_TOKEN}`);
  await page.waitForSelector('nav >> text=Dashboard', { timeout: 45_000 });
  const drawerClose = page.locator('.nh-aircall-drawer__header .nh-overlay-close');
  if (await drawerClose.count() > 0) await drawerClose.first().click().catch(() => {});
}

async function goHash(page, hash) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(3500);
}

test.beforeAll(() => {
  if (!SA_TOKEN) throw new Error('SA_TOKEN env var is required');
});

test.describe('v12.5.0', () => {
  test.setTimeout(240_000);

  test('backend is on 12.5.0 and healthy', async ({ request }) => {
    const shallow = await (await request.get(`${API_BASE}/api/health`)).json();
    const deep = await (await request.get(`${API_BASE}/api/health/deep`)).json();
    if (shallow.version !== '12.5.0') logIssue('health', `version is ${shallow.version}, expected 12.5.0`);
    else if (!deep.db_tables_accessible) logIssue('health', 'db_tables_accessible false');
    else logOk('health', `version=${shallow.version} db_tables_accessible=${deep.db_tables_accessible}`);
  });

  test('login page responsive at desktop/tablet/mobile', async ({ page }) => {
    const errs = [];
    watchErrors(page, errs);
    const breakpoints = [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'tablet-768', width: 768, height: 1024 },
      { name: 'mobile-375', width: 375, height: 812 },
    ];
    for (const bp of breakpoints) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.goto(`${BASE_URL}/login.html`);
      await page.waitForSelector('text=From Leads to Revenue', { timeout: 20_000 }).catch(() => {});

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) logIssue('login-responsive', `${bp.name}: horizontal overflow of ${overflow}px`);
      else logOk('login-responsive', `${bp.name}: no horizontal overflow`);

      await page.screenshot({ path: `tests/screenshots/v12-5-0-login-${bp.name}.png`, fullPage: true });
    }
  });

  test('login page has the smart access-request copy and legal links', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/login.html`);
    await page.waitForLoadState('networkidle');

    const bodyText = await page.textContent('body');
    if (!/we'll let your admin know/i.test(bodyText)) logIssue('login-access-request', 'missing "New to Alternate CRM... let your admin know" copy');
    else logOk('login-access-request', 'request-access copy present');

    const termsHref = await page.locator('a[href*="terms.html"]').first().getAttribute('href').catch(() => null);
    const privacyHref = await page.locator('a[href*="privacy.html"]').first().getAttribute('href').catch(() => null);
    if (!termsHref) logIssue('login-legal-links', 'no link to terms.html found');
    else logOk('login-legal-links', `terms link: ${termsHref}`);
    if (!privacyHref) logIssue('login-legal-links', 'no link to privacy.html found');
    else logOk('login-legal-links', `privacy link: ${privacyHref}`);

    await page.goto(`${BASE_URL}/login.html?error=unauthorized`);
    await page.waitForTimeout(1500);
    const toastText = await page.textContent('body');
    if (!/let your admin know/i.test(toastText)) logIssue('login-toast', 'unauthorized toast still has old copy');
    else logOk('login-toast', 'unauthorized toast has updated copy');
  });

  test('terms.html and privacy.html load standalone', async ({ page, request }) => {
    for (const [path, marker] of [['terms.html', /terms of use|alternatecrm/i], ['privacy.html', /privacy policy/i]]) {
      const res = await request.get(`${BASE_URL}/${path}`);
      if (res.status() !== 200) { logIssue('legal-pages', `${path} returned ${res.status()}`); continue; }
      const body = await res.text();
      if (!marker.test(body)) logIssue('legal-pages', `${path} missing expected content`);
      else logOk('legal-pages', `${path} loads with expected content`);
    }
  });

  test('Call List lead_count matches the scoped /leads queue', async ({ request }) => {
    const listsRes = await request.get(`${API_BASE}/api/call-lists`, { headers: { Authorization: `Bearer ${SA_TOKEN}` } });
    if (!listsRes.ok()) { logIssue('call-list-count', `GET /call-lists returned ${listsRes.status()}`); return; }
    const listsBody = await listsRes.json();
    const lists = Array.isArray(listsBody) ? listsBody : listsBody.call_lists;
    if (!Array.isArray(lists) || lists.length === 0) { logOk('call-list-count', 'no call lists to check on staging'); return; }

    let mismatches = 0;
    for (const cl of lists.slice(0, 5)) {
      const leadsRes = await request.get(`${API_BASE}/api/leads?call_list_id=${cl.id}&per_page=500`, { headers: { Authorization: `Bearer ${SA_TOKEN}` } });
      if (!leadsRes.ok()) { logIssue('call-list-count', `GET /leads?call_list_id=${cl.id} returned ${leadsRes.status()}`); continue; }
      const body = await leadsRes.json();
      const actual = typeof body.total === 'number' ? body.total : (Array.isArray(body.data) ? body.data.length : null);
      if (actual === null) { logIssue('call-list-count', `unexpected /leads response shape for list ${cl.id}: ${JSON.stringify(body).slice(0, 200)}`); continue; }
      if (cl.lead_count !== actual) {
        mismatches += 1;
        logIssue('call-list-count', `list "${cl.name}" (${cl.id}): lead_count=${cl.lead_count} but scoped queue has ${actual}`);
      }
    }
    if (mismatches === 0) logOk('call-list-count', `${lists.length} list(s) checked, counts match the scoped queue`);
  });

  test('Control Center Team & Access renders pending-access-requests path', async ({ page }) => {
    const errs = [];
    watchErrors(page, errs);
    await login(page);
    await goHash(page, 'control-center');
    await page.waitForTimeout(1000);

    const teamAccessTab = page.locator('text=Team & Access').first();
    if (await teamAccessTab.count() === 0) { logIssue('team-access', 'Team & Access section not found in Control Center'); }
    else {
      await teamAccessTab.click();
      await page.waitForTimeout(2000);
      const relevantErrs = errs.filter((e) => /access.request|AccessRequest|control-center/i.test(e));
      if (relevantErrs.length) logIssue('team-access', `console/page errors: ${relevantErrs.join(' | ')}`);
      else logOk('team-access', 'Team & Access section rendered, no related errors');
      await page.screenshot({ path: 'tests/screenshots/v12-5-0-team-access.png', fullPage: true });
    }
  });

  test('AE Pipeline and CSM Portal islands mount for Super Admin', async ({ page }) => {
    const errs = [];
    watchErrors(page, errs);
    await login(page);

    for (const hash of ['ae-pipeline', 'csm-portal']) {
      errs.length = 0;
      await goHash(page, hash);
      await page.waitForTimeout(2000);
      const root = page.locator('#view-container');
      const text = await root.textContent().catch(() => '');
      if (!text || text.trim().length === 0) logIssue(hash, 'view-container is empty — island failed to mount');
      else if (errs.length) logIssue(hash, `console/page errors on mount: ${errs.join(' | ')}`);
      else logOk(hash, 'island mounted with no console errors');
      await page.screenshot({ path: `tests/screenshots/v12-5-0-${hash}.png`, fullPage: true });
    }
  });

  test('Power Dialer island mounts (CurrentCallCard change)', async ({ page }) => {
    const errs = [];
    watchErrors(page, errs);
    await login(page);
    await goHash(page, 'my-calls');
    await page.waitForTimeout(2500);

    const root = page.locator('#power-dialer-react-root, #view-container');
    const text = await root.first().textContent().catch(() => '');
    if (!text || text.trim().length === 0) logIssue('power-dialer', 'Power Dialer view-container is empty');
    else if (errs.length) logIssue('power-dialer', `console/page errors: ${errs.join(' | ')}`);
    else logOk('power-dialer', 'Power Dialer mounted with no console errors');
    await page.screenshot({ path: 'tests/screenshots/v12-5-0-power-dialer.png', fullPage: true });
  });

  test.afterAll(() => {
    if (issues.length) console.error(`\n${issues.length} issue(s) found:\n` + issues.map((i) => `  - ${i}`).join('\n'));
    else console.log('\nAll v12.5.0 staging checks passed.');
  });

  test('summary — no issues collected', async () => {
    expect(issues, `staging audit found ${issues.length} issue(s)`).toEqual([]);
  });
});
