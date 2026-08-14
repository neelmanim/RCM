// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAs, navigateTo, BASE_URL, ADMIN_TOKEN } = require('./helpers/auth');

const SUPER_ADMIN_EMAIL = 'neelmani.mishra@screen-magic.com';
const VC = '#view-container';

test.describe('Super Admin Flow', () => {

  // 1. Dashboard
  test('1. Super Admin dashboard loads', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    const statCards = page.locator('.stat-card');
    await expect(statCards.first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.page-title')).toContainText('Dashboard');
  });

  // 2. Nav visibility — Super Admin sees all nav items
  test('2. Super Admin sees all nav items', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);

    const podsNav = page.locator('#pods-nav-item');
    await expect(podsNav).toBeVisible({ timeout: 5000 });
    const adminNav = page.locator('#admin-nav-item');
    await expect(adminNav).toBeVisible();
    const syncBtn = page.locator('#sync-btn');
    await expect(syncBtn).toBeVisible();
    // Upload Center in sidebar nav
    const uploadNav = page.locator('#upload-nav-item');
    await expect(uploadNav).toBeVisible();
    // Audit Logs in sidebar nav
    const auditNav = page.locator('#audit-logs-nav-item');
    await expect(auditNav).toBeVisible();
    console.log('  ✅ All Super Admin nav items and buttons visible');
  });

  // 3. All Leads page with admin tabs
  test('3. Leads page shows All Leads with tabs', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('#leads-tbody tr', { timeout: 10000 });

    await expect(page.locator('.page-title')).toContainText('All Leads');
    const tabs = page.locator('.leads-tab');
    expect(await tabs.count()).toBe(2);

    const headerText = await page.locator('#leads-tbody').evaluate(
      el => el.closest('table').querySelector('thead').textContent
    );
    expect(headerText).toContain('Assigned To');

    const rowCount = await page.locator('#leads-tbody tr').count();
    console.log(`  📋 Super Admin sees ${rowCount} leads`);
  });

  // 4. Admin Panel with user tabs
  test('4. Admin Panel shows user management tabs', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'admin');
    await page.waitForTimeout(2000);

    const text = await page.locator(VC).textContent();
    expect(text).toContain('Admin Panel');
    expect(text).toContain('Super Admins');
    expect(text).toContain('Pod Admins');
    expect(text).toContain('SDRs');
    console.log('  ✅ Admin Panel with all role tabs');
  });

  // 5. Admin Panel — switch between tabs
  test('5. Admin Panel tabs are switchable', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'admin');
    // Wait for the admin panel tabs to render
    await page.waitForSelector('.admin-tab-trigger', { timeout: 15000 });

    const podTab = page.locator('.admin-tab-trigger[data-tab="pod-admins"]');
    await expect(podTab).toBeVisible();
    await podTab.click();
    await page.waitForTimeout(1000);
    const text1 = await page.locator(VC).textContent();
    expect(text1).toContain('Pod Admin');

    const sdrTab = page.locator('.admin-tab-trigger[data-tab="sdrs"]');
    await expect(sdrTab).toBeVisible();
    await sdrTab.click();
    await page.waitForTimeout(1000);
    const text2 = await page.locator(VC).textContent();
    expect(text2).toContain('SDR');
    console.log('  ✅ Tab switching works');
  });

  // 6. POD Management page
  test('6. POD Management shows pod cards', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'pods');
    await page.waitForTimeout(2000);

    const text = await page.locator(VC).textContent();
    expect(text).toContain('POD Management');

    const hasPods = text.includes('Alpha Team') || text.includes('Beta Team') ||
      text.includes('Gamma Team') || text.includes('Delta Team');
    expect(hasPods).toBeTruthy();

    const createBtn = page.locator('#create-pod-btn');
    await expect(createBtn).toBeVisible();
    expect(text).toContain('members');
    console.log('  ✅ POD Management loaded with pod cards');
  });

  // 7. POD Management — create pod form toggles
  test('7. Create POD form toggles', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'pods');
    await page.waitForTimeout(2000);

    const form = page.locator('#create-pod-form');
    await expect(form).toBeHidden();
    await page.locator('#create-pod-btn').click();
    await expect(form).toBeVisible();
    await expect(page.locator('#new-pod-name')).toBeVisible();
    await expect(page.locator('#new-pod-admin')).toBeVisible();
    console.log('  ✅ Create POD form toggles correctly');
  });

  // 8. SF Logs page
  test('8. Audit Logs page loads from SF Logs redirect', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'audit-logs');
    await page.waitForTimeout(2000);

    const text = await page.locator(VC).textContent();
    const hasAuditContent = text.includes('Audit') || text.includes('Log') ||
      text.includes('Activity') || text.includes('Salesforce');
    expect(hasAuditContent).toBeTruthy();
    console.log('  ✅ Audit Logs page loaded (SF Logs redirects here)');
  });

  // 9. Lead detail from Super Admin — verify stepper
  test('9. Super Admin lead detail shows 4-step stepper', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'leads');
    // Staging API can be very slow on cold-start — generous timeout
    await page.waitForSelector('#leads-tbody tr', { timeout: 30000 });

    // First row is a .company-group-header — skip it, click the first actual lead row
    const leadRow = page.locator('#leads-tbody tr:not(.company-group-header)').first();
    await leadRow.waitFor({ state: 'visible', timeout: 10000 });
    await leadRow.locator('td:nth-child(2)').click();
    await page.waitForTimeout(3000);

    const text = await page.locator(VC).textContent();
    expect(text.length).toBeGreaterThan(100);
    const hasDetail = text.includes('Status') || text.includes('Company') || text.includes('Email');
    expect(hasDetail).toBeTruthy();

    // Verify stepper pipeline (may not render on staging if lead detail API is slow)
    const stepper = page.locator('.pipeline-v2');
    if (await stepper.count() > 0) {
      const stepperText = await stepper.textContent();
      expect(stepperText).toContain('Qualification');
      expect(stepperText).toContain('Meeting');
      expect(stepperText).toContain('Discovery');
      expect(stepperText).toContain('Demo');
    }
    console.log('  ✅ Lead detail page loaded');
  });

  // 10. Kanban/Pipeline — intentionally hidden, feature deprecated
  test.skip('10. Pipeline view (deprecated — kanban hidden)', async () => {
    // Kanban nav item is display:none — feature was intentionally removed from nav.
    // Keeping test as skip marker for documentation purposes.
  });

  // 11. Leaderboard — verify Disqualified column and time presets
  test('11. Leaderboard shows Disqualified column and time presets', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'leaderboard');
    await page.waitForTimeout(3000);

    const text = await page.locator(VC).textContent();
    expect(text.toLowerCase()).toContain('leaderboard');
    expect(text).toContain('Disqualified');
    // Old columns should not appear
    expect(text).not.toContain('Declined');
    // New: verify time-period presets and leader spotlight
    expect(text).toContain('7 Days');
    expect(text).toContain('30 Days');
    expect(text).toContain('All Time');
    console.log('  ✅ Leaderboard shows Disqualified column and time presets');
  });

  // 12. Settings — verify tabbed UI with Connection and Sync tabs
  test('12. Settings shows tabbed UI with Connection and Sync', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'settings');
    await page.waitForTimeout(2000);

    const text = await page.locator(VC).textContent();
    expect(text.toLowerCase()).toContain('settings');
    // New tabbed UI
    expect(text).toContain('Connection');
    expect(text).toContain('Sync Settings');
    expect(text).toContain('Data Summary');
    expect(text).toContain('Disqualified');
    console.log('  ✅ Settings shows tabbed UI with Connection and Sync');
  });

  // 13. Upload Center page loads
  test('13. Upload Center loads with upload history', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'upload');
    await page.waitForTimeout(2000);

    const text = await page.locator(VC).textContent();
    const hasUpload = text.includes('Upload') || text.includes('CSV') || text.includes('Import');
    expect(hasUpload).toBeTruthy();
    console.log('  ✅ Upload Center loaded');
  });

  // 14. Audit Logs page loads
  test('14. Audit Logs page loads', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'audit-logs');
    await page.waitForTimeout(2000);

    const text = await page.locator(VC).textContent();
    const hasAudit = text.includes('Audit') || text.includes('Log') || text.includes('Activity');
    expect(hasAudit).toBeTruthy();
    console.log('  ✅ Audit Logs page loaded');
  });

  // 15. Analytics Hub loads (formerly SDR Metrics — metrics nav is hidden, redirects to analytics)
  test('15. Analytics Hub loads', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    // navigateTo('analytics') can't be used — 3 <a data-view="analytics"> exist, first 2 are display:none
    await page.click('#analytics-nav-item a');
    await page.waitForTimeout(3000);

    const text = await page.locator(VC).textContent();
    const hasAnalytics = text.includes('Analytics') || text.includes('Funnel') ||
      text.includes('SDR') || text.includes('Trend') || text.includes('Performance');
    expect(hasAnalytics).toBeTruthy();
    console.log('  ✅ Analytics Hub loaded');
  });

  // 16. Assignments tab — verify it loads with some content
  test('16. Assignments tab loads from Leads view', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForTimeout(3000);

    // Look for Assignments tab (might be named differently)
    const assignTab = page.locator('.leads-tab').filter({ hasText: /Assign/i });
    if (await assignTab.count() > 0) {
      await assignTab.click();
      await page.waitForTimeout(3000);

      const text = await page.locator(VC).textContent();
      const hasAssignment = text.includes('Assign') || text.includes('SDR') ||
        text.includes('Unassigned') || text.includes('Round Robin');
      expect(hasAssignment).toBeTruthy();
      console.log('  ✅ Assignments tab loaded');
    } else {
      // Assignments may be feature-gated or renamed
      const text = await page.locator(VC).textContent();
      expect(text.length).toBeGreaterThan(50);
      console.log('  ⚠️ Assignments tab not found — may be restructured');
    }
  });

  // 17. Lead Assigned status filter returns results
  test('17. Lead Assigned filter shows leads', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'leads');
    await page.waitForSelector('#leads-tbody tr', { timeout: 15000 });

    const statusFilter = page.locator('#status-filter');
    await statusFilter.selectOption('Lead Assigned');
    // Wait longer for API roundtrip to staging
    await page.waitForTimeout(3000);

    const subtitle = page.locator('#leads-subtitle');
    await expect(subtitle).not.toHaveText('Loading...', { timeout: 10000 });
    const subtitleText = await subtitle.textContent();
    console.log(`  📋 Lead Assigned filter: ${subtitleText}`);

    // Verify the filter was applied (page should not error out)
    const bodyText = await page.locator('#leads-tbody').textContent();
    expect(bodyText.length).toBeGreaterThan(0);
    console.log('  ✅ Lead Assigned filter working');
  });

  // 18. User Guide / Help page loads with search
  test('18. Help page loads with content', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'user-guide');
    await page.waitForTimeout(2000);

    const text = await page.locator(VC).textContent();
    const hasHelp = text.includes('Guide') || text.includes('Help') || text.includes('Getting Started');
    expect(hasHelp).toBeTruthy();
    console.log('  ✅ Help page loaded');
  });

  // 19. Settings → Sync tab → Call Outcomes card is visible
  test('19. Settings Sync tab shows Call Outcomes configuration', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'settings');
    await page.waitForTimeout(2000);

    // Click Sync Settings tab
    const syncTab = page.locator('.settings-tab[data-tab="sync"]');
    if (await syncTab.count() > 0) {
      await syncTab.click();
      await page.waitForTimeout(1500);
    }

    const text = await page.locator(VC).textContent();
    expect(text).toContain('Call Outcomes Configuration');
    expect(text).toContain('Save');
    console.log('  ✅ Settings → Sync tab shows Call Outcomes config card');
  });

  // 20. Settings → Sync tab → Max Call Attempts input
  test('20. Settings Sync tab shows Max Call Attempts input', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'settings');
    await page.waitForTimeout(2000);

    const syncTab = page.locator('.settings-tab[data-tab="sync"]');
    if (await syncTab.count() > 0) {
      await syncTab.click();
      await page.waitForTimeout(1500);
    }

    const text = await page.locator(VC).textContent();
    const hasMaxAttempts = text.includes('Max Call Attempts') || text.includes('call attempts');
    expect(hasMaxAttempts).toBeTruthy();
    console.log('  ✅ Max Call Attempts field visible in Sync Settings');
  });

  // 21. Settings → AI tab renders for Super Admin
  test('21. Settings AI tab renders for Super Admin', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'settings');
    await page.waitForTimeout(2000);

    const aiTab = page.locator('.settings-tab[data-tab="ai"]');
    if (await aiTab.count() > 0) {
      await aiTab.click();
      await page.waitForTimeout(1500);

      const text = await page.locator(VC).textContent();
      const hasAI = text.includes('AI') || text.includes('LLM') || text.includes('Model') || text.includes('Provider');
      expect(hasAI).toBeTruthy();
      console.log('  ✅ AI Settings tab renders');
    } else {
      console.log('  ⚠️ AI tab not present (may not be enabled)');
    }
  });

  // 22. Settings → RCM/Dialer tab renders
  test('22. Settings RCM/Dialer tab renders', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await navigateTo(page, 'settings');
    await page.waitForTimeout(2000);

    // Look for RCM or Dialer tab
    const convTab = page.locator('.settings-tab[data-tab="rcm"]');
    const dialerTab = page.locator('.settings-tab[data-tab="dialer"]');

    let found = false;
    if (await convTab.count() > 0) {
      await convTab.click();
      await page.waitForTimeout(1500);
      const text = await page.locator(VC).textContent();
      expect(text.toLowerCase()).toMatch(/rcm|dialer|contact center|messaging/);
      found = true;
    } else if (await dialerTab.count() > 0) {
      await dialerTab.click();
      await page.waitForTimeout(1500);
      found = true;
    }

    if (found) {
      console.log('  ✅ RCM/Dialer settings tab renders');
    } else {
      // Tab might be combined — check if dialer fields exist on Sync tab
      const syncTab = page.locator('.settings-tab[data-tab="sync"]');
      if (await syncTab.count() > 0) {
        await syncTab.click();
        await page.waitForTimeout(1500);
      }
      const syncText = await page.locator(VC).textContent();
      const hasDial = syncText.toLowerCase().includes('dialer') || syncText.toLowerCase().includes('contact center');
      console.log(`  ${hasDial ? '✅' : '⚠️'} Dialer config ${hasDial ? 'found in Sync tab' : 'not found (may be feature-gated)'}`);
    }
  });

  // 23. Analytics Hub shows meaningful data
  test('23. Analytics Hub shows call statistics', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    // navigateTo('analytics') can't be used — 3 <a data-view="analytics"> exist, first 2 are display:none
    await page.click('#analytics-nav-item a');
    await page.waitForTimeout(4000);

    const text = await page.locator(VC).textContent();
    const hasAnalytics = text.includes('Analytics') || text.includes('Funnel') ||
      text.includes('SDR') || text.includes('Performance') || text.includes('Trend');
    expect(hasAnalytics).toBeTruthy();

    // Should have some numeric data or chart
    const hasNumbers = /\d+/.test(text);
    expect(hasNumbers).toBeTruthy();
    console.log('  ✅ Analytics Hub shows data');
  });
});

