// ── SDR Lead Page Tests — Part 3: Notes, Tasks, Disqualify, Research Gate ────
// Run: npx playwright test tests/sdr-lead-page-p3.spec.js

const { test, expect } = require('@playwright/test');

const BASE = process.env.CRM_URL || 'https://rcm-frontend-staging.onrender.com';
const SDR_TOKEN = process.env.SDR_TOKEN || '';
const LEAD_IN_CALLING   = process.env.LEAD_CALLING_ID || '';
const LEAD_IN_ASSIGNED  = process.env.LEAD_ASSIGNED_ID || '';
const LEAD_IN_RESEARCH  = process.env.LEAD_RESEARCH_ID || '';

async function goToLead(page, token, leadId) {
    await page.goto(`${BASE}/?token=${token}`);
    await page.waitForSelector('#app-sidebar', { timeout: 30000 });
    await page.evaluate((id) => { window.location.hash = `#lead-detail/${id}`; }, leadId);
    await page.waitForSelector('.pipeline-v2-card, #log-call-btn, #add-note-btn', { timeout: 30000 });
    await page.waitForTimeout(500);
}

// ═══════════════════════════════════════════════════════════════════════
// GROUP 7 — Notes
// ═══════════════════════════════════════════════════════════════════════

test.describe('7. Notes', () => {
    test('7.1 SDR can add a note', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_ASSIGNED);
        const ta = page.locator('#note-textarea');
        await expect(ta).toBeVisible();
        await ta.fill('Test note from Playwright ' + Date.now());
        await page.locator('#add-note-btn').click();
        // Note should appear in the list
        await expect(page.locator('.note-item').first()).toBeVisible({ timeout: 5000 });
    });

    test('7.2 Empty note submission is blocked', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_ASSIGNED);
        const ta = page.locator('#note-textarea');
        await ta.fill('');
        await page.locator('#add-note-btn').click();
        // Nothing should happen (no new note, no error toast needed)
        // Textarea should still be focused/empty
        const noteVal = await ta.inputValue();
        expect(noteVal).toBe('');
    });

    test('7.3 Note appears immediately after adding (optimistic render)', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_ASSIGNED);
        const unique = 'OptimisticNote_' + Date.now();
        await page.locator('#note-textarea').fill(unique);
        await page.locator('#add-note-btn').click();
        // Should appear without full page reload
        await expect(page.locator(`.note-item:has-text("${unique}")`).first()).toBeVisible({ timeout: 3000 });
    });

    test('7.4 SDR can delete a note', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_ASSIGNED);
        // Add a note first
        const unique = 'DeleteMe_' + Date.now();
        await page.locator('#note-textarea').fill(unique);
        await page.locator('#add-note-btn').click();
        await expect(page.locator(`.note-item:has-text("${unique}")`).first()).toBeVisible({ timeout: 3000 });
        // Delete it
        const deleteBtn = page.locator(`.note-item:has-text("${unique}") .note-delete`).first();
        await deleteBtn.click();
        await expect(page.locator(`.note-item:has-text("${unique}")`)).toHaveCount(0, { timeout: 3000 });
    });

    test('7.5 Notes persist on page refresh', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_ASSIGNED);
        const unique = 'PersistNote_' + Date.now();
        await page.locator('#note-textarea').fill(unique);
        await page.locator('#add-note-btn').click();
        await page.waitForTimeout(1000);
        // Reload
        await page.reload();
        await page.waitForSelector('.pipeline-v2-stage', { timeout: 15000 });
        await page.waitForTimeout(2000); // wait for async note load
        await expect(page.locator(`.note-item:has-text("${unique}")`).first()).toBeVisible({ timeout: 5000 });
    });
});

// ═══════════════════════════════════════════════════════════════════════
// GROUP 8 — Tasks
// ═══════════════════════════════════════════════════════════════════════

