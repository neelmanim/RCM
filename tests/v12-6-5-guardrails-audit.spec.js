/**
 * v12.6.5 guardrails audit — SF Sync Log direction/object columns, the
 * reworded Opportunity Sync toggle + confirm dialog, CSM Portal
 * portfolio/digest N+1 fix (functional check, not a timing assertion), and
 * the call-log-without-an-Opportunity fallback.
 *
 * Tokens via env: SA_TOKEN, CSM_TOKEN (real users, minted via the
 * Super-Admin "View As" endpoint).
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const SA_TOKEN = process.env.SA_TOKEN;
const CSM_TOKEN = process.env.CSM_TOKEN;

// Real staging account with zero Opportunities — the exact case the
// call-log-without-an-Opportunity fallback exists for.
const NO_OPP_ACCOUNT_ID = 'a94ddaf6-e90f-4139-9f85-336e7a140bf9';

const issues = [];
const logIssue = (area, detail) => { console.error(`FAIL [${area}] ${detail}`); issues.push(`[${area}] ${detail}`); };
const logOk = (area, detail) => console.log(`OK ${area}: ${detail}`);

async function login(page, token) {
  await page.addInitScript(() => {
    try { void localStorage.length; } catch { return; }
    ['csm-portal-inbox', 'csm-portal-portfolio', 'csm-portal-playbooks', 'csm-portal-digest',
      'csm-account-360', 'csm-portal', 'control-center'].forEach((t) =>
      localStorage.setItem(`alternatecrm:${t}-tour-seen`, '1'));
  });
  await page.goto(`${BASE_URL}/?token=${token}`);
  await page.waitForSelector('nav', { timeout: 45_000 });
  await page.waitForTimeout(1000);
}

async function goHash(page, hash) {
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.waitForTimeout(2000);
}

test.describe('v12.6.5 guardrails', () => {
  test('Control Center: SF Sync Log has Direction + Object columns and a filter for each', async ({ page }) => {
    await login(page, SA_TOKEN);
    await goHash(page, '#control-center');
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Monitoring' }).click();
    await page.waitForTimeout(1000);
    const sfLogTab = page.getByRole('button', { name: 'Salesforce Sync Log' });
    if (await sfLogTab.count() > 0) {
      await sfLogTab.click();
      await page.waitForTimeout(2000);
      const headerText = await page.locator('table thead').first().textContent().catch(() => '');
      if (headerText && headerText.includes('Direction') && headerText.includes('Object')) {
        logOk('SF-LOG-COLUMNS', 'Direction and Object columns present in table header');
      } else {
        logIssue('SF-LOG-COLUMNS', `Expected Direction+Object in header, got: ${headerText}`);
      }
      const directionFilter = page.locator('text=All directions');
      if (await directionFilter.count() > 0) {
        logOk('SF-LOG-FILTER', 'Direction filter dropdown present');
      } else {
        logIssue('SF-LOG-FILTER', 'Direction filter dropdown not found');
      }
    } else {
      logIssue('SF-LOG-TAB', 'Could not find SF Sync Log tab in Monitoring section');
    }
  });

  test('Control Center: Opportunity Sync toggle has new copy and a confirm dialog on enable', async ({ page }) => {
    await login(page, SA_TOKEN);
    await goHash(page, '#control-center');
    await page.waitForTimeout(2000);
    // Integrations is the default section, but OpportunitySyncCard lives
    // under its "CRM Settings" sub-tab specifically.
    await page.getByRole('button', { name: 'CRM Settings' }).click();
    await page.waitForTimeout(1000);

    const pullCopy = page.locator('text=Pull Opportunities & Accounts from Salesforce');
    if (await pullCopy.count() > 0) {
      logOk('TOGGLE-COPY', 'New "Pull Opportunities & Accounts from Salesforce" copy present');
    } else {
      logIssue('TOGGLE-COPY', 'New toggle copy not found — old "Push Only"/"Two-Way Sync" copy may still be live');
    }

    // Only probe the confirm dialog if the toggle is currently off (don't
    // flip a real setting on staging as a side effect of an audit).
    const offCopy = page.locator('text=Off — Alternate CRM only pushes Opportunity/Account changes');
    if (await offCopy.count() > 0) {
      // Scope to the toggle row containing this exact title, not just the
      // first switch on the page — CRM Settings has several other cards
      // with their own toggles (Sync Direction, Sync Toggles, POD, etc).
      const row = page.locator('.rounded-xl.border').filter({ hasText: 'Pull Opportunities & Accounts from Salesforce' });
      const target = row.locator('button[role="switch"], input[type="checkbox"]').first();
      if (await target.count() > 0) {
        await target.click({ force: true }).catch(() => {});
        await page.waitForTimeout(500);
        const confirmDialog = page.locator('text=Pull Opportunities & Accounts from Salesforce?');
        if (await confirmDialog.count() > 0) {
          logOk('TOGGLE-CONFIRM', 'ConfirmDialog appeared on enabling the pull toggle');
          const cancel = page.locator('button:has-text("Cancel")').first();
          if (await cancel.count() > 0) await cancel.click().catch(() => {});
        } else {
          logIssue('TOGGLE-CONFIRM', 'No confirm dialog appeared after clicking the pull toggle');
        }
      }
    } else {
      logOk('TOGGLE-CONFIRM', 'Skipped — pull toggle already on in this environment, not flipping it as a side effect');
    }
  });

  test('CSM Portal: Inbox and Portfolio load with real data (N+1 batch fix)', async ({ page }) => {
    await login(page, CSM_TOKEN);
    await goHash(page, '#csm-inbox');
    await page.waitForTimeout(2500);
    const inboxRows = page.locator('table tbody tr');
    const inboxCount = await inboxRows.count();
    if (inboxCount > 0) {
      logOk('INBOX-LOAD', `Inbox rendered ${inboxCount} row(s)`);
    } else {
      logIssue('INBOX-LOAD', 'Inbox table has zero rows');
    }

    await goHash(page, '#csm-portfolio');
    await page.waitForTimeout(2500);
    const portfolioRows = page.locator('table tbody tr');
    const portfolioCount = await portfolioRows.count();
    if (portfolioCount > 0) {
      logOk('PORTFOLIO-LOAD', `Portfolio rendered ${portfolioCount} row(s)`);
      const csmCell = await portfolioRows.first().locator('td').nth(1).textContent().catch(() => '');
      logOk('PORTFOLIO-CSM-CELL', `First row CSM cell: "${(csmCell || '').trim()}"`);
    } else {
      logIssue('PORTFOLIO-LOAD', 'Portfolio table has zero rows');
    }
  });

  test('CSM Portal: can log a call on an account with zero Opportunities', async ({ page }) => {
    await login(page, CSM_TOKEN);
    // Account 360 is opened via row click (internal state, no hash route) —
    // go to Portfolio and click the known zero-Opportunity account by name.
    await goHash(page, '#csm-portfolio');
    await page.waitForTimeout(2500);
    const row = page.locator('table tbody tr', { hasText: 'Umbrella Health' }).first();
    if (await row.count() === 0) {
      logIssue('NO-OPP-ACCOUNT-ROW', 'Could not find "Umbrella Health" row in Portfolio to open Account 360');
      return;
    }
    await row.click();
    await page.waitForTimeout(2500);

    const logCallHeading = page.locator('text=Log a call');
    if (await logCallHeading.count() === 0) {
      logIssue('NO-OPP-CALL-FORM', 'Log a call form not rendered for a zero-Opportunity account');
    } else {
      logOk('NO-OPP-CALL-FORM', 'Log a call form rendered despite zero Opportunities');
      const outcomeSelect = page.locator('[aria-label="Call outcome"]').first();
      if (await outcomeSelect.count() > 0) {
        await outcomeSelect.click();
        await page.waitForTimeout(500);
        // Outcomes are org-configurable — don't match by label text, just
        // take the first item in the now-open dropdown menu.
        const firstOption = page.locator('[role="menuitem"]:visible, [role="option"]:visible').first();
        if (await firstOption.count() > 0) {
          await firstOption.click();
          const submitBtn = page.locator('form:has-text("Log a call") button[type="submit"]').first();
          const [response] = await Promise.all([
            page.waitForResponse((r) => r.url().includes('/touches') && r.request().method() === 'POST', { timeout: 10_000 }).catch(() => null),
            submitBtn.click(),
          ]);
          if (response && response.ok()) {
            logOk('NO-OPP-CALL-SUBMIT', `Fallback POST to /touches succeeded (${response.status()})`);
          } else {
            logIssue('NO-OPP-CALL-SUBMIT', `Expected a successful POST to /touches, got: ${response ? response.status() : 'no matching request'}`);
          }
        } else {
          logIssue('NO-OPP-CALL-SUBMIT', 'Could not find a call outcome option to select');
        }
      } else {
        logIssue('NO-OPP-CALL-SUBMIT', 'Call outcome select not found');
      }
    }
  });

  test.afterAll(() => {
    console.log('\n=== v12.6.5 GUARDRAILS AUDIT SUMMARY ===');
    if (issues.length === 0) {
      console.log('No issues found.');
    } else {
      console.log(`${issues.length} issue(s):`);
      issues.forEach((i) => console.log(' -', i));
    }
  });
});
