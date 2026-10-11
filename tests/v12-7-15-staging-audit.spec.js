// v12.7.15 staging audit — every area the release touched, as Super Admin and SDR.
// Tokens come from the environment only (never committed):
//   V_SA_TOKEN=... V_SDR_TOKEN=... npx playwright test tests/v12-7-15-staging-audit.spec.js
// Read-only except test 7, which reassigns one staging lead and restores it.
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API = process.env.API_BASE_URL || 'https://messenger-crm-staging.onrender.com';
const SA = process.env.V_SA_TOKEN || '';
const SDR = process.env.V_SDR_TOKEN || '';
const AE = process.env.V_AE_TOKEN || '';

// Staging fixtures (Dev Kapoor = the SDR token's user).
const SDR_CALLING_LEAD = '27ce0546-cd4c-4076-818a-b58249aecdd8';
const SDR_ASSIGNED_LEAD = '462404ae-71ba-4db1-a3a9-859fe20e7697';
const DEV_ID = '5635a809-52f3-44a2-b9f3-c5f2118f049b';
const KARAN_ID = '1bb36457-0942-4964-bd42-32b50e65137f';
const MEETING_LEAD = '0820f8c7-9a2b-4f21-8d50-f6d90ac3c392';
const CADENCE_LEAD = '0ca178d4-5460-4e84-8420-16c1cc2d8a81';

const TOUR_KEYS = [
  'alternate:my-tasks-tour-seen', 'alternate:ae-pipeline-tour-seen', 'alternate:daily-digest-tour-seen',
  'alternate:leaderboard-tour-seen', 'alternate:sales-tools-tour-seen', 'alternate:my-settings-tour-seen',
  'alternate:cadence-rep-tour-seen-v2', 'alternate:power-dialer-tour-seen', 'alternate:control-center-tour-seen',
  'alternate:leads-hub-tour-seen-v2', 'alternate:lead-detail-emails-tour-seen', 'alternate:cadence-builder-v13-tour-seen', 'alternate:csm-account-360-tour-seen', 'alternate:aircall-drawer-tour-seen',
  'alternate:csm-portal-tour-seen', 'alternate:analytics-hub-tour-seen',
];

async function login(page, token) {
  await page.addInitScript((keys) => {
    try { keys.forEach((k) => localStorage.setItem(k, '1')); localStorage.setItem('leadDetailHub', 'on'); } catch { /* no storage */ }
  }, TOUR_KEYS);
  await page.goto(`${BASE_URL}/?token=${token}`);
  await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
}

async function openLead(page, id) {
  await page.evaluate((lid) => { window.location.hash = `#lead-detail/${lid}`; }, id);
  await expect(page.locator('.leaddetailhub')).toBeVisible({ timeout: 20000 });
}

async function stageOptions(page) {
  await page.getByRole('button', { name: 'Change lead stage' }).click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
  const opts = await page.getByRole('menuitem').allInnerTexts();
  await page.keyboard.press('Escape');
  return opts.map((s) => s.trim());
}

const auth = (t) => ({ headers: { Authorization: `Bearer ${t}` } });

