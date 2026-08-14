// @ts-check
/**
 * Playwright E2E — Dialer Outcome Gate
 * Implementation Plan: Part 1 (Outcome Gate) + Part 2 (Provider Test Buttons)
 *
 * ── Test Groups ──────────────────────────────────────────────────────────────
 *  TC-F1   No-dialer path: clicking Call opens outcome modal immediately
 *  TC-F2   "Call in progress" banner appears after Aircall call starts
 *  TC-F3   Modal auto-opens when Aircall call reaches terminal status (poll)
 *  TC-F4   Banner survives page refresh (localStorage persistence) — EC-2
 *  TC-F5   Modal opens after refresh when call already ended — EC-12
 *  TC-F6   Second call clears first poll (EC-10)
 *  TC-F7   Dismiss without logging → auto-comment in lead history (EC-7)
 *  TC-F8   Outcome submit clears banner + localStorage
 *  TC-F9   Dialer tab: "Test Connection" passes correct provider key
 *  TC-F10  RCM messaging tab: "Test Connection" button exists and is independent
 *  TC-F11  Both test buttons work independently when both providers configured
 *
 * Prerequisites:
 *   ADMIN_TOKEN=<Super Admin JWT> SDR_EMAIL=<sdr@email.com>
 *   npx playwright test tests/dialer-outcome-gate.spec.js
 */

const { test, expect } = require('@playwright/test');
const { BASE_URL, ADMIN_TOKEN, getTokenForUser, loginAs, navigateTo } = require('./helpers/auth');

const AUTH_HEADER = { Authorization: `Bearer ${ADMIN_TOKEN}` };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Find a lead in "Calling" or "New" status for test use. */
async function getTestLead(request) {
  for (const status of ['Calling', 'New', '']) {
    const url = status
      ? `${BASE_URL}/api/leads?status=${status}&limit=5`
      : `${BASE_URL}/api/leads?limit=5`;
    const res = await request.get(url, { headers: AUTH_HEADER });
    if (res.ok()) {
      const data = await res.json();
      const leads = data.leads || data;
      if (Array.isArray(leads) && leads.length > 0) return leads[0];
    }
  }
  return null;
}

/** Navigate to a specific lead's detail page. */
async function goToLead(page, lead) {
  await page.goto(
    `${BASE_URL}/frontend/index.html#leads/${lead.id}`,
    { waitUntil: 'networkidle', timeout: 30000 }
  );
  await page.waitForTimeout(2000);
}

/** Inject a fake DialerCall status into the intercepted status endpoint. */
async function mockCallStatus(page, callId, status, outcome = null) {
  await page.route(`**/api/calls/${callId}/status`, (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        call_id: callId,
        status,
        outcome,
        provider: 'aircall',
        duration: status === 'CALL_ENDED' ? 45 : null,
        started_at: new Date().toISOString(),
        ended_at: status === 'CALL_ENDED' ? new Date().toISOString() : null,
      }),
    });
  });
}

/** Intercept the dialer start call and return a fake call_id. */
async function mockDialerStart(page, fakeCallId = 'test-call-abc123') {
  await page.route('**/api/calls/start', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ call_id: fakeCallId, status: 'CALL_STARTED', provider: 'aircall' }),
    });
  });
  return fakeCallId;
}

