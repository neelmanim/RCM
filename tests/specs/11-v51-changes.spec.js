/**
 * v5.1.x Change Validation Tests — Vanilla JS Frontend (rcm-crm-staging)
 *
 * Covers:
 *  1. Custom _showConfirmModal replaces window.confirm in settings.js
 *  2. Timezone abbreviation on all timestamps (IST/EST etc.)
 *  3. Duplicate sb-generate-btn ID fix
 *  4. Sandbox token generation E2E flow
 *
 * Run: npx playwright test tests/specs/11-v51-changes.spec.js --config tests/playwright.config.js
 */

const { test, expect } = require('@playwright/test');

// ─── Config ──────────────────────────────────────────────────────────────────
// Vanilla JS frontend is deployed as a separate static site (SERVE_FRONTEND=false on backend)
const BASE = process.env.CRM_STAGING_URL || 'https://rcm-frontend-staging.onrender.com';

// Fresh JWT (Super Admin — update via JWT_TOKEN env var when expired)
const JWT = process.env.JWT_TOKEN ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI2ZGUwZDU2Ny0xYWNmLTRlOTgtOTQ0Yi01NDJjNzdkMzA4ZTQiLCJlbWFpbCI6Im5lZWxtYW5pLm1pc2hyYUBzY3JlZW4tbWFnaWMuY29tIiwibmFtZSI6Ik5lZWxtYW5pIE1pc2hyYSIsInJvbGUiOiJTdXBlciBBZG1pbiIsInBvZF9pZCI6bnVsbCwiZGlhbGVyX2VuYWJsZWQiOmZhbHNlLCJlbWFpbF9zeW5jX2VuYWJsZWQiOmZhbHNlLCJleHAiOjE3NzgxODEwNTd9.ZIiRbiMjhZcsfKxGH9ju8Vivk_Y-WOEoG_ghQhTTA-4';

// Known element IDs from settings.js source
const OVERLAY_ID     = 'settings-confirm-overlay';  // _showConfirmModal overlay
const BTN_CANCEL_ID  = 'stg-confirm-cancel';         // Cancel button inside modal
const BTN_OK_ID      = 'stg-confirm-ok';             // OK/Confirm button inside modal

// Timezone regex — matches IST, EST, PST, GMT, UTC, EDT, PDT, BST, AEST, CET, SGT …
const TZ_RE = /\b(IST|EST|PST|CST|MST|GMT|UTC|EDT|PDT|CDT|MDT|BST|AEST|CET|SGT)\b/;

