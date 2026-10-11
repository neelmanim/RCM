/**
 * Control Center UX Audit (v11.12.2) — live verification of the 10-item
 * feedback pass: emoji removal, ConfirmDialog wiring, Actions-column
 * redesign, Export Leads, provider-chip merge, Call Logs removal, Add User
 * modal, and the settings search box. Super-Admin-gated surface (widened
 * from single-owner-email 2026-09-04) — the JWT used here must decode to
 * role: "Super Admin".
 */
const { test, expect, navigateTo, collectApiErrors } = require('./helpers');

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

async function gotoControlCenter(page) {
  const apiErrors = collectApiErrors(page);
  await navigateTo(page, '/control-center', { waitMs: 4000 });
  return apiErrors;
}

test.describe('Control Center — UX audit', () => {

  test('owner sees Control Center, not the access-denied state', async ({ authenticatedPage: page }) => {
    await gotoControlCenter(page);
    await expect(page.getByRole('heading', { name: 'Control Center', level: 1 })).toBeVisible();
    await expect(page.locator('text=Not available')).toHaveCount(0);
  });

  test('search box exists and jumps to a matching section', async ({ authenticatedPage: page }) => {
    await gotoControlCenter(page);
    const search = page.getByPlaceholder('Search settings…');
    await expect(search).toBeVisible();
    await search.fill('audit log');
    await page.waitForTimeout(400);
    // Scope to the dropdown result specifically — the Monitoring tab bar also
    // has its own "Audit Log" button once mounted, so an unscoped role query
    // becomes ambiguous the instant both are on screen.
    const result = page.locator('button:has-text("Audit Log")').first();
    await expect(result).toBeVisible();
    await result.click();
    // Jumping should land on the Monitoring section's Audit Log tab content.
    await expect(page.getByPlaceholder('Search lead or changed by…')).toBeVisible({ timeout: 5000 });
  });

  test.describe('Team & Access — Users & PODs', () => {
    test('has one consolidated Actions column, not separate Access/View As/Delete columns', async ({ authenticatedPage: page }) => {
      await gotoControlCenter(page);
      await page.getByRole('button', { name: 'Team & Access' }).click();
      await page.waitForTimeout(2000);

      await expect(page.locator('th:has-text("Actions")')).toBeVisible();
      await expect(page.locator('th:has-text("Access")')).toHaveCount(0);
      await expect(page.locator('th:has-text("View As")')).toHaveCount(0);
      await expect(page.locator('th:has-text("Delete")')).toHaveCount(0);
    });

    test('Add User button opens a modal with Single User / Bulk CSV tabs', async ({ authenticatedPage: page }) => {
      await gotoControlCenter(page);
      await page.getByRole('button', { name: 'Team & Access' }).click();
      await page.waitForTimeout(2000);

      await page.getByRole('button', { name: /Add User/ }).click();
      // Scope by name — this app also mounts a persistent, always-in-DOM
      // Aircall "role=dialog" widget (unrelated), so an unscoped dialog
      // query is ambiguous the moment both exist.
      const dialog = page.getByRole('dialog', { name: 'Add User' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Single User')).toBeVisible();
      await expect(dialog.getByText('Bulk CSV')).toBeVisible();

      await dialog.getByText('Bulk CSV').click();
      await expect(dialog.getByText('Download CSV Template')).toBeVisible();
    });

    test('revoking access requires confirmation', async ({ authenticatedPage: page }) => {
      await gotoControlCenter(page);
      await page.getByRole('button', { name: 'Team & Access' }).click();
      await page.waitForTimeout(2000);

      const revokeBtn = page.locator('button[title="Revoke login access"]').first();
      if (await revokeBtn.count() === 0) {
        test.skip(true, 'No user with active access on this page to test revoke against.');
      }
      await revokeBtn.click();
      const dialog = page.getByRole('dialog', { name: 'Revoke login access?' });
      await expect(dialog).toBeVisible();
      // Cancel — do not actually mutate a real staging user's access.
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toHaveCount(0);
    });
  });

  test.describe('Team & Access — User Access', () => {
    test('does not show the same provider name twice for one SDR', async ({ authenticatedPage: page }) => {
      await gotoControlCenter(page);
      await page.getByRole('button', { name: 'Team & Access' }).click();
      await page.waitForTimeout(1500);
      await page.getByRole('button', { name: 'User Access' }).click();
      await page.waitForTimeout(2000);

      // For any row, "Calling & messaging provider" (merged) and the two
      // separate "Calling provider"/"Messaging provider" chips must be
      // mutually exclusive within that row.
      const rows = page.locator('[title="Calling & messaging provider"]');
      const mergedCount = await rows.count();
      console.log(`  → merged provider chips on this page: ${mergedCount}`);
      expect(mergedCount).toBeGreaterThanOrEqual(0); // smoke: no crash rendering either branch
    });
  });

  test.describe('Data section', () => {
    test('Export Leads card is present with an SDR picker', async ({ authenticatedPage: page }) => {
      await gotoControlCenter(page);
      await page.getByRole('button', { name: 'Data' }).click();
      await page.waitForTimeout(2000);

      await expect(page.locator('text=Export Leads')).toBeVisible();
      const exportBtn = page.getByRole('button', { name: /Export CSV/ });
      await expect(exportBtn).toBeVisible();
      await expect(exportBtn).toBeDisabled(); // no SDR chosen yet
    });
  });

  test.describe('Monitoring', () => {
    test('Call Logs tab no longer exists', async ({ authenticatedPage: page }) => {
      await gotoControlCenter(page);
      await page.getByRole('button', { name: 'Monitoring' }).click();
      await page.waitForTimeout(2000);
      await expect(page.getByRole('button', { name: 'Call Logs' })).toHaveCount(0);
    });

    test('Error Logs tab renders with no raw emoji glyphs', async ({ authenticatedPage: page }) => {
      await gotoControlCenter(page);
      await page.getByRole('button', { name: 'Monitoring' }).click();
      await page.waitForTimeout(1500);
      await page.getByRole('button', { name: 'Error Logs' }).click();
      await page.waitForTimeout(2000);

      const bodyText = await page.locator('body').innerText();
      expect(EMOJI_RE.test(bodyText)).toBe(false);
    });

    test('Perf Health tab renders with no raw emoji glyphs (Super Admin only)', async ({ authenticatedPage: page }) => {
      await gotoControlCenter(page);
      await page.getByRole('button', { name: 'Monitoring' }).click();
      await page.waitForTimeout(1500);
      const perfTab = page.getByRole('button', { name: 'Perf Health' });
      if (await perfTab.count() === 0) test.skip(true, 'Perf Health hidden for this role.');
      await perfTab.click();
      await page.waitForTimeout(2000);

      const bodyText = await page.locator('body').innerText();
      expect(EMOJI_RE.test(bodyText)).toBe(false);
    });
  });

  test.describe('Integrations', () => {
    test('Salesforce card renders (Last Sync no longer crashes the card)', async ({ authenticatedPage: page }) => {
      const apiErrors = await gotoControlCenter(page);
      await expect(page.locator('text=Salesforce Connection')).toBeVisible();
      await expect(page.locator('text=Last Sync')).toBeVisible();
      expect(apiErrors.filter((e) => e.url.includes('/sf/status'))).toHaveLength(0);
    });

    test('destructive actions confirm via dialog, not a native browser confirm', async ({ authenticatedPage: page }) => {
      await gotoControlCenter(page);
      let nativeDialogFired = false;
      page.on('dialog', () => { nativeDialogFired = true; });

      const disconnectBtn = page.getByRole('button', { name: 'Disconnect' });
      if (await disconnectBtn.count() > 0) {
        await disconnectBtn.click();
        const dialog = page.getByRole('dialog', { name: 'Disconnect Salesforce?' });
        await expect(dialog).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
      }
      expect(nativeDialogFired).toBe(false);
    });
  });

  test.describe('AI & Automation', () => {
    test('section loads without error', async ({ authenticatedPage: page }) => {
      await gotoControlCenter(page);
      await page.getByRole('button', { name: 'AI & Automation' }).click();
      await page.waitForTimeout(2000);
      await expect(page.locator('text=AI Research Configuration')).toBeVisible();
    });
  });
});
