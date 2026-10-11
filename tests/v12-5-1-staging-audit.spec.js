/**
 * v12.5.1 staging audit — every area this release touched.
 *
 * The release is mostly "swap hand-rolled markup for components/ui/", so most
 * of these assertions are negative: the primitive must NOT be a native
 * control any more. A positive-only check ("the outcome picker renders")
 * passes just as happily against the old raw <select>, which is exactly how
 * StageSelect went two releases with a raw <select> inside the component
 * library without anyone noticing.
 *
 *   1. Backend on 12.5.1, DB healthy (also proves create_all made
 *      background_job_state without erroring at startup).
 *   2. GET /sync-am-status returns the persisted shape (`interrupted`), not
 *      the old in-memory dict. Never verified live before this release.
 *   3. AE Pipeline drawer: call-outcome is a Select (role=menuitem), and
 *      neither the Update-deal nor the Close-deal card has a native date
 *      input left.
 *   4. CSM Account 360: health factors render from whatever the backend
 *      returned, the derived partial label names all four missing factors,
 *      Back is a real Button, and Manage's Stage is a Select.
 *   5. CSM Portfolio: the bulk-assign UI exists for a Super Admin.
 *   6. Help Hub lists v12.5.1.
 *
 * Read-only: nothing here submits a form. The write paths were exercised
 * against staging in v12.5.0's pass and are covered by unit tests.
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

test.describe('v12.5.1', () => {
  test.setTimeout(240_000);

  test('1. backend is on 12.5.1 and the DB is reachable', async ({ request }) => {
    const shallow = await (await request.get(`${API_BASE}/api/health`)).json();
    const deep = await (await request.get(`${API_BASE}/api/health/deep`)).json();
    expect(shallow.version).toBe('12.5.1');
    expect(deep.db_tables_accessible).toBe(true);
    // Startup ran create_all with the new BackgroundJobState model in the
    // metadata; a broken column type would have failed here, not silently.
    logOk('health', `version ${shallow.version}, db ${deep.db_latency_ms}ms`);
  });

  test('2. AM sync status is served from the persisted row, not the old dict', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/admin/sync-am-status`, {
      headers: { Authorization: `Bearer ${SA_TOKEN}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();

    // `interrupted` only exists on the new _read_am_status path — the old
    // in-memory dict had no such key. This is the one assertion that can
    // tell the two implementations apart from outside.
    if (!('interrupted' in body)) {
      logIssue('am-status', `no "interrupted" key — still the old in-memory shape? got ${JSON.stringify(body)}`);
    }
    for (const k of ['running', 'synced', 'failed', 'skipped', 'total', 'errors', 'started_at', 'finished_at', 'message']) {
      if (!(k in body)) logIssue('am-status', `missing key "${k}"`);
    }
    expect(typeof body.running).toBe('boolean');
    expect(Array.isArray(body.errors)).toBe(true);
    logOk('am-status', `running=${body.running} interrupted=${body.interrupted} synced=${body.synced} started_at=${body.started_at}`);
  });

  test('3. AE Pipeline drawer uses Select + DatePicker, no native controls', async ({ page }) => {
    // 2026-09-16: Super Admin no longer reaches #ae-pipeline directly — the
    // merged #pipeline-hub's AE tab (default) is the same component now.
    const errs = []; watchErrors(page, errs);
    await login(page);
    await goHash(page, 'pipeline-hub');

    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    if (rowCount === 0) {
      logIssue('ae-pipeline', 'no opportunities on staging — drawer assertions could not run');
      return;
    }

    // "Update deal" and "Close deal" are gated on !detail.is_closed, so a
    // closed opportunity legitimately has no DatePicker. Staging's first row
    // is Closed Won; pick an open one from the API rather than asserting
    // against whichever row happens to sort first.
    const list = await (await page.request.get(`${API_BASE}/api/ae-pipeline/opportunities`, {
      headers: { Authorization: `Bearer ${SA_TOKEN}` },
    })).json();
    const opps = Array.isArray(list) ? list : list.opportunities || [];
    const openIdx = opps.findIndex((o) => !o.is_closed);
    if (openIdx === -1) {
      logIssue('ae-pipeline', 'every opportunity on staging is closed — Update/Close card assertions could not run');
      return;
    }
    // Click by index, not by name: the Account cell renders
    // `opp.account_name || opp.name`, so the opportunity's own name is never
    // the visible text when the account has one. The table maps this same
    // array in this same order, so the index is the reliable handle.
    if (rowCount !== opps.length) {
      logIssue('ae-pipeline', `table shows ${rowCount} rows but the API returned ${opps.length} — index mapping is unsafe`);
      return;
    }
    await rows.nth(openIdx).click();

    // The always-mounted Aircall FAB is also a [role="dialog"], so a bare
    // selector is a strict-mode violation. Exclude the hidden one.
    const drawer = page.locator('[role="dialog"]:not([aria-hidden="true"])');
    await expect(drawer).toBeVisible({ timeout: 15_000 });
    // The Modal frame mounts before the detail fetch resolves. Without this
    // the assertions below run against an empty shell and every "not a
    // Select" check passes for the wrong reason.
    await expect(drawer.getByText('Call history')).toBeVisible({ timeout: 20_000 });

    // The whole point of the release: zero native selects / date inputs left.
    const nativeSelects = await drawer.locator('select').count();
    const nativeDates = await drawer.locator('input[type="date"]').count();
    if (nativeSelects > 0) logIssue('ae-pipeline', `${nativeSelects} native <select> still in the drawer`);
    if (nativeDates > 0) logIssue('ae-pipeline', `${nativeDates} native <input type=date> still in the drawer`);

    // Order matters: every read-only assertion runs BEFORE any interaction.
    // Escape closes the Select popover *and* propagates to the Radix Modal,
    // dismissing the whole drawer — so anything queried after the Select is
    // opened silently counts zero against a detached dialog.

    // Both date fields (Update deal + Close deal) are DatePickers, which
    // expose themselves as buttons named "Close date" (TriggerPill forwards
    // aria-label, which beats the visible date text for the accessible name).
    const dateTriggers = await drawer.getByRole('button', { name: 'Close date' }).count();
    if (dateTriggers < 1) logIssue('ae-pipeline', `expected DatePicker trigger(s) named "Close date", found ${dateTriggers}`);
    else logOk('ae-pipeline', `${dateTriggers} DatePicker trigger(s) present`);

    // Call outcome is a real Select: a button whose accessible name is the
    // static ariaLabel, opening menuitem options. Interaction last.
    const outcome = drawer.getByRole('button', { name: 'Call outcome' });
    if (await outcome.count() === 0) {
      logIssue('ae-pipeline', 'no button with accessible name "Call outcome" — outcome picker is not a Select');
    } else {
      await outcome.first().click();
      const items = page.locator('[role="menuitem"]');
      const n = await items.count();
      if (n === 0) logIssue('ae-pipeline', 'outcome Select opened no menuitem options');
      else logOk('ae-pipeline', `outcome Select opened ${n} options`);
      await page.keyboard.press('Escape');
    }

    await page.screenshot({ path: 'tests/screenshots/v12-5-1-ae-drawer.png', fullPage: false });
    if (errs.length) logIssue('ae-pipeline', `console/page errors: ${errs.join(' | ')}`);
  });

  test('4. CSM Account 360 renders derived health factors and shared components', async ({ page }) => {
    // 2026-09-16: Super Admin's CSM Portal oversight view moved from
    // #csm-portal to #pipeline-hub's "CSM Portal" tab.
    const errs = []; watchErrors(page, errs);
    await login(page);
    await goHash(page, 'pipeline-hub');
    await page.getByRole('button', { name: /CSM Portal/ }).first().click().catch(() => {});
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: /Portfolio/i }).first().click().catch(() => {});
    await page.waitForTimeout(2500);

    const rows = page.locator('table tbody tr');
    if (await rows.count() === 0) {
      logIssue('csm-portal', 'no accounts in the portfolio — Account 360 assertions could not run');
      return;
    }
    await rows.first().click();
    await page.waitForTimeout(3000);

    // Back is a Button now, not a hand-styled anchor.
    const back = page.getByRole('button', { name: /Back/ });
    if (await back.count() === 0) logIssue('csm-portal', 'no Back button (accessible name "Back") on Account 360');
    else logOk('csm-portal', 'Back renders as a Button');

    // Health factors are whatever the backend returned. Staging has the two
    // real ones; the assertion is that they come from the map, so the label
    // and the rendered factors agree with each other.
    const body = await page.locator('body').innerText();
    for (const f of ['commercial', 'relationship']) {
      if (!new RegExp(`${f}\\s*:\\s*\\d`, 'i').test(body)) logIssue('csm-portal', `health factor "${f}" not rendered`);
    }

    // The derived label. The old frozen string named only Usage/Support and
    // said "Relationship + Commercial"; the derived one follows
    // _FACTOR_WEIGHTS order and names all four missing factors.
    const label = body.match(/Based on [^\n]*not yet available/i);
    if (!label) {
      logIssue('csm-portal', 'no partial-data footnote found');
    } else {
      const text = label[0];
      for (const missing of ['Usage', 'Support', 'Payment', 'Sentiment']) {
        if (!text.includes(missing)) logIssue('csm-portal', `partial label omits "${missing}" — still the old frozen string? got: ${text}`);
      }
      logOk('csm-portal', `partial label: ${text}`);
    }

    // Manage -> the Stage field is a Select (StageSelect's own raw <select>
    // was the worst instance this release fixed).
    const manage = page.getByRole('button', { name: 'Manage' });
    if (await manage.count() > 0) {
      await manage.first().click();
      await page.waitForTimeout(2000);
      const dialog = page.locator('[role="dialog"]:not([aria-hidden="true"])');
      const nativeSelects = await dialog.locator('select').count();
      const nativeDates = await dialog.locator('input[type="date"]').count();
      if (nativeSelects > 0) logIssue('csm-portal', `${nativeSelects} native <select> still in the Manage modal`);
      if (nativeDates > 0) logIssue('csm-portal', `${nativeDates} native <input type=date> still in the Manage modal`);

      // StageSelect deliberately falls back to a free-text Input when
      // Salesforce isn't configured (no StageName picklist to constrain to),
      // which is staging's state — /csm-portal/stage-options returns []. So
      // assert on whichever branch the data actually put us in; the thing
      // that must hold either way is the native-<select> count above.
      const opts = await (await page.request.get(`${API_BASE}/api/csm-portal/stage-options`, {
        headers: { Authorization: `Bearer ${SA_TOKEN}` },
      })).json();
      const stageBtn = await dialog.getByRole('button', { name: 'Stage' }).count();
      const stageInput = await dialog.locator('input').count();
      if (opts.length > 0) {
        if (stageBtn === 0) logIssue('csm-portal', `${opts.length} stage options but Stage is not a Select`);
        else logOk('csm-portal', `Stage renders through Select (${opts.length} options)`);
      } else if (stageBtn > 0) {
        logIssue('csm-portal', 'Stage rendered as a Select with zero options — the free-text fallback should have run');
      } else if (stageInput === 0) {
        logIssue('csm-portal', 'no stage-options and no free-text Stage input either — field is missing');
      } else {
        logOk('csm-portal', 'no SF picklist on staging — Stage correctly fell back to the free-text Input');
      }
      await page.screenshot({ path: 'tests/screenshots/v12-5-1-csm-manage.png' });
      await page.keyboard.press('Escape');
    } else {
      logOk('csm-portal', 'no open opportunity on this account — Manage modal not exercised');
    }

    await page.screenshot({ path: 'tests/screenshots/v12-5-1-csm-account-360.png', fullPage: true });
    if (errs.length) logIssue('csm-portal', `console/page errors: ${errs.join(' | ')}`);
  });

  test('5. CSM Portfolio exposes the bulk-assign UI to a Super Admin', async ({ page }) => {
    // 2026-09-16: same #pipeline-hub move as test 4 above.
    const errs = []; watchErrors(page, errs);
    await login(page);
    await goHash(page, 'pipeline-hub');
    await page.getByRole('button', { name: /CSM Portal/ }).first().click().catch(() => {});
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /Portfolio/i }).first().click().catch(() => {});
    await page.waitForTimeout(2500);

    const boxes = page.locator('table tbody input[type="checkbox"]');
    const n = await boxes.count();
    if (n === 0) {
      logIssue('portfolio', 'no row checkboxes — bulk-assign UI missing for Super Admin');
      return;
    }
    // The assign bar is gated on a non-empty selection, so select one first.
    await boxes.first().click({ force: true });
    await page.waitForTimeout(800);

    const picker = page.getByRole('button', { name: 'Assign to CSM' });
    if (await picker.count() === 0) logIssue('portfolio', 'selection made but no "Assign to CSM" picker appeared');
    else logOk('portfolio', `${n} selectable rows, assign picker present`);

    await page.screenshot({ path: 'tests/screenshots/v12-5-1-portfolio-bulkassign.png' });
    if (errs.length) logIssue('portfolio', `console/page errors: ${errs.join(' | ')}`);
  });

  test('6. Help Hub lists the v12.5.1 release', async ({ page }) => {
    const errs = []; watchErrors(page, errs);
    await login(page);
    await goHash(page, 'user-guide');
    const body = await page.locator('body').innerText();
    if (!/v12\.5\.1/.test(body)) {
      // Release notes may be behind a section click.
      await page.getByText(/Release Notes|What's New/i).first().click().catch(() => {});
      await page.waitForTimeout(2000);
      const after = await page.locator('body').innerText();
      if (!/v12\.5\.1/.test(after)) logIssue('help-hub', 'v12.5.1 not listed in the in-app release notes');
      else logOk('help-hub', 'v12.5.1 listed');
    } else {
      logOk('help-hub', 'v12.5.1 listed');
    }
    await page.screenshot({ path: 'tests/screenshots/v12-5-1-help-hub.png' });
    if (errs.length) logIssue('help-hub', `console/page errors: ${errs.join(' | ')}`);
  });

  test.afterAll(() => {
    if (issues.length) {
      console.error(`\n=== ${issues.length} ISSUE(S) ===\n${issues.join('\n')}`);
    } else {
      console.log('\n=== no issues ===');
    }
  });
});