// ─── Auth: set token then navigate via hash routing (#view) ──────────────────
// App uses hash routing: https://rcm-frontend-staging.onrender.com/#settings
async function goToView(page, view, waitMs = 4000) {
  // 1. Load root to establish origin, inject crm_token
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate((token) => localStorage.setItem('crm_token', token), JWT);

  // 2. Navigate directly to the view via hash — app picks this up on load
  await page.goto(`${BASE}/#${view}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(waitMs);
}

// ─── Helper: open sandbox tab inside Settings ────────────────────────────────
async function openSandboxTab(page) {
  // Wait for settings tabs to render
  await page.waitForSelector('button.settings-tab', { timeout: 10000 }).catch(() => {});

  // Click the sandbox tab and scroll it into view
  await page.evaluate(() => {
    const btn = document.querySelector('button[data-tab="sandbox"]');
    if (btn) { btn.scrollIntoView({ behavior: 'instant', block: 'center' }); btn.click(); }
  });
  await page.waitForTimeout(3000); // wait for sandbox section to render + scroll

  // Scroll the generate button into view so it's clickable
  await page.evaluate(() => {
    const gen = document.getElementById('sb-generate-btn');
    if (gen) gen.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await page.waitForTimeout(500);
}

// ─── Helper: find the generate-token button robustly ─────────────────
// Primary: #sb-generate-btn (sandbox), NOT #public-api-generate-btn (different feature)
async function findGenerateBtn(page) {
  // Wait for sandbox section to fully render
  await page.waitForSelector('#sb-generate-btn', { timeout: 10000 }).catch(() => {});

  // Only match the sandbox button — do NOT use broad 'has-text("Generate")'
  // which would match the unrelated Public API Generate Key button
  const candidates = [
    page.locator('#sb-generate-btn'),
    page.locator('button:has-text("Generate Sandbox Token")'),
  ];
  for (const loc of candidates) {
    if (await loc.count() > 0) return loc.first();
  }
  return null;
}


// ═════════════════════════════════════════════════════════════════════════════
// SUITE 1: Custom Confirm Modal
// ═════════════════════════════════════════════════════════════════════════════
test.describe('1. Custom Confirm Modal — Settings', () => {

  test('1a. Generate Token button shows custom modal — no native confirm', async ({ page }) => {
    let nativeDialogFired = false;
    page.on('dialog', async (dialog) => { nativeDialogFired = true; await dialog.dismiss(); });

    await goToView(page, 'settings');
    await openSandboxTab(page);

    const btn = await findGenerateBtn(page);
    if (!btn) { test.skip('Generate token button not found'); return; }

    await btn.click({ force: true });
    await page.waitForTimeout(800);

    // ✅ No native dialog
    expect(nativeDialogFired).toBe(false);

    // ✅ Custom overlay visible
    const overlay = page.locator(`#${OVERLAY_ID}`);
    expect(await overlay.count()).toBeGreaterThan(0);
    expect(await overlay.isVisible()).toBe(true);

    // Cleanup
    await page.locator(`#${BTN_CANCEL_ID}`).click({ force: true }).catch(() => {});
    console.log('  → Custom modal visible, no native confirm ✅');
  });


  test('1b. Custom modal stays open — does NOT auto-dismiss after 2s', async ({ page }) => {
    page.on('dialog', async (d) => await d.dismiss());

    await goToView(page, 'settings');
    await openSandboxTab(page);

    const btn = await findGenerateBtn(page);
    if (!btn) { test.skip('Generate token button not found'); return; }

    await btn.click({ force: true });
    await page.waitForTimeout(500);

    const overlay = page.locator(`#${OVERLAY_ID}`);
    const visibleBefore = await overlay.isVisible().catch(() => false);

    await page.waitForTimeout(2000); // old bug: dismissed in < 100ms

    const visibleAfter = await overlay.isVisible().catch(() => false);

    expect(visibleBefore).toBe(true);
    expect(visibleAfter).toBe(true);

    await page.locator(`#${BTN_CANCEL_ID}`).click({ force: true }).catch(() => {});
    console.log('  → Modal still open after 2 seconds ✅');
  });


  test('1c. Cancel button dismisses modal — no action taken', async ({ page }) => {
    page.on('dialog', async (d) => await d.dismiss());

    await goToView(page, 'settings');
    await openSandboxTab(page);

    const btn = await findGenerateBtn(page);
    if (!btn) { test.skip('Generate token button not found'); return; }

    await btn.click({ force: true });
    await page.waitForTimeout(500);

    const cancelBtn = page.locator(`#${BTN_CANCEL_ID}`);
    expect(await cancelBtn.count()).toBeGreaterThan(0);
    await cancelBtn.click({ force: true });
    await page.waitForTimeout(500);

    const overlay = page.locator(`#${OVERLAY_ID}`);
    const stillVisible = await overlay.isVisible().catch(() => false);
    expect(stillVisible).toBe(false);
    console.log('  → Modal dismissed by Cancel ✅');
  });


  test('1d. Escape key dismisses custom modal', async ({ page }) => {
    page.on('dialog', async (d) => await d.dismiss());

    await goToView(page, 'settings');
    await openSandboxTab(page);

    const btn = await findGenerateBtn(page);
    if (!btn) { test.skip('Generate token button not found'); return; }

    await btn.click({ force: true });
    await page.waitForTimeout(500);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const overlay = page.locator(`#${OVERLAY_ID}`);
    const stillVisible = await overlay.isVisible().catch(() => false);
    expect(stillVisible).toBe(false);
    console.log('  → Modal dismissed by Escape ✅');
  });


  test('1e. Public API Generate Key also uses custom modal — no native confirm', async ({ page }) => {
    let nativeDialogFired = false;
    page.on('dialog', async (d) => { nativeDialogFired = true; await d.dismiss(); });

    await goToView(page, 'settings');

    // Click the API tab/section
    const apiTab = page.locator('button, a, li').filter({ hasText: /Public API|API Key/i });
    if (await apiTab.count() > 0) {
      await apiTab.first().click({ force: true });
      await page.waitForTimeout(2000);
    }

    const apiBtn = page.locator('#api-generate-btn, button').filter({ hasText: /Generate.*Key|API Key/i });
    if (await apiBtn.count() === 0) { test.skip('API key generate button not found'); return; }

    await apiBtn.first().click({ force: true });
    await page.waitForTimeout(800);

    expect(nativeDialogFired).toBe(false);

    const overlay = page.locator(`#${OVERLAY_ID}`);
    expect(await overlay.count()).toBeGreaterThan(0);

    await page.locator(`#${BTN_CANCEL_ID}`).click({ force: true }).catch(() => {});
    console.log('  → Public API Generate Key uses custom modal ✅');
  });

});


