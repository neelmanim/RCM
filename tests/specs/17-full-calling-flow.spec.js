/**
 * 17-full-calling-flow.spec.js — End-to-end calling flow verification
 * (post v11.4.1 incident: US SDR dialer adoption issues)
 *
 * Exercises the REAL staging backend end-to-end — lead creation, webhook
 * ingestion, auto-log tag mapping, outcome-status polling, and the browser
 * UI's outcome modal — for both branches of "what happens after a call ends":
 *
 *   SUCCESS: Aircall's post-call tag picker sends a tag Aircall's webhook
 *            carries → Alternate CRM auto-logs the outcome → the open outcome
 *            modal detects it via polling and auto-closes with a toast.
 *   FAILURE: no tag arrives → outcome stays unset → the modal/sticky banner
 *            stays up until the SDR manually picks an outcome and saves,
 *            which persists via PATCH /calls/{id}/outcome.
 *
 * Deliberately never calls POST /api/calls/start for real (that triggers a
 * REAL Aircall REST dial, ringing a real device) — the Call button's actual
 * network request is intercepted client-side and fulfilled with a synthetic
 * response pointing at a DialerCall row created via a simulated Aircall
 * webhook instead (POST /webhooks/aircall, the same unauthenticated
 * provider-facing endpoint real Aircall calls). This exercises the exact
 * same server-side code (dialer_service.handle_webhook, _auto_log_outcome)
 * production traffic does, with zero real telephony side effects.
 */
const { test, expect, JWT_TOKEN, API_BASE } = require('./helpers');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const OWNER_EMAIL = 'neelmani.mishra@screen-magic.com'; // matches JWT_TOKEN's sub in helpers.js

async function simulateAircallEvent(request, event, data) {
  const res = await request.post(`${API_BASE}/api/webhooks/aircall`, { data: { event, data } });
  expect(res.status(), `webhook ${event} should be accepted`).toBe(200);
}

async function runSyntheticCall(request, { phone, providerCallId, tags }) {
  const startedAt = Math.floor(Date.now() / 1000);
  await simulateAircallEvent(request, 'call.created', {
    id: providerCallId, direction: 'outbound', raw_digits: phone,
    user: { email: OWNER_EMAIL }, started_at: startedAt,
  });
  await new Promise((r) => setTimeout(r, 1200));

  await simulateAircallEvent(request, 'call.answered', {
    id: providerCallId, direction: 'outbound', raw_digits: phone,
    user: { email: OWNER_EMAIL }, answered_at: startedAt + 2,
  });
  await new Promise((r) => setTimeout(r, 1200));

  await simulateAircallEvent(request, 'call.ended', {
    id: providerCallId, direction: 'outbound', raw_digits: phone,
    user: { email: OWNER_EMAIL }, ended_at: startedAt + 30, duration: 28,
    tags: (tags || []).map((name) => ({ name })),
  });
  await new Promise((r) => setTimeout(r, 1500));
}

/** /my/today-calls merges CallLog + DialerCall and can hand back either
 * table's id — _auto_log_outcome() writes a companion CallLog row alongside
 * the DialerCall it updates, so the merged view isn't reliable for getting
 * the actual DialerCall.id that /dialer/call-outcome-status expects. Resolve
 * lead_id from today-calls, then read the real dialer-sourced row (source:
 * "dialer") from /leads/{id}/calls, which never merges the two. */
