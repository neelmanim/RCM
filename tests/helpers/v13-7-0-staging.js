// v13.7.0 close-out audit — shared harness for the per-persona staging specs.
// STAGING ONLY: refuses any other host. Read-mostly: the specs never send an
// email/SMS, never place a call, never edit settings or the demo cadences.
const { expect } = require('@playwright/test');
const fs = require('fs');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API = process.env.API_BASE_URL || 'https://messenger-crm-staging.onrender.com';
if (!/^https:\/\/messenger-crm-staging\.onrender\.com$/.test(API) ||
    !/^https:\/\/messenger-frontend-staging\.onrender\.com$/.test(BASE_URL)) {
  throw new Error(`Refusing to run: not staging (${API}, ${BASE_URL})`);
}

const PERSONAS = {
  sa: { label: 'Super Admin', token: process.env.SA_TOKEN },
  pa: { label: 'Pod Admin', token: process.env.POD_ADMIN_TOKEN },
  pa2: { label: 'Pod Admin (demo)', token: process.env.PA_TOKEN },
  sdr: { label: 'SDR (Dev Kapoor)', token: process.env.SDR_DEVKAPOOR_TOKEN },
  ae: { label: 'AE', token: process.env.AE_TOKEN },
  csm: { label: 'CSM', token: process.env.CSM_TOKEN },
};

const TOUR_KEYS = [
  'ae-pipeline', 'aircall-drawer', 'analytics-hub', 'cadence-builder-v13', 'cadence-rep', 'control-center', 'dashboard',
  'csm-account-360', 'csm-portal-inbox', 'csm-portal-playbooks', 'csm-portal', 'daily-digest',
  'lead-detail-emails', 'leaderboard', 'leads-hub', 'my-settings', 'my-tasks', 'power-dialer', 'sales-tools',
].flatMap((k) => [`alternatecrm:${k}-tour-seen`, `alternatecrm:${k}-tour-seen-v2`]);

// The release the audit runs against = the repo's VERSION (staging serves develop's last push).
const APP_VERSION = fs.readFileSync(`${__dirname}/../../VERSION`, 'utf8').trim();

const SHOTS = 'tests/screenshots/v13-7-0';
fs.mkdirSync(SHOTS, { recursive: true });

// Noise that is not an app defect (third-party widgets, favicon, aborted polls on navigation).
const IGNORE = [/favicon/i, /net::ERR_ABORTED/i, /aircall/i, /intercom/i, /sentry/i, /ResizeObserver loop/i];
const ignored = (s) => IGNORE.some((r) => r.test(s));

/** Attach collectors: uncaught page errors, console errors, and 5xx API
 *  responses. Call `problems()` at the end of a view to get what happened. */
function watch(page) {
  const out = [];
  page.on('pageerror', (e) => { if (!ignored(e.message)) out.push(`pageerror: ${e.message}`); });
  // "Failed to load resource" console lines carry no URL, so network failures are judged from the response
  // events below. Known, pre-existing, swallowed by the UI: the first load via ?token= makes the messenger
  // widget fire /calls/my-active + /conversations/status before the token is stored (401; a normal load has
  // none — verified 2026-10-07), and GET /api/pods is 403 for roles without pod access.
  const KNOWN = /^(401 \/api\/(calls\/my-active|conversations\/status)|403 \/api\/pods)$/;
  page.on('console', (m) => {
    if (m.type() === 'error' && !ignored(m.text()) && !/Failed to load resource/.test(m.text())) out.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on('response', (r) => {
    if (!r.url().startsWith(API) || r.status() < 400) return;
    const path = new URL(r.url()).pathname;
    if (!KNOWN.test(`${r.status()} ${path}`)) {
      out.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, '')}`);
    }
  });
  return { problems: () => out.splice(0) };
}

/** `opts.tours: true` leaves the page guides UNSEEN (the default marks every guide as seen so other specs are not covered by an overlay);
 *  the Aircall drawer's own hint stays suppressed either way. */
async function login(page, token, opts = {}) {
  const seen = opts.tours ? TOUR_KEYS.filter((k) => /aircall/.test(k)) : TOUR_KEYS;
  await page.addInitScript((keys) => {
    try {
      keys.forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('leadDetailHub', 'on');
      localStorage.setItem('leadsHub', 'on');
    } catch { /* storage blocked */ }
  }, seen);
  await page.goto(`${BASE_URL}/?token=${token}`);
  // ponytail: My Tasks is the one nav item every role has (CSM has no Dashboard).
  await page.waitForSelector('nav >> text=My Tasks', { timeout: 45000 });
}

/** Go to a hash route and let the island render. */
async function go(page, hash) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function api(request, method, path, token, data) {
  const r = await request.fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data });
  let body = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  return { status: r.status(), body };
}

/** Fail the test with every collected problem listed, not just the first. */
function expectClean(problems, where) {
  expect(problems, `${where}: console errors / 5xx`).toEqual([]);
}

/** Staging sleeps when idle and answers 502 for a minute or so while it wakes; wait for a real health answer before the first test. */
async function warmUp(request, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const r = await request.get(`${API}/api/health`, { timeout: 20000 }).catch(() => null);
    if (r && r.ok()) { try { if ((await r.json()).status === 'ok') return; } catch { /* still waking */ } }
    await new Promise((res) => setTimeout(res, 3000));
  }
}

module.exports = { warmUp, APP_VERSION, BASE_URL, API, PERSONAS, SHOTS, watch, login, go, shot, api, expectClean };