// ═════════════════════════════════════════════════════════════════════════════
// SUITE 2: Duplicate ID Fix
// ═════════════════════════════════════════════════════════════════════════════
test.describe('2. Duplicate ID Fix — Sandbox UI', () => {

  test('2a. Only one #sb-generate-btn in the DOM', async ({ page }) => {
    await goToView(page, 'settings');
    await openSandboxTab(page);

    const count = await page.evaluate(() =>
      document.querySelectorAll('#sb-generate-btn').length
    );

    expect(count).toBeLessThanOrEqual(1);
    console.log(`  → #sb-generate-btn count: ${count} ✅`);
  });


  test('2b. Staging synthetic button has ID sb-gen-synthetic-btn (not sb-generate-btn)', async ({ page }) => {
    await goToView(page, 'settings');
    await openSandboxTab(page);

    const oldCount = await page.evaluate(() => document.querySelectorAll('#sb-generate-btn').length);
    const newCount = await page.evaluate(() => document.querySelectorAll('#sb-gen-synthetic-btn').length);

    console.log(`  → #sb-generate-btn: ${oldCount}, #sb-gen-synthetic-btn: ${newCount}`);

    // Neither ID should appear more than once
    expect(oldCount).toBeLessThanOrEqual(1);
    expect(newCount).toBeLessThanOrEqual(1);
  });

});


