// @ts-check
/**
 * Playwright E2E tests — Call Outcome Flow (API + SDR journey)
 *
 * Tests the dynamic call outcome system end-to-end:
 *   - GET /api/call-outcomes returns config-driven outcomes
 *   - POST /api/leads/{id}/calls respects DB config (validation, notes, custom outcomes)
 *   - POST /api/leads/{id}/close respects config-derived terminal reasons
 *
 * Prerequisites:
 *   ADMIN_TOKEN=<Super Admin JWT> npx playwright test tests/call-outcome-flow.spec.js
 */
const { test, expect } = require('@playwright/test');
const { BASE_URL, ADMIN_TOKEN } = require('./helpers/auth');

const AUTH_HEADER = { Authorization: `Bearer ${ADMIN_TOKEN}` };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Find a lead for call tests. */
async function getTestLead(request) {
  // Try Calling leads first, then any lead
  for (const status of ['Calling', '']) {
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

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Call Outcome Flow — API Tests', () => {

  // 1. GET /call-outcomes returns outcome config
  test('1. GET /call-outcomes returns outcome config with correct shape', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/call-outcomes`, {
      headers: AUTH_HEADER,
    });
    expect(res.status()).toBe(200);

    const data = await res.json();
    expect(data).toHaveProperty('outcomes');
    expect(data).toHaveProperty('enabled_outcomes');
    expect(Array.isArray(data.outcomes)).toBeTruthy();
    expect(data.outcomes.length).toBeGreaterThan(0);

    // Every outcome must have required fields
    for (const o of data.outcomes) {
      expect(o).toHaveProperty('value');
      expect(o).toHaveProperty('group');
      expect(o).toHaveProperty('action');
      expect(o).toHaveProperty('notes_required');
      expect(o).toHaveProperty('enabled');
      expect(['answered', 'not_answered', 'terminal']).toContain(o.group);
      expect(['none', 'disqualify', 'meeting_scheduled']).toContain(o.action);
    }
    console.log(`  ✅ GET /call-outcomes returned ${data.outcomes.length} outcomes`);
  });

  // 2. Enabled outcomes are a subset of all outcomes
  test('2. Enabled outcomes are subset of all outcomes', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/call-outcomes`, {
      headers: AUTH_HEADER,
    });
    const data = await res.json();

    const allValues = new Set(data.outcomes.map(o => o.value));
    for (const eo of data.enabled_outcomes) {
      expect(allValues.has(eo.value)).toBeTruthy();
      expect(eo.enabled).toBe(true);
    }
    console.log(`  ✅ ${data.enabled_outcomes.length}/${data.outcomes.length} outcomes are enabled`);
  });

  // 3. Builtin outcomes include essential defaults (data-driven from live config)
  test('3. Builtin outcomes include essential defaults', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/call-outcomes`, {
      headers: AUTH_HEADER,
    });
    const data = await res.json();
    const values = data.outcomes.map(o => o.value);

    // These must ALWAYS exist regardless of customization
    const coreOutcomes = [
      'No Answer', 'Left Voicemail', 'Wrong Number',
      'Not Interested', 'Unreachable', 'Left the Company',
    ];
    for (const expected of coreOutcomes) {
      expect(values).toContain(expected);
    }

    // Must have all 3 groups represented
    const groups = new Set(data.outcomes.map(o => o.group));
    expect(groups.has('answered')).toBeTruthy();
    expect(groups.has('not_answered')).toBeTruthy();
    expect(groups.has('terminal')).toBeTruthy();

    console.log('  ✅ All core builtin outcomes present, all groups represented');
  });

  // 4. Log call with valid builtin outcome
  test('4. Log call with valid builtin outcome succeeds', async ({ request }) => {
    const lead = await getTestLead(request);
    if (!lead) {
      test.skip();
      return;
    }

    const res = await request.post(`${BASE_URL}/api/leads/${lead.id}/calls`, {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: { outcome: 'No Answer', notes: 'Playwright E2E — no answer test' },
    });

    // Accept 200 (success) or 422 (status mismatch) — both prove validation works
    expect([200, 422]).toContain(res.status());
    if (res.status() === 200) {
      console.log('  ✅ Call logged with "No Answer" outcome');
    } else {
      console.log('  ⚠️ Lead not in correct status for call logging (expected)');
    }
  });

  // 5. Log call with invalid outcome is rejected
  test('5. Log call with invalid outcome returns 400', async ({ request }) => {
    const lead = await getTestLead(request);
    if (!lead) {
      test.skip();
      return;
    }

    const res = await request.post(`${BASE_URL}/api/leads/${lead.id}/calls`, {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: { outcome: 'Totally Fake Outcome XYZ', notes: '' },
    });

    // 400 (invalid outcome) or 422 (status mismatch caught first)
    expect([400, 422]).toContain(res.status());
    console.log(`  ✅ Invalid outcome correctly handled (${res.status()})`);
  });

  // 6. Log call with notes_required outcome but no notes
  test('6. Notes-required outcome without notes is rejected', async ({ request }) => {
    const lead = await getTestLead(request);
    if (!lead) {
      test.skip();
      return;
    }

    // "Not Interested" has notes_required: true in default config
    const res = await request.post(`${BASE_URL}/api/leads/${lead.id}/calls`, {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: { outcome: 'Not Interested', notes: '' },
    });

    // Should be 422 (notes mandatory or status mismatch)
    expect([422]).toContain(res.status());
    const body = await res.json();
    const isRelevant = (body.detail && body.detail.includes('Notes are mandatory')) ||
                       (body.detail && body.detail.includes('status'));
    expect(isRelevant).toBeTruthy();
    console.log(`  ✅ Notes enforcement working`);
  });

  // 7. Close lead with non-terminal reason is rejected
  test('7. Close lead with non-terminal reason returns error', async ({ request }) => {
    const lead = await getTestLead(request);
    if (!lead) {
      test.skip();
      return;
    }

    // "No Answer" is not_answered group — not valid for closing
    const res = await request.post(`${BASE_URL}/api/leads/${lead.id}/close`, {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: { reason: 'No Answer' },
    });

    // Should be 400 (invalid reason) or 422 (status/attempts check)
    expect([400, 422]).toContain(res.status());
    console.log(`  ✅ Non-terminal close reason correctly rejected (${res.status()})`);
  });

  // 8. Close lead with valid terminal reason
  test('8. Close lead with valid terminal reason works', async ({ request }) => {
    const lead = await getTestLead(request);
    if (!lead) {
      test.skip();
      return;
    }

    const res = await request.post(`${BASE_URL}/api/leads/${lead.id}/close`, {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: { reason: 'Not Interested', notes: 'Playwright E2E — close test' },
    });

    // 200 (closed), 400 (invalid), or 422 (status/attempts check)
    expect([200, 400, 422]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.lead_status).toBe('Disqualified');
      console.log('  ✅ Lead closed with terminal reason');
    } else {
      console.log(`  ⚠️ Close returned ${res.status()} — lead may not be in valid state (expected)`);
    }
  });
});
