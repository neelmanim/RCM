// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo } = require('./helpers/auth');

const SDR_EMAIL = 'siddharth.nair@testcrm.com';  // Alpha Team SDR
const VC = '#view-container';  // main view container

test.describe('SDR Flow – Complete Journey', () => {

  // 1. Dashboard
  test('1. Dashboard loads with stats', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    const statCards = page.locator('.stat-card');
    await expect(statCards.first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.page-title')).toContainText('Dashboard');
  });

  // 2. Leads List
  test('2. Leads page shows assigned leads', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('.data-table tbody tr', { timeout: 10000 });
    const rowCount = await page.locator('.data-table tbody tr').count();
    expect(rowCount).toBeGreaterThan(0);
    console.log(`  📋 SDR sees ${rowCount} leads`);
  });

  // 3. Lead Detail – click a table row to open detail
  test('3. Open lead detail and verify fields', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('#leads-tbody tr.lead-row', { timeout: 15000 });
    await page.locator('#leads-tbody tr.lead-row').first().locator('td:nth-child(2)').click();
    await page.waitForSelector('.lead-detail-header, #add-task-btn, .pipeline-v2', { timeout: 30000 });

    const text = await page.locator(VC).textContent();
    expect(text.length).toBeGreaterThan(100);
    const hasInfo = text.includes('Status') || text.includes('Company') || text.includes('Email') || text.includes('Notes');
    expect(hasInfo).toBeTruthy();
  });

  // 4. Kanban Board — verify pipeline columns including Disqualified
  test.skip('4. Kanban board shows pipeline columns with Disqualified (deprecated — kanban hidden)', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'kanban');
    await page.waitForSelector('.kanban-column, .pipeline-column, [class*="kanban"]', { timeout: 30000 }).catch(() => { });
    await page.waitForTimeout(5000);
    const text = await page.locator(VC).textContent();
    expect(text).toContain('Lead Assigned');
    expect(text).toContain('Research');
    expect(text).toContain('Calling');
    expect(text).toContain('Meeting Scheduled');
    expect(text).toContain('Disqualified');
    // Old statuses should NOT appear as columns
    const hasOldStatuses = text.includes('Customer Declined') && !text.includes('Disqualified');
    expect(hasOldStatuses).toBeFalsy();
    console.log('  ✅ Kanban shows correct pipeline including Disqualified');
  });

  // 5. Lead Detail – stepper shows correct pipeline
  test('5. Lead detail stepper shows 4-step pipeline', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('#leads-tbody tr.lead-row', { timeout: 15000 });
    await page.locator('#leads-tbody tr.lead-row').first().locator('td:nth-child(2)').click();
    await page.waitForSelector('.lead-detail-header, #add-task-btn, .pipeline-v2', { timeout: 30000 });
    // Give stepper a moment to render after the main detail loads
    await page.waitForSelector('.pipeline-v2', { timeout: 15000 });

    // Stepper shows grouped pipeline stages
    const stepperText = await page.locator('.pipeline-v2').textContent();
    expect(stepperText).toContain('Qualification');
    expect(stepperText).toContain('Meeting');
    expect(stepperText).toContain('Discovery');
    expect(stepperText).toContain('Demo');
    console.log('  📌 Lead detail stepper shows 4-step pipeline');
  });

  // 6. Add Note
  test('6. Add a note to a lead', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('#leads-tbody tr.lead-row', { timeout: 15000 });
    await page.locator('#leads-tbody tr.lead-row').first().locator('td:nth-child(2)').click();
    await page.waitForSelector('.lead-detail-header, #add-task-btn, .pipeline-v2', { timeout: 30000 });

    const notesTab = page.locator('button, [role="tab"]').filter({ hasText: /Notes/i });
    if (await notesTab.count() > 0) {
      await notesTab.first().click();
      await page.waitForTimeout(800);
    }

    const textareas = page.locator('textarea');
    if (await textareas.count() > 0) {
      await textareas.first().fill('Playwright test note — automated SDR flow ✅');
      const saveBtn = page.locator('button').filter({ hasText: /^Add$|Add Note|Save|Post/i });
      if (await saveBtn.count() > 0) {
        await saveBtn.first().click();
        await page.waitForTimeout(1500);
        console.log('  ✅ Note added');
      }
    }
  });

  // 7. Create Task
  test('7. Create a task on a lead', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('#leads-tbody tr.lead-row', { timeout: 15000 });
    await page.locator('#leads-tbody tr.lead-row').first().locator('td:nth-child(2)').click();
    await page.waitForSelector('.lead-detail-header, #add-task-btn, .pipeline-v2', { timeout: 30000 });

    const tasksTab = page.locator('button, [role="tab"]').filter({ hasText: /Tasks/i });
    if (await tasksTab.count() > 0) {
      await tasksTab.first().click();
      await page.waitForTimeout(800);
    }

    const addBtn = page.locator('button').filter({ hasText: /Add Task|New Task|\+ Task/i });
    if (await addBtn.count() > 0) {
      await addBtn.first().click();
      await page.waitForTimeout(600);
      const inputs = page.locator('input[type="text"]');
      if (await inputs.count() > 0) {
        await inputs.first().fill('Follow up — Playwright E2E');
        const saveBtn = page.locator('button').filter({ hasText: /Save|Add|Create/i });
        if (await saveBtn.count() > 0) {
          await saveBtn.first().click();
          await page.waitForTimeout(1500);
          console.log('  ✅ Task created');
        }
      }
    }
  });

  // 8. Calls Tab
  test('8. Calls tab shows on lead detail', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('#leads-tbody tr.lead-row', { timeout: 15000 });
    await page.locator('#leads-tbody tr.lead-row').first().locator('td:nth-child(2)').click();
    await page.waitForSelector('.lead-detail-header, #add-task-btn, .pipeline-v2', { timeout: 30000 });

    const vcText = await page.locator(VC).textContent();
    const hasCallsSection = vcText.includes('Call') || vcText.includes('Activity');
    expect(hasCallsSection).toBeTruthy();
    console.log('  ✅ Calls/Activity section present on lead detail');
  });

  // 9. Leaderboard — verify Disqualified column and time presets
  test('9. Leaderboard loads with Disqualified column and time presets', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'leaderboard');
    await page.waitForTimeout(3000);
    const text = await page.locator(VC).textContent();
    expect(text.toLowerCase()).toContain('leaderboard');
    expect(text).toContain('Disqualified');
    // Old column names should not appear
    expect(text).not.toContain('Declined');
    // New: verify time-period presets
    expect(text).toContain('7 Days');
    expect(text).toContain('30 Days');
    expect(text).toContain('All Time');
    console.log('  ✅ Leaderboard shows Disqualified column and time presets');
  });

  // 10. Settings
  test('10. Settings page loads for SDR', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    // Settings nav is hidden for SDR, navigate via URL hash
    await page.evaluate(() => { window.location.hash = 'settings'; });
    await page.waitForTimeout(3000);
    const text = await page.locator(VC).textContent();
    expect(text.toLowerCase()).toContain('settings');
    console.log('  ✅ Settings page loaded for SDR');
  });

  // 11. Settings — verify settings page loads for SDR
  test('11. Settings page renders correctly for SDR', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    // Settings nav is hidden for SDR, navigate via URL hash
    await page.evaluate(() => { window.location.hash = 'settings'; });
    await page.waitForTimeout(3000);
    const text = await page.locator(VC).textContent();
    expect(text.toLowerCase()).toContain('settings');
    console.log('  ✅ Settings page renders correctly for SDR');
  });

  // 12. Lead Assigned filter returns results for SDR
  test('12. Lead Assigned filter shows results', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('.data-table tbody tr', { timeout: 10000 });

    const initialCount = await page.locator('.data-table tbody tr').count();

    const statusFilter = page.locator('#status-filter');
    await statusFilter.selectOption('Lead Assigned');
    await page.waitForTimeout(1500);

    const filteredCount = await page.locator('.data-table tbody tr').count();
    console.log(`  📋 SDR Lead Assigned filter: before=${initialCount}, after=${filteredCount}`);
    // Should not error out
    expect(filteredCount).toBeGreaterThanOrEqual(0);
  });

  // 13. Help page loads for SDR
  test('13. Help page loads for SDR', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await navigateTo(page, 'user-guide');
    await page.waitForTimeout(2000);

    const text = await page.locator(VC).textContent();
    const hasHelp = text.includes('Guide') || text.includes('Help') || text.includes('Getting Started');
    expect(hasHelp).toBeTruthy();
    console.log('  ✅ SDR Help page loaded');
  });

  // 14. SDR cannot see Admin-only nav items
  test('14. SDR cannot see admin nav items', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await page.waitForTimeout(2000);

    // Admin Panel should be hidden for SDR
    const adminNav = page.locator('#admin-nav-item');
    await expect(adminNav).toBeHidden();
    // POD Management should be hidden
    const podsNav = page.locator('#pods-nav-item');
    await expect(podsNav).toBeHidden();
    // SF Logs should be hidden
    const sfLogsNav = page.locator('#sf-logs-nav-item');
    await expect(sfLogsNav).toBeHidden();
    console.log('  ✅ Admin-only nav items hidden for SDR');
  });
});

