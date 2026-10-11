/**
 * v12.2.0 staging audit — the batch shipped in commit e4a7d688:
 *   1. campaign email HTML fix (send_email body_is_html)
 *   2. email-template ownership exposure + symmetric Edit/Delete gating
 *   3. cadence ownership scoping (owner-or-Super-Admin on every mutating route)
 *   4. MergeFieldComposer (chip inserts at the caret)
 *   5. read-only EmailPreview in the cadence node config panel
 *   6. Daily Digest regrouped KPIs
 *   7. My Settings React island + Leaderboard React island + Pod Admin in
 *      Control Center with per-section gating
 *
 * Run across all four staging roles. Tokens are passed in via env so they
 * aren't committed: SA_TOKEN / PA_TOKEN / SDR_TOKEN / AE_TOKEN.
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const TOKENS = {
  'Super Admin': process.env.SA_TOKEN,
  'Pod Admin': process.env.PA_TOKEN,
  SDR: process.env.SDR_TOKEN,
  AE: process.env.AE_TOKEN,
};

const issues = [];
const logIssue = (area, detail) => { console.error(`FAIL [${area}] ${detail}`); issues.push(`[${area}] ${detail}`); };
const logOk = (area, detail) => console.log(`OK ${area}: ${detail}`);

/** Console/pageerror collector — a blank React island only shows up here. */
function watchErrors(page, sink) {
  page.on('pageerror', (e) => sink.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Staging noise unrelated to this batch: missing favicons, 401s from
    // integrations that aren't connected for a given test user.
    if (/favicon|net::ERR_|Failed to load resource/i.test(t)) return;
    sink.push(`console: ${t}`);
  });
}

async function login(page, token) {
  await page.goto(`${BASE_URL}/?token=${token}`);
  await page.waitForSelector('nav >> text=Dashboard', { timeout: 45000 });
  // Suppress every already-shipped tour — their overlays intercept clicks.
  await page.evaluate(() => {
    ['sales-tools', 'control-center', 'daily-digest', 'cadence-readonly',
     'my-settings', 'leaderboard'].forEach((t) =>
      localStorage.setItem(`alternatecrm:${t}-tour-seen`, '1'));
  });
  // Dismiss the Aircall drawer (AircallEverywhereDrawer.jsx). It docks over
  // the right ~440px and covers the campaign wizard's Continue button, which
  // makes Playwright wait forever for an unobscured click target. Scope this
  // to the drawer's own close button — a loose `[class*="aircall"] button`
  // selector hits "Sign in to Aircall" and navigates the session away.
  const drawerClose = page.locator('.nh-aircall-drawer__header .nh-overlay-close');
  if (await drawerClose.count() > 0) await drawerClose.first().click().catch(() => {});
}

async function openNav(page, label) {
  const link = page.getByRole('link', { name: label, exact: true });
  if (await link.count() === 0) return false;
  await link.click();
  await page.waitForTimeout(3000);
  return true;
}

