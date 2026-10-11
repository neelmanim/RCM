// v14.3.0 on STAGING — Team Digest drill-downs (by segment, accounts, calls), the editable ICP, clearer Salesforce mapping messages.
// The only write is the ICP words, put back in a finally block; the mapping check is a refused (400) request, so nothing is saved.
//   npx playwright test tests/v14-3-0-drilldown.spec.js
const { test, expect } = require('@playwright/test');
const { warmUp, APP_VERSION, API, PERSONAS, watch, login, shot, api } = require('./helpers/v13-7-0-staging');

const SA = PERSONAS.sa, PA = PERSONAS.pa, SDR = PERSONAS.sdr;
test.beforeAll(async ({ request }) => { await warmUp(request); });
test.skip(!SA.token, 'SA_TOKEN missing from .env.test');
const clean = (c) => c.problems().filter((p) => !/^(40[139]|409) /.test(p));
const DIMS = ['icp', 'industry', 'country', 'city', 'seniority', 'function', 'company_size', 'source'];
const B = '/api/admin/analytics/daily-digest';

// a fixed past window long enough to hold real activity on staging
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const Q = `from=${day(30)}&to=${day(1)}`;

async function closeAircall(page) {
  const h = page.getByText('Aircall — log in below');
  if (await h.isVisible({ timeout: 4000 }).catch(() => false)) {
    await h.locator('xpath=ancestor::*[.//button][1]').locator('button').first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

test('staging runs this release', async ({ request }) => {
  expect((await (await request.get(`${API}/api/health`)).json()).version).toBe(APP_VERSION);
});

test('every breakdown answers, adds up, and agrees with the Digest on calls', async ({ request }) => {
  const digest = (await api(request, 'GET', `/api/admin/analytics/daily-digest?${Q}`, SA.token)).body;
  for (const d of DIMS) {
    const r = await api(request, 'GET', `${B}/breakdown?${Q}&dimension=${d}`, SA.token);
    expect(r.status, d).toBe(200);
    const b = r.body;
    expect(b.total.calls, `${d}: total calls = the Digest's calls`).toBe(digest.kpi.calls_made.today);
    if (!b.more) expect(b.rows.reduce((n, x) => n + x.calls, 0), `${d}: rows add up`).toBe(b.total.calls);
    expect(b.coverage.pct).toBeGreaterThanOrEqual(0);
    expect(b.coverage.pct).toBeLessThanOrEqual(100);
    for (const x of b.rows) expect(x.connect_rate, `${d}/${x.label}`).toBeLessThanOrEqual(100);
  }
});

test('conversions and bookings equal the Funnel numbers, and the comparison period equals a fresh run on it', async ({ request }) => {
  const fun = (await api(request, 'GET', `/api/admin/analytics/sales-funnel?${Q}`, SA.token)).body.total;
  const b = (await api(request, 'GET', `${B}/breakdown?${Q}&dimension=country`, SA.token)).body;
  expect([b.total.conversations, b.total.booked, b.total.held, b.total.no_show]).toEqual([fun.conversations, fun.booked, fun.held, fun.no_show]);
  const span = 30;
  const prevTo = day(31), prevFrom = day(31 + span - 1);
  const fresh = (await api(request, 'GET', `${B}/breakdown?from=${prevFrom}&to=${prevTo}&dimension=country&compare=false`, SA.token)).body;
  expect([b.total.prev.calls, b.total.prev.conversations, b.total.prev.booked]).toEqual([fresh.total.calls, fresh.total.conversations, fresh.total.booked]);
  for (const x of b.rows) {
    expect(x.lead_to_conversation).toBeLessThanOrEqual(100);
    expect(x.held_rate).toBeLessThanOrEqual(100);
    if (x.prev.calls === 0 && x.calls > 0) expect(x.delta.calls).toBe('new');
  }
  const off = (await api(request, 'GET', `${B}/breakdown?${Q}&dimension=country&compare=false`, SA.token)).body;
  expect(off.compared).toBe(false);
  expect(off.rows.every((x) => x.prev === undefined)).toBe(true);
});

test('the Excel download works, matches the screen, and is recorded; a bad request leaves no record', async ({ request }) => {
  const before = (await api(request, 'GET', '/api/admin/audit-log?category=export&per_page=1', SA.token)).body.total;
  const bad = await api(request, 'GET', `${B}/drilldown.xlsx?${Q}&dimension=shoe`, SA.token);
  expect(bad.status).toBe(400);
  expect((await api(request, 'GET', '/api/admin/audit-log?category=export&per_page=1', SA.token)).body.total, 'no file, no record').toBe(before);
  const r = await request.get(`${API}${B}/drilldown.xlsx?${Q}&dimension=country`, { headers: { Authorization: `Bearer ${SA.token}` } });
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toContain('spreadsheetml');
  const buf = await r.body();
  expect(buf.slice(0, 2).toString()).toBe('PK');                       // a real .xlsx (zip)
  const log = (await api(request, 'GET', '/api/admin/audit-log?category=export&per_page=3', SA.token)).body;
  expect(log.total).toBe(before + 1);
  expect(log.items[0].summary).toBe('Team Digest drill-down (Excel)');
  expect(log.items[0].actor_email).toBeTruthy();
  if (SDR.token) expect((await api(request, 'GET', `${B}/drilldown.xlsx?${Q}`, SDR.token)).status).toBe(403);
});

test('accounts and calls agree with each other', async ({ request }) => {
  const a = (await api(request, 'GET', `${B}/accounts?${Q}`, SA.token)).body;
  const c = (await api(request, 'GET', `${B}/calls?${Q}`, SA.token)).body;
  expect(a.summary.accounts).toBeGreaterThanOrEqual(0);
  expect(Object.values(a.summary.stages).reduce((n, x) => n + x, 0)).toBe(a.summary.accounts);
  expect(c.outcomes.reduce((n, x) => n + x.calls, 0)).toBe(c.total);
  expect(c.by_hour.reduce((n, x) => n + x.calls, 0)).toBeLessThanOrEqual(c.total);
  expect(c.connect_rate).toBeLessThanOrEqual(100);
  const digest = (await api(request, 'GET', `/api/admin/analytics/daily-digest?${Q}`, SA.token)).body;
  expect(c.total).toBe(digest.kpi.calls_made.today);
});

test('who may look: Super Admin and Pod Admin yes (pod only), SDR no; bad input is a clear 400', async ({ request }) => {
  const sa = (await api(request, 'GET', `${B}/breakdown?${Q}&dimension=country`, SA.token)).body;
  if (PA.token) {
    const pa = await api(request, 'GET', `${B}/breakdown?${Q}&dimension=country`, PA.token);
    expect(pa.status).toBe(200);
    expect(pa.body.total.calls, 'a Pod Admin never sees more than the whole org').toBeLessThanOrEqual(sa.total.calls);
    const other = await api(request, 'GET', `${B}/breakdown?${Q}&dimension=country&pod_id=not-my-pod`, PA.token);
    expect(other.body.total.calls, 'a pod_id from a Pod Admin changes nothing').toBe(pa.body.total.calls);
  }
  if (SDR.token) for (const p of ['breakdown', 'accounts', 'calls']) expect((await api(request, 'GET', `${B}/${p}?${Q}`, SDR.token)).status).toBe(403);
  expect((await api(request, 'GET', `${B}/breakdown?${Q}&dimension=shoe_size`, SA.token)).status).toBe(400);
  expect((await api(request, 'GET', `${B}/breakdown?from=2099-01-01&to=2099-01-02`, SA.token)).status).toBe(400);
  expect((await api(request, 'GET', `${B}/breakdown?from=${day(10)}`, SA.token)).status).toBe(400);
});

test('Team Digest shows the drill-down: ICP first, a dimension menu, Accounts and Calls tabs', async ({ page }) => {
  const c = watch(page);
  await login(page, SA.token);
  await closeAircall(page);
  await page.locator('nav').getByText('Team Digest', { exact: true }).first().click();
  const card = page.locator('[data-tour="digest-drilldown"]');
  await expect(card.getByText('Drill-down', { exact: true })).toBeVisible({ timeout: 30000 });
  await expect(card.getByText(/In ICP|Outside ICP|Industry not filled in|No activity/).first()).toBeVisible({ timeout: 30000 });
  await expect(card.getByText(/Filled in|Nothing was called/).first()).toBeVisible();
  await card.locator('[data-tab="accounts"]').click();
  await expect(card.getByText(/Accounts worked|No activity/).first()).toBeVisible({ timeout: 30000 });
  await card.locator('[data-tab="calls"]').click();
  await expect(card.getByText(/Connect rate|No activity/).first()).toBeVisible({ timeout: 30000 });
  await card.locator('[data-tab="segment"]').click();
  await expect(card.getByText(/Leads spoken to %/).first()).toBeVisible();
  await expect(card.getByText(/compare with/).first()).toBeVisible();
  await expect(card.getByRole('button', { name: /Export/ })).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), card.getByRole('button', { name: /Export/ }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^team-digest-drilldown-.*\.xlsx$/);
  await card.getByLabel('Break down by').click();
  await page.getByRole('menuitem', { name: 'Country' }).click();
  await expect(card.getByText(/Country/).first()).toBeVisible();
  await shot(page, 'v14-3-drilldown');
  expect(clean(c)).toEqual([]);
});

test('ICP: Super Admin only, every change recorded, and the breakdown follows it (live, restored)', async ({ page, request }) => {
  const before = (await api(request, 'GET', '/api/admin/analytics/icp', SA.token)).body.keywords;
  try {
    if (PA.token) expect((await api(request, 'PUT', '/api/admin/analytics/icp', PA.token, { keywords: ['x'] })).status).toBe(403);
    if (SDR.token) expect((await api(request, 'PUT', '/api/admin/analytics/icp', SDR.token, { keywords: ['x'] })).status).toBe(403);
    expect((await api(request, 'PUT', '/api/admin/analytics/icp', SA.token, { keywords: [] })).status).toBe(400);
    const words = ['zzz-no-such-industry'];
    const set = await api(request, 'PUT', '/api/admin/analytics/icp', SA.token, { keywords: words });
    expect(set.status).toBe(200);
    const b = (await api(request, 'GET', `${B}/breakdown?${Q}&dimension=icp`, SA.token)).body;
    expect(b.icp_keywords).toEqual(words);
    expect(b.rows.find((x) => x.label === 'In ICP'), 'nobody matches a made-up word').toBeUndefined();
    const ev = (await api(request, 'GET', '/api/admin/audit-log?category=setting&per_page=3', SA.token)).body.items;
    expect(ev[0].summary).toContain('zzz-no-such-industry');
    expect(ev[0].actor_email).toBeTruthy();
    // and from the screen: open the dialog, see the words, cancel (nothing changes)
    await login(page, SA.token);
    await closeAircall(page);
    await page.locator('nav').getByText('Team Digest', { exact: true }).first().click();
    const card = page.locator('[data-tour="digest-drilldown"]');
    await card.getByRole('button', { name: /Edit ICP/ }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByLabel(/Industry words/)).toHaveValue('zzz-no-such-industry', { timeout: 15000 });
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    expect((await api(request, 'GET', '/api/admin/analytics/icp', SA.token)).body.keywords).toEqual(words);
  } finally {
    await api(request, 'PUT', '/api/admin/analytics/icp', SA.token, { keywords: before });
  }
  expect((await api(request, 'GET', '/api/admin/analytics/icp', SA.token)).body.keywords).toEqual(before);
});

test('adding a field Alternate CRM already sends says which built-in covers it (and saves nothing)', async ({ request }) => {
  const list = async () => (await api(request, 'GET', '/api/admin/sf-field-mappings', SA.token)).body;
  const before = await list();
  const r = await api(request, 'POST', '/api/admin/sf-field-mappings', SA.token, { lead_field: 'total_funding', sf_field: 'Country' });
  expect(r.status).toBe(400);
  expect(r.body.detail).toContain('built-in "Country" mapping');
  expect(r.body.detail).not.toContain('managed by Alternate CRM');
  expect(await list()).toEqual(before);
});

test('every number can be followed to its leads: the leads behind a row add up to the row', async ({ request }) => {
  const b = (await api(request, 'GET', `${B}/breakdown?${Q}&dimension=country&compare=false`, SA.token)).body;
  const row = b.rows.find((x) => x.leads > 0 && x.label !== 'No lead on record');
  test.skip(!row, 'no activity on staging in the window');
  const l = (await api(request, 'GET', `${B}/drilldown/leads?${Q}&dimension=country&segment=${encodeURIComponent(row.label)}`, SA.token)).body;
  expect(l.total).toBe(row.leads);
  if (!l.more) expect([l.rows.reduce((n, x) => n + x.calls, 0), l.rows.reduce((n, x) => n + x.conversations, 0), l.rows.reduce((n, x) => n + x.booked, 0)]).toEqual([row.calls, row.conversations, row.booked]);
  const a = (await api(request, 'GET', `${B}/accounts?${Q}`, SA.token)).body;
  const acc = a.rows[0];
  if (acc) expect((await api(request, 'GET', `${B}/drilldown/leads?${Q}&account=${encodeURIComponent(acc.key)}`, SA.token)).body.total).toBe(acc.people_tried);
  const stage = a.rows.find((x) => x.stage === 'Tried, not reached');
  if (stage) {
    const only = (await api(request, 'GET', `${B}/accounts?${Q}&stage=${encodeURIComponent('Tried, not reached')}`, SA.token)).body;
    expect(only.rows.every((x) => x.stage === 'Tried, not reached')).toBe(true);
    expect(only.summary).toEqual(a.summary);
  }
});

test('the card is clean: short columns first, a row opens its leads, the stage filter and the lead source read sensibly', async ({ page, request }) => {
  const c = watch(page);
  await login(page, SA.token);
  await closeAircall(page);
  await page.locator('nav').getByText('Team Digest', { exact: true }).first().click();
  const card = page.locator('[data-tour="digest-drilldown"]');
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByText(/Leads worked|No activity/).first()).toBeVisible({ timeout: 45000 });
  // short column list first; the rest on request
  await expect(card.getByRole('columnheader', { name: /^Emails/ })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'More columns' })).toBeVisible();
  await card.getByRole('button', { name: 'More columns' }).click();
  await expect(card.getByRole('columnheader', { name: /^Emails/ })).toBeVisible();
  await card.getByRole('button', { name: 'Fewer columns' }).click();
  // the lead source is a handful of kinds, not thousands of timestamps
  await card.getByLabel('Break down by').click();
  await page.getByRole('menuitem', { name: 'Lead source' }).click();
  await expect(card.getByText(/Uploaded file|Google Sheet|Klenty sync|Manual|Not filled in|No activity/).first()).toBeVisible({ timeout: 30000 });
  expect(await card.locator('tbody tr').count()).toBeLessThan(15);
  // a row opens the leads behind it
  const clickable = card.locator('tbody tr[tabindex="0"]').first();
  if (await clickable.count()) {
    await clickable.click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByText(/Click a lead to open it|No leads|Could not load/)).toBeVisible({ timeout: 30000 });
    await shot(page, 'v14-3-drilldown-leads');
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
  }
  // accounts: stage filter
  await card.locator('[data-tab="accounts"]').click();
  await expect(card.getByText(/Accounts worked|No activity/).first()).toBeVisible({ timeout: 30000 });
  if (await card.getByLabel('Show accounts at stage').count()) {
    await card.getByLabel('Show accounts at stage').click();
    await page.getByRole('menuitem', { name: /Tried, not reached/ }).click();
    await expect(card.getByText(/Tried, not reached|No accounts at this stage/).first()).toBeVisible({ timeout: 30000 });
  }
  await shot(page, 'v14-3-drilldown-accounts');
  expect(clean(c)).toEqual([]);
});
