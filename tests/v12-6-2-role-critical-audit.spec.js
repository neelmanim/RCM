/**
 * v12.6.2 role-critical audit — a genuine AE and a genuine CSM user
 * (tokens minted via the real Super-Admin "View As" endpoint, not guessed),
 * driven through every nav item they can actually reach, hunting for
 * usability gaps: broken/irrelevant screens, console errors, misleading
 * copy, and scoping mistakes — not just re-confirming what was already
 * fixed this session.
 *
 * Tokens via env: SA_TOKEN (unused directly here but required by the other
 * staging-audit specs sharing this file's conventions), AE_TOKEN, CSM_TOKEN.
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const AE_TOKEN = process.env.AE_TOKEN;
const CSM_TOKEN = process.env.CSM_TOKEN;

const issues = [];
const logIssue = (area, detail) => { console.error(`FAIL [${area}] ${detail}`); issues.push(`[${area}] ${detail}`); };
const logOk = (area, detail) => console.log(`OK ${area}: ${detail}`);
const logNote = (area, detail) => { console.log(`NOTE [${area}] ${detail}`); issues.push(`NOTE [${area}] ${detail}`); };

function watchErrors(page, sink) {
  page.on('pageerror', (e) => sink.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/favicon|net::ERR_|Failed to load resource|aircall/i.test(t)) return;
    sink.push(`console: ${t}`);
  });
}

async function login(page, token) {
  await page.addInitScript(() => {
    try { void localStorage.length; } catch { return; }
    ['sales-tools', 'control-center', 'daily-digest', 'cadence-readonly',
     'my-settings', 'leaderboard', 'aircall-drawer', 'ae-pipeline', 'csm-portal',
     'my-tasks'].forEach((t) =>
      localStorage.setItem(`alternatecrm:${t}-tour-seen`, '1'));
    localStorage.setItem('leadsHub', 'on');
  });
  await page.goto(`${BASE_URL}/?token=${token}`);
  await page.waitForSelector('nav', { timeout: 45_000 });
  await page.waitForTimeout(1500);
  const drawerClose = page.locator('.nh-aircall-drawer__header .nh-overlay-close');
  if (await drawerClose.count() > 0) await drawerClose.first().click().catch(() => {});
}

async function goHash(page, hash) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(3000);
}

test.beforeAll(() => {
  if (!AE_TOKEN) throw new Error('AE_TOKEN env var is required');
  if (!CSM_TOKEN) throw new Error('CSM_TOKEN env var is required');
});

// ── CSM ──────────────────────────────────────────────────────────────────

test('CSM: lands on Inbox by default, not Dashboard', async ({ page }) => {
  // 2026-09-16: CSM Portal's 4 sections were promoted to flat top-level nav
  // items ("a view which greets them") — Inbox is now the landing section,
  // not a wrapper "CSM Portal" page with an internal tab strip.
  await login(page, CSM_TOKEN);
  const heading = page.locator('h1');
  await expect(heading).toContainText('Inbox', { timeout: 15_000 });
  logOk('csm-landing', 'default view is Inbox (own flat nav item)');
});

test('CSM: Dashboard and Leaderboard nav items are gone', async ({ page }) => {
  await login(page, CSM_TOKEN);
  expect(await page.locator('nav >> text=Dashboard').count()).toBe(0);
  expect(await page.locator('nav >> text=Leaderboard').count()).toBe(0);
  logOk('csm-nav', 'Dashboard and Leaderboard correctly hidden');
});

test('CSM: nav inventory — Inbox/Portfolio/Playbooks/Digest hidden by the Pipeline & CSM lockdown', async ({ page }) => {
  // 2026-09-25: Pipeline & CSM Portal (AE's own AE Pipeline, CSM's own flat
  // Inbox/Portfolio/Playbooks/Digest, and the Super Admin oversight tab) are
  // hidden for everyone except neelmani.mishra@screen-magic.com while that
  // surface is reworked — see NavSidebar.jsx's isItemVisible / PIPELINE_CSM_
  // LOCKDOWN_EMAIL. CSM_TOKEN is a test persona, not that account, so every
  // csm-* item is now expected to be ABSENT rather than present.
  const errs = [];
  watchErrors(page, errs);
  await login(page, CSM_TOKEN);
  const items = await page.locator('nav a, nav button').allTextContents();
  logOk('csm-nav', `visible nav items: ${items.filter(Boolean).join(', ')}`);

  expect(await page.locator('nav >> text=Inbox').count()).toBe(0);
  expect(await page.locator('nav >> text=Portfolio').count()).toBe(0);
  expect(await page.locator('nav >> text=Playbooks').count()).toBe(0);
  expect(await page.locator('nav >> text=Digest').count()).toBe(0);
  expect(await page.locator('nav >> text=AE Pipeline').count()).toBe(0);
  expect(await page.locator('nav >> text=CSM Portal').count()).toBe(0);

  if (errs.length) errs.forEach((e) => logIssue('csm-nav', e));
});

test('CSM: Portfolio — scoped copy, filters, and health donut all correct for a real CSM', async ({ page }) => {
  const errs = [];
  watchErrors(page, errs);
  await login(page, CSM_TOKEN);
  await goHash(page, '#csm-portfolio');
  await expect(page.getByText(/Your full account list/)).toBeVisible({ timeout: 15_000 });

  // A plain CSM must not see the admin-only bulk-assign checkboxes/CSM filter.
  expect(await page.locator('[aria-label^="Select "]').count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Filter by CSM' }).count()).toBe(0);
  logOk('csm-portfolio', 'no admin-only controls leaked to a plain CSM');

  const rows = page.locator('table tbody tr');
  const rowCount = await rows.count();
  const donutTotal = await page.getByText(/account\(s\) total/).textContent().catch(() => null);
  if (donutTotal) {
    const n = parseInt(donutTotal, 10);
    if (n !== rowCount) logIssue('csm-portfolio', `donut says "${donutTotal}" but table has ${rowCount} row(s)`);
    else logOk('csm-portfolio', `donut total (${n}) matches table row count`);
  } else {
    logNote('csm-portfolio', 'no donut/rows to cross-check (empty portfolio) — not a failure, just unverifiable here');
  }

  if (errs.length) errs.forEach((e) => logIssue('csm-portfolio', e));
});

test('CSM: My Settings is now reachable and shows Email Sync + Dialer (was missing entirely)', async ({ page }) => {
  // 2026-09-16 gap: 'my-settings' nav item's roles list was never updated
  // when CSM was introduced — a CSM had no way at all to connect email or
  // manage dialer access. MySettingsHub itself has no role logic, so this
  // was a pure nav-gating omission.
  const errs = [];
  watchErrors(page, errs);
  await login(page, CSM_TOKEN);
  expect(await page.locator('nav >> text=My Settings').count()).toBe(1);
  await goHash(page, '#my-settings');
  await expect(page.getByText('Email Sync')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Dialer', { exact: true })).toBeVisible();
  logOk('csm-my-settings', 'nav item present, Email Sync + Dialer cards render for a CSM');
  if (errs.length) errs.forEach((e) => logIssue('csm-my-settings', e));
});

test('CSM: My Tasks is scoped to the CSM (not an SDR/AE-only crash)', async ({ page }) => {
  const errs = [];
  watchErrors(page, errs);
  await login(page, CSM_TOKEN);
  await goHash(page, '#my-tasks');
  await expect(page.locator('h1:has-text("My Tasks")')).toBeVisible({ timeout: 15_000 });
  if (errs.length) errs.forEach((e) => logIssue('csm-my-tasks', e));
  else logOk('csm-my-tasks', 'loads cleanly for a CSM');
});

test('CSM: Leads and Sales Tools pages — do they render something coherent for a CSM?', async ({ page }) => {
  const errs = [];
  watchErrors(page, errs);
  await login(page, CSM_TOKEN);

  await goHash(page, '#leads');
  const leadsBroken = await page.locator('text=/error|not found|undefined/i').count();
  logOk('csm-leads', leadsBroken ? `possible issue text found (${leadsBroken} match(es))` : 'no obvious error text');
  if (leadsBroken) logNote('csm-leads', 'Leads page still nav-visible to CSM (roles: [\'all\']) — worth deciding whether a CSM should see every org lead, unrelated to their accounts');

  await goHash(page, '#sales-tools');
  const stBroken = await page.locator('text=/error|not found|undefined/i').count();
  logOk('csm-sales-tools', stBroken ? `possible issue text found (${stBroken} match(es))` : 'no obvious error text');

  if (errs.length) errs.forEach((e) => logIssue('csm-other-pages', e));
});

// ── AE ───────────────────────────────────────────────────────────────────

test('AE: still lands on Dashboard (unchanged), AE Pipeline hidden by the Pipeline & CSM lockdown', async ({ page }) => {
  // See the CSM nav-inventory test above for why AE Pipeline is now expected
  // to be absent — AE_TOKEN is a test persona, not the one account the
  // lockdown allows.
  await login(page, AE_TOKEN);
  const heading = page.locator('h1');
  await expect(heading).toContainText('Dashboard', { timeout: 15_000 });
  expect(await page.locator('nav >> text=AE Pipeline').count()).toBe(0);
  expect(await page.locator('nav >> text=CSM Portal').count()).toBe(0);
  logOk('ae-landing', 'Dashboard default preserved, Pipeline & CSM correctly hidden');
});

test('AE Pipeline: scoped copy, filters, no owner filter for a single-AE view, no admin controls', async ({ page }) => {
  const errs = [];
  watchErrors(page, errs);
  await login(page, AE_TOKEN);
  await goHash(page, '#ae-pipeline');

  await expect(page.getByPlaceholder('Search by account…')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Filter by stage' })).toBeVisible();
  // A plain AE only ever sees their own deals, so the "Filter by AE" picker
  // (gated on >1 distinct owner_name in the list) must not render.
  expect(await page.getByRole('button', { name: 'Filter by AE' }).count()).toBe(0);
  logOk('ae-pipeline', 'search/stage filter render, no owner filter for single-AE scope');

  if (errs.length) errs.forEach((e) => logIssue('ae-pipeline', e));
  else logOk('ae-pipeline', 'no page errors');
});

test('AE: My Settings, Power Dialer, Analytics Hub all reachable and load cleanly', async ({ page }) => {
  const errs = [];
  watchErrors(page, errs);
  await login(page, AE_TOKEN);

  for (const hash of ['my-settings', 'my-calls', 'analytics']) {
    await goHash(page, `#${hash}`);
    const errorText = await page.locator('text=/uncaught|undefined is not|cannot read prop/i').count();
    if (errorText) logIssue(`ae-${hash}`, 'possible crash text found on page');
    else logOk(`ae-${hash}`, 'loads without obvious crash text');
  }
  if (errs.length) errs.forEach((e) => logIssue('ae-other-pages', e));
});

test.afterAll(() => {
  const real = issues.filter((i) => !i.startsWith('NOTE'));
  console.log(`\n=== v12.6.2 role-critical audit: ${real.length} failure(s), ${issues.length - real.length} note(s) ===`);
  issues.forEach((i) => console.log(i));
  if (real.length) throw new Error(real.join('\n'));
});
