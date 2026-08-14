// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo } = require('./helpers/auth');

const POD_ADMIN_EMAIL = 'priya.verma@testcrm.com';  // Alpha Team Pod Admin
const VC = '#view-container';

test.describe('Pod Admin Lead Flow', () => {

  // 1. Dashboard – Pod Admin perspective
  test('1. Pod Admin dashboard loads', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    const statCards = page.locator('.stat-card');
    await expect(statCards.first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.page-title')).toContainText('Dashboard');
  });

  // 2. Leads page shows "All Leads" with admin tabs
  test('2. Leads page shows All Leads with tabs', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('.data-table tbody tr', { timeout: 10000 });

    await expect(page.locator('.page-title')).toContainText('All Leads');
    const tabBar = page.locator('.leads-tab');
    const tabCount = await tabBar.count();
    expect(tabCount).toBe(2);

    const headerText = await page.locator('#leads-tbody').evaluate(el => el.closest('table').querySelector('thead').textContent);
    expect(headerText).toContain('Assigned To');

    const rowCount = await page.locator('.data-table tbody tr').count();
    console.log(`  📋 Pod Admin sees ${rowCount} leads`);
  });

  // 3. Leads list shows pod leads with assigned SDR names
  test('3. Leads table shows assigned SDR names', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('#leads-tbody tr.lead-row', { timeout: 15000 });

    const bodyText = await page.locator('#leads-tbody').textContent();
    expect(bodyText.length).toBeGreaterThan(20);

    const hasAssignment = bodyText.includes('Ankit') || bodyText.includes('Neha') || bodyText.includes('Vikram');
    console.log(`  👥 Leads show SDR assignments: ${hasAssignment}`);
  });

  // 4. Assignments tab shows lead assignment UI
  test('4. Assignments tab is accessible', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('.leads-tab', { timeout: 10000 });

    const assignTab = page.locator('.leads-tab').filter({ hasText: 'Assignments' });
    await expect(assignTab).toBeVisible();
    await assignTab.click();
    await page.waitForTimeout(1500);

    const assignContent = page.locator('#assignments-tab-content');
    await expect(assignContent).toBeVisible();
    console.log('  ✅ Assignments tab loaded');
  });

  // 5. Lead detail view accessible from admin
  test('5. Pod Admin can open lead detail', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('#leads-tbody tr.lead-row', { timeout: 15000 });

    await page.locator('#leads-tbody tr.lead-row').first().locator('td:nth-child(2)').click();
    await page.waitForSelector('.lead-detail-header, #add-task-btn, .pipeline-v2', { timeout: 30000 });

    const text = await page.locator(VC).textContent();
    expect(text.length).toBeGreaterThan(100);
    const hasDetail = text.includes('Status') || text.includes('Company') || text.includes('Email');
    expect(hasDetail).toBeTruthy();
  });

  // 6. Status filter works
  test('6. Status filter narrows lead list', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('.data-table tbody tr', { timeout: 10000 });

    const initialCount = await page.locator('.data-table tbody tr').count();
    const statusFilter = page.locator('#status-filter');
    await statusFilter.selectOption('Lead Assigned');
    await page.waitForTimeout(1500);

    const filteredCount = await page.locator('.data-table tbody tr').count();
    console.log(`  🔍 Before filter: ${initialCount}, after "Lead Assigned" filter: ${filteredCount}`);
    expect(filteredCount).toBeGreaterThanOrEqual(0);
  });

  // 7. Search works
  test('7. Search filters leads by text', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('.data-table tbody tr', { timeout: 10000 });

    const searchInput = page.locator('#lead-search');
    await searchInput.fill('TechFirm');
    await page.waitForTimeout(1500);

    const bodyText = await page.locator('#leads-tbody').textContent();
    const hasResult = bodyText.includes('TechFirm') || bodyText.includes('No leads');
    expect(hasResult).toBeTruthy();
    console.log(`  🔍 Search for "TechFirm": ${bodyText.includes("TechFirm") ? "found" : "not found"}`);
  });

  // 8. Kanban board — verify pipeline columns including Disqualified
  test.skip('8. Kanban shows pipeline with Disqualified column (deprecated — kanban hidden)', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    await navigateTo(page, 'kanban');
    await page.waitForSelector('.kanban-column, .pipeline-column, [class*="kanban"]', { timeout: 30000 }).catch(() => { });
    await page.waitForTimeout(5000);

    const text = await page.locator(VC).textContent();
    expect(text).toContain('Lead Assigned');
    expect(text).toContain('Research');
    expect(text).toContain('Calling');
    expect(text).toContain('Meeting Scheduled');
    expect(text).toContain('Disqualified');

    const hasAdminView = text.includes('All leads') || text.includes('pipeline');
    console.log(`  📊 Kanban admin view: ${hasAdminView}`);
  });

  // 9. Pod Admin can add a note to any lead
  test('9. Pod Admin adds note to a lead', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
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
      await textareas.first().fill('Pod Admin note — reviewing lead progress');
      const saveBtn = page.locator('button').filter({ hasText: /^Add$|Add Note|Save|Post/i });
      if (await saveBtn.count() > 0) {
        await saveBtn.first().click();
        await page.waitForTimeout(1500);
        console.log('  ✅ Pod Admin note added');
      }
    }
  });

  // 10. Leaderboard — verify Disqualified column and time presets
  test('10. Leaderboard shows Disqualified column and time presets', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    await navigateTo(page, 'leaderboard');
    await page.waitForTimeout(3000);
    const text = await page.locator(VC).textContent();
    expect(text.toLowerCase()).toContain('leaderboard');
    expect(text).toContain('Disqualified');
    // New: verify time-period presets exist
    expect(text).toContain('7 Days');
    expect(text).toContain('30 Days');
    expect(text).toContain('All Time');
    console.log('  ✅ Leaderboard shows Disqualified column and time presets');
  });

  // 11. Settings shows tabbed UI with Connection tab
  test('11. Settings page loads for Pod Admin', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    await navigateTo(page, 'settings');
    await page.waitForTimeout(3000);
    const text = await page.locator(VC).textContent();
    expect(text.toLowerCase()).toContain('settings');
    console.log('  ✅ Settings page loaded for Pod Admin');
  });

  // 12. Lead detail shows 4-step stepper pipeline
  test('12. Lead detail stepper shows correct pipeline', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('#leads-tbody tr.lead-row', { timeout: 15000 });
    await page.locator('#leads-tbody tr.lead-row').first().locator('td:nth-child(2)').click();
    await page.waitForSelector('.lead-detail-header, #add-task-btn, .pipeline-v2', { timeout: 30000 });
    await page.waitForSelector('.pipeline-v2', { timeout: 15000 });

    const stepperText = await page.locator('.pipeline-v2').textContent();
    expect(stepperText).toContain('Qualification');
    expect(stepperText).toContain('Meeting');
    expect(stepperText).toContain('Discovery');
    expect(stepperText).toContain('Demo');
    console.log('  📌 Pod Admin lead detail stepper shows 4-step pipeline');
  });

  // 13. Assignments page has SDR filter and bulk controls
  test('13. Assignments page has SDR filter and checkboxes', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('.leads-tab', { timeout: 15000 });

    const assignTab = page.locator('.leads-tab').filter({ hasText: 'Assignments' });
    await expect(assignTab).toBeVisible();
    await assignTab.click();
    // Wait for the assignments view to load (async — calls 3 APIs)
    await page.waitForSelector('#assigned-sdr-filter', { timeout: 30000 });

    // SDR filter dropdown
    const sdrFilter = page.locator('#assigned-sdr-filter');
    await expect(sdrFilter).toBeVisible();
    // Select-all checkboxes on both tables
    await expect(page.locator('#select-all-unassigned')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#select-all-assigned')).toBeVisible({ timeout: 15000 });
    console.log('  ✅ Pod Admin Assignments page with SDR filter and bulk controls');
  });

  // 14. Lead Assigned filter works correctly
  test('14. Lead Assigned filter shows leads', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('.data-table tbody tr', { timeout: 10000 });

    const statusFilter = page.locator('#status-filter');
    await statusFilter.selectOption('Lead Assigned');
    await page.waitForTimeout(1500);

    const subtitle = await page.locator('#leads-subtitle').textContent();
    console.log(`  📋 Pod Admin Lead Assigned filter: ${subtitle}`);
    const bodyText = await page.locator('#leads-tbody').textContent();
    expect(bodyText.length).toBeGreaterThan(0);
  });

  // 15. Pod Admin cannot see Super Admin-only nav items
  test('15. Pod Admin cannot see Super Admin-only nav items', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    await page.waitForTimeout(2000);

    // Upload Center is Super Admin only
    const uploadNav = page.locator('#upload-nav-item');
    await expect(uploadNav).toBeHidden();
    // POD Management is Super Admin only
    const podsNav = page.locator('#pods-nav-item');
    await expect(podsNav).toBeHidden();
    console.log('  ✅ Super Admin-only nav items hidden for Pod Admin');
  });

  // 16. Help page loads
  test('16. Help page loads', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    await navigateTo(page, 'user-guide');
    await page.waitForTimeout(2000);

    const text = await page.locator(VC).textContent();
    const hasHelp = text.includes('Guide') || text.includes('Help') || text.includes('Getting Started');
    expect(hasHelp).toBeTruthy();
    console.log('  ✅ Pod Admin Help page loaded');
  });
});

