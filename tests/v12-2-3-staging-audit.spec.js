/**
 * v12.2.3 staging audit — the three prod reports plus the refactor's blast
 * radius:
 *   1. My Settings "Connect email" navigates to the real auth_url, not
 *      /undefined. Stubbed at the network layer so no OAuth flow is started
 *      and no real mailbox is touched.
 *   2. Every one of the 14 React islands still mounts and renders — the
 *      hub-entry.jsx refactor rewrote all 15 entry shims and rebuilt all 15
 *      bundles, so "does each view still come up" is the check that matters.
 *   3. navigate() honours its container: same-view re-navigation keeps the
 *      hub alive, a cross-view round trip re-renders, and the Email tab
 *      renders for a second lead with no reload (the v12.2.2 report, still
 *      passing through the shared module).
 *   4. Backend is on 12.2.3 and healthy.
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
  // addInitScript runs before any app code on every navigation — the only
  // reliable place to pre-seed localStorage. Setting it after goto() is too
  // late: the tours have already decided to show, and the Aircall drawer tour
  // is a pointer-events overlay that swallows clicks on the content area.
  await page.addInitScript(() => {
    // Runs on every document, including the cross-origin auth URL the
    // connect-email check deliberately aborts — where localStorage access
    // throws. Guard it, or that throw shows up as an app page error.
    try { void localStorage.length; } catch { return; }
    ['sales-tools', 'control-center', 'daily-digest', 'cadence-readonly',
     'my-settings', 'leaderboard', 'aircall-drawer'].forEach((t) =>
      localStorage.setItem(`alternatecrm:${t}-tour-seen`, '1'));
    // Leads is a beta opt-in (default off → classic view, no React island).
    // Turn it on so its island is actually exercised. leadDetailHub stays off
    // on purpose: the Email-tab check needs the classic lead page's
    // #emails-tab-content.
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

test.describe('v12.2.3', () => {
  test.setTimeout(240_000);

  test('backend is on 12.2.3 and healthy', async ({ request }) => {
    // `version` lives on /api/health; /api/health/deep carries the DB probe.
    const shallow = await (await request.get(`${API_BASE}/api/health`)).json();
    const deep = await (await request.get(`${API_BASE}/api/health/deep`)).json();
    if (shallow.version !== '12.2.3') logIssue('health', `version is ${shallow.version}, expected 12.2.3`);
    else if (!deep.db_tables_accessible) logIssue('health', 'db_tables_accessible false');
    else logOk('health', `version=${shallow.version} db_tables_accessible=${deep.db_tables_accessible} latency=${deep.db_latency_ms}ms`);
  });

  test('GET /api/email/auth-url returns auth_url — the key the UI now reads', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/email/auth-url`, {
      headers: { Authorization: `Bearer ${SA_TOKEN}` },
    });
    const body = await res.json();
    if (typeof body.auth_url !== 'string' || !body.auth_url.startsWith('http')) {
      logIssue('auth-url', `no usable auth_url in ${JSON.stringify(body).slice(0, 200)}`);
      return;
    }
    if ('url' in body) logIssue('auth-url', 'response also has a `url` key — check which one the UI reads');
    else logOk('auth-url', `auth_url present (${new URL(body.auth_url).host})`);
  });

  test('Connect email goes to the auth URL, never to /undefined', async ({ page }) => {
    const errs = [];
    watchErrors(page, errs);
    await login(page);

    // Show the not-connected state regardless of the real mailbox, and hand
    // the page a known auth URL. Stubbing beats clicking through a live
    // consent screen, and leaves the actual staging mailbox alone.
    const FAKE_AUTH = 'https://api.us.nylas.com/v3/connect/auth?client_id=stub&state=stub';
    await page.route('**/api/email/status', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ connected: false, nylas_configured: true, needs_reconnect: false, email: null }) }));
    await page.route('**/api/email/auth-url', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ auth_url: FAKE_AUTH }) }));

    // Capture where the click sends the browser without actually going there.
    const attempted = [];
    await page.route('https://api.us.nylas.com/**', (route) => {
      attempted.push(route.request().url());
      route.abort();
    });

    await goHash(page, 'my-settings');
    const connectBtn = page.getByRole('button', { name: 'Connect email' });
    if (await connectBtn.count() === 0) {
      logIssue('connect-email', 'Connect email button not rendered with a stubbed not-connected status');
      return;
    }
    await connectBtn.first().click({ timeout: 15_000 }).catch(() => connectBtn.first().click({ force: true }));
    await page.waitForTimeout(3000);

    if (page.url().includes('/undefined')) {
      logIssue('connect-email', `landed on ${page.url()} — the reported bug`);
    } else if (attempted.length === 0) {
      logIssue('connect-email', `no navigation to the auth URL was attempted; still at ${page.url()}`);
    } else {
      logOk('connect-email', `navigated to ${new URL(attempted[0]).host}${new URL(attempted[0]).pathname}`);
    }
    if (errs.length) logIssue('connect-email', `console: ${errs[0]}`);
  });

  test('every React island still mounts after the entry-shim refactor', async ({ page }) => {
    const errs = [];
    watchErrors(page, errs);
    await login(page);

    // hash → a selector that only exists once that island has rendered.
    const VIEWS = [
      ['dashboard', '#dashboard-react-root'],
      ['analytics', '#analytics-react-root'],
      ['leads', '#leads-react-root'],
      ['calendar', '#calendar-react-root'],
      ['my-calls', '#power-dialer-react-root'],
      ['pods', '#pods-react-root'],
      ['activity-monitor', '#activity-monitor-react-root'],
      ['digest', '#daily-digest-react-root'],
      ['my-settings', '#my-settings-react-root'],
      ['leaderboard', '#leaderboard-react-root'],
      ['control-center', '#control-center-react-root'],
      ['sales-tools', '#sales-tools-react-root'],
      ['user-guide', '#help-react-root'],
    ];

    for (const [hash, sel] of VIEWS) {
      await goHash(page, hash);
      // Analytics polls up to 3s for its bundle, and a legacy view we just
      // left can still land an async innerHTML write on #view-container —
      // so give a missing root one more settle before calling it broken.
      let len = await page.evaluate((s) => {
        const el = document.querySelector(s);
        return el ? el.textContent.trim().length : -1;
      }, sel);
      if (len < 40) {
        await page.waitForTimeout(4000);
        len = await page.evaluate((s) => {
          const el = document.querySelector(s);
          return el ? el.textContent.trim().length : -1;
        }, sel);
      }
      if (len < 0) logIssue('islands', `${hash}: ${sel} missing entirely`);
      else if (len < 40) logIssue('islands', `${hash}: ${sel} rendered only ${len} chars — blank island`);
      else logOk('islands', `${hash} rendered ${len} chars`);
    }
    if (errs.length) logIssue('islands', `console: ${errs.slice(0, 2).join(' | ')}`);
  });

  test('navigate() keeps a live hub on same-view re-entry and re-renders after a round trip', async ({ page }) => {
    await login(page);
    await goHash(page, 'calendar');

    const mountedAfterFirst = await page.evaluate(() => !!window.CalendarHub?.isMounted);
    if (!mountedAfterFirst) { logIssue('navigate', 'CalendarHub did not mount'); return; }

    // Re-clicking the view you're on must not throw the tree away.
    await goHash(page, 'calendar');
    const stillMounted = await page.evaluate(() => !!window.CalendarHub?.isMounted);
    const contentAfterReentry = await page.evaluate(() =>
      document.querySelector('#calendar-react-root')?.textContent.trim().length ?? -1);
    if (!stillMounted) logIssue('navigate', 'CalendarHub was torn down by same-view re-navigation');
    else if (contentAfterReentry < 40) logIssue('navigate', `calendar blank after re-entry (${contentAfterReentry} chars)`);
    else logOk('navigate', `same-view re-entry kept the hub, ${contentAfterReentry} chars on screen`);

    // Leaving and returning rebuilds the container — the case that used to
    // leave the root painting into a detached node.
    await goHash(page, 'dashboard');
    const unmounted = await page.evaluate(() => !!window.CalendarHub?.isMounted);
    await goHash(page, 'calendar');
    const contentAfterRoundTrip = await page.evaluate(() =>
      document.querySelector('#calendar-react-root')?.textContent.trim().length ?? -1);
    if (unmounted) logIssue('navigate', 'CalendarHub stayed mounted after leaving calendar');
    else if (contentAfterRoundTrip < 40) logIssue('navigate', `calendar blank after round trip (${contentAfterRoundTrip} chars)`);
    else logOk('navigate', `round trip re-rendered ${contentAfterRoundTrip} chars`);
  });

  test('Email tab renders for a second lead without a page reload', async ({ page, request }) => {
    await login(page);
    const res = await request.get(`${API_BASE}/api/leads?page=1&limit=5`, {
      headers: { Authorization: `Bearer ${SA_TOKEN}` },
    });
    const payload = await res.json();
    const leads = (payload.data || []).map((l) => l.id);
    if (leads.length < 2) { logIssue('email-remount', `need 2 leads, got ${leads.length}`); return; }

    async function openEmailTab(leadId) {
      await goHash(page, `lead-detail/${leadId}`);
      const tab = page.locator('[data-tab="emails"], button:has-text("Emails")').first();
      if (await tab.count() > 0) await tab.click().catch(() => {});
      await page.waitForTimeout(4000);
      return page.evaluate(() => {
        const el = document.getElementById('emails-tab-content');
        return el ? el.textContent.trim().length : -1;
      });
    }

    const first = await openEmailTab(leads[0]);
    if (first < 1) { logIssue('email-remount', `lead 1 email tab rendered ${first} chars`); return; }
    logOk('email-remount', `lead 1 tab rendered ${first} chars`);

    const second = await openEmailTab(leads[1]);
    if (second < 1) logIssue('email-remount', `lead 2 email tab rendered ${second} chars — the reported bug`);
    else logOk('email-remount', `lead 2 tab rendered ${second} chars without a reload`);
  });

  test.afterAll(() => {
    if (issues.length) {
      console.error(`\n${issues.length} issue(s):\n - ${issues.join('\n - ')}`);
      expect(issues, `staging audit found ${issues.length} issue(s)`).toEqual([]);
    } else {
      console.log('\nAll checks passed.');
    }
  });
});
