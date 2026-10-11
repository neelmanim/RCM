// v13.9.4 on STAGING — My Day, the honest Dashboard cards, SDR Performance's real pipeline, saved views per user.
// Throwaway data only (one PW-v1394 lead + one saved view), removed afterwards. Never touches the demo cadences/leads.
//   npx playwright test tests/v13-9-4-my-day-dashboard.spec.js
const { test, expect } = require('@playwright/test');
const { APP_VERSION, BASE_URL, API, PERSONAS, watch, login, go, shot, api } = require('./helpers/v13-7-0-staging');

const SA = PERSONAS.sa, SDR = PERSONAS.sdr;
const STAMP = Date.now();
const NAME = `PW-v1394 Lead${STAMP}`;
const VIEW = `PW-v1394 view ${STAMP}`;
const sub = (t) => JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).sub;
const created = { leadId: null };

test.describe.configure({ mode: 'serial' });
test.skip(!SA.token || !SDR.token, 'SA_TOKEN / SDR_DEVKAPOOR_TOKEN missing from .env.test');

const problems = (c) => c.problems().filter((p) => !/^(40[139]) /.test(p) && !/^409 /.test(p));

test.afterAll(async ({ request }) => {
  if (created.leadId) await api(request, 'POST', '/api/admin/leads/bulk-delete', SA.token, { lead_ids: [created.leadId] });
  const views = await api(request, 'GET', '/api/me/saved-views', SDR.token);
  for (const v of (views.body?.views || []).filter((x) => x.name.startsWith('PW-v1394'))) {
    await api(request, 'DELETE', `/api/me/saved-views/${v.id}`, SDR.token);
  }
});

test('staging runs this release', async ({ request }) => {
  const r = await request.get(`${API}/api/health`);
  expect((await r.json()).version).toBe(APP_VERSION);
});

test('My Day API: a lead assigned to the SDR shows up as given today, in the SDR\'s own day', async ({ request }) => {
  const lead = await api(request, 'POST', '/api/leads', SA.token, {
    first_name: 'PW-v1394', last_name: `Lead${STAMP}`, company: `PW-v1394 Co ${STAMP}`, email: `pw-v1394-${STAMP}@example.com`, phone: '+10005550142',   // assignment skips leads with no phone
  });
  expect(lead.status, JSON.stringify(lead.body)).toBeLessThan(300);
  created.leadId = lead.body.id;
  const asg = await api(request, 'POST', '/api/admin/assignments/bulk-assign', SA.token, { user_id: sub(SDR.token), lead_ids: [created.leadId] });
  expect(asg.status, JSON.stringify(asg.body)).toBe(200);

  const day = await api(request, 'GET', '/api/my-day?tz_offset_min=-330', SDR.token);
  expect(day.status).toBe(200);
  const mine = day.body.given.leads.find((l) => l.id === created.leadId);
  expect(mine, 'the lead just assigned must be in "given today"').toBeTruthy();
  expect(mine.reason).toBe('Assigned to you');
  expect(day.body.given.total).toBe(day.body.given.assigned + day.body.given.reset);
  expect(day.body.now.not_yet_called).toBeGreaterThanOrEqual(1);          // brand-new lead, nobody has called it
  // it is the SDR's own day: the Super Admin's My Day must not contain it
  const saDay = await api(request, 'GET', '/api/my-day?tz_offset_min=-330', SA.token);
  expect(saDay.status).toBe(200);
  expect(saDay.body.given.leads.some((l) => l.id === created.leadId)).toBe(false);
  expect((await api(request, 'GET', '/api/my-day?date=nope', SDR.token)).status).toBe(400);
});

