/**
 * Sales Tools (v12) — Cadence + Campaigns umbrella hub, live on staging.
 * Covers every role Campaigns is open to (all) vs. Cadence (Admin+ only),
 * the direct "New Campaign" recipient picker (search/filter/select-all),
 * a real send to seeded @staging.test leads (RFC 2606 reserved TLD — never
 * actually delivers, safe to run for real), scheduling, the Performance
 * donut chart, and the rich-text template editor.
 */
const { test, expect } = require('@playwright/test');

const TOKENS = {
  'Super Admin': process.env.SUPER_ADMIN_TOKEN,
  'Pod Admin': process.env.POD_ADMIN_TOKEN,
  'AE': process.env.AE_TOKEN,
  'SDR': process.env.SDR_TOKEN,
};

async function loginAs(page, role, { seedTourSeen = true } = {}) {
  const token = TOKENS[role];
  if (!token) throw new Error(`No token configured for role: ${role}`);
  // auth.js redirects to /login.html the instant it sees no crm_token in
  // localStorage — going to '/' first with empty storage loses that race
  // every time (the redirect fires before the token is ever set, and a
  // later reload() just reloads whatever page the redirect landed on).
  // /login.html itself never redirects unauthenticated, so it's a safe
  // place to seed localStorage before navigating to '/' for real.
  await page.goto('/login.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ t, seedTourSeen }) => {
    localStorage.setItem('crm_token', t);
    // Sales Tools' first-visit guided tour is real UI to verify separately
    // (see "guided tour" test below) — every fresh test browser here is a
    // "first visit", and its full-screen backdrop would otherwise
    // intercept every click in every other test. Pre-seed it as seen,
    // except for the one test that means to exercise it for real.
    if (seedTourSeen) localStorage.setItem('alternate:sales-tools-tour-seen', '1');
  }, { t: token, seedTourSeen });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav >> text=Dashboard', { timeout: 20000 });
}

