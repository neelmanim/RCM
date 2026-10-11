// v14.2.0 on STAGING — settings show the truth at once, the permanent export record, editable built-in Salesforce mappings.
// Every change a test makes is reversed in a finally block; only QA-MATRIX users and a harmless built-in mapping are touched.
//   npx playwright test tests/v14-2-0-settings.spec.js
const { test, expect } = require('@playwright/test');
const { warmUp, APP_VERSION, API, PERSONAS, watch, login, shot, api } = require('./helpers/v13-7-0-staging');

const SA = PERSONAS.sa, PA = PERSONAS.pa, SDR = PERSONAS.sdr;
test.beforeAll(async ({ request }) => { await warmUp(request); });
test.skip(!SA.token, 'SA_TOKEN missing from .env.test');
const clean = (c) => c.problems().filter((p) => !/^(40[139]|409) /.test(p));
const log = async (request, qs = '') => (await api(request, 'GET', `/api/admin/audit-log?${qs}`, SA.token)).body;

async function closeAircall(page) {
  const h = page.getByText('Aircall — log in below');
  if (await h.isVisible({ timeout: 4000 }).catch(() => false)) {
    await h.locator('xpath=ancestor::*[.//button][1]').locator('button').first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
}
async function openControlCenter(page, token, tab) {
  await login(page, token);
  await closeAircall(page);
  await page.locator('nav').getByText('Control Center', { exact: false }).first().click();
  await page.getByRole('button', { name: tab }).first().click().catch(() => {});
}

test('staging runs this release', async ({ request }) => {
  expect((await (await request.get(`${API}/api/health`)).json()).version).toBe(APP_VERSION);
});

// ── the audit trail ─────────────────────────────────────────────────────────────────────────────────────────────
test('the audit log is for Super Admins only', async ({ request }) => {
  expect((await api(request, 'GET', '/api/admin/audit-log', SA.token)).status).toBe(200);
  if (PA.token) expect((await api(request, 'GET', '/api/admin/audit-log', PA.token)).status).toBe(403);
  if (SDR.token) expect((await api(request, 'GET', '/api/admin/audit-log', SDR.token)).status).toBe(403);
});

test('a download is recorded with who and when, and a refused one is not', async ({ request }) => {
  const before = (await log(request, 'category=export')).total;
  expect((await api(request, 'GET', '/api/my-day/export', SA.token)).status).toBe(200);
  const after = await log(request, 'category=export&per_page=5');
  expect(after.total).toBe(before + 1);
  const top = after.items[0];
  expect(top.summary).toBe('My Day CSV');
  expect(top.actor_email).toBeTruthy();
  expect(Math.abs(Date.now() - new Date(top.at).getTime()), 'time is now, not a stale or zero date').toBeLessThan(120000);
  if (PA.token) {
    expect((await api(request, 'GET', '/api/my-day/export', PA.token)).status).toBe(403);
    expect((await log(request, 'category=export')).total, 'refusal leaves no record').toBe(before + 1);
    expect((await api(request, 'POST', '/api/me/export-event', PA.token, { what: 'x', rows: 1 })).status).toBe(403);
  }
});

test('a CSV built in the browser is recorded too (Activity Monitor → Export CSV)', async ({ page, request }) => {
  const c = watch(page);
  const before = (await log(request, 'category=export')).total;
  await login(page, SA.token);
  await closeAircall(page);
  await page.locator('nav').getByText('Activity Monitor', { exact: true }).first().click();
  const btn = page.getByRole('button', { name: /Export CSV/ }).first();
  await expect(btn).toBeVisible({ timeout: 30000 });
  const download = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  await btn.click();
  await download;
  await expect.poll(async () => (await log(request, 'category=export')).total, { timeout: 30000 }).toBeGreaterThan(before);
  const kinds = (await log(request, 'category=export&per_page=5')).items.map((e) => e.action);
  expect(kinds).toContain('BROWSER_CSV');
  expect(clean(c)).toEqual([]);
});

test('Export History tab: Super Admin sees it with people and times; a Pod Admin has no such tab', async ({ page, browser }) => {
  const c = watch(page);
  await openControlCenter(page, SA.token, 'Team & Access');
  await page.getByRole('tab', { name: 'Export History' }).or(page.getByText('Export History', { exact: true })).first().click();
  await expect(page.getByText(/nothing here can be edited/)).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('columnheader', { name: 'When' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Who' })).toBeVisible();
  await shot(page, 'v14-2-export-history');
  await page.getByLabel('Kind').click();
  await page.getByRole('menuitem', { name: 'Access changes only' }).click();
  await page.waitForTimeout(800);
  expect(clean(c)).toEqual([]);
  if (PA.token) {
    const ctx = await browser.newContext();                 // a separate login: the same context would share the Super Admin's session
    const pa = await ctx.newPage();
    await openControlCenter(pa, PA.token, 'Team & Access');
    await expect(pa.getByText('Data Export').first()).toBeVisible({ timeout: 30000 });
    await expect(pa.getByText('Export History', { exact: true })).toHaveCount(0);
    await ctx.close();
  }
});

// ── a changed setting shows its new state at once, and keeps it ─────────────────────────────────────────────────
test('Data Export switch: shows the new state immediately, survives a reload, and every change is recorded (live, restored)', async ({ page, request }) => {
  const c = watch(page);
  const users = (await api(request, 'GET', '/api/admin/users?fresh=true', SA.token)).body;
  const qa = users.find((u) => /qa-matrix-rep-a@/i.test(u.email) && u.role === 'SDR');
  test.skip(!qa, 'QA-MATRIX rep-a not on staging');
  await api(request, 'PATCH', `/api/admin/users/${qa.id}/settings`, SA.token, { export_enabled: false });
  page.on('response', async (r) => { if (/\/api\/admin\/users(\?|$|\/.*settings)/.test(r.url())) { let v = ''; try { const b = await r.json(); v = Array.isArray(b) ? JSON.stringify(b.find((u) => u.id === qa.id)?.export_enabled) : JSON.stringify(b.export_enabled); } catch {} console.log('NET', r.request().method(), r.status(), r.url().replace(/^.*\/api/, ''), v); } });
  try {
    await openControlCenter(page, SA.token, 'Team & Access');
    await page.getByPlaceholder('Search by name or email…').fill(qa.email);
    const row = page.getByRole('row').filter({ hasText: qa.email });
    await expect(row.getByText('Off', { exact: true })).toBeVisible({ timeout: 30000 });
    await row.getByRole('checkbox').click({ force: true });
    await page.getByRole('dialog').getByRole('button', { name: 'Allow Export' }).click();
    await expect(row.getByText('On', { exact: true }), 'On straight away, no reload').toBeVisible({ timeout: 10000 });
    await expect(row.getByRole('checkbox')).toBeChecked();
    const srv = (await api(request, 'GET', '/api/admin/users?fresh=true', SA.token)).body.find((u) => u.id === qa.id).export_enabled;
    expect(srv, 'the server really has it On right after the click').toBe(true);
    await page.waitForTimeout(3000);
    await expect(row.getByText('On', { exact: true }), 'still On 3s later').toBeVisible();
    await page.reload();
    await openControlCenter(page, SA.token, 'Team & Access');
    await page.getByPlaceholder('Search by name or email…').fill(qa.email);
    await expect(page.getByRole('row').filter({ hasText: qa.email }).getByText('On', { exact: true })).toBeVisible({ timeout: 30000 });
    // turn off from the UI (no confirmation for a rep) and see Off at once
    const r2 = page.getByRole('row').filter({ hasText: qa.email });
    await r2.getByRole('checkbox').click({ force: true });
    await expect(r2.getByText('Off', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(r2.getByRole('checkbox')).not.toBeChecked();
    const ev = (await log(request, `category=export_access&q=${encodeURIComponent(qa.email)}&per_page=5`)).items;
    expect(ev.map((e) => e.action).slice(0, 2)).toEqual(['BLOCKED', 'ALLOWED']);
    expect(ev[0].actor_email).toBeTruthy();
    // the page.reload() boots the app a moment before the test re-applies the login, so background polls 401 once and the bell logs it
    expect(clean(c).filter((p) => !/NotificationBell/.test(p))).toEqual([]);
  } finally {
    await api(request, 'PATCH', `/api/admin/users/${qa.id}/settings`, SA.token, { export_enabled: false });
  }
});

test('no stale reads: after each change, both the cached and the fresh user list agree, many times over (two workers)', async ({ request }) => {
  const users = (await api(request, 'GET', '/api/admin/users?fresh=true', SA.token)).body;
  const qa = users.find((u) => /qa-matrix-rep-a@/i.test(u.email) && u.role === 'SDR');
  test.skip(!qa, 'QA-MATRIX rep-a not on staging');
  const state = async (qs) => (await api(request, 'GET', `/api/admin/users${qs}`, SA.token)).body.find((u) => u.id === qa.id).export_enabled;
  try {
    for (let i = 0; i < 6; i++) {
      const want = i % 2 === 0;
      expect((await api(request, 'PATCH', `/api/admin/users/${qa.id}/settings`, SA.token, { export_enabled: want })).status).toBe(200);
      for (let k = 0; k < 4; k++) expect(await state(''), `cached list, round ${i}, read ${k}`).toBe(want);       // the path that used to go stale
      expect(await state('?fresh=true')).toBe(want);
    }
  } finally {
    await api(request, 'PATCH', `/api/admin/users/${qa.id}/settings`, SA.token, { export_enabled: false });
  }
});

test('the users list is not kept by the browser (the cause of "saved, but still shows the old value")', async ({ request }) => {
  for (const qs of ['', '?fresh=true']) {
    const r = await request.fetch(`${API}/api/admin/users${qs}`, { headers: { Authorization: `Bearer ${SA.token}` } });
    expect(r.headers()['cache-control'], qs).toBe('no-store');
  }
});

test('the user list keeps the same order on every read', async ({ request }) => {
  const ids = async () => (await api(request, 'GET', '/api/admin/users?fresh=true', SA.token)).body.map((u) => u.id);
  const first = await ids();
  for (let i = 0; i < 3; i++) expect(await ids()).toEqual(first);
});

test('a Super Admin cannot switch off their own export, and nothing is recorded for the refusal', async ({ request }) => {
  const me = (await api(request, 'GET', '/api/auth/me', SA.token)).body;
  const before = (await log(request, 'category=export_access')).total;
  const r = await api(request, 'PATCH', `/api/admin/users/${me.sub}/settings`, SA.token, { export_enabled: false });
  expect(r.status).toBe(400);
  expect((await log(request, 'category=export_access')).total).toBe(before);
});

// ── Salesforce mapping: history and editable built-ins ──────────────────────────────────────────────────────────
async function openMapping(page) {
  await login(page, SA.token);
  await closeAircall(page);
  await page.locator('nav').getByText('Control Center', { exact: false }).first().click();
  await page.getByRole('button', { name: 'Integrations' }).first().click().catch(() => {});
  await expect(page.getByText('Salesforce Field Mapping')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: /built-in fields/ }).click();
}

test('built-in mappings: five are required, the rest can be edited, a bad name is refused in the dialog, switch-off asks first', async ({ page, request }) => {
  const c = watch(page);
  const before = (await api(request, 'GET', '/api/admin/sf-field-mappings', SA.token)).body.builtin;
  await openMapping(page);
  await expect(page.getByText('Required', { exact: true })).toHaveCount(5);
  await expect(page.getByLabel('Edit Email')).toHaveCount(0);
  await page.getByLabel('Edit Job title').click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByLabel('Salesforce API name')).toHaveValue('Job_Title__c');
  await dlg.getByLabel('Salesforce API name').fill('Not_A_Real_Field__c');
  await dlg.getByRole('button', { name: 'Save Mapping' }).click();
  await expect(dlg.getByRole('alert')).toContainText(/Lead object has no field called Not_A_Real_Field__c|already|Salesforce/i, { timeout: 30000 });
  await dlg.getByLabel('Salesforce API name').fill('x');
  await expect(dlg.getByRole('alert')).toHaveCount(0);                                   // typing clears it
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('checkbox', { name: 'Send Industry' }).click({ force: true });
  await expect(page.getByRole('dialog')).toContainText('will no longer be sent to Industry');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await shot(page, 'v14-2-builtin-mappings');
  const after = (await api(request, 'GET', '/api/admin/sf-field-mappings', SA.token)).body.builtin;
  expect(after, 'cancelled and refused edits changed nothing').toEqual(before);
  expect(clean(c).filter((p) => !/^400 PATCH .*\/builtin\/title/.test(p)), 'only the deliberate refusal').toEqual([]);
});

test('switching a built-in off and on is recorded in History with who and when (live, restored)', async ({ page, request }) => {
  const key = 'industry';
  const state = async () => (await api(request, 'GET', '/api/admin/sf-field-mappings', SA.token)).body.builtin.find((b) => b.lead_field === key);
  expect((await state()).enabled).toBe(true);
  try {
    await openMapping(page);
    await page.getByRole('checkbox', { name: 'Send Industry' }).click({ force: true });
    await page.getByRole('dialog').getByRole('button', { name: 'Stop Sending' }).click();
    await expect(page.getByRole('checkbox', { name: 'Send Industry' })).not.toBeChecked({ timeout: 10000 });
    expect((await state()).enabled).toBe(false);
    await page.getByRole('checkbox', { name: 'Send Industry' }).click({ force: true });
    await expect(page.getByRole('checkbox', { name: 'Send Industry' })).toBeChecked({ timeout: 10000 });
    expect((await state()).enabled).toBe(true);
    await page.getByRole('button', { name: 'History' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByText(/Changed mapping Industry: switched off \(built-in\)/).first()).toBeVisible({ timeout: 30000 });
    await expect(dlg.getByText(/Changed mapping Industry: switched on \(built-in\)/).first()).toBeVisible();
    await shot(page, 'v14-2-mapping-history');
    const ev = (await log(request, 'category=sf_mapping&per_page=2')).items;
    expect(ev.map((e) => e.action)).toEqual(['CHANGED', 'CHANGED']);
    expect(ev[0].actor_email).toBeTruthy();
  } finally {
    await api(request, 'PATCH', `/api/admin/sf-field-mappings/builtin/${key}`, SA.token, { enabled: true });
  }
});

test('locked built-ins cannot be changed even by calling the API directly', async ({ request }) => {
  for (const key of ['first_name', 'last_name', 'email', 'phone', 'status']) {
    expect((await api(request, 'PATCH', `/api/admin/sf-field-mappings/builtin/${key}`, SA.token, { enabled: false })).status, key).toBe(400);
  }
  expect((await api(request, 'PATCH', '/api/admin/sf-field-mappings/builtin/title', PA.token || SDR.token, { enabled: false })).status).toBe(403);
});
