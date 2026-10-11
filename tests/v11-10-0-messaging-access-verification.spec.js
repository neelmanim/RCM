// ── v11.10.0/v11.10.1 per-SDR messaging access — live staging verification ──
// Verifies, against real staging data, that an admin can actually grant
// SMS/WhatsApp per user, and that the v11.10.1 settings-consolidation pass
// (Dialer + Alternate Messenger tabs merged into one "Calling & Messaging" tab, the
// Alternate Messenger "Agent Assignments" table and the Aircall "User Access" table
// merged into one User Access table, the Admin → Users per-user dialer
// controls replaced by a read-only Channels chip) didn't regress anything.
//
// Covers:
//   1. GET /api/me/capabilities exists and returns per-channel state, live from
//      the DB (the endpoint the widget and the lead-detail Message button now
//      gate on, replacing "infer messaging from the dialer provider").
//   2. Settings → 📞 Calling & Messaging has exactly one tab, one User Access
//      table (not two), listing every user with clickable Calling/SMS/WhatsApp
//      chips — and clicking one really persists (re-read from the API, not
//      just the optimistic UI).
//   3. The Edit form no longer demands a Alternate Messenger User ID when the only
//      change is switching that user's Messaging Provider to Aircall.
//   4. An Aircall-only row (no Alternate Messenger identity) shows no ID/credential
//      fields — Aircall needs no per-user setup, since it matches users by
//      email and uses the numbers Aircall already assigns them.
//   5. A granted channel with an unconfigured vendor reports the missing field
//      rather than silently failing at first send — both from the API and
//      from the readiness banner above the User Access table.
//   6. Admin → Users no longer exposes editable dialer/Alternate Messenger controls
//      (the second, unvalidated copy of the same fields) — only a read-only
//      Channels indicator.
//
// Uses a raw JWT handed directly by the user (ADMIN_TOKEN in .env.test) via
// the app's `?token=` login — a real staging session, not a synthetic one.
// Run: npx playwright test tests/v11-10-0-messaging-access-verification.spec.js
const { test, expect } = require('@playwright/test');
// Staging is two separate Render services: BASE_URL is the static frontend
// host, API_BASE_URL the FastAPI one. The frontend does NOT proxy /api/* (it
// serves its own SPA index.html), so API calls must go to API_BASE_URL —
// the trap tests/helpers/auth.js already documents.
const { BASE_URL, API_BASE_URL } = require('./helpers/auth');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

async function loginAsAdmin(page) {
  await page.goto(`${BASE_URL}/?token=${ADMIN_TOKEN}`);
  await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
}

/** Open Settings and click its one Calling & Messaging tab. */
async function openChannelsTab(page) {
  await page.evaluate(() => { window.location.hash = 'settings'; });
  await page.waitForSelector('#settings-tabs', { timeout: 20000 });
  await page.click('#settings-tabs .settings-tab[data-tab="channels"]');
  await page.waitForTimeout(2500);
}

/** Call the staging API directly, as the same Super Admin the page is using. */
async function api(request, path, opts = {}) {
  const res = await request.fetch(`${API_BASE_URL}/api${path}`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    ...opts,
  });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status(), body };
}

test.describe('v11.10.0 — capabilities endpoint', () => {
  test('GET /api/me/capabilities returns per-channel state', async ({ page, request }) => {
    await loginAsAdmin(page);
    const { status, body } = await api(request, '/me/capabilities');

    expect(status).toBe(200);
    // Shape the frontend depends on for the widget-mount and tab decisions.
    expect(body).toHaveProperty('calling');
    expect(body).toHaveProperty('sms');
    expect(body).toHaveProperty('whatsapp');
    for (const channel of ['sms', 'whatsapp']) {
      expect(Object.keys(body[channel]).sort()).toEqual(['enabled', 'ready', 'reason']);
      expect(typeof body[channel].enabled).toBe('boolean');
      expect(typeof body[channel].ready).toBe('boolean');
    }
  });

  test('a channel that is not ready explains why', async ({ page, request }) => {
    await loginAsAdmin(page);
    const { body } = await api(request, '/me/capabilities');

    // Whichever channels aren't live must say what's missing — the whole point
    // of this release is that an admin never has to guess.
    for (const channel of ['sms', 'whatsapp']) {
      if (!body[channel].ready) {
        expect(body[channel].reason, `${channel} not ready but gave no reason`).toBeTruthy();
      }
    }
  });
});