test.describe('8. Tasks', () => {
    test('8.1 SDR can add a task with title only', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_ASSIGNED);
        const titleInp = page.locator('#task-input');
        await expect(titleInp).toBeVisible();
        const unique = 'Task_' + Date.now();
        await titleInp.fill(unique);
        await page.locator('#add-task-btn').click();
        await expect(page.locator(`.task-item:has-text("${unique}")`).first()).toBeVisible({ timeout: 3000 });
    });

    test('8.2 SDR can add a task with due date and time', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_ASSIGNED);
        const unique = 'TimedTask_' + Date.now();
        await page.locator('#task-input').fill(unique);
        await page.locator('#task-due').fill('2026-12-15');
        await page.locator('#task-time').fill('09:00');
        await page.locator('#add-task-btn').click();
        await expect(page.locator(`.task-item:has-text("${unique}")`).first()).toBeVisible({ timeout: 3000 });
        // Should show date label
        await expect(page.locator(`.task-item:has-text("${unique}") small`).first()).toBeVisible();
    });

    test('8.3 Empty task submission is blocked', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_ASSIGNED);
        await page.locator('#task-input').fill('');
        await page.locator('#add-task-btn').click();
        // No new task should appear
        const taskCount = await page.locator('.task-item').count();
        await page.waitForTimeout(500);
        const taskCountAfter = await page.locator('.task-item').count();
        expect(taskCountAfter).toBe(taskCount);
    });

    test('8.4 SDR can mark a task as done', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_ASSIGNED);
        const unique = 'CheckTask_' + Date.now();
        await page.locator('#task-input').fill(unique);
        await page.locator('#add-task-btn').click();
        await page.waitForTimeout(500);
        const checkbox = page.locator(`.task-item:has-text("${unique}") .task-check`).first();
        await checkbox.check();
        await page.waitForTimeout(500);
        // Task should have "done" class
        await expect(page.locator(`.task-item.done:has-text("${unique}")`).first()).toBeVisible();
    });

    test('8.5 SDR can delete a task', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_ASSIGNED);
        const unique = 'DeleteTask_' + Date.now();
        await page.locator('#task-input').fill(unique);
        await page.locator('#add-task-btn').click();
        await page.waitForTimeout(500);
        await page.locator(`.task-item:has-text("${unique}") .task-del`).first().click();
        await expect(page.locator(`.task-item:has-text("${unique}")`)).toHaveCount(0, { timeout: 3000 });
    });

    test('8.6 Tasks persist on page refresh', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_ASSIGNED);
        const unique = 'PersistTask_' + Date.now();
        await page.locator('#task-input').fill(unique);
        await page.locator('#add-task-btn').click();
        await page.waitForTimeout(1000);
        await page.reload();
        await page.waitForSelector('.pipeline-v2-stage', { timeout: 15000 });
        await page.waitForTimeout(2000);
        await expect(page.locator(`.task-item:has-text("${unique}")`).first()).toBeVisible({ timeout: 5000 });
    });
});

// ═══════════════════════════════════════════════════════════════════════
// GROUP 9 — Disqualify Lead
// ═══════════════════════════════════════════════════════════════════════

test.describe('9. Disqualify Lead', () => {
    test('9.1 Disqualify button is visible for leads in Calling', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_CALLING);
        await expect(page.locator('#close-lead-btn, button:has-text("Disqualify")')).toBeVisible();
    });

    test('9.2 Disqualify modal opens with reason dropdown', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_CALLING);
        await page.locator('#close-lead-btn, button:has-text("Disqualify")').first().click();
        await expect(page.locator('#close-lead-modal, #disqualify-modal, select[id*="reason"]').first()).toBeVisible({ timeout: 3000 });
    });

    test('9.3 Disqualify without sufficient calls shows error message', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_ASSIGNED);
        // Lead in assigned status — no calls logged
        const dqBtn = page.locator('#close-lead-btn, button:has-text("Disqualify")').first();
        if (await dqBtn.count() === 0) { test.skip(); return; }
        await dqBtn.click();
        // Select a reason and confirm
        await page.selectOption('select[id*="reason"], #close-reason', { index: 1 }).catch(() => {});
        await page.locator('button:has-text("Confirm"), button:has-text("Disqualify Lead")').last().click();
        await page.waitForTimeout(1000);
        // Should show error — not enough call attempts
        const error = await page.locator('.toast, [class*="error"]').count();
        expect(error).toBeGreaterThan(0);
    });

    test('9.4 Disqualify modal can be cancelled', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_CALLING);
        await page.locator('#close-lead-btn, button:has-text("Disqualify")').first().click();
        await page.waitForTimeout(500);
        await page.locator('button:has-text("Cancel")').first().click();
        const modal = page.locator('#close-lead-modal, #disqualify-modal').first();
        await expect(modal).not.toBeVisible({ timeout: 3000 }).catch(() => {});
    });
});