// ── 1. Both new React islands must mount for every role ─────────────────────
for (const [role, token] of Object.entries(TOKENS)) {
  test(`[${role}] My Settings island mounts with all four cards`, async ({ page }) => {
    const errs = []; watchErrors(page, errs);
    await login(page, token);
    if (!await openNav(page, 'My Settings')) {
      logIssue(`MySettings/${role}`, 'No "My Settings" nav entry');
      return;
    }
    for (const card of ['Email Sync', 'Dialer', 'Email Branding', 'Signature']) {
      if (await page.getByText(card, { exact: false }).count() > 0) logOk(`MySettings/${role}`, `"${card}" card present`);
      else logIssue(`MySettings/${role}`, `"${card}" card missing`);
    }
    // The legacy page is kept as a crash-fallback; if it rendered, the island died.
    if (await page.locator('#my-settings-legacy, .legacy-my-settings').count() > 0)
      logIssue(`MySettings/${role}`, 'Legacy fallback rendered — React island failed to mount');
    if (errs.length) logIssue(`MySettings/${role}`, `console errors: ${errs.slice(0, 3).join(' | ')}`);
    await page.screenshot({ path: `tests/screenshots/v1220-my-settings-${role.replace(/\s/g, '')}.png`, fullPage: true });
  });

  test(`[${role}] Leaderboard island mounts`, async ({ page }) => {
    const errs = []; watchErrors(page, errs);
    await login(page, token);
    if (!await openNav(page, 'Leaderboard')) {
      logIssue(`Leaderboard/${role}`, 'No "Leaderboard" nav entry');
      return;
    }
    await page.locator('table tbody tr').first()
      .or(page.getByText(/to rank yet/)).waitFor({ timeout: 20000 }).catch(() => {});
    const hasRows = await page.locator('table tbody tr').count();
    const hasEmpty = await page.getByText(/to rank yet/).count();
    if (hasRows > 0 || hasEmpty > 0) logOk(`Leaderboard/${role}`, `rendered (rows=${hasRows}, emptyState=${hasEmpty})`);
    else logIssue(`Leaderboard/${role}`, 'Neither a table nor an empty state rendered — island likely blank');

    // Pod Admin is the only role with the My Pod / Global scope toggle.
    const toggle = page.getByRole('button', { name: /^Global$/ });
    if (role === 'Pod Admin') {
      if (await toggle.count() > 0) {
        logOk('Leaderboard/PodAdmin', 'My Pod / Global toggle present');
        // Staging has no SDR with a pod_id, so My Pod is legitimately empty —
        // the empty state must point at the Global toggle rather than dead-end.
        if (await page.getByText(/Switch to Global to see everyone/).count() > 0)
          logOk('Leaderboard/PodAdmin', 'Empty pod view guides to Global');
        await toggle.click();
        await page.waitForTimeout(3000);
        const after = await page.locator('table tbody tr').count();
        if (after > 0) logOk('Leaderboard/PodAdmin', `Global view returns ${after} rows`);
        else logIssue('Leaderboard/PodAdmin', 'Global view still empty — toggle not wired');
      } else logIssue('Leaderboard/PodAdmin', 'My Pod / Global toggle missing');
    } else if (await toggle.count() > 0) {
      logIssue(`Leaderboard/${role}`, 'Pod-scope toggle exposed to a non-Pod-Admin role');
    }

    // AE tab is admin-only.
    const aeTab = page.getByRole('button', { name: 'AEs', exact: true });
    const aeVisible = await aeTab.count() > 0;
    if (['Super Admin', 'Pod Admin'].includes(role) ? aeVisible : !aeVisible)
      logOk(`Leaderboard/${role}`, `AE tab visibility correct (visible=${aeVisible})`);
    else logIssue(`Leaderboard/${role}`, `AE tab visibility wrong (visible=${aeVisible})`);

    if (errs.length) logIssue(`Leaderboard/${role}`, `console errors: ${errs.slice(0, 3).join(' | ')}`);
    await page.screenshot({ path: `tests/screenshots/v1220-leaderboard-${role.replace(/\s/g, '')}.png`, fullPage: true });
  });
}

// ── 2. Control Center — Pod Admin admitted, but only to Team & Access ───────
test('[Pod Admin] Control Center shows only Team & Access', async ({ page }) => {
  const errs = []; watchErrors(page, errs);
  await login(page, TOKENS['Pod Admin']);
  if (!await openNav(page, 'Control Center')) {
    logIssue('ControlCenter/PodAdmin', 'No "Control Center" nav entry for a Pod Admin');
    return;
  }
  const shown = await page.getByRole('button', { name: /Team & Access/i }).count();
  if (shown > 0) logOk('ControlCenter/PodAdmin', 'Team & Access section available');
  else logIssue('ControlCenter/PodAdmin', 'Team & Access section not available');

  for (const denied of ['Integrations', 'AI & Automation', 'Data', 'Monitoring']) {
    if (await page.getByRole('button', { name: denied, exact: true }).count() === 0)
      logOk('ControlCenter/PodAdmin', `"${denied}" correctly hidden`);
    else logIssue('ControlCenter/PodAdmin', `"${denied}" is visible to a Pod Admin — should be Super Admin only`);
  }
  if (errs.length) logIssue('ControlCenter/PodAdmin', `console errors: ${errs.slice(0, 3).join(' | ')}`);
  await page.screenshot({ path: 'tests/screenshots/v1220-cc-podadmin.png', fullPage: true });
});

test('[SDR] Control Center stays hidden', async ({ page }) => {
  await login(page, TOKENS.SDR);
  const link = page.getByRole('link', { name: 'Control Center', exact: true });
  if (await link.count() === 0) logOk('ControlCenter/SDR', 'Correctly hidden from an SDR');
  else logIssue('ControlCenter/SDR', 'Control Center nav entry visible to an SDR');
});

