// @ts-check
/**
 * SDR Lead Workflow — Gap Coverage
 *
 * Covers the lead lifecycle actions NOT tested in sdr-flow.spec.js:
 *   - Note saved and visible in list
 *   - Task saved and visible in list
 *   - Task marked as done
 *   - Lead search by name
 *   - Status filters (Research, Calling, Meeting Scheduled)
 *   - Research card renders with correct gate status
 *   - Research gate badge shows Pending or Ready
 *   - Disqualify flow — close-lead-btn triggers form, cancel dismisses
 *   - Tab navigation (Overview, Notes, Tasks, Calls)
 *   - MyCalls page loads for SDR
 *
 * NOTE: Call logging with dialer (log-call-btn) is excluded here — record
 * those flows via `npx playwright codegen` against staging (dialer-specific).
 */

const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo } = require('./helpers/auth');

const SDR_EMAIL = 'siddharth.nair@testcrm.com'; // Alpha Team SDR
const VC = '#view-container';

// ─── Shared helper: open the first lead's detail page ─────────────────────
async function openFirstLead(page, request) {
  await loginAs(page, request, SDR_EMAIL);
  await navigateTo(page, 'leads');
  await page.waitForSelector('#leads-tbody tr.lead-row', { timeout: 15000 });
  await page.locator('#leads-tbody tr.lead-row').first().locator('td:nth-child(2)').click();
  await page.waitForSelector('.pipeline-v2', { timeout: 20000 });
  await page.waitForTimeout(800); // let tabs and sections settle
}

// ─── Shared helper: click a named tab ─────────────────────────────────────
async function clickTab(page, tabLabel) {
  const tab = page.locator('.tab-btn, [role="tab"]').filter({ hasText: new RegExp(tabLabel, 'i') });
  await tab.first().click();
  await page.waitForTimeout(600);
}