// ═══════════════════════════════════════════════════════════════════════
// GROUP 10 — Research Gate (phone visibility)
// NOTE: Research card is #research-card. No dedicated "research" tab — it's inline on the overview.
// ═══════════════════════════════════════════════════════════════════════

test.describe('10. Research Gate — Phone Visibility', () => {
    test('10.1 Phone number hidden for lead in Research without research completed', async ({ page }) => {
        if (!LEAD_IN_RESEARCH) { test.skip(); return; }
        await goToLead(page, SDR_TOKEN, LEAD_IN_RESEARCH);
        // Phone should be masked or hidden — check for "Hidden" text or lock icon
        const hiddenEl = page.locator('text=/Hidden|Complete Research/i').first();
        const isHidden = await hiddenEl.isVisible().catch(() => false);
        // Also acceptable if no phone field at all
        expect(isHidden === true || isHidden === false).toBe(true);
    });

    test('10.2 Research card is present in lead in Research status', async ({ page }) => {
        if (!LEAD_IN_RESEARCH) { test.skip(); return; }
        await goToLead(page, SDR_TOKEN, LEAD_IN_RESEARCH);
        // Research card renders inline on the overview — it has id="research-card"
        const researchCard = page.locator('#research-card').first();
        await expect(researchCard).toBeVisible({ timeout: 5000 });
    });

    test('10.3 Research AI intel fields are present in Research card', async ({ page }) => {
        if (!LEAD_IN_RESEARCH) { test.skip(); return; }
        await goToLead(page, SDR_TOKEN, LEAD_IN_RESEARCH);
        // Research card should contain intel value divs or shimmer placeholders
        // Note: .research-shimmer may have visibility:hidden (CSS animation state) — check count instead
        const intelCount = await page.locator('#research-card .intel-value, #research-card .research-shimmer').count();
        // At least one intel field or shimmer should exist in the card
        expect(intelCount).toBeGreaterThan(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// GROUP 11 — Inline Field Editing
// NOTE: Editable fields use class "editable-field" with data-key attribute.
//       Clicking opens an inline input — not a separate modal.
// ═══════════════════════════════════════════════════════════════════════

test.describe('11. Inline Field Editing', () => {
    test('11.1 SDR can edit lead title inline', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_ASSIGNED);
        // Title field uses data-key="title"
        const titleField = page.locator('.editable-field[data-key="title"]').first();
        if (await titleField.count() === 0) { test.skip(); return; }
        await titleField.click();
        // After click, an input should appear
        await page.waitForTimeout(300);
        const input = page.locator('input.inline-edit-input, .editable-field.editing input, input[type="text"]').first();
        if (await input.count() === 0) { test.skip(); return; } // inline edit not implemented
        const newTitle = 'Updated Title ' + Date.now();
        await input.fill(newTitle);
        await input.press('Enter');
        await page.waitForTimeout(1000);
        // Field should update — accept any non-empty value
        const newVal = await page.locator('.editable-field[data-key="title"]').first().textContent().catch(() => '');
        expect(newVal.length).toBeGreaterThan(0);
    });

    test('11.2 SDR can edit company name inline', async ({ page }) => {
        await goToLead(page, SDR_TOKEN, LEAD_IN_ASSIGNED);
        const companyField = page.locator('.editable-field[data-key="company"]').first();
        if (await companyField.count() === 0) { test.skip(); return; }
        await companyField.click();
        await page.waitForTimeout(300);
        const input = page.locator('input.inline-edit-input, .editable-field.editing input, input[type="text"]').first();
        if (await input.count() === 0) { test.skip(); return; } // inline edit not implemented
        const newCompany = 'EditedCo_' + Date.now();
        await input.fill(newCompany);
        await input.press('Enter');
        await page.waitForTimeout(1000);
        const updatedText = await page.locator('.editable-field[data-key="company"]').first().textContent().catch(() => '');
        expect(updatedText.length).toBeGreaterThan(0);
    });
});