test.describe('v12.7.15 staging audit', () => {
  test.skip(!SA || !SDR, 'V_SA_TOKEN / V_SDR_TOKEN not set');

  test('1. outcome list no longer offers the lookalike "Meeting Scheduled"', async ({ request }) => {
    const r = await request.get(`${API}/api/call-outcomes`, auth(SDR));
    const values = (await r.json()).enabled_outcomes.map((o) => (typeof o === 'string' ? o : o.value));
    expect(values).toContain('Meeting Confirmed');
    expect(values).not.toContain('Meeting Scheduled');
  });

  test('2. post-call modal: only "Meeting Booked" books a meeting', async ({ page }) => {
    await login(page, SDR);
    await page.evaluate(async (id) => {
      const m = await import('/js/views/modals.js');
      await m.openCallModal(id, 'Audit Lead', '+10000000000', {});
    }, SDR_CALLING_LEAD);
    await page.locator('#branch-yes-btn').click();
    await expect(page.locator('.clm-featured-chip[data-value="Meeting Confirmed"]')).toBeVisible();
    await expect(page.locator('.clm-chip[data-value="Meeting Scheduled"]')).toHaveCount(0);
  });

  test('3. SDR cannot skip a stage (both status endpoints) — server-side', async ({ request }) => {
    const patch = await request.patch(`${API}/api/leads/${SDR_CALLING_LEAD}`, { ...auth(SDR), data: { status: '1st Discovery Meeting' } });
    expect(patch.status()).toBe(403);
    expect((await patch.json()).detail).toContain('one stage at a time');
    const kanban = await request.patch(`${API}/api/leads/kanban/move?lead_id=${SDR_CALLING_LEAD}&new_status=Demo%20Scheduled`, auth(SDR));
    expect(kanban.status()).toBe(403);
    const lead = await (await request.get(`${API}/api/leads/${SDR_CALLING_LEAD}`, auth(SA))).json();
    expect(lead.status).toBe('Calling');
  });

  test('4. SDR stage menu only offers legal moves, never Disqualified', async ({ page }) => {
    await login(page, SDR);
    await openLead(page, SDR_CALLING_LEAD);
    const opts = await stageOptions(page);
    expect(opts).toContain('Meeting Scheduled');
    for (const bad of ['Lead Assigned', '1st Discovery Meeting', 'Demo Scheduled', 'Completed', 'Disqualified']) {
      expect(opts).not.toContain(bad);
    }
  });

  test('5. admin stage menu can skip stages, still no Disqualified', async ({ page }) => {
    await login(page, SA);
    await openLead(page, SDR_CALLING_LEAD);
    const opts = await stageOptions(page);
    expect(opts).toContain('Demo Scheduled');
    expect(opts).not.toContain('Disqualified');
  });

  test('6. Won/Lost card: shows at Meeting Scheduled with an optional notes field', async ({ page }) => {
    await login(page, SA);
    await openLead(page, MEETING_LEAD);
    await expect(page.getByRole('textbox', { name: 'Outcome notes' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Won', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Lost', exact: true })).toBeVisible();
  });

  test('7. reassigning to a new SDR replaces the old one (restored after)', async ({ request }) => {
    const owners = async () => ((await (await request.get(`${API}/api/leads/${SDR_ASSIGNED_LEAD}`, auth(SA))).json()).assigned_to || []).map((u) => u.id);
    const assign = (uid) => request.post(`${API}/api/admin/assignments/bulk-assign`, { ...auth(SA), data: { user_id: uid, lead_ids: [SDR_ASSIGNED_LEAD] } });
    expect(await owners()).toEqual([DEV_ID]);
    try {
      expect((await assign(KARAN_ID)).ok()).toBeTruthy();
      expect(await owners()).toEqual([KARAN_ID]);
    } finally {
      await assign(DEV_ID);
    }
    expect(await owners()).toEqual([DEV_ID]);
  });

  test('7b. v12.7.17: before a meeting, last assigned is the only owner (AE → SDR)', async ({ request }) => {
    test.skip(!AE, 'V_AE_TOKEN not set');
    const AE_ID = 'd620c5c8-79d2-41ac-b698-adfd600701b9'; // Demo AE (the AE token's user)
    const owners = async () => ((await (await request.get(`${API}/api/leads/${SDR_ASSIGNED_LEAD}`, auth(SA))).json()).assigned_to || []).map((u) => u.id);
    const assign = (uid) => request.post(`${API}/api/admin/assignments/bulk-assign`, { ...auth(SA), data: { user_id: uid, lead_ids: [SDR_ASSIGNED_LEAD] } });
    const inMyLeads = async (token) => {
      const d = await (await request.get(`${API}/api/leads/my?limit=500`, auth(token))).json();
      return (d.data || d).some((l) => l.id === SDR_ASSIGNED_LEAD);
    };
    try {
      expect((await assign(AE_ID)).ok()).toBeTruthy();
      expect(await owners()).toEqual([AE_ID]);
      expect(await inMyLeads(AE)).toBe(true);
      expect(await inMyLeads(SDR)).toBe(false);
    } finally {
      await assign(DEV_ID);
    }
    expect(await owners()).toEqual([DEV_ID]);
    expect(await inMyLeads(AE)).toBe(false);
    expect(await inMyLeads(SDR)).toBe(true);
  });

  test('8. Sales Cadence card lists the enrollment with its status', async ({ page }) => {
    await login(page, SA);
    await openLead(page, CADENCE_LEAD);
    const card = page.locator('text=Sales Cadence').locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
    await expect(page.getByText('🛤️ Testing Cadence 1')).toBeVisible({ timeout: 15000 });
    await expect(card.getByText('Completed')).toBeVisible();
  });

  test('9. Regenerate research asks for confirmation first (cancelled — no write)', async ({ page }) => {
    await login(page, SA);
    await openLead(page, MEETING_LEAD);
    // Opening a lead with no research auto-runs it; wait for Regenerate to appear.
    const regen = page.getByRole('button', { name: /Regenerate/ });
    await expect(regen).toBeVisible({ timeout: 90000 });
    await regen.click();
    await expect(page.getByText('Regenerate AI research? This will replace all current research')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Regenerate AI research?')).toHaveCount(0);
  });

  test('11. v12.7.18: Emails card shows the lead\'s emails with stats', async ({ page, request }) => {
    const { emails } = await (await request.get(`${API}/api/email/lead/${CADENCE_LEAD}/emails`, auth(SA))).json();
    await login(page, SA);
    await openLead(page, CADENCE_LEAD);
    const card = page.locator('h3', { hasText: /^Emails$/ }).locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
    await expect(card).toBeVisible({ timeout: 15000 });
    if (!emails.length) {
      await expect(card.getByText('No emails with this lead yet.')).toBeVisible();
      return;
    }
    const sent = emails.filter((e) => e.direction === 'outbound').length;
    await expect(card.getByText('Sent', { exact: true }).locator('xpath=following-sibling::p')).toHaveText(String(sent));
    await expect(card.getByText(emails[emails.length - 1].subject || '(no subject)').first()).toBeVisible();
  });

  test('10. Help Hub release notes list v12.7.15 and v12.7.16', async ({ page }) => {
    await login(page, SA);
    await page.getByRole('link', { name: 'Help', exact: true }).click();
    await page.getByRole('button', { name: /What's New/ }).click();
    await expect(page.getByText('v12.7.18', { exact: true }).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('v12.7.17', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('v12.7.16', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('v12.7.15', { exact: true }).first()).toBeVisible();
  });
});