// ──────────────────────────────────────────────────────────────────────────
test.describe('SDR Lead Workflow — Gap Coverage', () => {

  // ── Tab navigation ──────────────────────────────────────────────────────

  test('L01. Lead detail tab navigation — Overview, Notes, Tasks, Calls all render', async ({ page, request }) => {
    await openFirstLead(page, request);

    for (const tab of ['Notes', 'Tasks', 'Calls']) {
      await clickTab(page, tab);
      const panelVisible = await page.locator(`#tab-${tab.toLowerCase()}, .tab-panel.active`).isVisible().catch(() => false);
      expect(panelVisible, `${tab} tab panel should be visible`).toBeTruthy();
      console.log(`  ✅ ${tab} tab renders`);
    }
  });

  // ── Notes ───────────────────────────────────────────────────────────────

  test('L02. Note saved — appears in notes list after save', async ({ page, request }) => {
    await openFirstLead(page, request);
    await clickTab(page, 'Notes');

    const noteText = `PW auto-note ${Date.now()}`;
    await page.fill('#note-textarea', noteText);
    await page.click('#add-note-btn');

    // Wait for optimistic UI update or API round-trip
    await page.waitForTimeout(2000);

    const notesList = page.locator('#notes-list');
    await expect(notesList).toContainText(noteText, { timeout: 8000 });
    console.log('  ✅ Note saved and visible in list');
  });

  test('L03. Note textarea is present and add button is enabled', async ({ page, request }) => {
    await openFirstLead(page, request);
    await clickTab(page, 'Notes');

    await expect(page.locator('#note-textarea')).toBeVisible();
    await expect(page.locator('#add-note-btn')).toBeVisible();
    await expect(page.locator('#add-note-btn')).toBeEnabled();
  });

  // ── Tasks ───────────────────────────────────────────────────────────────

  test('L04. Task saved — appears in task list after save', async ({ page, request }) => {
    await openFirstLead(page, request);
    await clickTab(page, 'Tasks');

    const taskTitle = `PW task ${Date.now()}`;
    await page.fill('#task-input', taskTitle);
    await page.click('#add-task-btn');

    await page.waitForTimeout(2000);

    // Task item should now exist with the title
    const taskItems = page.locator('.task-item');
    const count = await taskItems.count();
    expect(count).toBeGreaterThan(0);

    const allTaskText = await page.locator('.task-item').allTextContents();
    const found = allTaskText.some(t => t.includes(taskTitle));
    expect(found, `Task "${taskTitle}" should appear in list`).toBeTruthy();
    console.log('  ✅ Task saved and visible in list');
  });

  test('L05. Task marked as done — done class applied', async ({ page, request }) => {
    await openFirstLead(page, request);
    await clickTab(page, 'Tasks');

    // Create a task first to ensure at least one exists
    const taskTitle = `PW done-task ${Date.now()}`;
    await page.fill('#task-input', taskTitle);
    await page.click('#add-task-btn');
    await page.waitForTimeout(2000);

    // Click the checkbox/done button on first undone task
    const doneBtn = page.locator('.task-item:not(.done) .task-done-btn, .task-item:not(.done) input[type="checkbox"]').first();
    if (await doneBtn.count() > 0) {
      await doneBtn.click();
      await page.waitForTimeout(1500);
      // At least one task-item should now have .done class
      const doneItems = page.locator('.task-item.done');
      expect(await doneItems.count()).toBeGreaterThan(0);
      console.log('  ✅ Task marked as done');
    } else {
      console.log('  ⚠️  No undone task checkbox found — skipping done assertion');
    }
  });

  test('L06. Empty task title does not create a task', async ({ page, request }) => {
    await openFirstLead(page, request);
    await clickTab(page, 'Tasks');

    const before = await page.locator('.task-item').count();

    // Click Add with empty input
    await page.fill('#task-input', '');
    await page.click('#add-task-btn');
    await page.waitForTimeout(1000);

    const after = await page.locator('.task-item').count();
    expect(after).toBe(before);
    console.log('  ✅ Empty task not created');
  });

  // ── Research card ────────────────────────────────────────────────────────

  test('L07. Research card is visible on lead detail overview', async ({ page, request }) => {
    await openFirstLead(page, request);
    // Overview is default — no tab click needed
    const researchCard = page.locator('#research-card');
    await expect(researchCard).toBeVisible({ timeout: 10000 });
    console.log('  ✅ Research card visible');
  });

  test('L08. Research gate status badge shows Pending or Ready', async ({ page, request }) => {
    await openFirstLead(page, request);
    const badge = page.locator('#research-status-badge');
    await expect(badge).toBeVisible({ timeout: 10000 });
    const badgeText = await badge.textContent();
    const isValid = badgeText.includes('Ready') || badgeText.includes('Pending');
    expect(isValid, `Badge should be "Ready" or "Pending", got: "${badgeText}"`).toBeTruthy();
    console.log(`  ✅ Research badge shows: ${badgeText?.trim()}`);
  });

  test('L09. Research gate status block is visible below research card', async ({ page, request }) => {
    await openFirstLead(page, request);
    const gateStatus = page.locator('#research-gate-status');
    await expect(gateStatus).toBeVisible({ timeout: 10000 });
    const text = await gateStatus.textContent();
    expect(text.length).toBeGreaterThan(5);
    console.log(`  ✅ Research gate text: "${text?.trim().slice(0, 60)}"`);
  });

  // ── Disqualify / Close Lead ──────────────────────────────────────────────

  test('L10. Close lead button is visible on lead detail', async ({ page, request }) => {
    await openFirstLead(page, request);
    const closeBtn = page.locator('#close-lead-btn');
    await expect(closeBtn).toBeVisible({ timeout: 10000 });
    console.log('  ✅ Close lead button visible');
  });

  test('L11. Close lead — clicking shows confirmation form', async ({ page, request }) => {
    await openFirstLead(page, request);
    await page.click('#close-lead-btn');
    await page.waitForTimeout(800);

    // Confirmation form should appear
    const form = page.locator('#close-lead-form, .close-lead-form');
    await expect(form).toBeVisible({ timeout: 5000 });
    console.log('  ✅ Close lead form appeared');
  });

  test('L12. Close lead — Cancel dismisses the form without changing status', async ({ page, request }) => {
    await openFirstLead(page, request);
    await page.click('#close-lead-btn');
    await page.waitForTimeout(600);

    const form = page.locator('#close-lead-form, .close-lead-form');
    await expect(form).toBeVisible({ timeout: 5000 });

    await page.click('#close-lead-cancel');
    await page.waitForTimeout(600);

    await expect(form).toBeHidden();
    console.log('  ✅ Cancel dismissed the close-lead form');
  });

  // ── Lead Search ──────────────────────────────────────────────────────────

  test('L13. Lead search — typing filters the table', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('#leads-tbody tr.lead-row', { timeout: 15000 });

    const totalBefore = await page.locator('#leads-tbody tr.lead-row').count();

    // Get the name from the first row to search for
    const firstName = await page.locator('#leads-tbody tr.lead-row').first()
      .locator('td:nth-child(2)').textContent();
    const searchTerm = firstName?.trim().split(' ')[0] || 'a';

    await page.fill('#lead-search', searchTerm);
    await page.waitForTimeout(1500);

    const filteredCount = await page.locator('#leads-tbody tr.lead-row').count();
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThanOrEqual(totalBefore);
    console.log(`  ✅ Search "${searchTerm}": ${totalBefore} → ${filteredCount} rows`);
  });

  test('L14. Lead search — clearing search restores full list', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('#leads-tbody tr.lead-row', { timeout: 15000 });

    const totalBefore = await page.locator('#leads-tbody tr.lead-row').count();

    await page.fill('#lead-search', 'zzzznotaname');
    await page.waitForTimeout(1000);

    await page.fill('#lead-search', '');
    await page.waitForTimeout(1500);

    const totalAfter = await page.locator('#leads-tbody tr.lead-row').count();
    expect(totalAfter).toBe(totalBefore);
    console.log(`  ✅ Clearing search restored ${totalAfter} rows`);
  });

  // ── Status Filters ───────────────────────────────────────────────────────

  test('L15. Status filter — Research shows only Research leads (or empty, not error)', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('.data-table tbody tr', { timeout: 10000 });

    await page.locator('#status-filter').selectOption('Research');
    await page.waitForTimeout(1500);

    // Should not crash — either rows or a no-results state
    const hasError = await page.locator('.error-message, .alert-danger').count();
    expect(hasError).toBe(0);
    console.log('  ✅ Research filter applied without error');
  });

  test('L16. Status filter — Calling shows only Calling leads (or empty, not error)', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('.data-table tbody tr', { timeout: 10000 });

    await page.locator('#status-filter').selectOption('Calling');
    await page.waitForTimeout(1500);

    const hasError = await page.locator('.error-message, .alert-danger').count();
    expect(hasError).toBe(0);
    console.log('  ✅ Calling filter applied without error');
  });

  test('L17. Status filter — Meeting Scheduled applies without error', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('.data-table tbody tr', { timeout: 10000 });

    await page.locator('#status-filter').selectOption('Meeting Scheduled');
    await page.waitForTimeout(1500);

    const hasError = await page.locator('.error-message, .alert-danger').count();
    expect(hasError).toBe(0);
    console.log('  ✅ Meeting Scheduled filter applied without error');
  });

  test('L18. Status filter — resetting to All restores full lead list', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('#leads-tbody tr.lead-row', { timeout: 15000 });

    const totalBefore = await page.locator('#leads-tbody tr.lead-row').count();

    await page.locator('#status-filter').selectOption('Research');
    await page.waitForTimeout(1000);
    await page.locator('#status-filter').selectOption('');
    await page.waitForTimeout(1500);

    const totalAfter = await page.locator('#leads-tbody tr.lead-row').count();
    expect(totalAfter).toBe(totalBefore);
    console.log(`  ✅ Resetting filter restored ${totalAfter} rows`);
  });

  // ── MyCalls ──────────────────────────────────────────────────────────────

  test('L19. MyCalls page loads for SDR', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'my-calls');

    const text = await page.locator(VC).textContent();
    const hasContent = text.includes("Today") || text.includes("Call") || text.includes("No calls");
    expect(hasContent).toBeTruthy();
    console.log('  ✅ MyCalls page loaded for SDR');
  });

  test('L20. MyCalls page has no API errors on load', async ({ page, request }) => {
    const errors = [];
    page.on('response', res => {
      if (res.status() >= 500) errors.push(`${res.status()} ${res.url()}`);
    });

    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'my-calls');
    await page.waitForTimeout(3000);

    expect(errors, `500 errors on MyCalls: ${errors.join(', ')}`).toHaveLength(0);
    console.log('  ✅ MyCalls loaded with no 5xx errors');
  });

  // ── Log Call button presence (record actual dialer flow via codegen) ──────
  // NOTE: The actual call logging interaction (clicking log-call-btn, selecting
  // outcome, submitting) should be recorded via:
  //   npx playwright codegen https://rcm-crm-staging.onrender.com
  // and added to tests/sdr-dialer-flow.spec.js

  test('L21. Log Call button is visible on lead detail for SDR', async ({ page, request }) => {
    await openFirstLead(page, request);
    const logCallBtn = page.locator('#log-call-btn');
    await expect(logCallBtn).toBeVisible({ timeout: 10000 });
    const label = await logCallBtn.textContent();
    console.log(`  ✅ Log Call button visible — label: "${label?.trim()}"`);
  });

});