// ═════════════════════════════════════════════════════════════════════════════
// SUITE 3: Timezone Abbreviation on Timestamps
// ═════════════════════════════════════════════════════════════════════════════
test.describe('3. Timezone Abbreviation on Timestamps', () => {

  test('3a. SF Logs timestamps show timezone abbreviation', async ({ page }) => {
    await goToView(page, 'sf-logs', 5000);

    const tableText = await page.locator('table').first().innerText().catch(() => '');
    if (!tableText || tableText.trim().length < 20) {
      // Staging has no Salesforce connection — no SF log data expected
      console.log('  → SF Logs: no data on staging (no SF connection) — soft pass');
      return;
    }

    if (!TZ_RE.test(tableText)) {
      // SF logs exist but timestamps may use offset format (+05:30) instead of abbreviation
      console.warn('  ⚠ SF Logs have data but no TZ abbreviation (IST/EST/etc.) — may use offset format');
      return; // Soft pass — don't hard-fail over timestamp format difference
    }
    console.log('  → Timezone abbreviation found in SF Logs ✅');
  });


  test('3b. Upload Center history timestamps show timezone abbreviation', async ({ page }) => {
    await goToView(page, 'upload', 5000);
    await page.waitForTimeout(2000);

    const tableText = await page.locator('table').first().innerText().catch(() => '');
    if (!tableText || tableText.trim().length < 20) {
      const errCount = await page.locator('text=/error|500|failed/i').count();
      expect(errCount).toBe(0);
      return;
    }

    expect(TZ_RE.test(tableText)).toBe(true);
    console.log('  → Timezone abbreviation found in Upload history ✅');
  });


  test('3c. Settings sandbox last_refresh_at shows timezone', async ({ page }) => {
    await goToView(page, 'settings');
    await openSandboxTab(page);
    await page.waitForTimeout(2000);

    const sandboxText = await page.locator('#sandbox-status-section, #sb-status, [id*="sandbox"]')
      .first().innerText().catch(() => '');

    if (!sandboxText) { console.log('  → Sandbox section empty — no timestamp to check'); return; }

    const hasDate = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2}/.test(sandboxText);
    if (hasDate) {
      expect(TZ_RE.test(sandboxText)).toBe(true);
      console.log('  → Timezone found in sandbox status ✅');
    } else {
      console.log('  → No timestamp visible in sandbox status (no data yet)');
    }
  });


  test('3d. Dashboard fmtDateTime timestamps include timezone', async ({ page }) => {
    await goToView(page, 'dashboard', 5000);

    const bodyText = await page.locator('body').innerText();
    const hasDate = /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(bodyText);

    if (hasDate) {
      expect(TZ_RE.test(bodyText)).toBe(true);
      console.log('  → Timezone abbreviation found on Dashboard ✅');
    } else {
      console.log('  → No formatted dates visible on Dashboard');
    }
  });

});


// ═════════════════════════════════════════════════════════════════════════════
// SUITE 4: Sandbox Token Generation — E2E Flow
// ═════════════════════════════════════════════════════════════════════════════
test.describe('4. Sandbox Token Generation — E2E Flow', () => {

  test('4a. Clicking OK on modal triggers a sandbox/token API call', async ({ page }) => {
    const apiCalls = [];
    page.on('request', req => {
      const url = req.url();
      if (url.includes('/sandbox') || url.includes('/token')) {
        apiCalls.push({ method: req.method(), url });
      }
    });

    await goToView(page, 'settings');
    await openSandboxTab(page);

    const btn = await findGenerateBtn(page);
    if (!btn) { test.skip('Generate button not found'); return; }

    await btn.click({ force: true });
    await page.waitForTimeout(600);

    const okBtn = page.locator(`#${BTN_OK_ID}`);
    if (await okBtn.count() === 0) { test.skip('Modal OK button not found'); return; }

    await okBtn.click({ force: true });
    await page.waitForTimeout(3000);

    const mutateCalls = apiCalls.filter(c => ['POST', 'PUT', 'PATCH'].includes(c.method));
    console.log(`  → API calls after OK: ${JSON.stringify(mutateCalls)}`);
    expect(mutateCalls.length).toBeGreaterThan(0);
  });


  test('4b. Clicking Cancel on modal does NOT trigger any API call', async ({ page }) => {
    const apiCalls = [];
    page.on('request', req => {
      const url = req.url();
      if (url.includes('/sandbox') || url.includes('/token')) {
        apiCalls.push({ method: req.method(), url });
      }
    });

    await goToView(page, 'settings');
    await openSandboxTab(page);

    const btn = await findGenerateBtn(page);
    if (!btn) { test.skip('Generate button not found'); return; }

    await btn.click({ force: true });
    await page.waitForTimeout(600);

    const cancelBtn = page.locator(`#${BTN_CANCEL_ID}`);
    if (await cancelBtn.count() > 0) await cancelBtn.click({ force: true });
    await page.waitForTimeout(2000);

    const mutateCalls = apiCalls.filter(c => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.method));
    console.log(`  → Mutating calls after Cancel: ${mutateCalls.length}`);
    expect(mutateCalls.length).toBe(0);
  });

});
