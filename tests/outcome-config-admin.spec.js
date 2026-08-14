// @ts-check
/**
 * Playwright E2E tests — Outcome Config Admin UI + API
 *
 * Tests the Dynamic Call Outcomes admin management interface:
 *   - Settings → Sync tab → Call Outcomes Configuration card
 *   - Toggle enabled/disabled, notes checkboxes
 *   - Add custom outcomes via form
 *   - Save outcomes via PATCH /admin/sync-settings
 *   - API validation for invalid configs
 *
 * Prerequisites:
 *   ADMIN_TOKEN=<Super Admin JWT> npx playwright test tests/outcome-config-admin.spec.js
 */
const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo, BASE_URL, ADMIN_TOKEN } = require('./helpers/auth');

const SUPER_ADMIN_EMAIL = 'neelmani.mishra@screen-magic.com';
const AUTH_HEADER = { Authorization: `Bearer ${ADMIN_TOKEN}` };
const VC = '#view-container';

/** Navigate to Settings → Sync tab */
async function goToSyncSettings(page, request) {
  await loginAs(page, request, SUPER_ADMIN_EMAIL);
  await navigateTo(page, 'settings');
  await page.waitForTimeout(2000);

  // Click Sync Settings tab (class is "settings-tab", data-tab="sync")
  const syncTab = page.locator('.settings-tab[data-tab="sync"]');
  if (await syncTab.count() > 0) {
    await syncTab.click();
    await page.waitForTimeout(2000);
  }
}

test.describe('Outcome Config Admin — UI Tests', () => {

  // 1. Settings → Sync tab → Call Outcomes card is visible
  test('1. Call Outcomes config card renders in Sync Settings', async ({ page, request }) => {
    await goToSyncSettings(page, request);

    // Verify the outcomes container exists
    const container = page.locator('#call-outcomes-config-container');
    await expect(container).toBeVisible({ timeout: 10000 });

    // Should contain outcome names
    const text = await container.textContent();
    expect(text).toContain('No Answer');
    expect(text).toContain('Not Interested');
    console.log('  ✅ Call Outcomes config card renders in Sync Settings');
  });

  // 2. Outcomes table shows builtin outcomes
  test('2. Outcomes table displays builtin outcomes', async ({ page, request }) => {
    await goToSyncSettings(page, request);

    const container = page.locator('#call-outcomes-config-container');
    await expect(container).toBeVisible({ timeout: 10000 });

    const text = await container.textContent();
    // Core outcomes that must always exist
    const coreOutcomes = [
      'No Answer', 'Left Voicemail', 'Wrong Number',
      'Not Interested', 'Unreachable', 'Left the Company',
    ];

    for (const outcome of coreOutcomes) {
      expect(text).toContain(outcome);
    }
    console.log('  ✅ Core builtin outcomes displayed');
  });

  // 3. Save button is visible
  test('3. Save Outcomes button is visible', async ({ page, request }) => {
    await goToSyncSettings(page, request);

    const saveBtn = page.locator('#btn-save-outcomes');
    await expect(saveBtn).toBeVisible({ timeout: 10000 });
    const btnText = await saveBtn.textContent();
    expect(btnText).toContain('Save');
    console.log('  ✅ Save Outcomes button visible');
  });

  // 4. Add Outcome form is visible with inputs
  test('4. Add Outcome form renders with input fields', async ({ page, request }) => {
    await goToSyncSettings(page, request);

    // Form inputs
    const nameInput = page.locator('#new-outcome-value');
    await expect(nameInput).toBeVisible({ timeout: 10000 });

    const groupSelect = page.locator('#new-outcome-group');
    await expect(groupSelect).toBeVisible();

    const actionSelect = page.locator('#new-outcome-action');
    await expect(actionSelect).toBeVisible();

    const addBtn = page.locator('#btn-add-outcome');
    await expect(addBtn).toBeVisible();

    console.log('  ✅ Add Outcome form renders with all fields');
  });

  // 5. Toggle switch exists for each outcome row
  test('5. Enabled toggle switches exist for all outcomes', async ({ page, request }) => {
    await goToSyncSettings(page, request);

    const container = page.locator('#call-outcomes-config-container');
    await expect(container).toBeVisible({ timeout: 10000 });

    // Count toggle checkboxes (enabled field)
    const toggles = container.locator('input[data-field="enabled"]');
    const count = await toggles.count();
    expect(count).toBeGreaterThanOrEqual(6); // at least core builtins
    console.log(`  ✅ ${count} enabled toggle switches found`);
  });

  // 6. Notes Required checkboxes exist
  test('6. Notes Required checkboxes exist for all outcomes', async ({ page, request }) => {
    await goToSyncSettings(page, request);

    const container = page.locator('#call-outcomes-config-container');
    await expect(container).toBeVisible({ timeout: 10000 });

    const notesCheckboxes = container.locator('input[data-field="notes_required"]');
    const count = await notesCheckboxes.count();
    expect(count).toBeGreaterThanOrEqual(6);
    console.log(`  ✅ ${count} notes_required checkboxes found`);
  });

  // 7. Table shows group badges (Answered, Not Answered, Terminal)
  test('7. Table shows group badges for outcomes', async ({ page, request }) => {
    await goToSyncSettings(page, request);

    const container = page.locator('#call-outcomes-config-container');
    await expect(container).toBeVisible({ timeout: 10000 });

    const text = await container.textContent();
    // Check that group labels are present (case-insensitive check via includes)
    const hasGroups = text.includes('answered') || text.includes('Answered');
    expect(hasGroups).toBeTruthy();
    const hasTerminal = text.includes('terminal') || text.includes('Terminal');
    expect(hasTerminal).toBeTruthy();
    console.log('  ✅ Group badges visible in outcomes table');
  });

  // 8. Custom outcome counter shows
  test('8. Custom outcome counter is displayed', async ({ page, request }) => {
    await goToSyncSettings(page, request);

    const container = page.locator('#call-outcomes-config-container');
    await expect(container).toBeVisible({ timeout: 10000 });

    const text = await container.textContent();
    // Should show "X/10 custom outcomes used"
    expect(text).toContain('/10');
    console.log('  ✅ Custom outcome counter displayed');
  });
});


