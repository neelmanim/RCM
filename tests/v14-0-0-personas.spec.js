// v14.0.0 on STAGING — every persona against what this release changed: Daily Digest (redesigned), global search,
// Pod Admin isolation, role gates, Dashboard "Needs attention", offboarding. Read-mostly; the only writes are one
// throwaway user (offboarded and re-added) which stays as a "left" row. Never books a meeting, sends, or calls.
//   npx playwright test tests/v14-0-0-personas.spec.js
const { test, expect } = require('@playwright/test');
const { APP_VERSION, API, PERSONAS, watch, login, go, shot, api } = require('./helpers/v13-7-0-staging');

const { sa: SA, pa: PA, pa2: PA2, sdr: SDR, ae: AE, csm: CSM } = PERSONAS;
test.skip(!SA.token || !PA.token || !SDR.token || !AE.token || !CSM.token, 'persona tokens missing from .env.test');

const DAY = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 2); return d.toISOString().slice(0, 10); })();
const ADMINS = [['Super Admin', SA], ['Pod Admin', PA], ['Pod Admin (demo)', PA2]].filter(([, p]) => p.token);
const NON_ADMINS = [['AE', AE], ['SDR', SDR], ['CSM', CSM]];
const clean = (c) => c.problems().filter((p) => !/^(40[139]|409) /.test(p));

test('staging runs this release', async ({ request }) => {
  expect((await (await request.get(`${API}/api/health`)).json()).version).toBe(APP_VERSION);
});

// ── role gates, straight against the API, every persona ─────────────────────────────────────────────────────────
const GATES = [
  ['digest', `/api/admin/analytics/daily-digest?date=${DAY}`, true], ['digest leads', `/api/admin/analytics/daily-digest/leads?date=${DAY}`, true],
  ['digest export', `/api/admin/analytics/daily-digest/export.xlsx?date=${DAY}`, true], ['users', '/api/admin/users', true],
  ['email logs', '/api/admin/email-logs', true], ['unassigned leads', '/api/admin/leads/unassigned', true],
  ['reports', '/api/admin/analytics/reports', true], ['activity feed', '/api/admin/activity-feed?date_range=7d', true],
  ['skip summary', '/api/admin/dialer/skip-summary', true], ['export activity', `/api/exports/activity.xlsx?date_from=${DAY}&date_to=${DAY}`, true],
];
for (const [role, p] of [...ADMINS, ...NON_ADMINS]) {
  test(`role gates — ${role}`, async ({ request }) => {
    const admin = ADMINS.some(([r]) => r === role);
    for (const [name, path, adminOnly] of GATES) {
      const r = await api(request, 'GET', path, p.token);
      expect(r.status === 200, `${role} ${name} -> ${r.status}`).toBe(adminOnly ? admin : false);
      if (!admin) expect(r.status, `${role} ${name}`).toBe(403);
    }
    for (const path of ['/api/my-day/lifecycle', '/api/leaderboard', '/api/search?q=an']) {
      expect((await api(request, 'GET', path, p.token)).status, `${role} ${path}`).toBe(200);
    }
  });
}

// ── Pod Admin sees only their own pod ───────────────────────────────────────────────────────────────────────────
for (const [role, p] of ADMINS.filter(([r]) => r !== 'Super Admin')) {
  test(`${role} sees only their own pod`, async ({ request }) => {
    const users = (await api(request, 'GET', '/api/admin/users', p.token)).body;
    const pods = new Set(users.map((u) => u.pod_id).filter(Boolean));
    expect(pods.size, 'people of exactly one pod').toBeLessThanOrEqual(1);
    const own = [...pods][0];

    const digest = (await api(request, 'GET', `/api/admin/analytics/daily-digest?date=${DAY}`, p.token)).body;
    const ids = new Set(users.map((u) => u.id));
    for (const r of digest.sdr_snapshot) expect(ids.has(r.user_id), `digest rep ${r.name} outside the pod`).toBe(true);
    const leads = (await api(request, 'GET', `/api/admin/analytics/daily-digest/leads?date=${DAY}&per_page=50`, p.token)).body;
    for (const r of leads.items) expect(ids.has(r.rep_id), `digest lead of ${r.rep} outside the pod`).toBe(true);

    // the params that used to widen the feed are ignored
    const widened = await api(request, 'GET', '/api/admin/activity-feed?date_range=all&global_view=true&pod_id=some-other-pod', p.token);
    const plain = await api(request, 'GET', '/api/admin/activity-feed?date_range=all', p.token);
    expect(widened.body.total).toBe(plain.body.total);

    // org-wide pool and lists: only this pod's leads
    const un = (await api(request, 'GET', '/api/admin/leads/unassigned?per_page=100', p.token)).body;
    const saUn = (await api(request, 'GET', '/api/admin/leads/unassigned?per_page=1', SA.token)).body;
    expect(un.total).toBeLessThanOrEqual(saUn.total);
    // bulk user changes are not for Pod Admins
    expect((await api(request, 'POST', '/api/admin/users/upload', p.token, { csv: 'email,name,action\n' })).status).toBe(403);
    // search returns only people from the pod
    const found = (await api(request, 'GET', '/api/search?q=a', p.token)).body;
    for (const u of found.users) expect(ids.has(u.id), `search user ${u.name} outside the pod`).toBe(true);
    expect(own === undefined || typeof own === 'string').toBe(true);
  });
}