/** Intercept the test connection endpoint and capture which ?provider was sent. */
async function captureTestConnectionProvider(page) {
  return new Promise((resolve) => {
    page.route('**/api/dialer/test**', (route) => {
      const url = new URL(route.request().url());
      resolve(url.searchParams.get('provider'));
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'Connected (mocked)' }),
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Dialer Outcome Gate — Frontend E2E', () => {

  // ── TC-F1: No-dialer path ─────────────────────────────────────────────────
  test('TC-F1: No-dialer path — Call button opens outcome modal immediately', async ({ page, request }) => {
    // Mock settings: no dialer configured
    await page.route('**/api/config/user', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ dialer_provider: null, dialer_enabled: false }),
      });
    });

    await loginAs(page, request, process.env.SDR_EMAIL || '');
    const lead = await getTestLead(request);
    test.skip(!lead, 'No test lead available');
    await goToLead(page, lead);

    // Click the Call button
    const callBtn = page.locator('#call-btn, button:has-text("Call"), [data-action="call"]').first();
    await expect(callBtn).toBeVisible({ timeout: 8000 });
    await callBtn.click();

    // Modal should open immediately (no polling delay)
    const modal = page.locator('#call-outcome-modal, .call-outcome-modal, [data-modal="call-outcome"]');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // No "Call in progress" banner should appear
    const banner = page.locator('#call-in-progress-banner, .call-progress-banner');
    await expect(banner).not.toBeVisible();
  });

  // ── TC-F2: Banner appears after Aircall call starts ───────────────────────
  test('TC-F2: Aircall path — "Call in progress" banner appears after call start', async ({ page, request }) => {
    const FAKE_CALL_ID = 'tc-f2-call-001';

    await mockDialerStart(page, FAKE_CALL_ID);
    // Return active status so poll doesn't immediately close
    await mockCallStatus(page, FAKE_CALL_ID, 'CALL_ANSWERED');

    await loginAs(page, request, process.env.SDR_EMAIL || '');
    const lead = await getTestLead(request);
    test.skip(!lead, 'No test lead available');
    await goToLead(page, lead);

    // Click the Call button (dialer path)
    const callBtn = page.locator('#call-btn, [data-action="call"]').first();
    await expect(callBtn).toBeVisible({ timeout: 8000 });
    await callBtn.click();

    // Banner MUST appear
    const banner = page.locator('#call-in-progress-banner, .call-progress-banner, [data-banner="call-in-progress"]');
    await expect(banner).toBeVisible({ timeout: 8000 });
    await expect(banner).toContainText(/call in progress|log outcome/i);

    // Outcome modal must NOT open yet (call is still active)
    const modal = page.locator('#call-outcome-modal, .call-outcome-modal');
    await expect(modal).not.toBeVisible();
  });

  // ── TC-F3: Modal auto-opens when call reaches terminal status ─────────────
  test('TC-F3: Aircall poll — modal opens automatically when call ends', async ({ page, request }) => {
    const FAKE_CALL_ID = 'tc-f3-call-002';
    let pollCount = 0;

    // First 2 polls: active; 3rd poll: CALL_ENDED
    await page.route(`**/api/calls/${FAKE_CALL_ID}/status`, (route) => {
      pollCount++;
      const status = pollCount >= 3 ? 'CALL_ENDED' : 'CALL_ANSWERED';
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          call_id: FAKE_CALL_ID,
          status,
          outcome: null,
          provider: 'aircall',
        }),
      });
    });
    await mockDialerStart(page, FAKE_CALL_ID);

    await loginAs(page, request, process.env.SDR_EMAIL || '');
    const lead = await getTestLead(request);
    test.skip(!lead, 'No test lead available');
    await goToLead(page, lead);

    const callBtn = page.locator('#call-btn, [data-action="call"]').first();
    await expect(callBtn).toBeVisible({ timeout: 8000 });
    await callBtn.click();

    // Wait long enough for 3 poll cycles (6s each = ~20s)
    const modal = page.locator('#call-outcome-modal, .call-outcome-modal');
    await expect(modal).toBeVisible({ timeout: 25000 });

    // Banner should be gone when modal is open
    const banner = page.locator('#call-in-progress-banner, .call-progress-banner');
    await expect(banner).not.toBeVisible();
  });

  // ── TC-F4: Banner survives page refresh (EC-2) ────────────────────────────
  test('TC-F4: EC-2 — Banner re-appears after page refresh during active call', async ({ page, request }) => {
    const FAKE_CALL_ID = 'tc-f4-call-003';

    await mockCallStatus(page, FAKE_CALL_ID, 'CALL_ANSWERED');
    await mockDialerStart(page, FAKE_CALL_ID);

    await loginAs(page, request, process.env.SDR_EMAIL || '');
    const lead = await getTestLead(request);
    test.skip(!lead, 'No test lead available');
    await goToLead(page, lead);

    // Start the call
    const callBtn = page.locator('#call-btn, [data-action="call"]').first();
    await callBtn.click();

    // Verify banner appeared
    const banner = page.locator('#call-in-progress-banner, .call-progress-banner');
    await expect(banner).toBeVisible({ timeout: 8000 });

    // Check localStorage was written
    const pending = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('pendingOutcome') || 'null')
    );
    expect(pending).not.toBeNull();
    expect(pending.callId).toBe(FAKE_CALL_ID);

    // Simulate refresh — re-mock status endpoint for the refreshed page
    await mockCallStatus(page, FAKE_CALL_ID, 'CALL_ANSWERED');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Banner must re-appear from localStorage after reload
    await expect(banner).toBeVisible({ timeout: 8000 });
  });

  // ── TC-F5: Modal opens immediately after refresh when call already ended (EC-12) ──
  test('TC-F5: EC-12 — Modal opens immediately after refresh when call already ended', async ({ page, request }) => {
    const FAKE_CALL_ID = 'tc-f5-call-004';

    await loginAs(page, request, process.env.SDR_EMAIL || '');
    const lead = await getTestLead(request);
    test.skip(!lead, 'No test lead available');

    // Pre-seed localStorage as if a call was in progress before refresh
    await page.evaluate((id) => {
      localStorage.setItem('pendingOutcome', JSON.stringify({
        callId: id,
        leadId: 'fake-lead-id',
        leadName: 'Test Lead',
        startedAt: Date.now() - 60000,  // 1 min ago
      }));
    }, FAKE_CALL_ID);

    // Mock: call is already ended
    await mockCallStatus(page, FAKE_CALL_ID, 'CALL_ENDED');

    // Navigate to trigger the page-load recovery check
    await goToLead(page, lead);

    // Modal should open without any user action
    const modal = page.locator('#call-outcome-modal, .call-outcome-modal');
    await expect(modal).toBeVisible({ timeout: 10000 });

    // localStorage should be cleared once modal is shown
    const pending = await page.evaluate(() => localStorage.getItem('pendingOutcome'));
    expect(pending).toBeNull();
  });

  // ── TC-F6: Second call clears first poll (EC-10) ──────────────────────────
  test('TC-F6: EC-10 — Second call replaces first poll and localStorage entry', async ({ page, request }) => {
    const CALL_1 = 'tc-f6-call-001';
    const CALL_2 = 'tc-f6-call-002';
    let call1Polls = 0;

    await page.route(`**/api/calls/${CALL_1}/status`, (route) => {
      call1Polls++;
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ call_id: CALL_1, status: 'CALL_ANSWERED', outcome: null }),
      });
    });
    await mockCallStatus(page, CALL_2, 'CALL_ANSWERED');

    await loginAs(page, request, process.env.SDR_EMAIL || '');
    const lead = await getTestLead(request);
    test.skip(!lead, 'No test lead available');
    await goToLead(page, lead);

    // First call
    await page.route('**/api/calls/start', (route) => {
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ call_id: CALL_1, status: 'CALL_STARTED', provider: 'aircall' }),
      });
    });
    await page.locator('#call-btn, [data-action="call"]').first().click();
    await page.waitForTimeout(3000);  // let first poll start

    const pollsAfterFirst = call1Polls;

    // Second call — override the mock to return CALL_2
    await page.route('**/api/calls/start', (route) => {
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ call_id: CALL_2, status: 'CALL_STARTED', provider: 'aircall' }),
      });
    });
    await page.locator('#call-btn, [data-action="call"]').first().click();
    await page.waitForTimeout(3000);

    // localStorage must reference CALL_2 now
    const pending = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('pendingOutcome') || 'null')
    );
    expect(pending?.callId).toBe(CALL_2);

    // First poll should have stopped (poll count shouldn't advance much more)
    await page.waitForTimeout(8000);
    const pollsLater = call1Polls;
    expect(pollsLater - pollsAfterFirst).toBeLessThan(3); // at most 2 stray polls before stop
  });

  // ── TC-F7: Dismiss without logging → auto-comment (EC-7) ──────────────────
  test('TC-F7: EC-7 — Dismissing outcome modal adds auto-comment to lead history', async ({ page, request }) => {
    const FAKE_CALL_ID = 'tc-f7-call-005';
    let commentPosted = false;
    let commentBody = null;

    // Intercept any comment/note POST
    await page.route(/\/(notes|comments)$/, (route) => {
      if (route.request().method() === 'POST') {
        commentPosted = true;
        commentBody = route.request().postDataJSON();
        route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
      } else {
        route.continue();
      }
    });

    // Mock call ended
    await mockCallStatus(page, FAKE_CALL_ID, 'CALL_ENDED');
    await page.evaluate((id) => {
      localStorage.setItem('pendingOutcome', JSON.stringify({
        callId: id, leadId: 'some-lead', leadName: 'Test', startedAt: Date.now() - 90000,
      }));
    }, FAKE_CALL_ID);

    await loginAs(page, request, process.env.SDR_EMAIL || '');
    const lead = await getTestLead(request);
    test.skip(!lead, 'No test lead available');
    await goToLead(page, lead);

    // Modal should open from localStorage recovery
    const modal = page.locator('#call-outcome-modal, .call-outcome-modal');
    await expect(modal).toBeVisible({ timeout: 10000 });

    // Dismiss by clicking X / close
    const closeBtn = modal.locator('[data-dismiss], .modal-close, button:has-text("✕"), button:has-text("×")').first();
    await closeBtn.click();

    // Modal must close
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Auto-comment must have been POSTed
    expect(commentPosted).toBe(true);
    expect(commentBody?.note || commentBody?.text || '').toMatch(/outcome not logged/i);

    // No re-prompt toast
    const toast = page.locator('.toast, .notification, [data-toast]');
    await expect(toast).not.toContainText(/log.*outcome|outcome.*required/i);
  });

  // ── TC-F8: Successful outcome submit clears banner + localStorage ──────────
  test('TC-F8: Successful outcome submit clears banner and localStorage', async ({ page, request }) => {
    const FAKE_CALL_ID = 'tc-f8-call-006';
    let pollCount = 0;

    await page.route(`**/api/calls/${FAKE_CALL_ID}/status`, (route) => {
      pollCount++;
      const status = pollCount >= 2 ? 'CALL_ENDED' : 'CALL_ANSWERED';
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ call_id: FAKE_CALL_ID, status, outcome: null }),
      });
    });
    await mockDialerStart(page, FAKE_CALL_ID);

    // Mock the logCall POST to succeed
    await page.route('**/api/leads/**/calls', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ success: true, call_attempt_count: 1 }),
        });
      } else { route.continue(); }
    });

    await loginAs(page, request, process.env.SDR_EMAIL || '');
    const lead = await getTestLead(request);
    test.skip(!lead, 'No test lead available');
    await goToLead(page, lead);

    // Start the call
    await page.locator('#call-btn, [data-action="call"]').first().click();

    // Wait for modal
    const modal = page.locator('#call-outcome-modal, .call-outcome-modal');
    await expect(modal).toBeVisible({ timeout: 20000 });

    // Select an outcome and submit
    const outcomeSelect = modal.locator('select, [data-field="outcome"]').first();
    await outcomeSelect.selectOption({ index: 1 });
    const submitBtn = modal.locator('button[type="submit"], button:has-text("Save"), button:has-text("Log")');
    await submitBtn.first().click();

    // Modal closes
    await expect(modal).not.toBeVisible({ timeout: 8000 });

    // Banner gone
    const banner = page.locator('#call-in-progress-banner, .call-progress-banner');
    await expect(banner).not.toBeVisible();

    // localStorage cleared
    const pending = await page.evaluate(() => localStorage.getItem('pendingOutcome'));
    expect(pending).toBeNull();
  });

  // ── TC-F9: Dialer tab test button passes correct provider key ─────────────
  test('TC-F9: P2 — Dialer tab "Test Connection" passes ?provider=aircall for Aircall', async ({ page, request }) => {
    await loginAs(page, request, process.env.ADMIN_EMAIL || process.env.SDR_EMAIL || '');
    await navigateTo(page, 'settings');
    await page.waitForTimeout(1000);

    // Click the Dialer / AI Dialer tab
    const dialerTab = page.locator('[data-tab="dialer"], [data-settings-tab="dialer"], button:has-text("Dialer")').first();
    if (await dialerTab.isVisible()) await dialerTab.click();
    await page.waitForTimeout(500);

    // Set dropdown to Aircall
    const providerSelect = page.locator('#dialer-provider, select[name="dialer_provider"]').first();
    if (await providerSelect.isVisible()) {
      await providerSelect.selectOption('aircall');
    }

    // Capture which provider was sent to the test endpoint
    const providerKeyPromise = captureTestConnectionProvider(page);

    // Click test button
    const testBtn = page.locator('#dialer-test-btn, button:has-text("Test Connection")').first();
    await expect(testBtn).toBeVisible({ timeout: 8000 });
    await testBtn.click();

    const providerKey = await Promise.race([
      providerKeyPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]).catch(() => null);

    expect(providerKey).toBe('aircall');
  });

  // ── TC-F10: RCM messaging tab — independent test button ────────────
  test('TC-F10: P2 — RCM messaging tab has its own "Test Connection" button', async ({ page, request }) => {
    await loginAs(page, request, process.env.ADMIN_EMAIL || process.env.SDR_EMAIL || '');
    await navigateTo(page, 'settings');
    await page.waitForTimeout(1000);

    // Navigate to RCM messaging tab
    const convTab = page.locator('[data-tab="rcm"], [data-settings-tab="rcm"], button:has-text("RCM")').first();
    if (await convTab.isVisible()) await convTab.click();
    await page.waitForTimeout(500);

    // The new button must exist
    const convTestBtn = page.locator('#rcm-test-btn');
    await expect(convTestBtn).toBeVisible({ timeout: 8000 });
    await expect(convTestBtn).toContainText(/test connection/i);

    // Click it and verify ?provider=rcm_messaging is sent
    const providerKeyPromise = captureTestConnectionProvider(page);
    await convTestBtn.click();

    const providerKey = await Promise.race([
      providerKeyPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]).catch(() => null);

    expect(providerKey).toBe('rcm_messaging');
  });

  // ── TC-F11: Both buttons work independently ───────────────────────────────
  test('TC-F11: P2 — Both test buttons independent when both providers configured', async ({ page, request }) => {
    // This test verifies that clicking Aircall test never accidentally fires
    // rcm_messaging, and vice versa.
    const captured = [];

    await page.route('**/api/dialer/test**', (route) => {
      const url = new URL(route.request().url());
      captured.push(url.searchParams.get('provider'));
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, message: 'OK' }),
      });
    });

    await loginAs(page, request, process.env.ADMIN_EMAIL || process.env.SDR_EMAIL || '');
    await navigateTo(page, 'settings');
    await page.waitForTimeout(1000);

    // 1. Click Aircall test
    const dialerTab = page.locator('[data-tab="dialer"], button:has-text("Dialer")').first();
    if (await dialerTab.isVisible()) await dialerTab.click();
    const providerSelect = page.locator('#dialer-provider, select[name="dialer_provider"]').first();
    if (await providerSelect.isVisible()) await providerSelect.selectOption('aircall');
    const dialerTestBtn = page.locator('#dialer-test-btn').first();
    if (await dialerTestBtn.isVisible()) await dialerTestBtn.click();
    await page.waitForTimeout(1000);

    // 2. Click RCM messaging test
    const convTab = page.locator('[data-tab="rcm"], button:has-text("RCM")').first();
    if (await convTab.isVisible()) await convTab.click();
    const convTestBtn = page.locator('#rcm-test-btn').first();
    if (await convTestBtn.isVisible()) await convTestBtn.click();
    await page.waitForTimeout(1000);

    // Both must have been fired; order matters
    expect(captured.length).toBeGreaterThanOrEqual(2);
    expect(captured).toContain('aircall');
    expect(captured).toContain('rcm_messaging');

    // They must be different
    const unique = [...new Set(captured)];
    expect(unique.length).toBeGreaterThanOrEqual(2);
  });

});