// ── 3. Merge-field composer + template ownership on Sales Tools ─────────────
test('[Super Admin] Campaigns composer has merge-field chips that insert at the caret', async ({ page }) => {
  // The longest path in this spec: login, three navigations, then a
  // two-step wizard whose first step loads an 11.5k-row lead table. The
  // 60s default is spent before the composer is even on screen.
  test.setTimeout(150_000);
  const errs = []; watchErrors(page, errs);
  await login(page, TOKENS['Super Admin']);
  await openNav(page, 'Sales Tools');
  await page.getByRole('button', { name: 'Campaigns', exact: true }).click();
  await page.waitForTimeout(2500);

  const newBtn = page.getByRole('button', { name: /New Campaign/i }).first();
  if (await newBtn.count() === 0) { logIssue('MergeComposer', 'No "New Campaign" button found'); return; }
  await newBtn.click();
  await page.waitForTimeout(2000);

  // "New Campaign" is a two-step wizard: step 1 picks recipients, and the
  // compose surface (with the merge chips) is step 2. Pick one lead and
  // advance, or the chips genuinely aren't on screen yet.
  const step1 = page.getByText(/Step 1 of 2/);
  if (await step1.count() > 0) {
    const firstLead = page.locator('table input[type="checkbox"]').first();
    await firstLead.waitFor({ timeout: 15000 }).catch(() => {});
    await firstLead.check().catch(() => {});
    await page.getByRole('button', { name: /Continue/i }).first().click().catch(() => {});
    await page.waitForTimeout(2500);
  }

  const chip = page.getByRole('button', { name: '{{first_name}}', exact: true }).first();
  await chip.waitFor({ timeout: 10000 }).catch(() => {});
  if (await chip.count() === 0) {
    await page.screenshot({ path: 'tests/screenshots/v1220-merge-composer-MISS.png', fullPage: true });
    logIssue('MergeComposer', 'No {{first_name}} merge chip rendered');
    return;
  }
  logOk('MergeComposer', 'Merge-field chips rendered');

  // Subject: type a prefix, place the caret mid-string, then insert.
  const subject = page.getByPlaceholder(/subject/i).first();
  if (await subject.count() > 0) {
    await subject.click();
    await subject.fill('Hi  — quick note');
    // Caret between the two spaces after "Hi".
    await subject.evaluate((el) => { el.focus(); el.setSelectionRange(3, 3); });
    await chip.click();
    await page.waitForTimeout(500);
    const val = await subject.inputValue();
    if (val.includes('{{first_name}}')) {
      logOk('MergeComposer', `Chip inserted into subject: ${JSON.stringify(val)}`);
      if (val.startsWith('Hi {{first_name}}')) logOk('MergeComposer', 'Inserted at the caret, not appended');
      else logIssue('MergeComposer', `Inserted but not at the caret: ${JSON.stringify(val)}`);
    } else logIssue('MergeComposer', `Chip click did not insert into subject (value=${JSON.stringify(val)})`);
  } else logIssue('MergeComposer', 'Subject input not found');

  if (errs.length) logIssue('MergeComposer', `console errors: ${errs.slice(0, 3).join(' | ')}`);
  await page.screenshot({ path: 'tests/screenshots/v1220-merge-composer.png', fullPage: true });
});

test('[Pod Admin] Another user\'s template offers Duplicate, never Edit or Delete', async ({ page }) => {
  await login(page, TOKENS['Pod Admin']);
  await openNav(page, 'Sales Tools');
  await page.getByRole('button', { name: 'Campaigns', exact: true }).click();
  await page.waitForTimeout(2000);
  // Saved templates are a separate sub-tab from the campaigns list.
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.waitForTimeout(3000);

  const attribution = page.getByText(/^by /);
  if (await attribution.count() > 0) logOk('TemplateOwnership', `Owner attribution shown (${await attribution.count()} rows)`);
  else logIssue('TemplateOwnership', 'No "by <owner>" attribution on templates owned by someone else');

  // Every template on staging belongs to the Super Admin, so a Pod Admin must
  // see zero Edit/Delete affordances and a Duplicate instead.
  const editable = await page.getByRole('button', { name: /^Edit$/ }).count();
  const deletable = await page.getByRole('button', { name: /^Delete$/ }).count();
  const dupes = await page.getByRole('button', { name: /Duplicate|Copy/i }).count();
  if (editable === 0 && deletable === 0) logOk('TemplateOwnership', 'No Edit/Delete on non-owned templates');
  else logIssue('TemplateOwnership', `Edit(${editable})/Delete(${deletable}) exposed on a template this user does not own`);
  if (dupes > 0) logOk('TemplateOwnership', `Duplicate offered instead (${dupes})`);
  else logIssue('TemplateOwnership', 'No Duplicate action offered to a non-owner');

  await page.screenshot({ path: 'tests/screenshots/v1220-template-ownership-pa.png', fullPage: true });
});

