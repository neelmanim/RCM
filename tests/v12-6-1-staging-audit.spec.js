/**
 * v12.6.1 staging audit — pagination/filtering/CSM health chart batch.
 *
 *   1. My Tasks: nav item now HIDDEN for Super Admin (new gating — a
 *      personal worklist doesn't apply to a role with no assigned leads).
 *   2/3. AE Pipeline + CSM Portal: 2026-09-16 nav restructuring merged these
 *      two into one Super-Admin nav item ('pipeline-hub') with a tab for
 *      each — a real merge this time (one nav entry, two tabs inside),
 *      not the redundant duplicate switch a first cut of v12.6.0 shipped
 *      and then removed (that switch sat *inside* two still-separate nav
 *      items, duplicating what the sidebar already did). Verifies both
 *      tabs render their real content and no bare error leaks through.
 *
 * Read-only: nothing here submits a form. Token via env so it isn't
 * committed: SA_TOKEN.
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
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
     'my-settings', 'leaderboard', 'aircall-drawer', 'ae-pipeline', 'csm-portal',
     'my-tasks', 'csm-inbox', 'csm-portfolio', 'csm-playbooks', 'csm-digest'].forEach((t) =>
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

test('My Tasks: nav item hidden for Super Admin', async ({ page }) => {
  await login(page);
  const navItem = page.locator('nav >> text=My Tasks');
  expect(await navItem.count()).toBe(0);
  logOk('my-tasks', 'nav item correctly hidden for Super Admin');
});

test('Pipeline hub: AE Pipeline tab search/filters render, no ReferenceError', async ({ page }) => {
  const errs = [];
  watchErrors(page, errs);
  await login(page);
  await goHash(page, '#pipeline-hub');

  await expect(page.getByRole('button', { name: 'AE Pipeline' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'CSM Portal' })).toBeVisible();
  logOk('pipeline-hub', 'both tabs render — a real merge, one nav item with two tabs');
  await expect(page.getByPlaceholder('Search by account…')).toBeVisible({ timeout: 15_000 });
  logOk('pipeline-hub', 'AE Pipeline tab: search input renders');
  await expect(page.getByRole('button', { name: 'Filter by stage' })).toBeVisible();
  logOk('pipeline-hub', 'AE Pipeline tab: stage filter renders');

  if (errs.length) errs.forEach((e) => logIssue('pipeline-hub', e));
  else logOk('pipeline-hub', 'no page errors');
});

test('Pipeline hub: CSM Portal tab search/filters render, health donut', async ({ page }) => {
  const errs = [];
  watchErrors(page, errs);
  await login(page);
  await goHash(page, '#pipeline-hub');
  await page.getByRole('button', { name: 'CSM Portal' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Portfolio/ }).click().catch(() => {});
  await page.waitForTimeout(1500);

  await expect(page.getByText('Portfolio health')).toBeVisible({ timeout: 15_000 });
  logOk('pipeline-hub', 'CSM Portal tab: health-tier donut chart renders');
  await expect(page.getByPlaceholder('Search by account…')).toBeVisible();
  logOk('pipeline-hub', 'CSM Portal tab: search input renders');

  if (errs.length) errs.forEach((e) => logIssue('pipeline-hub', e));
  else logOk('pipeline-hub', 'no page errors');
});

test.afterAll(() => {
  console.log(`\n=== v12.6.1 staging audit: ${issues.length} issue(s) ===`);
  if (issues.length) throw new Error(issues.join('\n'));
});
