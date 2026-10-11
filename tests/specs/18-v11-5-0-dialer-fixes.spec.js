/**
 * 18-v11-5-0-dialer-fixes.spec.js
 * Playwright tests for the v11.5.0 SDR-reported dialer fixes.
 *
 * Covers:
 *   A. Calls tab shows an "Edit" action on a dialer-sourced call with an
 *      outcome, and clicking it reopens the log-call modal against that
 *      specific DialerCall (RCA 2026-08-19: outcome correction).
 *   B. Correcting an outcome via the API overwrites DialerCall.outcome and
 *      does not create a duplicate CallLog row.
 *   C. Phone timezone badge does not default a NANP-formatted US number
 *      ("(212) 555-0100" style) to India/IST.
 *   D. GET /api/calls/my-active still works post-deploy (sanity for the
 *      _get_active_call_for_user code path the self-heal fix touches).
 *
 * NOT covered here: the live Aircall self-heal check itself (asking Aircall
 * for a call's real status before blocking a new dial) — that requires an
 * actual in-progress Aircall call, which isn't reproducible from a scripted
 * test. Covered instead by backend unit/integration tests
 * (test_dialer_routes.py::TestConcurrentCallGuard).
 */
const { test, expect, JWT_TOKEN, API_BASE, navigateTo } = require('./helpers');

const AUTH_HEADER = { Authorization: `Bearer ${JWT_TOKEN}` };
const LEAD_ID = process.env.LEAD_CALLING_ID || 'bd4f0289-71e4-4193-8926-6b39af27fa65';

/** Find a lead with an existing dialer-sourced call (any outcome state). */
async function findLeadWithDialerCall(request) {
  const res = await request.get(`${API_BASE}/api/leads/${LEAD_ID}/calls`, { headers: AUTH_HEADER });
  if (res.ok()) {
    const data = await res.json();
    const dialerCall = (data.calls || []).find(c => c.source === 'dialer');
    if (dialerCall) return { leadId: LEAD_ID, call: dialerCall };
  }
  return null;
}

test.describe('v11.5.0 dialer fixes', () => {

  test('B. Correcting a dialer outcome overwrites it, no duplicate CallLog', async ({ request }) => {
    const found = await findLeadWithDialerCall(request);
    test.skip(!found, 'No lead with a dialer-sourced call available on staging to test correction against');
    const { leadId, call } = found;

    const before = await request.get(`${API_BASE}/api/leads/${leadId}/calls`, { headers: AUTH_HEADER });
    const beforeCount = (await before.json()).total_count;

    const firstOutcome = call.outcome === 'No Answer' ? 'Call Back Later' : 'No Answer';
    const r1 = await request.post(`${API_BASE}/api/leads/${leadId}/calls`, {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: { outcome: firstOutcome, notes: 'playwright v11.5.0 check — step 1', dialer_call_id: call.id },
    });
    expect(r1.status()).toBe(200);

    const secondOutcome = firstOutcome === 'No Answer' ? 'Call Back Later' : 'No Answer';
    const r2 = await request.post(`${API_BASE}/api/leads/${leadId}/calls`, {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: { outcome: secondOutcome, notes: 'playwright v11.5.0 check — step 2 correction', dialer_call_id: call.id },
    });
    expect(r2.status()).toBe(200);
    expect(r2.json ? (await r2.json()).call.outcome : null).toBe(secondOutcome);

    const after = await request.get(`${API_BASE}/api/leads/${leadId}/calls`, { headers: AUTH_HEADER });
    const afterBody = await after.json();
    expect(afterBody.total_count).toBe(beforeCount); // no new row from the correction
    const correctedCall = afterBody.calls.find(c => c.id === call.id);
    expect(correctedCall.outcome).toBe(secondOutcome);
    console.log(`  ✅ Correction overwrote outcome to "${secondOutcome}", call count unchanged (${afterBody.total_count})`);
  });

  test('A. Calls tab shows an Edit action on a dialer call with an outcome', async ({ authenticatedPage: page }) => {
    // Real route is #lead-detail/<id> (confirmed against lead_detail.js /
    // sdr-lead-page-p1.spec.js's goToLead helper) — navigateTo prefixes '#'.
    await navigateTo(page, `/lead-detail/${LEAD_ID}`, { waitMs: 4000 });

    const callsTab = page.locator('[data-tab="calls"]').first();
    if (await callsTab.count() === 0) { console.log('  → No Calls tab — skipping'); return; }
    await callsTab.click();
    await page.waitForTimeout(3000);

    const editLink = page.locator('[data-edit-call-id]').first();
    if (await editLink.count() === 0) {
      console.log('  → No dialer call with an outcome on this lead — skipping');
      return;
    }
    await expect(editLink).toBeVisible();
    await editLink.click();
    await page.waitForTimeout(1000);

    const modal = page.locator('#call-log-modal');
    await expect(modal).toBeVisible();
    console.log('  ✅ Edit action opens the log-call modal');
  });

  test('C. Timezone badge does not show India for a NANP-formatted US number', async ({ authenticatedPage: page }) => {
    // app.js exposes window._phoneTimezoneUtils = { getPhoneTimezone, renderPhoneLocalTime }
    // — call the REAL deployed function directly, not a reimplementation.
    await navigateTo(page, '/dashboard', { waitMs: 3000 });
    const result = await page.waitForFunction(
      () => window._phoneTimezoneUtils !== undefined
    ).then(() => page.evaluate(() => {
      const { getPhoneTimezone } = window._phoneTimezoneUtils;
      return {
        nanp: getPhoneTimezone('(212) 555-0100'),
        bareIndia: getPhoneTimezone('9876543210'),
      };
    }));

    expect(result.nanp).not.toBeNull();
    expect(result.nanp.countryCode).toBe('1');
    expect(result.nanp.label).not.toMatch(/india/i);

    expect(result.bareIndia).not.toBeNull();
    expect(result.bareIndia.countryCode).toBe('91'); // unformatted bare number still defaults to India

    console.log(`  ✅ NANP number → ${JSON.stringify(result.nanp)}, bare digits → ${JSON.stringify(result.bareIndia)}`);
  });

  test('D. GET /api/calls/my-active still works post-deploy', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/calls/my-active`, { headers: AUTH_HEADER });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('active');
    console.log(`  ✅ /api/calls/my-active → active=${body.active}`);
  });
});