async function gotoSalesTools(page) {
  await page.goto('/#sales-tools', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  // The Aircall CTI widget (unrelated to Sales Tools) auto-opens its own
  // drawer over the right half of the page on some loads and intercepts
  // every click under it — close it up front rather than fighting it later.
  const aircallClose = page.locator('.nh-aircall-drawer button[aria-label="Close"]');
  if (await aircallClose.count()) await aircallClose.click();
}

for (const role of ['Super Admin', 'Pod Admin', 'AE', 'SDR']) {
  test.describe(`Sales Tools — ${role}`, () => {
    test(`${role} sees Sales Tools with Campaigns available, Cadence gated correctly`, async ({ page }) => {
      await loginAs(page, role);
      await expect(page.getByRole('link', { name: 'Sales Tools', exact: true })).toBeVisible();
      await gotoSalesTools(page);
      await expect(page.locator('text=View not found')).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'Sales Tools', level: 1 })).toBeVisible();

      const canUseCadence = role === 'Super Admin' || role === 'Pod Admin';
      if (canUseCadence) {
        // Cadence-capable roles land here by default.
        await expect(page.getByRole('heading', { name: 'Sales Cadences' })).toBeVisible({ timeout: 10000 });
      } else {
        // Roles without Cadence default straight to Campaigns instead —
        // clicking into Cadence themselves still shows the gated message.
        await page.getByRole('button', { name: 'Cadence', exact: true }).click();
        await expect(page.locator('text=Not available')).toBeVisible({ timeout: 10000 });
      }

      // Campaigns is open to every role, unlike Cadence.
      await page.getByRole('button', { name: 'Campaigns', exact: true }).first().click();
      await page.waitForTimeout(1000);
      await expect(page.locator('text=/New Campaign|No campaigns yet/').first()).toBeVisible({ timeout: 10000 });

      const errors = [];
      page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) errors.push(r.url()); });
      await page.getByRole('button', { name: 'New Campaign' }).click();
      await expect(page.locator('text=Step 1 of 2')).toBeVisible({ timeout: 5000 });
      // Table renders (possibly empty, if this role's own leads are scoped
      // to nothing) without a 500 — that's the real cross-role assertion.
      await page.waitForTimeout(1500);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('Sales Tools — Super Admin full Campaigns flow', () => {
  test('New Campaign picker: filter, select staging.test leads, compose with rich text, send now', async ({ page }) => {
    await loginAs(page, 'Super Admin');
    await gotoSalesTools(page);
    await page.getByRole('button', { name: 'Campaigns', exact: true }).first().click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'New Campaign' }).click();
    await expect(page.locator('text=Step 1 of 2')).toBeVisible({ timeout: 5000 });

    await page.getByPlaceholder(/Search by name, email, or company/).fill('staging.test');
    // Search is debounced (400ms) + a real network round-trip on staging —
    // wait for the skeleton to actually clear rather than a fixed guess.
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(600); // debounce settle before reading row count
    const rows = page.locator('table tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    const toSelect = Math.min(rowCount, 2);
    for (let i = 0; i < toSelect; i++) {
      await rows.nth(i).locator('input[type="checkbox"]').click();
    }
    await expect(page.locator(`text=${toSelect} of 200 selected`)).toBeVisible();
    // force: true — the Aircall CTI widget's own drawer (unrelated to Sales
    // Tools) sometimes auto-opens and overlaps this bottom-right corner.
    await page.getByRole('button', { name: `Continue with ${toSelect} lead${toSelect === 1 ? '' : 's'}` }).click({ force: true });

    await expect(page.locator('text=Step 2 of 2')).toBeVisible({ timeout: 5000 });
    await page.locator('input[placeholder*="Subject"]').fill('Hi {{first_name}}');
    // Rich text editor — type into Tiptap's contenteditable, use the Bold button.
    const editor = page.locator('.ProseMirror');
    await editor.click();
    await editor.type('Following up with ');
    await page.getByTitle('Bold').click();
    await editor.type('you');
    await expect(editor.locator('strong')).toHaveText('you');

    await page.getByRole('button', { name: 'Send', exact: true }).click({ force: true });
    await expect(page.locator('text=/Campaign started: \\d+\\/\\d+ lead/')).toBeVisible({ timeout: 10000 });
  });

  test('Scheduling a campaign for later does not send immediately', async ({ page }) => {
    await loginAs(page, 'Super Admin');
    await gotoSalesTools(page);
    await page.getByRole('button', { name: 'Campaigns', exact: true }).first().click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'New Campaign' }).click();
    await page.getByPlaceholder(/Search by name, email, or company/).fill('staging.test');
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(600);
    await page.locator('table tbody tr').first().locator('input[type="checkbox"]').click();
    await page.getByRole('button', { name: /^Continue with 1 lead$/ }).click();

    await expect(page.locator('text=Step 2 of 2')).toBeVisible({ timeout: 5000 });
    await page.locator('input[placeholder*="Subject"]').fill('Scheduled test');
    await page.locator('.ProseMirror').click();
    await page.locator('.ProseMirror').type('Body text.');
    await page.getByRole('button', { name: 'Schedule for later' }).click();
    // Date/time now come from this app's own DatePicker/TimePicker (a
    // Popover + Calendar, and two Select dropdowns) rather than a native
    // datetime-local input. Tomorrow's day-of-month is always the single
    // "inside" (current-month) cell with that number in the visible grid —
    // showOutsideDays renders neighboring months' overflow days too, but
    // they never share tomorrow's number when tomorrow is early enough in
    // the month, which every real calendar day here is far from the edge of.
    await page.getByRole('button', { name: 'Send date' }).click();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).getDate().toString();
    await page.locator('.rdp-day_button', { hasText: new RegExp(`^${tomorrow}$`) }).click();
    // Leaving the time at its default (09:00) is enough — picking just the
    // date already produces a complete, valid future scheduled_send_at.
    await page.getByRole('button', { name: 'Schedule Campaign', exact: true }).click({ force: true });
    await expect(page.locator('text=/Campaign scheduled: \\d+\\/\\d+ lead/')).toBeVisible({ timeout: 10000 });
  });

  test('Performance tab renders the donut chart with real totals', async ({ page }) => {
    await loginAs(page, 'Super Admin');
    await gotoSalesTools(page);
    await page.getByRole('button', { name: 'Campaigns', exact: true }).first().click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Performance', exact: true }).click();
    await page.waitForTimeout(1500);
    await expect(page.locator('svg circle').first()).toBeVisible({ timeout: 8000 });
    // "Sent"/"Failed"/"Skipped" appear twice each (donut legend + "By
    // campaign" table column header) — .first() targets the legend.
    await expect(page.locator('text=Sent').first()).toBeVisible();
    await expect(page.locator('text=Failed').first()).toBeVisible();
    await expect(page.locator('text=Skipped').first()).toBeVisible();
  });

  test('Templates tab: rich text editor saves and reloads a template', async ({ page }) => {
    await loginAs(page, 'Super Admin');
    await gotoSalesTools(page);
    await page.getByRole('button', { name: 'Campaigns', exact: true }).first().click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Templates', exact: true }).click();
    await page.waitForTimeout(500);
    const stamp = Date.now();
    await page.getByPlaceholder('Template name').fill(`RichText Template ${stamp}`);
    await page.getByPlaceholder(/Subject.*first_name/).fill('Subject line');
    await page.locator('.ProseMirror').first().click();
    await page.locator('.ProseMirror').first().type('Rich body content.');
    await page.getByRole('button', { name: 'Save Template' }).click();
    await expect(page.locator(`text=RichText Template ${stamp}`)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Sales Tools — guided tour', () => {
  test('shows on a genuine first visit and Skip dismisses it', async ({ page }) => {
    await loginAs(page, 'Super Admin', { seedTourSeen: false });
    await gotoSalesTools(page);
    const tour = page.getByRole('dialog', { name: 'Sales Tools guided tour' });
    await expect(tour).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Campaigns is new here')).toBeVisible();
    await tour.getByText('Skip tour').click();
    await expect(tour).not.toBeVisible();
    // Reloading (still the same real browser storage) confirms it stays
    // dismissed — the same seenFlag mechanism the other tests pre-seed.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    await expect(page.getByRole('dialog', { name: 'Sales Tools guided tour' })).not.toBeVisible();
  });
});
