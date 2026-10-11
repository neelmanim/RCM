/**
 * v12.2.5 staging audit — this release's specific blast radius:
 *   1. Backend is on 12.2.5.
 *   2. SdrPerformanceHub mounts and renders real data via the Leaderboard
 *      hand-off (the actual user path, not a direct hash navigation).
 *   3. #upload and #audit-logs land on Control Center instead of a blank
 *      or broken legacy page — the whole point of retiring them.
 *   4. #kanban and #smart-analytics show "View not found" cleanly rather
 *      than a crash or a blank white screen — they have no destination to
 *      redirect to, unlike #upload/#audit-logs.
 *   5. Every other island still mounts (regression net for the app.js
 *      edits touching many router branches in one file).
 *
 * Token via env so it isn't committed: SA_TOKEN. Login helper copied from
 * v12-2-3-staging-audit.spec.js — see that file for why each quirk (Aircall
 * tour overlay, leadsHub beta flag, localStorage on cross-origin docs) is
 * handled the way it is.
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
     'my-settings', 'leaderboard', 'aircall-drawer'].forEach((t) =>
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

test.describe('v12.2.5', () => {
  test.setTimeout(180_000);

  test('backend is on 12.2.5', async ({ request }) => {
    const body = await (await request.get(`${API_BASE}/api/health`)).json();
    if (body.version !== '12.2.5') logIssue('health', `version is ${body.version}, expected 12.2.5`);
    else logOk('health', `version=${body.version}`);
  });

  test('SDR Performance opens from Leaderboard with real data', async ({ page }) => {
    const errs = [];
    watchErrors(page, errs);
    await login(page);
    await goHash(page, 'leaderboard');

    // Click a real person-name button, scoped to the <table> element. The
    // period-filter pills above it (SDRs/AEs/7 Days/.../All Time) are
    // buttons too and shaped exactly like a two-word name ("All Time" passed
    // a /^[A-Z]\w+ [A-Z]\w+$/ filter over the whole .leaderboard-hub, and
    // was clicked instead of a row — confirmed live). The table structurally
    // excludes that toolbar, so any button inside it is a real row.
    await page.waitForSelector('.leaderboard-hub table', { timeout: 10_000 }).catch(() => {});
    const target = page.locator('.leaderboard-hub table').getByRole('button').first();
    if (await target.count() === 0) {
      logIssue('sdr-performance', 'no clickable row found inside the Leaderboard table');
      return;
    }
    await target.click().catch(() => {});
    await page.waitForTimeout(4000);

    const rootLen = await page.evaluate(() => {
      const el = document.querySelector('#sdr-performance-react-root');
      return el ? el.textContent.trim().length : -1;
    });
    if (rootLen < 0) logIssue('sdr-performance', 'root missing — click did not navigate to sdr-performance');
    else if (rootLen < 60) logIssue('sdr-performance', `rendered only ${rootLen} chars — likely blank/error state`);
    else logOk('sdr-performance', `rendered ${rootLen} chars from a real Leaderboard click`);

    const hasBack = await page.getByRole('button', { name: /Back/ }).count();
    if (hasBack === 0) logIssue('sdr-performance', 'no Back button found');
    else {
      await page.getByRole('button', { name: /Back/ }).first().click();
      await page.waitForTimeout(1500);
      const backOnLeaderboard = await page.evaluate(() => location.hash.includes('leaderboard'));
      if (!backOnLeaderboard) logIssue('sdr-performance', `Back did not return to Leaderboard, hash=${await page.evaluate(() => location.hash)}`);
      else logOk('sdr-performance', 'Back returns to Leaderboard');
    }
    if (errs.length) logIssue('sdr-performance', `console: ${errs.slice(0, 2).join(' | ')}`);
  });

  test('#upload lands on Control Center, not a blank or dead page', async ({ page }) => {
    const errs = [];
    watchErrors(page, errs);
    await login(page);
    await goHash(page, 'upload');
    await page.waitForTimeout(1500);

    const hash = await page.evaluate(() => location.hash);
    const ccLen = await page.evaluate(() => {
      const el = document.querySelector('#control-center-react-root');
      return el ? el.textContent.trim().length : -1;
    });
    if (!hash.includes('control-center')) logIssue('upload-redirect', `hash is ${hash}, expected #control-center`);
    else if (ccLen < 40) logIssue('upload-redirect', `redirected but Control Center rendered only ${ccLen} chars`);
    else logOk('upload-redirect', `#upload -> ${hash}, ${ccLen} chars rendered`);
    if (errs.length) logIssue('upload-redirect', `console: ${errs[0]}`);
  });

  test('#audit-logs lands on Control Center, not a blank or dead page', async ({ page }) => {
    await login(page);
    await goHash(page, 'audit-logs');
    await page.waitForTimeout(1500);

    const hash = await page.evaluate(() => location.hash);
    const ccLen = await page.evaluate(() => {
      const el = document.querySelector('#control-center-react-root');
      return el ? el.textContent.trim().length : -1;
    });
    if (!hash.includes('control-center')) logIssue('audit-logs-redirect', `hash is ${hash}, expected #control-center`);
    else if (ccLen < 40) logIssue('audit-logs-redirect', `redirected but Control Center rendered only ${ccLen} chars`);
    else logOk('audit-logs-redirect', `#audit-logs -> ${hash}, ${ccLen} chars rendered`);
  });

  test('#sf-logs skips the audit-logs hop and lands on Control Center directly', async ({ page }) => {
    await login(page);
    await goHash(page, 'sf-logs');
    await page.waitForTimeout(1500);
    const hash = await page.evaluate(() => location.hash);
    if (!hash.includes('control-center')) logIssue('sf-logs-redirect', `hash is ${hash}, expected #control-center`);
    else logOk('sf-logs-redirect', `#sf-logs -> ${hash}`);
  });

  test('#kanban and #smart-analytics show "View not found", not a crash', async ({ page }) => {
    const errs = [];
    watchErrors(page, errs);
    await login(page);

    for (const hash of ['kanban', 'smart-analytics']) {
      await goHash(page, hash);
      const text = await page.evaluate(() => document.querySelector('#view-container')?.textContent || '');
      if (!/view not found/i.test(text)) logIssue('deleted-routes', `#${hash} did not show "View not found" (got ${text.slice(0, 80).trim() || 'empty'})`);
      else logOk('deleted-routes', `#${hash} -> "View not found" cleanly`);
    }
    if (errs.length) logIssue('deleted-routes', `console: ${errs.slice(0, 2).join(' | ')}`);
  });

  test('every other island still mounts (app.js regression net)', async ({ page }) => {
    const errs = [];
    watchErrors(page, errs);
    await login(page);

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
      ['sales-tools', '#sales-tools-react-root'],
      ['user-guide', '#help-react-root'],
    ];

    for (const [hash, sel] of VIEWS) {
      await goHash(page, hash);
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

  test.afterAll(() => {
    if (issues.length) {
      console.error(`\n${issues.length} issue(s):\n - ${issues.join('\n - ')}`);
      expect(issues, `staging audit found ${issues.length} issue(s)`).toEqual([]);
    } else {
      console.log('\nAll checks passed.');
    }
  });
});
