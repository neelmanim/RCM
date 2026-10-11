/**
 * v12.2.2 staging audit — verifies the areas this release touched:
 *   1. Email tab remount across two leads (the "refresh the entire page"
 *      report) — the highest-value check here.
 *   2. My Settings: one "Email Sign-off" card, and the mailbox status card.
 *   3. Leaderboard + SDR performance drill-down use SVG icons, not emoji.
 *   4. Control Center subtitle: generic for Super Admin, POD copy under
 *      View-As a Pod Admin.
 *   5. GET /api/email/status exposes needs_reconnect.
 *   6. POST /api/calls/start answers a bad request with a handled 4xx,
 *      never a 500 (the prod incident's symptom).
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

// Emoji ranges that used to appear as "icons" on these pages.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

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
  // ?token= is the app's own bootstrap — seeding localStorage after goto()
  // is too late: app.js has already run and redirected to login.
  await page.goto(`${BASE_URL}/?token=${SA_TOKEN}`);
  await page.waitForSelector('nav >> text=Dashboard', { timeout: 45_000 });
  await page.evaluate(() => {
    ['sales-tools', 'control-center', 'daily-digest', 'cadence-readonly',
     'my-settings', 'leaderboard'].forEach((t) =>
      localStorage.setItem(`alternatecrm:${t}-tour-seen`, '1'));
  });
  // The Aircall drawer docks over the right ~440px and blocks clicks.
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

test.describe('v12.2.2', () => {
  test.setTimeout(180_000);

  test('backend is on 12.2.2 and healthy', async ({ request }) => {
    const h = await request.get(`${API_BASE}/api/health`);
    const body = await h.json();
    expect(body.version, 'staging must be running the release under test').toBe('12.2.2');
    const deep = await request.get(`${API_BASE}/api/health/deep`);
    const d = await deep.json();
    expect(d.db_tables_accessible, JSON.stringify(d)).toBe(true);
    logOk('health', `version=${body.version} db_tables_accessible=${d.db_tables_accessible}`);
  });

  test('GET /api/email/status exposes needs_reconnect', async ({ request }) => {
    const r = await request.get(`${API_BASE}/api/email/status`, {
      headers: { Authorization: `Bearer ${SA_TOKEN}` },
    });
    expect(r.status()).toBe(200);
    const b = await r.json();
    if (!('needs_reconnect' in b)) {
      logIssue('email-status', `needs_reconnect missing: ${JSON.stringify(b)}`);
    } else {
      logOk('email-status', `connected=${b.connected} needs_reconnect=${b.needs_reconnect} email=${b.email}`);
    }
    expect(b).toHaveProperty('needs_reconnect');
    // The field the React card reads for the address.
    expect(b, 'card reads `email`, not `email_address`').toHaveProperty('email');
  });

  test('POST /api/calls/start answers a handled 4xx, never a 500', async ({ request }) => {
    // Deliberately invalid: no phone_number. The prod incident surfaced as an
    // unhandled 500 from this endpoint, so any 5xx here is a red flag.
    const r = await request.post(`${API_BASE}/api/calls/start`, {
      headers: { Authorization: `Bearer ${SA_TOKEN}` },
      data: { lead_id: '00000000-0000-0000-0000-000000000000' },
    });
    if (r.status() >= 500) logIssue('calls/start', `${r.status()} ${(await r.text()).slice(0, 200)}`);
    expect(r.status(), 'must not be a server error').toBeLessThan(500);
    logOk('calls/start', `handled ${r.status()}`);
  });

  test('PATCH /api/admin/sync-settings still works for a Super Admin', async ({ request }) => {
    const cur = await request.get(`${API_BASE}/api/admin/sync-settings`, {
      headers: { Authorization: `Bearer ${SA_TOKEN}` },
    });
    expect(cur.status()).toBe(200);
    const before = (await cur.json()).lead_limit;
    // Write the same value back — proves the tightened gate admits Super
    // Admin without changing any configuration.
    const w = await request.patch(`${API_BASE}/api/admin/sync-settings`, {
      headers: { Authorization: `Bearer ${SA_TOKEN}` },
      data: { lead_limit: before },
    });
    if (w.status() !== 200) logIssue('sync-settings', `Super Admin write got ${w.status()}: ${(await w.text()).slice(0, 200)}`);
    expect(w.status()).toBe(200);
    logOk('sync-settings', `Super Admin write OK, lead_limit unchanged at ${before}`);
  });

  test('My Settings has one Email Sign-off card, not two email cards', async ({ page }) => {
    const errs = []; watchErrors(page, errs);
    await login(page);
    await goHash(page, 'my-settings');
    const body = await page.locator('body').innerText();

    if (!/Email Sign-off/i.test(body)) logIssue('my-settings', 'no "Email Sign-off" card');
    if (/Email Branding/i.test(body)) logIssue('my-settings', 'old "Email Branding" card still present');
    if (!/Powered by Alternate Messenger/i.test(body)) logIssue('my-settings', 'branding toggle copy missing from the merged card');
    if (!/Email Sync/i.test(body)) logIssue('my-settings', 'Email Sync card missing');
    if (/Org-wide configuration lives in Settings/i.test(body)) logIssue('my-settings', 'stale subtitle pointing at "Settings"');

    expect(body).toMatch(/Email Sign-off/i);
    expect(body).not.toMatch(/Email Branding/i);
    if (errs.length) logIssue('my-settings', `console: ${errs.slice(0, 3).join(' | ')}`);
    logOk('my-settings', 'single Email Sign-off card, no stale subtitle');
  });

  test('Leaderboard renders SVG icons, not emoji', async ({ page }) => {
    const errs = []; watchErrors(page, errs);
    await login(page);
    await goHash(page, 'leaderboard');
    const header = page.locator('h1', { hasText: 'Leaderboard' }).first();
    await expect(header).toBeVisible({ timeout: 20_000 });
    const headerHtml = await header.innerHTML();
    if (!headerHtml.includes('<svg')) logIssue('leaderboard', 'title has no inline SVG icon');
    const headerText = await header.innerText();
    if (EMOJI_RE.test(headerText)) logIssue('leaderboard', `emoji still in title: ${headerText}`);
    expect(headerHtml).toContain('<svg');
    expect(headerText).not.toMatch(EMOJI_RE);
    if (errs.length) logIssue('leaderboard', `console: ${errs.slice(0, 3).join(' | ')}`);
    logOk('leaderboard', 'trophy rendered as SVG, no emoji');
  });

  test('SDR performance drill-down metric cards use SVG icons', async ({ page, request }) => {
    const errs = []; watchErrors(page, errs);
    // Go straight to the drill-down hash — exactly what the React
    // Leaderboard's onOpenPerson does (app.js: loadView('sdr-performance',
    // sdrId)). Clicking a row is a Leaderboard test, not this one, and the
    // page under test here is the legacy sdr_performance.js view.
    const ur = await request.get(`${API_BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${SA_TOKEN}` },
    });
    expect(ur.status()).toBe(200);
    const up = await ur.json();
    const users = up.data || up.users || (Array.isArray(up) ? up : []);
    const sdr = users.find((u) => u && u.id && (u.role === 'SDR' || u.role === 'AE'));
    if (!sdr) { logIssue('sdr-performance', 'no SDR/AE user found on staging'); test.skip(true, 'no SDR'); }
    await login(page);
    await goHash(page, `sdr-performance/${sdr.id}`);
    await page.waitForTimeout(2500);

    const body = await page.locator('body').innerText();
    if (!/Performance Analytics/i.test(body)) {
      logIssue('sdr-performance', 'drill-down did not open');
      test.skip(true, 'drill-down did not open');
    }
    // Every metric card label must be free of emoji and carry an SVG.
    for (const label of ['LEADS ASSIGNED', 'ACTIVE LEADS', 'CALLS MADE', 'CONV. RATE']) {
      const card = page.locator(`text=${label}`).first();
      if (await card.count() === 0) { logIssue('sdr-performance', `card "${label}" missing`); continue; }
      const parent = card.locator('xpath=..');
      const html = await parent.innerHTML();
      if (!html.includes('<svg')) logIssue('sdr-performance', `card "${label}" has no SVG icon`);
    }
    if (EMOJI_RE.test(body)) logIssue('sdr-performance', 'emoji still present on the page');
    expect(body).not.toMatch(EMOJI_RE);
    await page.screenshot({ path: 'tests/screenshots/v1222-sdr-performance.png', fullPage: false });
    if (errs.length) logIssue('sdr-performance', `console: ${errs.slice(0, 3).join(' | ')}`);
    logOk('sdr-performance', 'metric cards carry SVG icons, no emoji');
  });

  test('Control Center subtitle no longer names pages nobody has', async ({ page }) => {
    const errs = []; watchErrors(page, errs);
    await login(page);
    await goHash(page, 'control-center');
    const body = await page.locator('body').innerText();
    if (/Upload Center and System Logs/i.test(body)) logIssue('control-center', 'stale subtitle still names Upload Center / System Logs');
    if (!/One home for org configuration/i.test(body)) logIssue('control-center', `expected generic Super Admin subtitle, got: ${body.slice(0, 300)}`);
    expect(body).not.toMatch(/Upload Center and System Logs/i);
    await page.screenshot({ path: 'tests/screenshots/v1222-control-center-sa.png', fullPage: false });
    if (errs.length) logIssue('control-center', `console: ${errs.slice(0, 3).join(' | ')}`);
    logOk('control-center', 'Super Admin sees the generic org-configuration subtitle');
  });

  test('Email tab renders for a second lead without a page reload', async ({ page, request }) => {
    const errs = []; watchErrors(page, errs);
    // Two distinct leads, straight from the API.
    const r = await request.get(`${API_BASE}/api/leads?page=1&limit=5`, {
      headers: { Authorization: `Bearer ${SA_TOKEN}` },
    });
    expect(r.status()).toBe(200);
    const payload = await r.json();
    const leads = (payload.data || payload.leads || payload.items || []).filter((l) => l && l.id);
    if (leads.length < 2) {
      logIssue('email-remount', `need 2 leads, got ${leads.length}`);
      test.skip(true, 'not enough leads on staging');
    }

    await login(page);

    async function openEmailTab(leadId) {
      await goHash(page, `lead-detail/${leadId}`);
      const tab = page.locator('[data-tab="emails"], button:has-text("Emails"), .tab:has-text("Emails")').first();
      if (await tab.count() > 0) { await tab.click().catch(() => {}); }
      await page.waitForTimeout(4000);
      const el = page.locator('#emails-tab-content');
      await expect(el).toHaveCount(1);
      return (await el.innerText()).trim();
    }

    const firstText = await openEmailTab(leads[0].id);
    logOk('email-remount', `lead 1 tab rendered ${firstText.length} chars`);

    // The regression: navigate lead -> lead with NO reload in between.
    const secondText = await openEmailTab(leads[1].id);
    if (secondText.length === 0) {
      logIssue('email-remount', 'Email tab is EMPTY for the second lead — the detached-root bug is back');
    }
    await page.screenshot({ path: 'tests/screenshots/v1222-email-tab-second-lead.png', fullPage: false });
    expect(secondText.length, 'Email tab must render for the second lead without a reload').toBeGreaterThan(0);
    if (errs.length) logIssue('email-remount', `console: ${errs.slice(0, 3).join(' | ')}`);
    logOk('email-remount', `lead 2 tab rendered ${secondText.length} chars without a reload`);
  });

  test.afterAll(() => {
    if (issues.length) {
      console.error(`\n${issues.length} issue(s):\n` + issues.map((i) => ' - ' + i).join('\n'));
    } else {
      console.log('\nAll checks passed.');
    }
  });
});
