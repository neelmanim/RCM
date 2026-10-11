// ── Lead Detail Hub — dual-view toggle E2E ───────────────────────────────────
// Verifies the new React Lead Detail page (opt-in via localStorage
// 'leadDetailHub') and the legacy vanilla page keep working side by side,
// exactly like the existing Leads Hub toggle. Run:
//   npx playwright test tests/lead-detail-hub.spec.js
const { test, expect } = require('@playwright/test');
const { loginAs, BASE_URL } = require('./helpers/auth');

const SUPER_ADMIN_EMAIL = 'neelmani.mishra@screen-magic.com';
const LEAD_ID = process.env.LEAD_ASSIGNED_ID || '';

async function goToLead(page, leadId) {
    await page.evaluate((id) => { window.location.hash = `#lead-detail/${id}`; }, leadId);
    await page.waitForTimeout(1500);
}

test.describe('Lead Detail Hub — dual view toggle', () => {
    test.skip(!LEAD_ID, 'LEAD_ASSIGNED_ID not set in .env.test');

    test('1. classic Lead Detail is the default view, with a link to try the new one', async ({ page, request }) => {
        await loginAs(page, request, SUPER_ADMIN_EMAIL);
        await page.evaluate(() => localStorage.removeItem('leadDetailHub'));
        await goToLead(page, LEAD_ID);

        // Classic-only markers.
        await expect(page.locator('.pipeline-v2-card, #log-call-btn, #add-note-btn').first()).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('Switch to the new experience')).toBeVisible();
    });

    test('2. toggling on renders the React Lead Detail Hub for the same lead', async ({ page, request }) => {
        await loginAs(page, request, SUPER_ADMIN_EMAIL);
        await page.evaluate(() => localStorage.removeItem('leadDetailHub'));
        await goToLead(page, LEAD_ID);

        await page.getByText('Switch to the new experience').click();
        await expect(page.locator('.leaddetailhub')).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('Next Action')).toBeVisible();
        await expect(page.getByText('Switch to classic view')).toBeVisible();

        // Persisted across a hash re-navigation to the same lead.
        await page.evaluate(() => { window.location.hash = '#dashboard'; });
        await page.waitForTimeout(800);
        await goToLead(page, LEAD_ID);
        await expect(page.locator('.leaddetailhub')).toBeVisible({ timeout: 15000 });
    });

    test('3. switching back to classic from the React page restores classic and clears the flag', async ({ page, request }) => {
        await loginAs(page, request, SUPER_ADMIN_EMAIL);
        await page.evaluate(() => localStorage.setItem('leadDetailHub', 'on'));
        await goToLead(page, LEAD_ID);
        await expect(page.locator('.leaddetailhub')).toBeVisible({ timeout: 15000 });

        await page.getByText('Switch to classic view').click();
        await expect(page.locator('.pipeline-v2-card, #log-call-btn, #add-note-btn').first()).toBeVisible({ timeout: 15000 });
        const flag = await page.evaluate(() => localStorage.getItem('leadDetailHub'));
        expect(flag).not.toBe('on');
    });

    test('4. the React Lead Detail Hub renders with no console errors', async ({ page, request }) => {
        const errors = [];
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        // Chromium's "Failed to load resource" console message never
        // includes the URL, so a real failure can only be told apart from
        // known pre-existing noise via the network response itself.
        const unexpectedFailures = [];
        page.on('response', (res) => {
            if (res.status() < 400) return;
            const url = res.url();
            // Pre-existing global app-shell polling — 401s on every page load
            // regardless of view (confirmed by reproducing on the classic
            // page too), not something this feature introduces.
            if (url.includes('/api/calls/my-active') || url.includes('/api/conversations/status')) return;
            unexpectedFailures.push(`${res.status()} ${url}`);
        });

        await loginAs(page, request, SUPER_ADMIN_EMAIL);
        await page.evaluate(() => localStorage.setItem('leadDetailHub', 'on'));
        await goToLead(page, LEAD_ID);
        await expect(page.locator('.leaddetailhub')).toBeVisible({ timeout: 15000 });
        await page.waitForTimeout(1500); // let the parallel Priority-2 fetches settle

        expect(unexpectedFailures).toHaveLength(0);
        const nonNetworkErrors = errors.filter((e) => !e.includes('favicon') && !e.includes('Failed to load resource'));
        expect(nonNetworkErrors).toHaveLength(0);
    });

    test('5. prev/next lead navigation works from the React page', async ({ page, request }) => {
        await loginAs(page, request, SUPER_ADMIN_EMAIL);
        // Seed a real nav queue the way the classic Leads table does, by
        // visiting the Leads list first, then jump into the toggled lead.
        // Waits for the table to actually finish rendering (not a fixed
        // timeout) — app.js's hashchange listener ignores a second hash
        // change while the first loadView() call is still in flight
        // (_skipHashUpdate guard), so navigating away too early silently
        // drops the second navigation.
        await page.evaluate(() => { window.location.hash = '#leads'; });
        await page.waitForSelector('.leads-tab.active', { timeout: 20000 });
        await page.waitForTimeout(500);
        await page.evaluate(() => localStorage.setItem('leadDetailHub', 'on'));
        await goToLead(page, LEAD_ID);
        await expect(page.locator('.leaddetailhub')).toBeVisible({ timeout: 15000 });

        // Position indicator only renders once a nav queue is populated —
        // this just confirms it doesn't crash whether or not one exists.
        const nextBtn = page.getByRole('button', { name: 'Next lead' });
        if (await nextBtn.count() > 0 && await nextBtn.isEnabled()) {
            await nextBtn.click();
            await page.waitForTimeout(1000);
            await expect(page.locator('.leaddetailhub')).toBeVisible();
        }
    });

    test('6. Super Admin sees a populated assignment-change control in the header (v11.6.4, rebuilt v11.6.6 as a searchable popover)', async ({ page, request }) => {
        await loginAs(page, request, SUPER_ADMIN_EMAIL);
        await page.evaluate(() => localStorage.setItem('leadDetailHub', 'on'));
        await goToLead(page, LEAD_ID);
        await expect(page.locator('.leaddetailhub')).toBeVisible({ timeout: 15000 });

        // Non-mutating check only — this hits the real staging assignment
        // endpoints on selection, so we verify the control renders and is
        // populated without actually submitting a reassignment against a
        // shared fixture lead. v11.6.6 replaced the bare native <select>
        // (unstyled, ran off-screen with 20+ names) with the same searchable
        // popover convention as the Leads Hub table (InlineSelectCell).
        const trigger = page.getByRole('button', { name: 'Change lead assignment' });
        await expect(trigger).toBeVisible({ timeout: 10000 });
        await trigger.click();
        await expect(page.getByRole('listbox')).toBeVisible({ timeout: 5000 });
        await expect
            .poll(async () => (await page.getByRole('option').count()), { timeout: 10000 })
            .toBeGreaterThan(1);
        await page.keyboard.press('Escape');
    });

    test('7. the full-page shell shows a skeleton, not plain "Loading…" text, while the lead fetch is in flight (v11.6.4)', async ({ page, request }) => {
        await loginAs(page, request, SUPER_ADMIN_EMAIL);
        await page.evaluate(() => localStorage.setItem('leadDetailHub', 'on'));

        // Delay the lead-detail fetch so the loading state is observable.
        await page.route('**/api/leads/*', async (route) => {
            await new Promise((r) => setTimeout(r, 2000));
            await route.continue();
        });

        await goToLead(page, LEAD_ID);
        await expect(page.locator('.animate-pulse').first()).toBeVisible({ timeout: 3000 });
        await expect(page.getByText('Loading lead')).toHaveCount(0);

        await page.unroute('**/api/leads/*');
        await expect(page.locator('.leaddetailhub')).toBeVisible({ timeout: 15000 });
    });

    // RCA 2026-08-26: Delete Lead used a bare window.confirm() (a plain
    // browser dialog, not styled like the rest of the app) and Mark Opted
    // Out had no confirmation step at all. Both now route through the same
    // in-page ConfirmDialog the Leads Hub already uses for bulk delete.
    test('8. Delete Lead opens an in-page confirm modal, not a bare browser confirm() (v11.6.6)', async ({ page, request }) => {
        await loginAs(page, request, SUPER_ADMIN_EMAIL);
        await page.evaluate(() => localStorage.setItem('leadDetailHub', 'on'));
        await goToLead(page, LEAD_ID);
        await expect(page.locator('.leaddetailhub')).toBeVisible({ timeout: 15000 });

        let nativeDialogFired = false;
        page.on('dialog', () => { nativeDialogFired = true; });

        await page.getByText('Delete Lead').click();
        // Scoped by name — the always-mounted Aircall drawer is also
        // role="dialog" (aria-hidden="false" even collapsed), so a bare
        // getByRole('dialog') matches both and fails strict mode.
        const dialog = page.getByRole('dialog', { name: 'Delete Lead' });
        await expect(dialog).toBeVisible({ timeout: 5000 });
        await expect(dialog.getByText(/Delete .*\?/)).toBeVisible();
        expect(nativeDialogFired).toBe(false);

        // Non-mutating: cancel instead of confirming, so the shared fixture lead survives.
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).not.toBeVisible();
    });

    test('9. Mark Opted Out now requires confirmation via the same in-page modal (v11.6.6)', async ({ page, request }) => {
        await loginAs(page, request, SUPER_ADMIN_EMAIL);
        await page.evaluate(() => localStorage.setItem('leadDetailHub', 'on'));
        await goToLead(page, LEAD_ID);
        await expect(page.locator('.leaddetailhub')).toBeVisible({ timeout: 15000 });

        await page.getByText('Mark Opted Out').first().click();
        // Scoped by name — see test 8's comment (Aircall drawer is also role="dialog").
        const dialog = page.getByRole('dialog', { name: 'Mark Opted Out' });
        await expect(dialog).toBeVisible({ timeout: 5000 });
        await expect(dialog.getByText(/as opted out\?/)).toBeVisible();

        // Non-mutating: cancel instead of confirming, so the shared fixture lead survives.
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).not.toBeVisible();
    });

    test('10. Send Email opens a native compose form instead of switching to classic view (v11.6.6)', async ({ page, request }) => {
        await loginAs(page, request, SUPER_ADMIN_EMAIL);
        await page.evaluate(() => localStorage.setItem('leadDetailHub', 'on'));
        await goToLead(page, LEAD_ID);
        await expect(page.locator('.leaddetailhub')).toBeVisible({ timeout: 15000 });

        await page.getByText('Send Email').click();
        await expect(page.getByPlaceholder('Subject')).toBeVisible({ timeout: 5000 });
        // Still on the React hub — not redirected to the classic page.
        await expect(page.locator('.leaddetailhub')).toBeVisible();
    });
});