test.describe('v11.10.1 — one Calling & Messaging tab, one User Access table', () => {
  test('the old separate Dialer and Alternate Messenger tabs are gone', async ({ page }) => {
    await loginAsAdmin(page);
    await page.evaluate(() => { window.location.hash = 'settings'; });
    await page.waitForSelector('#settings-tabs', { timeout: 20000 });

    await expect(page.locator('#settings-tabs .settings-tab[data-tab="dialer"]')).toHaveCount(0);
    await expect(page.locator('#settings-tabs .settings-tab[data-tab="messenger"]')).toHaveCount(0);
    await expect(page.locator('#settings-tabs .settings-tab[data-tab="channels"]')).toBeVisible();
  });

  test('user rows expose clickable Calling/SMS/WhatsApp chips', async ({ page, request }) => {
    await loginAsAdmin(page);
    await openChannelsTab(page);

    const section = page.locator('#user-access-section');
    await expect(section).toBeVisible();
    await expect(section).not.toContainText('Loading', { timeout: 20000 });

    const firstRow = section.locator('.user-access-row').first();
    await expect(firstRow).toBeVisible();
    for (const label of ['Calling', 'SMS', 'WhatsApp']) {
      await expect(firstRow.locator(`button:has-text("${label}")`)).toBeVisible();
    }
  });

  test('the table lists every user, not a provider-filtered subset', async ({ page, request }) => {
    // Before the merge, a Alternate Messenger-only admin screen hid Aircall users and
    // vice versa — the exact confusion that prompted this consolidation.
    // v11.10.4 added 5-rows-per-page pagination on top of this same table, so
    // "every user" is now checked against the count summary rather than the
    // number of rows actually painted on the current page.
    await loginAsAdmin(page);
    await openChannelsTab(page);

    const section = page.locator('#user-access-section');
    await expect(section).not.toContainText('Loading', { timeout: 20000 });
    const rowCount = await section.locator('.user-access-row').count();

    const { body: allSdrs } = await api(request, '/admin/dialer/sdr-configs');
    expect(rowCount).toBeLessThanOrEqual(5);
    await expect(page.locator('#user-access-count')).toContainText(`${allSdrs.length} user`);
  });

  test('clicking a chip really persists the grant', async ({ page, request }) => {
    await loginAsAdmin(page);
    await openChannelsTab(page);

    const row = page.locator('#user-access-section .user-access-row').first();
    const userId = await row.getAttribute('data-user-id');
    expect(userId).toBeTruthy();

    const before = await api(request, '/admin/dialer/sdr-configs');
    const wasEnabled = before.body.find((u) => u.id === userId).sms_enabled;

    // Toggle, then read the value back from the API rather than trusting the
    // optimistic chip styling.
    await row.locator('button:has-text("SMS")').click();
    await page.waitForTimeout(2500);

    const after = await api(request, '/admin/dialer/sdr-configs');
    const nowEnabled = after.body.find((u) => u.id === userId).sms_enabled;
    expect(nowEnabled).toBe(!wasEnabled);

    // Restore, so a verification run leaves no grant changed behind it.
    await row.locator('button:has-text("SMS")').click();
    await page.waitForTimeout(2500);
    const restored = await api(request, '/admin/dialer/sdr-configs');
    expect(restored.body.find((u) => u.id === userId).sms_enabled).toBe(wasEnabled);
  });

  test('an Aircall-only row shows no per-user credential fields', async ({ page, request }) => {
    const { body: allSdrs } = await api(request, '/admin/dialer/sdr-configs');
    const aircallUser = allSdrs.find((u) =>
      (u.effective_dialer_provider === 'aircall' || u.effective_messaging_provider === 'aircall')
      && !u.messenger_user_id
    );
    test.skip(!aircallUser, 'no Aircall-only user on this staging dataset');

    await loginAsAdmin(page);
    await openChannelsTab(page);

    // Narrow to this one user first — pagination (5 rows/page) means their
    // row isn't guaranteed to be on page 1 of the unfiltered list.
    await page.locator('#user-access-search').fill(aircallUser.email);

    const row = page.locator(`.user-access-row[data-user-id="${aircallUser.id}"]`);
    await expect(row).toBeVisible();
    // No credential inputs at rest — any input here would contradict the
    // whole point of Aircall needing no per-user setup.
    await expect(row.locator('input')).toHaveCount(0);
    // And specifically no Alternate Messenger agent-ID pill, since this user has none.
    await expect(row.locator('span[title="Alternate Messenger calling agent ID"]')).toHaveCount(0);
  });

  test('switching a user to Aircall messaging saves without a Alternate Messenger User ID', async ({ page, request }) => {
    // The staging regression: "Alternate Messenger User ID is required" fired on every
    // Edit save, so a user with no Alternate Messenger agent ID could not be moved to
    // Aircall messaging at all.
    await loginAsAdmin(page);
    await openChannelsTab(page);

    // Filter to users with no Alternate Messenger agent ID first — the case that used
    // to be stuck — so pagination (5 rows/page) can't hide every match on a
    // later page.
    await page.locator('#user-access-filter-agent').selectOption('no');

    const section = page.locator('#user-access-section');
    const row = section.locator('.user-access-row').first();
    await expect(row, 'expected at least one user with no Alternate Messenger agent ID').toBeVisible();
    const userId = await row.getAttribute('data-user-id');

    await row.locator('.conv-menu-btn').click();
    await row.locator('.conv-edit-btn').click();

    const editRow = page.locator('.conv-edit-row');
    await expect(editRow).toBeVisible();
    await expect(editRow.locator('.edit-uid')).toHaveValue('');

    await editRow.locator('.edit-msg-provider').selectOption('aircall');
    await editRow.locator('.edit-save-btn').click();
    await page.waitForTimeout(3000);

    const err = editRow.locator('.edit-err');
    if (await err.count()) {
      await expect(err).not.toContainText('Alternate Messenger User ID is required');
    }
    const after = await api(request, '/admin/dialer/sdr-configs');
    const saved = after.body.find((u) => u.id === userId);
    expect(saved.messaging_provider_override).toBe('aircall');
    expect(saved.effective_messaging_provider).toBe('aircall');

    await api(request, `/admin/users/${userId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ messaging_provider_override: null }),
    });
  });

  test('the Aircall Number ID field is presented as an optional fallback', async ({ page, request }) => {
    // It used to read "(only if Aircall selected)" and be a hard requirement
    // before Aircall messaging would work for anyone.
    await loginAsAdmin(page);
    await openChannelsTab(page);

    const field = page.locator('#aircall-messaging-number-id');
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute('placeholder', /resolved per user/i);
  });

  test('an unconfigured messaging vendor shows a readiness warning above User Access', async ({ page, request }) => {
    await loginAsAdmin(page);
    await openChannelsTab(page);

    const { body } = await api(request, '/me/capabilities');
    const anyChannelBlocked = !body.sms.ready || !body.whatsapp.ready;
    test.skip(!anyChannelBlocked, 'both messaging channels are fully configured on this staging environment');

    const banner = page.locator('#user-access-readiness');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/won't send yet/i);
  });
});

test.describe('v11.10.1 — Admin → Users no longer edits dialer/Alternate Messenger fields', () => {
  test('Admin → Users shows read-only channel chips, not editable controls', async ({ page }) => {
    await loginAsAdmin(page);
    await page.evaluate(() => { window.location.hash = 'admin'; });
    await page.waitForSelector('table.data-table', { timeout: 20000 });

    // The second, unvalidated copies of these controls are gone.
    await expect(page.locator('.dialer-override-select')).toHaveCount(0);
    await expect(page.locator('.conv-agent-id-input')).toHaveCount(0);
    await expect(page.locator('.conv-from-number-input')).toHaveCount(0);
    await expect(page.locator('.conv-email-input')).toHaveCount(0);
    await expect(page.locator('.toggle-dialer-btn')).toHaveCount(0);

    // The read-only replacement links back to the one real editor.
    const firstLink = page.locator('table.data-table a[href="#settings"]').first();
    await expect(firstLink).toBeVisible();
  });
});
