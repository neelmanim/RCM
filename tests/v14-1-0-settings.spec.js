// v14.1.0 on STAGING — Control Center → Integrations (Salesforce tab, Pod & Call Rules) and the Daily Digest Funnel / Team paging.
// READ-ONLY: every confirmation is opened and CANCELLED; the settings are compared through the API before and after.
//   npx playwright test tests/v14-1-0-settings.spec.js
const { test, expect } = require('@playwright/test');
const { warmUp, APP_VERSION, API, PERSONAS, watch, login, shot, api } = require('./helpers/v13-7-0-staging');

const SA = PERSONAS.sa;
test.beforeAll(async ({ request }) => { await warmUp(request); });
test.skip(!SA.token, 'SA_TOKEN missing from .env.test');
const clean = (c) => c.problems().filter((p) => !/^(40[139]|409) /.test(p));
const settings = async (request) => (await api(request, 'GET', '/api/admin/sync-settings', SA.token)).body;

// Staging's Aircall drawer opens over the page on a fresh profile and swallows clicks; close it if it is there.
async function closeAircall(page) {
  const h = page.getByText('Aircall — log in below');
  if (await h.isVisible({ timeout: 4000 }).catch(() => false)) {
    await h.locator('xpath=ancestor::*[.//button][1]').locator('button').first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

async function openIntegrations(page) {
  await login(page, SA.token);
  await closeAircall(page);
  await page.locator('nav').getByText('Control Center', { exact: false }).first().click();
  await page.getByRole('button', { name: 'Integrations' }).first().click().catch(() => {});
  await expect(page.getByText('What Syncs with Salesforce')).toBeVisible({ timeout: 30000 });
}

test('staging runs this release', async ({ request }) => {
  expect((await (await request.get(`${API}/api/health`)).json()).version).toBe(APP_VERSION);
});

test('Salesforce tab: one place for everything, and every critical switch asks first (Cancel saves nothing)', async ({ page, request }) => {
  const c = watch(page);
  const before = await settings(request);
  await openIntegrations(page);
  for (const t of ['What Syncs with Salesforce', 'Schedule and Volume', 'Salesforce Field Mapping']) await expect(page.getByText(t)).toBeVisible();
  await shot(page, 'v14-1-sf-tab');

  const critical = [
    ['Two-way lead sync', /two-way lead sync/i], ['Also send Customer Declined leads', /Customer Declined/],
    ['Also send Unreachable leads', /Unreachable/], ['Read opportunities and accounts from Salesforce', /Read opportunities/],
    ['Send AE and CSM deal actions to Salesforce', /Send deal actions/],
  ];
  for (const [label, title] of critical) {
    const sw = page.getByRole('checkbox', { name: label });
    if (await sw.isChecked()) continue;                      // already on: turning it OFF never asks
    await sw.click({ force: true });
    const dlg = page.getByRole('dialog');
    await expect(dlg, `${label} asks first`).toBeVisible();
    await expect(dlg).toContainText(title);
    if (label === 'Two-way lead sync') await shot(page, 'v14-1-sf-confirm');
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(sw).not.toBeChecked();
  }
  const after = await settings(request);
  for (const k of ['sync_direction', 'sync_declined_to_salesforce', 'sync_unreachable_to_salesforce', 'opportunity_sync_direction', 'opportunity_writeback_enabled', 'sf_push_stage']) {
    expect(after[k], `${k} unchanged`).toEqual(before[k]);
  }
  expect(clean(c)).toEqual([]);
});

test('Schedule and Volume: editing shows unsaved changes and Save lists them first', async ({ page, request }) => {
  const before = await settings(request);
  await openIntegrations(page);
  const limit = page.getByLabel('Leads read per sync');
  const was = await limit.inputValue();
  await limit.fill(String(Number(was) + 100));
  await expect(page.getByText('1 unsaved change')).toBeVisible();
  await page.getByRole('button', { name: 'Save Changes' }).first().click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText(`Leads read per sync: ${was} → ${Number(was) + 100}`);
  await shot(page, 'v14-1-sf-schedule-confirm');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Discard' }).first().click();
  await expect(limit).toHaveValue(was);
  expect((await settings(request)).lead_limit).toEqual(before.lead_limit);
});

test('Field mapping: Add dialog reminds what is needed and never sends an empty mapping', async ({ page }) => {
  await openIntegrations(page);
  await page.getByRole('button', { name: 'Add Mapping' }).first().click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Add Mapping' }).click();
  await expect(dlg.getByRole('alert')).toContainText('Choose a Alternate CRM field');
  await shot(page, 'v14-1-sf-add-mapping');
  await dlg.getByRole('button', { name: 'Cancel' }).click();
});

test('Pod & Call Rules: the pod switch asks first; call numbers list changes before saving', async ({ page, request }) => {
  const c = watch(page);
  const before = await settings(request);
  await openIntegrations(page);
  await page.getByRole('button', { name: 'Pod & Call Rules' }).click();
  await expect(page.getByText('Pod and Call Rules')).toBeVisible();
  await shot(page, 'v14-1-rules-tab');
  const pod = page.getByRole('checkbox', { name: 'Let an SDR belong to more than one pod' });
  if (!(await pod.isChecked())) {
    await pod.click({ force: true });
    await expect(page.getByRole('dialog')).toContainText('widens who can see');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(pod).not.toBeChecked();
  }
  const attempts = page.getByLabel('Call attempts before a warning');
  const was = await attempts.inputValue();
  await attempts.fill(String(Number(was) + 1));
  await page.getByRole('button', { name: 'Save Changes' }).first().click();
  await expect(page.getByRole('dialog')).toContainText(`Call attempts before a warning: ${was} → ${Number(was) + 1}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Discard' }).first().click();
  const after = await settings(request);
  expect(after.max_call_attempts).toEqual(before.max_call_attempts);
  expect(after.allow_multi_pod_sdr).toEqual(before.allow_multi_pod_sdr);
  expect(clean(c)).toEqual([]);
});

test('Team Digest: Team table shows at most 8 reps and the Funnel renders', async ({ page }) => {
  const c = watch(page);
  await login(page, SA.token);
  await closeAircall(page);
  await page.locator('nav').getByText('Team Digest', { exact: true }).first().click();
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await expect(page.getByText('Funnel').first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Meetings booked').first()).toBeVisible();
  const rows = await page.locator('[data-tour="digest-sdr-snapshot"] tbody tr').count();
  expect(rows).toBeLessThanOrEqual(8);
  await shot(page, 'v14-1-digest');
  expect(clean(c)).toEqual([]);
});

// ── v14.1.0 part 2: Team Digest, data export switch, Salesforce overview / mapping table ─────────────────────────
const PA = PERSONAS.pa;
const SDR = PERSONAS.sdr;

test('Salesforce tab shows how many leads are in Salesforce, and the mapping table has search', async ({ page }) => {
  const c = watch(page);
  await openIntegrations(page);
  for (const t of ['Leads in Alternate CRM', 'In Salesforce', 'Only in Alternate CRM', 'Waiting to be sent']) await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Record types to read', { exact: true })).toBeVisible();
  await expect(page.getByText(/record types are read|selected — only these are read|no custom record types/)).toBeVisible();
  await page.getByRole('button', { name: /built-in fields/ }).click();
  await page.getByLabel('Search built-in fields…').fill('phone');
  await expect(page.getByText('Phone', { exact: true }).first()).toBeVisible();
  await shot(page, 'v14-1-sf-overview');
  expect(clean(c)).toEqual([]);
});

test('Team Digest: period menu, Campaigns, Customize numbers; Export only for someone allowed', async ({ page }) => {
  const c = watch(page);
  await login(page, SA.token);
  await closeAircall(page);
  await page.locator('nav').getByText('Team Digest', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Team Digest' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: /Export Excel/ })).toBeVisible();            // Super Admin may export

  await page.getByLabel('Period').click();
  await page.getByRole('menuitem', { name: 'Last 7 days' }).click();
  await expect(page.getByText(/compared with the previous 7 days/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Campaigns', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('No campaign').first()).toBeVisible();

  await page.getByRole('button', { name: /Customize numbers/ }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Shown (5/10)');
  await dlg.getByRole('checkbox', { name: 'Conversations' }).click();
  await expect(dlg).toContainText('Shown (6/10)');
  await dlg.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('[data-tour="digest-kpi-grid"]')).toContainText('Conversations');
  await expect(page.getByLabel('View')).toContainText('Custom (not saved)');
  await shot(page, 'v14-1-team-digest');
  expect(clean(c)).toEqual([]);
});

test('a Pod Admin sees Team Digest with no Export buttons, and the Users table shows Data Export', async ({ page }) => {
  test.skip(!PA.token, 'POD_ADMIN_TOKEN missing');
  const c = watch(page);
  await login(page, PA.token);
  await closeAircall(page);
  await page.locator('nav').getByText('Team Digest', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Team Digest' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Funnel').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Export/ })).toHaveCount(0);
  await shot(page, 'v14-1-team-digest-pod-admin');
  expect(clean(c)).toEqual([]);
});

test('Data Export: off for others, on after a Super Admin grants it, off again after revoking (live, then restored)', async ({ request }) => {
  test.skip(!SDR.token, 'SDR token missing');
  const users = (await api(request, 'GET', '/api/admin/users', SA.token)).body;
  const sdr = users.find((u) => u.role === 'SDR' && !u.export_enabled && u.access_allowed !== false);
  test.skip(!sdr, 'no SDR to use');
  // Only act on the SDR whose token we hold: look their id up from their own token.
  const me = (await api(request, 'GET', '/api/auth/me', SDR.token)).body;
  test.skip(!me?.sub, 'cannot identify the SDR');
  const before = (await api(request, 'GET', '/api/my-day/export', SDR.token)).status;
  expect(before, 'export is off by default').toBe(403);
  try {
    expect((await api(request, 'PATCH', `/api/admin/users/${me.sub}/settings`, SA.token, { export_enabled: true })).status).toBe(200);
    expect((await api(request, 'GET', '/api/me/capabilities', SDR.token)).body.export).toBe(true);
    expect((await api(request, 'GET', '/api/my-day/export', SDR.token)).status).toBe(200);
    expect((await api(request, 'GET', '/api/admin/leads/export?date_from=2000-01-01', SDR.token)).status).toBe(403);      // role gate still applies
  } finally {
    await api(request, 'PATCH', `/api/admin/users/${me.sub}/settings`, SA.token, { export_enabled: false });
  }
  expect((await api(request, 'GET', '/api/my-day/export', SDR.token)).status, 'revoked').toBe(403);
});

// ── v14.1.0 follow-up: Data Export column, blocking a Super Admin, custom range, shared Digest views ──────────────────────
async function openUsers(page, token) {
  await login(page, token);
  await closeAircall(page);
  await page.locator('nav').getByText('Control Center', { exact: false }).first().click();
  await page.getByRole('button', { name: 'Team & Access' }).first().click().catch(() => {});
  await expect(page.getByText('Data Export').first()).toBeVisible({ timeout: 30000 });
}

test('Users table: Data Export is a labelled switch on every row, Super Admins included (no "Always" badge)', async ({ page }) => {
  const c = watch(page);
  await openUsers(page, SA.token);
  await expect(page.getByText('Always', { exact: true })).toHaveCount(0);
  const switches = page.getByRole('checkbox', { name: /exporting data/ });
  expect(await switches.count()).toBeGreaterThan(1);
  await expect(page.getByText('On', { exact: true }).first()).toBeVisible();                 // the state is written out, not just a knob
  await expect(page.getByText('Off', { exact: true }).first()).toBeVisible();
  await shot(page, 'v14-1-users-export-column');
  expect(clean(c)).toEqual([]);
});

test('Users table: blocking yourself is refused and nothing changes; a Pod Admin only reads the column', async ({ page, request }) => {
  const me = (await api(request, 'GET', '/api/auth/me', SA.token)).body;
  const own = (await api(request, 'GET', '/api/admin/users', SA.token)).body.find((u) => u.id === me.sub);
  test.skip(!own, 'own row not listed');
  await openUsers(page, SA.token);
  await page.getByPlaceholder('Search by name or email…').fill(own.email);        // the table is paged
  await page.getByRole('checkbox', { name: new RegExp(`Block ${own.name || own.email} exporting data`) }).click({ force: true });
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Block data export?');
  await expect(dlg).toContainText('even though their role normally can');
  await dlg.getByRole('button', { name: 'Block Export' }).click();
  await expect(page.getByText('You cannot switch off your own export access.')).toBeVisible({ timeout: 15000 });
  expect((await api(request, 'GET', '/api/admin/users', SA.token)).body.find((u) => u.id === me.sub).export_enabled, 'still on').toBe(true);
  expect((await api(request, 'GET', '/api/me/capabilities', SA.token)).body.export).toBe(true);

  test.skip(!PA.token, 'POD_ADMIN_TOKEN missing');
  const pa = await page.context().newPage();
  await openUsers(pa, PA.token);
  await expect(pa.getByRole('checkbox', { name: /exporting data/ })).toHaveCount(0);
  await expect(pa.getByText('Off', { exact: true }).first()).toBeVisible();
});

test('Team Digest: choosing Custom range never leaves a blank page — it starts from the last 7 days with the picker open to edit', async ({ page }) => {
  const c = watch(page);
  await login(page, SA.token);
  await closeAircall(page);
  await page.locator('nav').getByText('Team Digest', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Team Digest' })).toBeVisible({ timeout: 30000 });
  await page.getByLabel('Period').click();
  await page.getByRole('menuitem', { name: 'Custom range…' }).click();
  await expect(page.getByLabel('Digest dates')).toBeVisible();
  await expect(page.getByText('Pick the dates')).toHaveCount(0);
  await expect(page.getByText(/What your team did over .* compared with the previous 7 days/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Campaigns', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Date range', { exact: true })).toHaveCount(0);                // the picker shows the dates, not its placeholder
  // the calendar: no future days, fully on screen, and picking a new range updates the page without blanking it
  const dayName = (d) => { const n = d.getUTCDate(); const o = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'; return new RegExp(`${d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${n}${o}, ${d.getUTCFullYear()}`); };
  const day = (back) => new Date(Date.now() - back * 86400000);
  await page.getByLabel('Digest dates').click();
  const cal = page.locator('.rdp-root').first();
  await expect(cal).toBeVisible();
  const box = await cal.boundingBox();
  const vw = page.viewportSize().width;
  expect(box.x, 'calendar starts on screen').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, 'calendar ends on screen').toBeLessThanOrEqual(vw);
  await expect(page.getByRole('button', { name: dayName(day(0)) }).first(), 'today cannot be picked').toBeDisabled();
  await expect(page.getByRole('button', { name: dayName(day(1)) }).first(), 'yesterday can').toBeEnabled();
  await shot(page, 'v14-1-digest-custom-picker');
  await page.getByRole('button', { name: dayName(day(12)) }).first().click();
  await expect(page.getByText('Pick the dates')).toHaveCount(0);                 // half-picked: the page keeps its last range
  await page.getByRole('button', { name: dayName(day(9)) }).first().click();
  await expect(page.getByText(/What your team did over/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Date must be in the past.')).toHaveCount(0);
  await shot(page, 'v14-1-digest-custom');
  expect(clean(c)).toEqual([]);
});

test('Digest views: an admin can share one with the team, reps see it read-only and cannot share or delete (live, then removed)', async ({ request }) => {
  test.skip(!SDR.token, 'SDR token missing');
  const body = { scope: 'digest', name: `pw-shared-${Date.now()}`, keys: ['calls_made', 'new_leads'], filters: { period: 'last7' }, shared: true };
  expect((await api(request, 'POST', '/api/me/saved-views', SDR.token, body)).status, 'a rep cannot share').toBe(403);
  const made = await api(request, 'POST', '/api/me/saved-views', SA.token, body);
  expect(made.status).toBe(200);
  try {
    const seen = (await api(request, 'GET', '/api/me/saved-views?scope=digest', SDR.token)).body.views.find((v) => v.id === made.body.id);
    expect(seen, 'the rep sees it').toBeTruthy();
    expect(seen.mine).toBe(false);
    expect((await api(request, 'DELETE', `/api/me/saved-views/${made.body.id}`, SDR.token)).status).toBe(404);
    const leads = (await api(request, 'GET', '/api/me/saved-views?scope=leads', SDR.token)).body.views;
    expect(leads.find((v) => v.id === made.body.id), 'not in the Leads page list').toBeFalsy();
  } finally {
    expect((await api(request, 'DELETE', `/api/me/saved-views/${made.body.id}`, SA.token)).status).toBe(200);
  }
});