async function findTodayCallByPhone(request, phone) {
  const res = await request.get(`${API_BASE}/api/my/today-calls`, {
    headers: { Authorization: `Bearer ${JWT_TOKEN}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  const summary = (body.calls || []).find((c) => c.phone_number === phone);
  expect(summary, `no today-call found for synthetic phone ${phone} — webhook may not have processed yet`).toBeTruthy();

  const leadCalls = await (await request.get(`${API_BASE}/api/leads/${summary.lead_id}/calls`, {
    headers: { Authorization: `Bearer ${JWT_TOKEN}` },
  })).json();
  const call = (leadCalls.calls || []).find((c) => c.source === 'dialer' && c.phone_number === phone);
  expect(call, `no dialer-sourced call row found for lead ${summary.lead_id}`).toBeTruthy();
  return { ...call, lead_id: summary.lead_id, lead_name: summary.lead_name };
}

/** Intercept the browser's own POST /api/calls/start so clicking Call never
 * reaches the real backend / real Aircall — fulfills with the real call_id
 * already created by the webhook simulation above, so the modal's polling
 * targets a row that genuinely exists. */
async function mockCallStart(page, { callId, leadId, leadName, phone }) {
  await page.route('**/api/calls/start', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true, call_id: callId, provider: 'aircall',
      lead_id: leadId, lead_name: leadName, phone,
    }),
  }));
}

async function authAndOpenLead(page, leadId) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('crm_token', t), JWT_TOKEN);
  await page.goto(`${BASE_URL}/#lead-detail/${leadId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
}

test.describe('Full calling flow: lead → Call button → dialer → outcome', () => {

  test('SUCCESS: Aircall tag auto-logs the outcome, open modal auto-closes', async ({ request, page }) => {
    const phone = `+1555${Date.now().toString().slice(-7)}`;
    const providerCallId = `pw-success-${Date.now()}`;

    await runSyntheticCall(request, { phone, providerCallId, tags: ['Answered – Not Interested'] });

    const call = await findTodayCallByPhone(request, phone);
    console.log(`  → created call ${call.id} for lead ${call.lead_id}, outcome=${call.outcome}`);

    // Backend: auto-log fired from the tag alone, no manual entry needed.
    const status1 = await (await request.get(
      `${API_BASE}/api/dialer/call-outcome-status?call_id=${call.id}`,
      { headers: { Authorization: `Bearer ${JWT_TOKEN}` } },
    )).json();
    expect(status1.outcome_logged).toBe(true);
    expect(status1.outcome).toBe('Not Interested');

    // Browser: Call button → mocked initiate → modal opens → poll detects the
    // already-logged outcome on its first cycle → auto-closes with a toast.
    await mockCallStart(page, { callId: call.id, leadId: call.lead_id, leadName: call.lead_name || 'Test Lead', phone });
    await authAndOpenLead(page, call.lead_id);

    const callBtn = page.locator('#log-call-btn');
    await expect(callBtn).toBeVisible({ timeout: 10000 });
    await callBtn.click();

    // app.js's _startAircallOutcomePolling checks getCallStatus() every 10s —
    // the modal only opens once that poll (not the 5s modal-internal one,
    // which hasn't started yet) sees the terminal status.
    const modal = page.locator('#call-log-modal');
    await expect(modal).toBeVisible({ timeout: 16000 });

    await expect(modal).toBeHidden({ timeout: 10000 });
    await expect(page.locator('text=/Outcome synced from Aircall/i')).toBeVisible({ timeout: 5000 });
  });

  test('FAILURE: no tag arrives, modal stays open until manually logged', async ({ request, page }) => {
    const phone = `+1555${(Date.now() + 1).toString().slice(-7)}`;
    const providerCallId = `pw-notag-${Date.now()}`;

    await runSyntheticCall(request, { phone, providerCallId, tags: [] });

    const call = await findTodayCallByPhone(request, phone);
    console.log(`  → created call ${call.id} for lead ${call.lead_id}, outcome=${call.outcome}`);

    const status1 = await (await request.get(
      `${API_BASE}/api/dialer/call-outcome-status?call_id=${call.id}`,
      { headers: { Authorization: `Bearer ${JWT_TOKEN}` } },
    )).json();
    expect(status1.outcome_logged).toBe(false);

    await mockCallStart(page, { callId: call.id, leadId: call.lead_id, leadName: call.lead_name || 'Test Lead', phone });
    await authAndOpenLead(page, call.lead_id);

    const callBtn = page.locator('#log-call-btn');
    await expect(callBtn).toBeVisible({ timeout: 10000 });
    await callBtn.click();

    const modal = page.locator('#call-log-modal');
    await expect(modal).toBeVisible({ timeout: 16000 });

    // Wait through at least one 5s poll cycle — with no tag, outcome_logged
    // never flips true, so the modal must NOT auto-close (this is the exact
    // "Not Logged despite being logged" complaint's inverse: here it's
    // genuinely not logged yet, and the UI must keep prompting, not go silent).
    await page.waitForTimeout(6000);
    await expect(modal).toBeVisible();

    // SDR manually picks an outcome and saves — the real backend PATCH path.
    const patchRes = await request.patch(`${API_BASE}/api/calls/${call.id}/outcome`, {
      headers: { Authorization: `Bearer ${JWT_TOKEN}` },
      data: { outcome: 'No Answer', notes: 'playwright manual-log verification' },
    });
    expect(patchRes.status()).toBe(200);

    const status2 = await (await request.get(
      `${API_BASE}/api/dialer/call-outcome-status?call_id=${call.id}`,
      { headers: { Authorization: `Bearer ${JWT_TOKEN}` } },
    )).json();
    expect(status2.outcome_logged).toBe(true);
    expect(status2.outcome).toBe('No Answer');
  });
});