test('SDR Dashboard: honest cards + My Day card; numbers agree with the Leads list; Yesterday toggles; a row opens the lead', async ({ page, request }) => {
  const c = watch(page);
  await login(page, SDR.token);
  await go(page, '#dashboard');
  for (const label of ['Assigned to me', 'Given today', 'Not yet called', 'Calls today']) await expect(page.locator('[data-stat-label]', { hasText: label }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Untouched leads')).toHaveCount(0);          // the misleading caption is gone
  const card = page.getByTestId('my-day');
  await expect(card).toBeVisible();
  await expect(card.getByText(NAME.replace('Lead', 'Lead'), { exact: false }).first()).toBeVisible({ timeout: 20000 });

  // "Assigned to me" must be the same number the Leads page reports for this SDR
  const stats = await api(request, 'GET', '/api/leads/dashboard-stats', SDR.token);
  const kpi = page.locator('[data-stat="Assigned to me"] [data-stat-value]');
  await expect(kpi).toHaveText(Number(stats.body.total).toLocaleString());
  const list = await api(request, 'GET', '/api/leads?page=1&per_page=1', SDR.token);
  expect(list.body.total).toBe(stats.body.total);

  await shot(page, 'v13-9-4-sdr-dashboard');
  await card.getByRole('button', { name: 'Yesterday' }).click();
  await expect(card.getByText(/yesterday/i).first()).toBeVisible();
  await card.getByRole('button', { name: 'Today' }).click();
  await card.getByText(NAME, { exact: false }).first().click();             // opens the lead
  await expect(page.getByText(`PW-v1394 Co ${STAMP}`, { exact: false }).first()).toBeVisible({ timeout: 30000 });
  expect(problems(c), 'unexpected problems').toEqual([]);
});

test('Saved views follow the person: saved on the server, still there with this browser\'s storage wiped, duplicate says why', async ({ page, request }) => {
  const c = watch(page);
  await login(page, SDR.token);
  await go(page, '#leads');
  await page.getByRole('button', { name: '+ Filter' }).click();
  await page.waitForTimeout(500);
  await page.locator('[data-radix-popper-content-wrapper]').last().getByText('Source', { exact: true }).click();
  await page.waitForTimeout(500);
  await page.locator('[data-radix-popper-content-wrapper]').last().getByText('Manual', { exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '+ Save view' }).click();
  await page.getByPlaceholder('Name this view…').fill(VIEW);
  await page.getByRole('button', { name: 'Save view', exact: true }).last().click();
  await expect(page.getByText(VIEW)).toBeVisible();

  const server = await api(request, 'GET', '/api/me/saved-views', SDR.token);
  const saved = server.body.views.find((v) => v.name === VIEW);
  expect(saved, 'the view must exist on the server').toBeTruthy();
  expect(saved.keys).toContain('source');

  // a different browser = empty storage; the view must still be there
  await page.evaluate(() => { localStorage.removeItem('leadsHub.savedViews'); });
  await page.reload();
  await go(page, '#leads');
  await expect(page.getByText(VIEW)).toBeVisible({ timeout: 30000 });

  // saving the same name again says why instead of silently doing nothing
  await page.getByText(VIEW).click();                                       // applies the view's filter (makes Save enabled)
  await page.getByRole('button', { name: '+ Save view' }).click();
  await page.getByPlaceholder('Name this view…').fill(VIEW);
  await page.getByRole('button', { name: 'Save view', exact: true }).last().click();
  await expect(page.getByRole('alert')).toContainText(/already have a view/i);
  await shot(page, 'v13-9-4-saved-view-duplicate');
  expect(problems(c), 'unexpected problems').toEqual([]);
});

test('SDR Performance: shows the whole current pipeline, not only what moved today', async ({ page, request }) => {
  const sdrId = sub(SDR.token);
  const perf = await api(request, 'GET', `/api/sdr-performance/${sdrId}?period=today`, SA.token);
  expect(perf.status).toBe(200);
  const nowSum = Object.values(perf.body.funnel_now).reduce((a, b) => a + b, 0);
  expect(perf.body.productivity.assigned_now).toBe(nowSum);
  expect(perf.body.productivity.assigned_now, 'the new lead is part of the current pipeline').toBeGreaterThanOrEqual(1);
  expect(perf.body.productivity.assigned_now).toBeGreaterThanOrEqual(Object.values(perf.body.funnel).reduce((a, b) => a + b, 0));

  const c = watch(page);
  await login(page, SA.token);
  await page.evaluate((id) => window._loadView('sdr-performance', id), sdrId);
  await expect(page.getByText('Current Pipeline')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Assigned Now (all)')).toBeVisible();
  await expect(page.getByText(/Stage Movement/)).toBeVisible();
  await shot(page, 'v13-9-4-sdr-performance');
  expect(problems(c), 'unexpected problems').toEqual([]);
});

test('Dashboard numbers open exactly what they count; paging, date picker, export and the tour work', async ({ page, request, browser }) => {
  const c = watch(page);
  await login(page, SDR.token);
  await go(page, '#dashboard');
  const tile = (label) => page.locator(`[data-stat="${label}"]`);
  const num = async (label) => {
    await expect(tile(label).locator('[data-stat-value]')).toHaveText(/^[\d,]+$/, { timeout: 30000 });   // "—" until My Day has loaded
    return Number((await tile(label).locator('[data-stat-value]').innerText()).replace(/,/g, ''));
  };
  await expect(tile('Not yet called')).toBeVisible({ timeout: 30000 });

  // each smart number -> the Leads list shows that many, with a banner that clears
  for (const [label, banner] of [['Not yet called', /nobody has called/i], ['Given today', /given to you today/i]]) {
    const n = await num(label);
    await tile(label).click();
    await expect(page.getByTestId('smart-view-banner')).toContainText(banner, { timeout: 30000 });
    await expect(page.getByText(`${n.toLocaleString()} leads in pipeline`)).toBeVisible({ timeout: 30000 });
    await page.getByLabel('Clear this view').click();
    await expect(page.getByTestId('smart-view-banner')).toHaveCount(0);
    await go(page, '#dashboard');
    await expect(tile(label)).toBeVisible({ timeout: 30000 });
  }
  // a status number -> a plain Leads filter
  const callingN = await num('Calling stage');
  await tile('Calling stage').click();
  await expect(page.getByText('Status').first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText(`${callingN.toLocaleString()} leads in pipeline`)).toBeVisible({ timeout: 30000 });
  await go(page, '#dashboard');

  const card = page.getByTestId('my-day');
  await expect(card).toBeVisible({ timeout: 30000 });
  // paging: server-side, every row reachable
  const day = await api(request, 'GET', '/api/my-day?tz_offset_min=-330&per_page=10', SDR.token);
  if (day.body.given.pages > 1) {
    await card.getByRole('button', { name: /Next/ }).click();
    await expect(card.getByText(/Showing 11–/)).toBeVisible();
  }
  // any past date, not just yesterday
  await expect(card.getByRole('button', { name: /Pick a date/ })).toBeVisible();
  // export: the whole day as a CSV
  const [download] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: /Export CSV/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^my-day-\d{4}-\d{2}-\d{2}\.csv$/);
  await shot(page, 'v13-9-5-sdr-dashboard');

  // the guided tour shows on a first visit, and only then
  // the guided tour: a brand-new browser (nothing pre-seeded) sees it once, in plain words, and not again
  const fresh = await browser.newContext();
  const fp = await fresh.newPage();
  await fp.goto(`${BASE_URL}/?token=${SDR.token}#dashboard`);
  const tour = fp.getByRole('dialog', { name: 'Dashboard guided tour' });
  await expect(tour).toBeVisible({ timeout: 45000 });
  await expect(tour).toContainText(/Your numbers/i);
  await fp.getByLabel('Close tour').click();
  await expect(tour).toHaveCount(0);
  await fp.reload();
  await expect(fp.locator('[data-stat="Assigned to me"]')).toBeVisible({ timeout: 45000 });
  await expect(tour).toHaveCount(0);
  await fresh.close();
  expect(problems(c), 'unexpected problems').toEqual([]);
});

test('Every navigation control on the SDR Dashboard lands on a real page (never "View not found")', async ({ page }) => {
  const c = watch(page);
  await login(page, SDR.token);
  const back = async () => { await go(page, '#dashboard'); await expect(page.locator('[data-stat="Not yet called"]')).toBeVisible({ timeout: 30000 }); };
  const notLost = async () => { await expect(page.getByText('View not found')).toHaveCount(0); };
  await back();
  await page.getByRole('button', { name: /Start calling/ }).click();
  await page.waitForTimeout(2500); await notLost();
  await expect(page.locator('#power-dialer-react-root')).toBeVisible({ timeout: 30000 });
  await back();
  await page.locator('[data-stat="Calls today"]').click();
  await page.waitForTimeout(2500); await notLost();
  await expect(page.locator('#power-dialer-react-root')).toBeVisible({ timeout: 30000 });
  await back();
  await page.getByRole('button', { name: /View all/ }).first().click();
  await page.waitForTimeout(2500); await notLost();
  await back();
  expect(problems(c), 'unexpected problems').toEqual([]);
});

test('Admin Dashboard: numbers open filtered Leads; export snapshot; no My Day', async ({ page }) => {
  const c = watch(page);
  await login(page, SA.token);
  await go(page, '#dashboard');
  await expect(page.locator('[data-stat="Total leads"]')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('my-day')).toHaveCount(0);
  await page.locator('[data-stat="Calling"]').click();
  await expect(page.getByText('leads in pipeline').first()).toBeVisible({ timeout: 30000 });
  await go(page, '#dashboard');
  await page.getByRole('button', { name: /Export/ }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /snapshot/i }).click()]);
  expect(download.suggestedFilename()).toMatch(/^dashboard-.*\.csv$/);
  expect(problems(c), 'unexpected problems').toEqual([]);
});