test('Super Admin sees more than any Pod Admin (the scoping is not just returning nothing)', async ({ request }) => {
  const sa = (await api(request, 'GET', '/api/admin/users', SA.token)).body.length;
  for (const [, p] of ADMINS.filter(([r]) => r !== 'Super Admin')) {
    const own = (await api(request, 'GET', '/api/admin/users', p.token)).body.length;
    expect(own).toBeGreaterThan(0);
    expect(own).toBeLessThan(sa);
  }
});

// ── Daily Digest, in the browser ────────────────────────────────────────────────────────────────────────────────
for (const [role, p] of ADMINS) {
  test(`Daily Digest UI — ${role}: tiles filter, rep click filters, pages, exports`, async ({ page }) => {
    const c = watch(page);
    await login(page, p.token);
    await page.locator('nav').getByText('Daily Digest', { exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Daily Digest' })).toBeVisible({ timeout: 30000 });
    for (const label of ['Calls', 'Emails sent', 'Research notes', 'Meetings booked', 'Leads touched']) {
      await expect(page.locator('[data-tour="digest-kpi-grid"]').getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('Team', { exact: true }).first()).toBeVisible();
    await shot(page, `v14-digest-${role.replace(/\W+/g, '-')}`);

    // a headline number narrows the lead list; the chip says so and can be cleared
    const tile = page.getByTitle('Show the leads with calls');
    await tile.click();
    await expect(page.getByText('With calls')).toBeVisible();
    await page.getByLabel('Clear activity filter').click();
    await expect(page.getByText('With calls')).toHaveCount(0);

    // clicking a rep row filters to that rep
    const firstRep = page.locator('[data-tour="digest-sdr-snapshot"] tbody tr').first();
    if (await firstRep.count()) {
      await firstRep.click();
      await expect(page.getByLabel('Clear rep filter')).toBeVisible();
      await page.getByRole('button', { name: 'Clear all' }).click();
    }

    // a follow-up filter and search never break the list (either rows or an honest empty state)
    await page.getByLabel('Follow-up', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Overdue' }).click();
    await expect(page.locator('[data-tour="digest-lead-activity"]')).toBeVisible();
    await page.getByRole('button', { name: 'Clear all' }).click();

    // pagination, when there is more than a page
    const next = page.locator('[data-tour="digest-lead-activity"]').getByRole('button', { name: /Next/ });
    if (await next.count() && await next.isEnabled()) {
      await next.click();
      await expect(page.getByText(/Showing 11–/)).toBeVisible();
    }

    // the whole digest downloads as one workbook
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: /Export Excel/ }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^daily-digest-.*\.xlsx$/);
    expect(clean(c), `${role} digest console/5xx`).toEqual([]);
  });
}

for (const [role, p] of NON_ADMINS) {
  test(`Daily Digest is not offered to ${role}`, async ({ page }) => {
    await login(page, p.token);
    await expect(page.locator('nav >> text=Daily Digest')).toHaveCount(0);
  });
}

// ── Global search, in the browser, every persona ────────────────────────────────────────────────────────────────
for (const [role, p] of [['Super Admin', SA], ['Pod Admin', PA], ['AE', AE], ['SDR', SDR], ['CSM', CSM]]) {
  test(`global search — ${role}: opens at once, settles on the final query, no console errors`, async ({ page }) => {
    const c = watch(page);
    await login(page, p.token);
    const box = page.getByLabel('Search', { exact: true });
    const seen = [];
    page.on('request', (r) => { if (r.url().includes('/api/search')) seen.push(new URL(r.url()).searchParams.get('q')); });
    await box.click();
    await box.pressSequentially('anan', { delay: 60 });                 // fast typing: must not fire one request per key
    await expect(page.locator('.nh-search__results')).toBeVisible({ timeout: 2000 });
    await expect.poll(() => seen.at(-1), { timeout: 10000 }).toBe('anan');
    await expect(page.locator('.nh-search__results [aria-busy="true"]')).toHaveCount(0, { timeout: 15000 });
    expect(seen.length, `requests for one typed word: ${seen}`).toBeLessThanOrEqual(2);
    await shot(page, `v14-search-${role.replace(/\W+/g, '-')}`);
    expect(clean(c), `${role} search console/5xx`).toEqual([]);
  });
}

// ── Dashboard "Needs attention" ─────────────────────────────────────────────────────────────────────────────────
for (const [role, p, shown] of [['Super Admin', SA, true], ['Pod Admin', PA, true], ['SDR', SDR, false]]) {
  test(`Dashboard — ${role}: Needs attention ${shown ? 'present' : 'absent'}`, async ({ page }) => {
    const c = watch(page);
    await login(page, p.token);
    await go(page, '#dashboard');
    if (!shown) await expect(page.getByText('Assigned to me').first()).toBeVisible({ timeout: 30000 });   // the rep-only card
    await expect(page.getByText('Needs attention').first())[shown ? 'toBeVisible' : 'toHaveCount'](...(shown ? [{ timeout: 30000 }] : [0]));
    if (shown) await expect(page.getByText(/no calls or emails today/)).toBeVisible();
    expect(clean(c), `${role} dashboard console/5xx`).toEqual([]);
  });
}

// ── offboarding a throwaway user ────────────────────────────────────────────────────────────────────────────────
test('offboarding: access off, hidden from the lists, reactivates on re-add', async ({ request }) => {
  const email = 'pw-v14-offboard@example.com';
  const found = async () => (await api(request, 'GET', '/api/admin/users', SA.token)).body.find((u) => u.email === email);
  let u = await found();
  if (!u) {
    const created = await api(request, 'POST', '/api/admin/users', SA.token, { email, name: 'PW v14 Offboard', role: 'SDR' });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    u = await found();
  }
  expect(u, 'throwaway user exists').toBeTruthy();
  const del = await api(request, 'DELETE', `/api/admin/users/${u.id}`, SA.token);
  expect(del.status, JSON.stringify(del.body)).toBeLessThan(300);
  expect(await found(), 'hidden from the user list').toBeUndefined();
  const withLeft = (await api(request, 'GET', '/api/admin/users?include_left=true', SA.token)).body.find((x) => x.email === email);
  expect(withLeft.left).toBe(true);
  const cfg = (await api(request, 'GET', '/api/admin/dialer/sdr-configs', SA.token)).body;
  expect(JSON.stringify(cfg)).not.toContain(email);
  expect((await api(request, 'POST', '/api/admin/users', SA.token, { email, name: 'PW v14 Offboard', role: 'SDR' })).status).toBeLessThan(300);
  expect((await found())?.left).toBeFalsy();                                  // same row, active again
  const again = await api(request, 'DELETE', `/api/admin/users/${(await found()).id}`, SA.token);
  expect(again.status).toBeLessThan(300);                                      // leave it offboarded
});

// ── View As ─────────────────────────────────────────────────────────────────────────────────────────────────────
for (const [role, p] of ADMINS.filter(([r]) => r !== 'Super Admin')) {
  test(`View As — ${role}: own-pod reps only (API) and the eye icon opens the rep's app (UI)`, async ({ page, request, context }) => {
    const users = (await api(request, 'GET', '/api/admin/users', p.token)).body;
    const rep = users.find((u) => ['SDR', 'AE'].includes(u.role));
    const peer = users.find((u) => u.role === 'Pod Admin' && u.email !== undefined && u.id !== JSON.parse(Buffer.from(p.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).sub);
    expect(rep, 'a rep in the pod').toBeTruthy();
    expect((await api(request, 'GET', `/api/admin/users/${rep.id}/token`, p.token)).status).toBe(200);
    if (peer) expect((await api(request, 'GET', `/api/admin/users/${peer.id}/token`, p.token)).status).toBe(403);
    const all = (await api(request, 'GET', '/api/admin/users', SA.token)).body;
    const outsider = all.find((u) => !users.some((x) => x.id === u.id) && ['SDR', 'AE'].includes(u.role));
    if (outsider) expect((await api(request, 'GET', `/api/admin/users/${outsider.id}/token`, p.token)).status).toBe(403);

    await login(page, p.token);
    await page.locator('nav').getByText('Control Center', { exact: false }).first().click();
    const eye = page.getByTitle('View As').first();
    await expect(eye).toBeVisible({ timeout: 30000 });
    const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 30000 }), eye.click()]);
    await popup.waitForSelector('nav >> text=My Tasks', { timeout: 45000 });
    expect(await popup.evaluate(() => !!sessionStorage.getItem('crm_view_as_token'))).toBe(true);
    await popup.screenshot({ path: `tests/screenshots/v13-7-0/v14-view-as-${role.replace(/\W+/g, '-')}.png` });
  });
}

for (const [role, p] of NON_ADMINS) {
  test(`View As is refused for ${role}`, async ({ request }) => {
    expect((await api(request, 'GET', '/api/admin/users/anyone/token', p.token)).status).toBe(403);
  });
}
