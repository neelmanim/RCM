/**
 * v12.1/v12.2 staging verification — Cadence read-only transparency + tour,
 * Daily Digest React port + tour, merged Campaigns/Performance + Cadence
 * performance donut, Export Leads filters, Alternate Messenger settings fix, Aircall
 * hint, Users & PODs role filter, and the delete-lead hotfix.
 *
 * Tokens were given directly by the user for this verification pass.
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';

const SUPER_ADMIN_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZGUwZDU2Ny0xYWNmLTRlOTgtOTQ0Yi01NDJjNzdkMzA4ZTQiLCJlbWFpbCI6Im5lZWxtYW5pLm1pc2hyYUBzY3JlZW4tbWFnaWMuY29tIiwibmFtZSI6Ik5lZWxtYW5pIE1pc2hyYSIsInJvbGUiOiJTdXBlciBBZG1pbiIsInBvZF9pZCI6bnVsbCwiZGlhbGVyX2VuYWJsZWQiOnRydWUsImVtYWlsX3N5bmNfZW5hYmxlZCI6dHJ1ZSwiZXhwIjoxNzg4ODg0MzgyfQ.WMjL9P5OHsyBf4z9s8Dm2DZMdi49fi3hoq1sB6isW5Q';
const SDR_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1NjM1YTgwOS01MmYzLTQ0YTItYjlmMy1jNWYyMTE4ZjA0OWIiLCJlbWFpbCI6ImRldi5iZXRhQHRlc3QuY29udmVyc2l2ZS5jb20iLCJuYW1lIjoiRGV2IEthcG9vciIsInJvbGUiOiJTRFIiLCJwb2RfaWQiOiJiOWQyMjZiOC1kYTc4LTQyZWYtYTg1MC01ODZkN2RhOWE2NDUiLCJkaWFsZXJfZW5hYmxlZCI6ZmFsc2UsImVtYWlsX3N5bmNfZW5hYmxlZCI6ZmFsc2UsImV4cCI6MTc4ODg4NDQ0M30.gZ6BfCYOYOA3k2HhXfQ-JOW-FFFqKjV2P_hcLIc1U2k';

const issues = [];
function logIssue(area, detail) { const e = `[${area}] ${detail}`; console.error(`FAIL ${e}`); issues.push(e); }
function logOk(area, detail) { console.log(`OK ${area}: ${detail}`); }

async function login(page, token) {
  await page.goto(`${BASE_URL}/?token=${token}`);
  await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
  // The pre-existing (already-shipped, unrelated to this verification) Sales
  // Tools tour otherwise pops a full-screen overlay that intercepts every
  // click on that page — mark it seen so it doesn't interfere. Tests that
  // specifically verify a NEW tour clear that tour's own seen-flag instead.
  await page.evaluate(() => {
    localStorage.setItem('alternate:sales-tools-tour-seen', '1');
    localStorage.setItem('alternate:control-center-tour-seen', '1');
  });
}

async function clickNav(page, label) {
  await page.getByRole('link', { name: label, exact: true }).click();
  await page.waitForTimeout(2500);
}

// ─── Super Admin ─────────────────────────────────────────────────────────────
test.describe('Super Admin — v12.1/v12.2', () => {
  test('Sales Tools: Cadence tab has performance donut, Campaigns tab has merged Performance snapshot', async ({ page }) => {
    await login(page, SUPER_ADMIN_TOKEN);
    await clickNav(page, 'Sales Tools');

    const cadenceDonut = page.getByText('Enrollment outcomes');
    if (await cadenceDonut.count() > 0) logOk('SalesTools/Cadence', 'Performance donut ("Enrollment outcomes") present');
    else logIssue('SalesTools/Cadence', 'No "Enrollment outcomes" donut found — check journeys exist on staging');

    await page.getByRole('button', { name: 'Campaigns', exact: true }).click();
    await page.waitForTimeout(2000);
    const perfSnapshot = page.getByText('Performance snapshot');
    const subTabsCount = await page.getByRole('button', { name: 'Performance', exact: true }).count();
    if (await perfSnapshot.count() > 0) logOk('SalesTools/Campaigns', '"Performance snapshot" collapsible present on the merged Campaigns screen');
    else logIssue('SalesTools/Campaigns', '"Performance snapshot" not found on Campaigns tab');
    if (subTabsCount === 0) logOk('SalesTools/Campaigns', 'No separate "Performance" sub-tab button — confirms the merge');
    else logIssue('SalesTools/Campaigns', 'A separate "Performance" sub-tab button still exists — merge incomplete');

    await page.screenshot({ path: 'tests/screenshots/v12-2-sales-tools-admin.png', fullPage: true });
  });

  test('Daily Digest: React page loads with new metrics and its guided tour', async ({ page }) => {
    await login(page, SUPER_ADMIN_TOKEN);
    await page.evaluate(() => localStorage.removeItem('alternate:daily-digest-tour-seen'));
    await clickNav(page, 'Daily Digest');
    await page.waitForTimeout(3000);

    const campaignsSentCard = page.getByText('Campaigns Sent');
    const cadenceEnrollCard = page.getByText('Cadence Enrollments');
    if (await campaignsSentCard.count() > 0) logOk('DailyDigest', '"Campaigns Sent" KPI card present');
    else logIssue('DailyDigest', '"Campaigns Sent" KPI card missing');
    if (await cadenceEnrollCard.count() > 0) logOk('DailyDigest', '"Cadence Enrollments" KPI card present');
    else logIssue('DailyDigest', '"Cadence Enrollments" KPI card missing');

    const tourDialog = page.getByRole('dialog', { name: /Daily Digest guided tour/i });
    if (await tourDialog.count() > 0) logOk('DailyDigest', 'Guided tour fired on first visit');
    else logIssue('DailyDigest', 'Guided tour did not appear (may already be marked seen in this browser profile)');

    await page.screenshot({ path: 'tests/screenshots/v12-2-daily-digest.png', fullPage: true });
  });

  test('Control Center: Users & PODs has a Role filter and search input', async ({ page }) => {
    await login(page, SUPER_ADMIN_TOKEN);
    await clickNav(page, 'Control Center');
    await page.waitForTimeout(2000);
    const teamAccessTab = page.getByRole('button', { name: /Team & Access/i });
    if (await teamAccessTab.count() > 0) { await teamAccessTab.click(); }
    // Users/pods fetch is async — wait for real content instead of a guessed
    // fixed delay (the panel shows a loading skeleton until it resolves).
    await page.getByText('Role: All').or(page.getByText("Couldn't load users")).waitFor({ timeout: 20000 }).catch(() => {});

    const roleFilter = page.getByText('Role: All');
    if (await roleFilter.count() > 0) logOk('UsersRolesPanel', '"Role: All" filter present');
    else logIssue('UsersRolesPanel', '"Role: All" filter not found');

    const searchInput = page.getByPlaceholder('Search by name or email…');
    if (await searchInput.count() > 0) logOk('UsersRolesPanel', 'Search input present');
    else logIssue('UsersRolesPanel', 'Search input not found');

    await page.screenshot({ path: 'tests/screenshots/v12-2-users-roles.png', fullPage: true });
  });

  test('Control Center: Alternate Messenger/Aircall settings render fixed fields and hint', async ({ page }) => {
    await login(page, SUPER_ADMIN_TOKEN);
    await clickNav(page, 'Control Center');
    await page.waitForTimeout(2000);
    const integrationsTab = page.getByRole('button', { name: /Integrations/i });
    if (await integrationsTab.count() > 0) { await integrationsTab.click(); await page.waitForTimeout(1000); }
    const dialerTab = page.getByRole('button', { name: 'Dialer', exact: true });
    if (await dialerTab.count() > 0) { await dialerTab.click(); await page.waitForTimeout(1500); }

    const aircallHint = page.getByText(/independent from the Messaging Provider setting/i);
    if (await aircallHint.count() > 0) logOk('Aircall', 'Clarifying hint under Calling Provider present');
    else logIssue('Aircall', 'Clarifying hint not found');

    const accountIdInput = page.getByPlaceholder('e.g. 80054247');
    if (await accountIdInput.count() > 0) {
      const val = await accountIdInput.inputValue();
      logOk('Alternate Messenger', `Account ID field renders (value length=${val.length})`);
    } else {
      logIssue('Alternate Messenger', 'Account ID input not found');
    }

    await page.screenshot({ path: 'tests/screenshots/v12-2-integrations-dialer.png', fullPage: true });
  });

  test('Control Center: Export Leads has upload-batch and date-range filters', async ({ page }) => {
    await login(page, SUPER_ADMIN_TOKEN);
    await clickNav(page, 'Control Center');
    await page.waitForTimeout(2000);
    const dataTab = page.getByRole('button', { name: 'Data', exact: true });
    if (await dataTab.count() > 0) { await dataTab.click(); await page.waitForTimeout(1500); }

    const exportCard = page.getByText('Export Leads');
    if (await exportCard.count() > 0) logOk('ExportLeads', '"Export Leads" card present');
    else logIssue('ExportLeads', '"Export Leads" card not found');

    const uploadBatchLabel = page.getByText('Upload batch');
    const dateRangeLabel = page.getByText('Created date range');
    if (await uploadBatchLabel.count() > 0) logOk('ExportLeads', 'Upload batch filter present');
    else logIssue('ExportLeads', 'Upload batch filter not found');
    if (await dateRangeLabel.count() > 0) logOk('ExportLeads', 'Date range filter present');
    else logIssue('ExportLeads', 'Date range filter not found');

    const exportBtn = page.getByRole('button', { name: /Export CSV/ });
    const isDisabled = await exportBtn.isDisabled().catch(() => null);
    if (isDisabled === true) logOk('ExportLeads', 'Export button correctly disabled with no filter chosen');
    else logIssue('ExportLeads', `Export button disabled-state unexpected (isDisabled=${isDisabled})`);

    await page.screenshot({ path: 'tests/screenshots/v12-2-export-leads.png', fullPage: true });
  });
});

// ─── SDR (non-admin) ─────────────────────────────────────────────────────────
test.describe('SDR (non-admin) — v12.1/v12.2 read-only Cadence', () => {
  test('Sales Tools: Cadence tab is visible, read-only, and shows its tour', async ({ page }) => {
    await login(page, SDR_TOKEN);
    await page.evaluate(() => localStorage.removeItem('alternate:cadence-rep-tour-seen-v2'));
    await page.reload();
    await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
    await clickNav(page, 'Sales Tools');

    // exact: true — otherwise this substring-matches a real cadence row named
    // e.g. "Testing New Cadence" (rendered as "Testing New Cadencedraft").
    const newCadenceBtn = page.getByRole('button', { name: 'New Cadence', exact: true });
    if (await newCadenceBtn.count() === 0) logOk('SDR/Cadence', '"New Cadence" button correctly hidden for a non-admin');
    else logIssue('SDR/Cadence', '"New Cadence" button is visible for an SDR — should be hidden');

    const tourDialog = page.getByRole('dialog', { name: /Cadence read-only guided tour/i });
    if (await tourDialog.count() > 0) logOk('SDR/Cadence', 'Read-only guided tour fired');
    else logIssue('SDR/Cadence', 'Read-only guided tour did not fire (may already be marked seen)');
    await page.keyboard.press('Escape').catch(() => {});

    const perfDonut = page.getByText('Enrollment outcomes');
    if (await perfDonut.count() > 0) logOk('SDR/Cadence', 'Performance donut visible to a non-admin (transparency)');
    else logIssue('SDR/Cadence', 'Performance donut not visible for SDR — check journeys exist');

    await page.screenshot({ path: 'tests/screenshots/v12-2-sales-tools-sdr.png', fullPage: true });
  });

  test('Sales Tools: opening a cadence as SDR shows the read-only banner and hides mutating controls', async ({ page }) => {
    await login(page, SDR_TOKEN);
    // The read-only tour is verified in the previous test — mark it seen here
    // so its overlay doesn't block clicking into a cadence below.
    await page.evaluate(() => localStorage.setItem('alternate:cadence-rep-tour-seen-v2', '1'));
    await page.reload();
    await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
    await clickNav(page, 'Sales Tools');

    const firstCadence = page.locator('.space-y-2 > div').first();
    if (await firstCadence.count() === 0) {
      logIssue('SDR/Cadence', 'No cadence rows found to open — cannot verify builder read-only state on this staging dataset');
      return;
    }
    await firstCadence.click();
    await page.waitForTimeout(2000);

    const banner = page.getByText('Read-only — contact your Pod Admin to request a change.');
    if (await banner.count() > 0) logOk('SDR/CadenceBuilder', 'Read-only banner visible');
    else logIssue('SDR/CadenceBuilder', 'Read-only banner not found');

    const saveBtn = page.getByRole('button', { name: /^Save$|^Saved$/ });
    const publishBtn = page.getByRole('button', { name: 'Publish' });
    const archiveBtn = page.getByRole('button', { name: 'Archive' });
    if (await saveBtn.count() === 0 && await publishBtn.count() === 0 && await archiveBtn.count() === 0) {
      logOk('SDR/CadenceBuilder', 'Save/Publish/Archive controls correctly hidden');
    } else {
      logIssue('SDR/CadenceBuilder', 'A mutating control (Save/Publish/Archive) is visible for an SDR');
    }

    await page.screenshot({ path: 'tests/screenshots/v12-2-cadence-builder-sdr.png', fullPage: true });
  });
});

test.afterAll(async () => {
  console.log('\n=== v12.1/v12.2 STAGING VERIFICATION SUMMARY ===');
  if (issues.length === 0) console.log('All checks passed.');
  else { console.log(`${issues.length} issue(s):`); issues.forEach((i, n) => console.log(`  ${n + 1}. ${i}`)); }
});