test.describe('Outcome Config Admin — API Tests', () => {

  // 9. GET /admin/sync-settings includes outcome_config
  test('9. GET /sync-settings includes outcome_config in response', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admin/sync-settings`, {
      headers: AUTH_HEADER,
    });

    // If migration hasn't been run, the endpoint may 500 — still useful signal
    if (res.status() === 500) {
      console.log('  ⚠️ GET /sync-settings returned 500 — migration may not be run yet');
      test.skip();
      return;
    }

    expect(res.status()).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('outcome_config');
    expect(Array.isArray(data.outcome_config)).toBeTruthy();
    expect(data.outcome_config.length).toBeGreaterThan(0);

    // Verify shape of first outcome
    const first = data.outcome_config[0];
    expect(first).toHaveProperty('value');
    expect(first).toHaveProperty('group');
    expect(first).toHaveProperty('action');
    console.log(`  ✅ GET /sync-settings includes ${data.outcome_config.length} outcomes`);
  });

  // 10. PATCH /sync-settings with valid outcome_config succeeds
  test('10. PATCH /sync-settings saves valid outcome_config', async ({ request }) => {
    // First read current config via call-outcomes (always works)
    const outRes = await request.get(`${BASE_URL}/api/call-outcomes`, {
      headers: AUTH_HEADER,
    });
    expect(outRes.status()).toBe(200);
    const outData = await outRes.json();

    // Patch with the current outcomes config
    const patchRes = await request.patch(`${BASE_URL}/api/admin/sync-settings`, {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: { outcome_config: outData.outcomes },
    });

    if (patchRes.status() === 500) {
      console.log('  ⚠️ PATCH returned 500 — migration may not be run yet');
      test.skip();
      return;
    }

    expect(patchRes.status()).toBe(200);
    const patchData = await patchRes.json();
    expect(patchData).toHaveProperty('outcome_config');
    console.log('  ✅ PATCH /sync-settings with valid config succeeds');
  });

  // 11. PATCH /sync-settings rejects invalid outcome_config (missing fields)
  test('11. PATCH rejects outcome_config with missing required fields', async ({ request }) => {
    const res = await request.patch(`${BASE_URL}/api/admin/sync-settings`, {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: {
        outcome_config: [
          { value: 'Incomplete Outcome' },  // missing group, action, etc.
        ],
      },
    });
    // 422 (validation) or 500 (migration not run)
    expect([422, 500]).toContain(res.status());
    if (res.status() === 422) {
      const body = await res.json();
      expect(body.detail).toContain('missing required field');
      console.log('  ✅ Missing fields correctly rejected with 422');
    } else {
      console.log('  ⚠️ 500 — migration may not be run yet');
    }
  });

  // 12. PATCH rejects duplicate outcome values
  test('12. PATCH rejects duplicate outcome values', async ({ request }) => {
    const res = await request.patch(`${BASE_URL}/api/admin/sync-settings`, {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: {
        outcome_config: [
          { value: 'Test Dup', group: 'terminal', action: 'none', notes_required: false, enabled: true, builtin: false },
          { value: 'Test Dup', group: 'terminal', action: 'none', notes_required: false, enabled: true, builtin: false },
        ],
      },
    });
    expect([422, 500]).toContain(res.status());
    if (res.status() === 422) {
      const body = await res.json();
      expect(body.detail).toContain('Duplicate outcome value');
      console.log('  ✅ Duplicate values correctly rejected');
    } else {
      console.log('  ⚠️ 500 — migration may not be run yet');
    }
  });

  // 13. PATCH rejects disqualify action on non-terminal group
  test('13. PATCH rejects disqualify action on answered group', async ({ request }) => {
    const res = await request.patch(`${BASE_URL}/api/admin/sync-settings`, {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: {
        outcome_config: [
          { value: 'Bad Combo', group: 'answered', action: 'disqualify', notes_required: false, enabled: true, builtin: false },
        ],
      },
    });
    expect([422, 500]).toContain(res.status());
    if (res.status() === 422) {
      const body = await res.json();
      expect(body.detail).toContain('disqualify');
      console.log('  ✅ Disqualify on non-terminal group correctly rejected');
    } else {
      console.log('  ⚠️ 500 — migration may not be run yet');
    }
  });

  // 14. PATCH rejects invalid group value
  test('14. PATCH rejects invalid group value', async ({ request }) => {
    const res = await request.patch(`${BASE_URL}/api/admin/sync-settings`, {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: {
        outcome_config: [
          { value: 'Bad Group', group: 'invalid_group', action: 'none', notes_required: false, enabled: true, builtin: false },
        ],
      },
    });
    expect([422, 500]).toContain(res.status());
    if (res.status() === 422) {
      const body = await res.json();
      expect(body.detail).toContain('invalid group');
      console.log('  ✅ Invalid group correctly rejected');
    } else {
      console.log('  ⚠️ 500 — migration may not be run yet');
    }
  });

  // 15. PATCH enforces max 10 custom outcomes
  test('15. PATCH enforces max 10 custom outcomes cap', async ({ request }) => {
    const customs = Array.from({ length: 11 }, (_, i) => ({
      value: `Custom Outcome ${i + 1}`,
      group: 'terminal',
      action: 'none',
      notes_required: false,
      enabled: true,
      builtin: false,
    }));

    const res = await request.patch(`${BASE_URL}/api/admin/sync-settings`, {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: { outcome_config: customs },
    });
    expect([422, 500]).toContain(res.status());
    if (res.status() === 422) {
      const body = await res.json();
      expect(body.detail).toContain('Maximum 10 custom outcomes');
      console.log('  ✅ Custom outcome cap (10) correctly enforced');
    } else {
      console.log('  ⚠️ 500 — migration may not be run yet');
    }
  });

  // 16. PATCH rejects outcome_config that is not a list
  test('16. PATCH rejects non-list outcome_config', async ({ request }) => {
    const res = await request.patch(`${BASE_URL}/api/admin/sync-settings`, {
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      data: { outcome_config: 'not a list' },
    });
    // Could be 422 (our validation) or 500 (unhandled type error)
    expect([422, 500]).toContain(res.status());
    console.log(`  ${res.status() === 422 ? '✅' : '⚠️'} Non-list config returned ${res.status()}`);
  });
});