// ── 4. Cadence ownership UI ─────────────────────────────────────────────────
test('[Pod Admin] Cadence list shows owner attribution and hides delete', async ({ page }) => {
  await login(page, TOKENS['Pod Admin']);
  await openNav(page, 'Sales Tools');
  await page.waitForTimeout(2000);

  const owned = page.getByText(/Owned by/);
  if (await owned.count() > 0) logOk('CadenceOwnership', `"Owned by …" attribution shown (${await owned.count()})`);
  else logIssue('CadenceOwnership', 'No "Owned by …" attribution on cadences owned by someone else');

  const boxes = page.locator('input[type="checkbox"]');
  const total = await boxes.count();
  let enabled = 0;
  for (let i = 0; i < total; i++) if (await boxes.nth(i).isEnabled()) enabled++;
  if (enabled === 0) logOk('CadenceOwnership', `all ${total} select checkbox(es) disabled — cannot bulk-delete another user's cadence`);
  else logIssue('CadenceOwnership', `${enabled}/${total} select checkbox(es) still enabled for cadences this user cannot edit`);

  await page.screenshot({ path: 'tests/screenshots/v1220-cadence-ownership-pa.png', fullPage: true });
});

test('[Pod Admin] Opening another user\'s cadence is read-only and names the owner', async ({ page }) => {
  await login(page, TOKENS['Pod Admin']);
  await openNav(page, 'Sales Tools');
  await page.waitForTimeout(2000);

  const row = page.getByText('Testing Cadence 1').first();
  if (await row.count() === 0) { logIssue('CadenceReadOnly', 'Could not find a cadence row to open'); return; }
  await row.click();
  await page.waitForTimeout(3000);

  const lockBanner = page.getByText(/Neelmani Mishra/);
  if (await lockBanner.count() > 0) logOk('CadenceReadOnly', 'Owner named in the read-only banner');
  else logIssue('CadenceReadOnly', 'Read-only banner does not name the owner');

  for (const btn of ['Publish', 'Archive']) {
    if (await page.getByRole('button', { name: btn, exact: true }).count() === 0) logOk('CadenceReadOnly', `${btn} hidden`);
    else logIssue('CadenceReadOnly', `${btn} is visible on a cadence this user does not own`);
  }
  await page.screenshot({ path: 'tests/screenshots/v1220-cadence-readonly-pa.png', fullPage: true });
});

// ── 5. Email preview usable while read-only ────────────────────────────────
test('[Super Admin] Cadence email node shows a preview', async ({ page }) => {
  const errs = []; watchErrors(page, errs);
  await login(page, TOKENS['Super Admin']);
  await openNav(page, 'Sales Tools');
  await page.waitForTimeout(2000);
  const row = page.getByText('Testing Cadence 1').first();
  if (await row.count() === 0) { logIssue('EmailPreview', 'No cadence to open'); return; }
  await row.click();
  await page.waitForTimeout(3500);

  const emailNode = page.locator('[data-node-type="email"], .react-flow__node').filter({ hasText: /Email/i }).first();
  if (await emailNode.count() === 0) { logIssue('EmailPreview', 'No Email node found in the graph'); return; }
  await emailNode.click();
  await page.waitForTimeout(2000);

  if (await page.getByText(/Preview/i).count() > 0) logOk('EmailPreview', 'Preview section present in the node config panel');
  else logIssue('EmailPreview', 'No Preview section in the Email node config panel');
  if (errs.length) logIssue('EmailPreview', `console errors: ${errs.slice(0, 3).join(' | ')}`);
  await page.screenshot({ path: 'tests/screenshots/v1220-email-preview.png', fullPage: true });
});

// ── 6. Daily Digest regrouped layout ───────────────────────────────────────
test('[Super Admin] Daily Digest renders regrouped KPI groups with no duplicate comparison card', async ({ page }) => {
  const errs = []; watchErrors(page, errs);
  await login(page, TOKENS['Super Admin']);
  if (!await openNav(page, 'Daily Digest')) { logIssue('DailyDigest', 'No Daily Digest nav entry'); return; }
  await page.waitForTimeout(3000);

  const dupes = await page.getByText('Today vs last week').count();
  if (dupes <= 1) logOk('DailyDigest', `"Today vs last week" appears ${dupes}× (duplicate card removed)`);
  else logIssue('DailyDigest', `"Today vs last week" appears ${dupes}× — duplicate card still present`);

  for (const kpi of ['Campaigns Sent', 'Cadence Enrollments']) {
    if (await page.getByText(kpi).count() > 0) logOk('DailyDigest', `"${kpi}" KPI present`);
    else logIssue('DailyDigest', `"${kpi}" KPI missing`);
  }
  if (errs.length) logIssue('DailyDigest', `console errors: ${errs.slice(0, 3).join(' | ')}`);
  await page.screenshot({ path: 'tests/screenshots/v1220-daily-digest.png', fullPage: true });
});

test.afterAll(() => {
  console.log('\n=== v12.2.0 STAGING AUDIT SUMMARY ===');
  if (!issues.length) console.log('All checks passed.');
  else { console.log(`${issues.length} issue(s):`); issues.forEach((i, n) => console.log(`  ${n + 1}. ${i}`)); }
});
