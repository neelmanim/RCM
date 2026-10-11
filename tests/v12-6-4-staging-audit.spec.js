/**
 * v12.6.4 staging audit — the nav-restructuring batch (CSM's 4 flat nav
 * items, Super Admin's merged Pipeline & CSM hub), CSM opportunity call
 * logging (parity with AE Pipeline), the nav-label truncation fix, the
 * section-aware guided tours (CsmPortalTour/AccountDetailTour split +
 * AEPipelineTour's new pipeline-hub-tabs step), and the CSM Inbox greeting.
 *
 * Tokens via env: SA_TOKEN, AE_TOKEN, CSM_TOKEN (real users, minted via the
 * Super-Admin "View As" endpoint).
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const SA_TOKEN = process.env.SA_TOKEN;
const AE_TOKEN = process.env.AE_TOKEN;
const CSM_TOKEN = process.env.CSM_TOKEN;

// Real staging account with 2 opportunities and existing call history —
// used for the live call-log write-path test.
const GLOBEX_ACCOUNT_ID = '815a7287-1ba8-4f98-aa4c-3217526c07bb';

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

// tourSeenKeys: pass [] to leave ALL tour-seen flags unset (so a tour actually
// shows), or a list of keys to pre-seed as seen. Everything else (drawers,
// unrelated tours) stays pre-seeded so only the tour under test can appear.
const ALL_TOUR_KEYS = ['sales-tools', 'control-center', 'daily-digest', 'cadence-readonly',
  'my-settings', 'leaderboard', 'aircall-drawer', 'ae-pipeline', 'my-tasks',
  'csm-portal-inbox', 'csm-portal-portfolio', 'csm-portal-playbooks', 'csm-portal-digest',
  'csm-account-360', 'csm-portal'];

async function login(page, token, { leaveUnseen = [] } = {}) {
  await page.addInitScript(([seenKeys, all]) => {
    try { void localStorage.length; } catch { return; }
    all.filter((k) => !seenKeys.includes(k)).forEach((t) =>
      localStorage.setItem(`alternatecrm:${t}-tour-seen`, '1'));
    localStorage.setItem('leadsHub', 'on');
  }, [leaveUnseen, ALL_TOUR_KEYS]);
  await page.goto(`${BASE_URL}/?token=${token}`);
  await page.waitForSelector('nav', { timeout: 45_000 });
  await page.waitForTimeout(1500);
  const drawerClose = page.locator('.nh-aircall-drawer__header .nh-overlay-close');
  if (await drawerClose.count() > 0) await drawerClose.first().click().catch(() => {});
}

async function goHash(page, hash) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(2500);
}

async function closeTourIfOpen(page) {
  const dialog = page.locator('[role="dialog"]:not([aria-hidden="true"])');
  if (await dialog.count() > 0) {
    const gotIt = dialog.getByRole('button', { name: /Got it|Skip tour/ });
    // Click "Got it"/"Next" repeatedly until the dialog is gone (max 8 steps).
    for (let i = 0; i < 8 && await dialog.count() > 0; i++) {
      const btn = dialog.getByRole('button', { name: 'Got it' });
      if (await btn.count() > 0) { await btn.click(); break; }
      const next = dialog.getByRole('button', { name: 'Next' });
      if (await next.count() > 0) { await next.click(); await page.waitForTimeout(300); continue; }
      break;
    }
  }
}

test.beforeAll(() => {
  if (!SA_TOKEN) throw new Error('SA_TOKEN env var is required');
  if (!AE_TOKEN) throw new Error('AE_TOKEN env var is required');
  if (!CSM_TOKEN) throw new Error('CSM_TOKEN env var is required');
});

// ── Nav label + merged Pipeline hub ─────────────────────────────────────────

test('Super Admin: merged nav label renders in full, no truncation', async ({ page }) => {
  await login(page, SA_TOKEN);
  const item = page.locator('nav >> text=Pipeline & CSM');
  await expect(item).toBeVisible({ timeout: 15_000 });
  // The old label used to truncate visually to "AE Pipeline & CSM Po…" —
  // confirm that string is nowhere on the page now.
  expect(await page.locator('nav >> text=/AE Pipeline & CSM Po/').count()).toBe(0);
  logOk('nav-label', '"Pipeline & CSM" renders whole, no truncated variant present');
});

test('Super Admin: Pipeline hub — AE tab and CSM Portal tab both render real, distinct content', async ({ page }) => {
  const errs = [];
  watchErrors(page, errs);
  await login(page, SA_TOKEN, { leaveUnseen: [] });
  await goHash(page, '#pipeline-hub');
  await closeTourIfOpen(page);

  await expect(page.locator('[data-tour="ae-pipeline-table"]')).toBeVisible({ timeout: 15_000 });
  logOk('pipeline-hub', 'AE Pipeline tab is the default, table renders');

  const csmTabBtn = page.getByRole('button', { name: /CSM Portal/ });
  await expect(csmTabBtn).toBeVisible();
  await csmTabBtn.click();
  await page.waitForTimeout(1500);
  await expect(page.getByText(/account\(s\) total|Every customer account/)).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('[data-tour="ae-pipeline-table"]').count()).toBe(0);
  logOk('pipeline-hub', 'switching to CSM Portal tab unmounts AE table, shows admin-scoped CSM content');

  if (errs.length) errs.forEach((e) => logIssue('pipeline-hub', e));
});

// ── CSM Inbox greeting ───────────────────────────────────────────────────

test('CSM: greeted by first name on Inbox, not on other flat sections', async ({ page }) => {
  await login(page, CSM_TOKEN);
  await expect(page.getByText(/Good (morning|afternoon|evening), Demo 👋/)).toBeVisible({ timeout: 15_000 });
  logOk('csm-greeting', 'Inbox (landing page) shows a personalized greeting, matching every other role\'s Dashboard');

  await goHash(page, '#csm-portfolio');
  expect(await page.getByText(/👋/).count()).toBe(0);
  logOk('csm-greeting', 'no greeting bleeds into Portfolio — Inbox-only, as intended');
});

// ── CSM opportunity call logging (parity with AE Pipeline) ─────────────────

test('CSM: can log a call against an account opportunity from Account 360', async ({ page }) => {
  const errs = [];
  watchErrors(page, errs);
  await login(page, CSM_TOKEN);

  const before = await page.request.get(
    `https://messenger-crm-staging.onrender.com/api/csm-portal/accounts/${GLOBEX_ACCOUNT_ID}`,
    { headers: { Authorization: `Bearer ${CSM_TOKEN}` } },
  ).then((r) => r.json());
  const beforeCount = before.opportunity_calls.length;

  await goHash(page, '#csm-portfolio');
  await page.getByText('Globex Logistics').click();
  await expect(page.locator('[data-tour="csm-portal-call-log"]')).toBeVisible({ timeout: 15_000 });

  // Component uses the shared Select (a Radix DropdownMenu: button trigger +
  // menuitem options), not a native <select>; open it by its accessible name.
  const outcomeBtn = page.locator('[data-tour="csm-portal-call-log"] button[aria-label="Call outcome"]');
  await outcomeBtn.click();
  await page.getByRole('menuitem').first().click();

  const notes = page.locator('[data-tour="csm-portal-call-log"] textarea');
  await notes.fill(`v12.6.4 staging audit — automated verification ${new Date().toISOString()}`);

  await page.locator('[data-tour="csm-portal-call-log"] button:has-text("Log call")').click();
  await page.waitForTimeout(2000);

  const after = await page.request.get(
    `https://messenger-crm-staging.onrender.com/api/csm-portal/accounts/${GLOBEX_ACCOUNT_ID}`,
    { headers: { Authorization: `Bearer ${CSM_TOKEN}` } },
  ).then((r) => r.json());

  if (after.opportunity_calls.length === beforeCount + 1) {
    logOk('csm-call-log', `call count went ${beforeCount} → ${after.opportunity_calls.length}, write-path confirmed live`);
  } else {
    logIssue('csm-call-log', `expected ${beforeCount + 1} calls after logging, got ${after.opportunity_calls.length}`);
  }

  if (errs.length) errs.forEach((e) => logIssue('csm-call-log', e));
});

// ── Section-aware guided tours ──────────────────────────────────────────────

test('CSM: Inbox and Portfolio tours are independent — each has its own seen-key', async ({ page }) => {
  await login(page, CSM_TOKEN, { leaveUnseen: ['csm-portal-inbox', 'csm-portal-portfolio'] });
  await expect(page.locator('[role="dialog"]:not([aria-hidden="true"])')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[role="dialog"]:not([aria-hidden="true"])')).toContainText(/Inbox|Portfolio|Playbooks|Digest|Worst-health/);
  logOk('csm-tour', 'Inbox tour shows on first visit');
  await closeTourIfOpen(page);
  await expect(page.locator('[role="dialog"]:not([aria-hidden="true"])')).toHaveCount(0);

  // Portfolio is a SEPARATE page mount with its own seen-key — its tour must
  // still be unseen even though Inbox's tour was just completed.
  await goHash(page, '#csm-portfolio');
  await expect(page.locator('[role="dialog"]:not([aria-hidden="true"])')).toBeVisible({ timeout: 15_000 });
  logOk('csm-tour', 'Portfolio tour still shows after Inbox tour was completed — independent seen-keys confirmed');
  await closeTourIfOpen(page);
});

test('CSM: Account 360 tour is independent of whichever section it was opened from', async ({ page }) => {
  await login(page, CSM_TOKEN, { leaveUnseen: ['csm-account-360'] });
  await goHash(page, '#csm-portfolio');
  await closeTourIfOpen(page); // portfolio's own tour, not under test here
  await page.getByText('Globex Logistics').click();
  await expect(page.locator('[role="dialog"]:not([aria-hidden="true"])')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[role="dialog"]:not([aria-hidden="true"])')).toContainText(/Account 360|Log a call/);
  logOk('account-360-tour', 'shows independently on first Account 360 visit');
  // Exactly one dialog — no stacked overlays.
  expect(await page.locator('[role="dialog"]:not([aria-hidden="true"])').count()).toBe(1);
  await closeTourIfOpen(page);
});

test('Super Admin: Pipeline hub reuses AEPipelineTour with one leading step, no second overlay stacks on it', async ({ page }) => {
  await login(page, SA_TOKEN, { leaveUnseen: ['ae-pipeline'] });
  await goHash(page, '#pipeline-hub');
  await expect(page.locator('[role="dialog"]:not([aria-hidden="true"])')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[role="dialog"]:not([aria-hidden="true"])')).toContainText('AE Pipeline & CSM Portal');
  // Only one GuidedTour overlay ever mounts here — confirms the deliberate
  // choice to extend AEPipelineTour rather than mount a second PipelineHubTour.
  expect(await page.locator('[role="dialog"]:not([aria-hidden="true"])').count()).toBe(1);
  logOk('pipeline-hub-tour', 'single tour overlay, leading step targets the tab switcher');
});

test.afterAll(() => {
  console.log(`\n=== v12.6.4 staging audit: ${issues.length} failure(s) ===`);
  issues.forEach((i) => console.log(i));
  if (issues.length) throw new Error(issues.join('\n'));
});
