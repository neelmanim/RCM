// v13.9.0 staging audit — duplicate-lead message + reassign requests, tag filter/audit, re-enrollment setting.
// STAGING ONLY (the shared harness refuses any other host). Creates its own throw-away leads/tags/cadence
// (names start "PW-v1390"), never touches existing leads or the demo cadences, and removes what it made.
//   npx playwright test tests/v13-9-0-reassign-tags-reenroll.spec.js
const { test, expect } = require('@playwright/test');
const { APP_VERSION, API, PERSONAS, watch, login, go, shot, api, expectClean } = require('./helpers/v13-7-0-staging');

const SA = PERSONAS.sa, SDR = PERSONAS.sdr, PA = PERSONAS.pa;
const STAMP = Date.now();
const created = { leads: [], tags: [], journeys: [] };

// Expected, asserted-on responses: the duplicate 409 the SDR is meant to see, and the first-load boot noise
// the shared watcher already whitelists.
const EXPECTED = /^409 POST \/api\/leads$/;
function net(page) {
  const bad = [];
  page.on('response', (r) => {
    if (r.status() < 400 || !r.url().startsWith(API)) return;
    const k = `${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`;
    if (!EXPECTED.test(k) && !/^(401 GET \/api\/(calls\/my-active|conversations\/status)|403 GET \/api\/pods)$/.test(k)) bad.push(k);
  });
  return bad;
}
async function start(page, who) {
  const w = watch(page);
  const bad = net(page);
  await login(page, who.token);
  return { problems: () => w.problems().filter((p) => !/^(40[139]) /.test(p)).concat(bad.splice(0)) };
}

test.describe.configure({ mode: 'serial' });
test.skip(!SA.token || !SDR.token, 'SA_TOKEN / SDR_DEVKAPOOR_TOKEN missing from .env.test');

async function makeLead(request, suffix) {
  const r = await api(request, 'POST', '/api/leads', SA.token, {
    first_name: 'PW-v1390', last_name: `${suffix}${STAMP}`, company: `PW-v1390 Co ${STAMP}`,
    email: `pw-v1390-${suffix.toLowerCase()}-${STAMP}@example.com`,
  });
  expect(r.status, `create lead ${suffix}`).toBe(200);
  created.leads.push(r.body.id);
  return { id: r.body.id, email: `pw-v1390-${suffix.toLowerCase()}-${STAMP}@example.com`, name: `PW-v1390 ${suffix}${STAMP}` };
}

test.afterAll(async ({ request }) => {
  // close any request this run left pending, then remove what it created
  const pending = await api(request, 'GET', '/api/reassign-requests', SA.token);
  for (const q of (pending.body?.requests || []).filter((r) => created.leads.includes(r.lead_id))) {
    await api(request, 'POST', `/api/reassign-requests/${q.id}/reject`, SA.token, { rejection_reason: 'PW cleanup' });
  }
  if (created.leads.length) await api(request, 'POST', '/api/admin/leads/bulk-delete', SA.token, { lead_ids: created.leads });   // DELETE /api/leads/{id} is 405: this used to leave every test lead behind
  for (const id of created.journeys) await api(request, 'POST', `/api/journeys/${id}/archive`, SA.token);
});

test('staging runs this release', async ({ request }) => {
  const r = await request.get(`${API}/api/health`);
  expect((await r.json()).version).toBe(APP_VERSION);
});

let leadA, leadB;

test('duplicate lead: the SDR is told who owns it, its status and how to proceed (API)', async ({ request }) => {
  leadA = await makeLead(request, 'A');
  const r = await api(request, 'POST', '/api/leads', SDR.token, {
    first_name: 'Dup', last_name: 'Try', company: 'Whatever', email: leadA.email,
  });
  expect(r.status).toBe(409);
  expect(r.body.detail).toMatch(/already exists/i);
  expect(r.body.detail).toMatch(/email/i);
  expect(r.body.detail).toMatch(/assigned to/i);
  expect(r.body.existing_lead).toMatchObject({ id: leadA.id, owned_by_you: false, can_request_reassignment: true, matched_on: 'email' });
  expect(r.body.existing_lead.owners.length).toBe(1);
  // admins are not offered a request
  const adm = await api(request, 'POST', '/api/leads', SA.token, { first_name: 'x', last_name: 'y', company: 'z', email: leadA.email });
  expect(adm.status).toBe(409);
  expect(adm.body.existing_lead.can_request_reassignment).toBe(false);
});

test('Add Lead modal: duplicate shows the notice and sends a reassignment request', async ({ page, request }) => {
  const c = await start(page, SDR);
  await page.getByRole('button', { name: 'New Lead' }).click();
  await page.fill('#lead-first-name', 'Dup');
  await page.fill('#lead-last-name', 'Try');
  await page.fill('#lead-company', 'Whatever');
  await page.fill('#lead-email', leadA.email);
  await page.locator('#new-lead-form button[type="submit"]').click();
  const notice = page.locator('#lead-dup-notice');
  await expect(notice).toBeVisible({ timeout: 20000 });
  await expect(notice).toContainText(/already exists/i);
  await expect(notice).toContainText(/assigned to/i);
  await shot(page, 'v13-9-dup-notice');
  await notice.getByRole('button', { name: 'Request reassignment' }).click();
  await expect(notice).toContainText(/Request sent/i, { timeout: 15000 });
  await expect(notice.getByRole('button', { name: 'Request reassignment' })).toHaveCount(0);
  const list = await api(request, 'GET', '/api/reassign-requests', SA.token);
  expect(list.body.requests.some((q) => q.lead_id === leadA.id), 'request is queued for the checker').toBe(true);
  // a second click / retry must not queue a second one
  const again = await api(request, 'POST', '/api/reassign-requests', SDR.token, { lead_id: leadA.id });
  expect(again.status).toBe(409);
  expectClean(c.problems(), 'add lead modal');
});

test('SDR cannot see or use the review queue; the SDR cannot open the lead yet', async ({ page, request }) => {
  expect((await api(request, 'GET', '/api/reassign-requests', SDR.token)).status).toBe(403);
  expect((await api(request, 'POST', `/api/reassign-requests/x/approve`, SDR.token)).status).toBe(403);
  // a lead the SDR may not see is hidden (404) rather than refused (403)
  expect([403, 404]).toContain((await api(request, 'GET', `/api/leads/${leadA.id}`, SDR.token)).status);
  const c = await start(page, SDR);
  await go(page, '#leads');
  await expect(page.getByText('All Leads').first()).toBeVisible({ timeout: 25000 });
  await expect(page.getByText('Reassign Requests')).toHaveCount(0);
  expectClean(c.problems(), 'sdr leads');
});

test('Super Admin approves in the Leads tab; the lead moves to the SDR with history intact', async ({ page, request }) => {
  const c = await start(page, SA);
  await go(page, '#leads');
  const tab = page.getByRole('button', { name: /Reassign Requests/ });
  await expect(tab).toBeVisible({ timeout: 25000 });
  await expect(tab).toContainText(/\d/);                       // pending badge
  await tab.click();
  const row = page.getByRole('row').filter({ hasText: leadA.name });
  await expect(row).toBeVisible({ timeout: 15000 });
  await shot(page, 'v13-9-reassign-queue');
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(row).toHaveCount(0, { timeout: 15000 });
  expect((await api(request, 'GET', `/api/leads/${leadA.id}`, SDR.token)).status, 'SDR can now open it').toBe(200);
  const hist = await api(request, 'GET', `/api/leads/${leadA.id}/field-history`, SA.token);
  expect(hist.body.some((h) => h.field_name === 'assigned_to' && h.new_value)).toBe(true);
  const dup = await api(request, 'POST', '/api/leads', SDR.token, { first_name: 'x', last_name: 'y', company: 'z', email: leadA.email });
  expect(dup.body.existing_lead.owned_by_you, 'now reported as already yours').toBe(true);
  expect(dup.body.detail).toMatch(/already assigned to you/i);
  expectClean(c.problems(), 'approve');
});

test('Pod Admin sees the queue tab; a rejected request is closed with its reason', async ({ page, request }) => {
  test.skip(!PA.token, 'POD_ADMIN_TOKEN missing');
  leadB = await makeLead(request, 'B');
  const q = await api(request, 'POST', '/api/reassign-requests', SDR.token, { lead_id: leadB.id, note: 'PW note' });
  expect(q.status).toBe(200);
  // Super Admin rejects through the UI
  const c = await start(page, SA);
  await go(page, '#leads');
  await page.getByRole('button', { name: /Reassign Requests/ }).click();
  const row = page.getByRole('row').filter({ hasText: leadB.name });
  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(row).toContainText('PW note');
  await row.getByRole('button', { name: 'Reject' }).click();
  await page.getByLabel('Rejection reason').fill('PW says no');
  await page.getByRole('button', { name: 'Confirm reject' }).click();
  await expect(row).toHaveCount(0, { timeout: 15000 });
  const done = await api(request, 'GET', '/api/reassign-requests?status=rejected', SA.token);
  const mine = done.body.requests.find((r) => r.lead_id === leadB.id);
  expect(mine.rejection_reason).toBe('PW says no');
  expect([403, 404], 'a rejected request grants nothing').toContain((await api(request, 'GET', `/api/leads/${leadB.id}`, SDR.token)).status);
  expectClean(c.problems(), 'reject');
  // Pod Admin: tab renders (their pod may have nothing pending)
  const p = await start(page, PA);
  await go(page, '#leads');
  await expect(page.getByRole('button', { name: /Reassign Requests/ })).toBeVisible({ timeout: 25000 });
  expectClean(p.problems(), 'pod admin tab');
});

test('tags: filter lists a tag created after the page opened; attach/detach are on the lead history', async ({ page, request }) => {
  const c = await start(page, SA);
  await go(page, '#leads');
  await expect(page.getByText('All Leads').first()).toBeVisible({ timeout: 25000 });
  const name = `PW-v1390 tag ${STAMP}`;
  const tag = await api(request, 'POST', '/api/tags', SA.token, { name });
  expect(tag.status).toBe(200);
  created.tags.push(tag.body.id);
  // page was already open: opening the Tag filter must fetch the new tag
  await page.getByRole('button', { name: '+ Filter' }).click();
  await page.getByRole('menuitem', { name: 'Tag' }).click();
  await expect(page.getByRole('button', { name }).first()).toBeVisible({ timeout: 15000 });
  await shot(page, 'v13-9-tag-filter');
  // attach → history
  expect((await api(request, 'POST', `/api/leads/${leadA.id}/tags/${tag.body.id}`, SA.token)).status).toBe(200);
  const h = await api(request, 'GET', `/api/leads/${leadA.id}/field-history`, SA.token);
  expect(h.body.some((x) => x.field_name === 'tags' && x.new_value === name && x.old_value == null)).toBe(true);
  // filtering by it returns the lead
  const filtered = await api(request, 'GET', `/api/leads?tag=${encodeURIComponent(name)}&per_page=50`, SA.token);
  const rows = Array.isArray(filtered.body) ? filtered.body : filtered.body.data || [];
  expect(rows.map((l) => l.id)).toContain(leadA.id);
  // the lead page timeline words it readably
  await go(page, `#lead-detail/${leadA.id}`);
  await expect(page.getByText(`Tag added: ${name}`).first()).toBeVisible({ timeout: 30000 });
  await shot(page, 'v13-9-tag-timeline');
  // detach → history, and the filter no longer returns it
  expect((await api(request, 'DELETE', `/api/leads/${leadA.id}/tags/${tag.body.id}`, SA.token)).status).toBe(200);
  const h2 = await api(request, 'GET', `/api/leads/${leadA.id}/field-history`, SA.token);
  expect(h2.body.some((x) => x.field_name === 'tags' && x.old_value === name && x.new_value == null)).toBe(true);
  expectClean(c.problems(), 'tags');
});

test('tag filter works for an SDR (non-admin) too', async ({ page, request }) => {
  const c = await start(page, SDR);
  await go(page, '#leads');
  await expect(page.getByText('All Leads').first()).toBeVisible({ timeout: 25000 });
  await page.getByRole('button', { name: '+ Filter' }).click();
  await page.getByRole('menuitem', { name: 'Tag' }).click();
  await expect(page.getByRole('button', { name: `PW-v1390 tag ${STAMP}` }).first()).toBeVisible({ timeout: 15000 });
  expectClean(c.problems(), 'sdr tag filter');
});

test('cadence rules: Allow re-enrollment defaults off for a new cadence, saves, and legacy cadences read as allowed', async ({ page, request }) => {
  const j = await api(request, 'POST', '/api/journeys', SA.token, { name: `PW-v1390 cadence ${STAMP}` });
  expect(j.status).toBe(200);
  created.journeys.push(j.body.id);
  expect((await api(request, 'GET', `/api/journeys/${j.body.id}`, SA.token)).body.allow_reenroll).toBe(false);
  const c = await start(page, SA);
  await go(page, `#sales-tools/${j.body.id}`);
  await page.getByTitle(/When this cadence stops/).click({ timeout: 30000 });
  const box = page.getByLabel('Allow re-enrollment');
  await expect(box).not.toBeChecked();
  await box.check();
  await page.getByText('Wait before a lead can join again').click();
  await page.getByLabel('Re-enrollment wait days').fill('14');
  await shot(page, 'v13-9-cadence-rules');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(async () => (await api(request, 'GET', `/api/journeys/${j.body.id}`, SA.token)).body.allow_reenroll, { timeout: 15000 }).toBe(true);
  const saved = (await api(request, 'GET', `/api/journeys/${j.body.id}`, SA.token)).body;
  expect(saved.reenroll_cooloff_days).toBe(14);
  // an older cadence (created before v13.9.0, setting NULL) must still read as allowed
  const list = await api(request, 'GET', '/api/journeys', SA.token);
  const all = Array.isArray(list.body) ? list.body : list.body?.items || list.body?.journeys || [];
  const older = all.find((x) => !/^PW-v1390/.test(x.name) && x.status !== 'archived');   // a real, pre-existing cadence
  if (older) expect((await api(request, 'GET', `/api/journeys/${older.id}`, SA.token)).body.allow_reenroll, 'legacy cadence unchanged').toBe(true);
  expectClean(c.problems(), 'cadence rules');
});

test('search: a full "First Last" name finds the lead on every search screen, and the table keeps its rows while loading', async ({ page, request }) => {
  const full = `PW-v1390 A${STAMP}`;                       // first_name "PW-v1390", last_name "A<stamp>"
  const reversed = `A${STAMP} PW-v1390`;
  const ids = async (path) => {
    const t0 = Date.now();
    const r = await api(request, 'GET', path, SA.token);
    expect(r.status, path).toBe(200);
    console.log(`search timing ${path.split('?')[0]}: ${Date.now() - t0} ms`);
    const rows = r.body.leads || r.body.data || r.body.items || [];
    return rows.map((x) => x.id || x.lead_id);
  };
  for (const q of [full, reversed, `PW-v1390 Co ${STAMP}`]) {
    expect(await ids(`/api/leads?search=${encodeURIComponent(q)}&per_page=20`), `leads list: ${q}`).toContain(leadA.id);
    expect(await ids(`/api/search?q=${encodeURIComponent(q)}`), `global search: ${q}`).toContain(leadA.id);
  }
  expect(await ids(`/api/leads?search=${encodeURIComponent('Nobody Zzzqq')}&per_page=20`)).toEqual([]);

  const c = await start(page, SA);
  await go(page, '#leads');
  await expect(page.getByText('All Leads').first()).toBeVisible({ timeout: 25000 });
  const box = page.getByPlaceholder('Search name, email, or company…');
  await box.fill(full);
  await expect(page.locator('tbody tr td', { hasText: leadA.name }).first()).toBeVisible({ timeout: 30000 });
  // typing a longer query must not blank the table into skeleton rows: rows stay on screen (dimmed) until the new ones arrive
  await box.fill('');
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30000 });
  let blanked = false;
  await page.route('**/api/leads?*', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue().catch(() => {}); });   // the app aborts superseded searches: the route may already be gone
  await box.fill('PW-v1390');
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(250);
    if (await page.locator('tbody tr').count() === 0) blanked = true;
  }
  expect(blanked, 'table went blank while the next search was loading').toBe(false);
  await page.unroute('**/api/leads?*');
  await shot(page, 'v13-9-search');
  // global search bar
  await page.getByPlaceholder(/Search leads, phone, SDRs/).fill(full);
  await expect(page.getByText(leadA.name).first()).toBeVisible({ timeout: 20000 });
  expectClean(c.problems(), 'search');
});

test('a refused action shows the server\'s own reason, not "refresh the page" (global net)', async ({ page }) => {
  const c = await start(page, SA);
  await go(page, '#leads');
  await page.evaluate(() => { Promise.reject({ response: { status: 400, data: { detail: 'PW refused: already a member of another pod' } } }); });
  await expect(page.getByText('PW refused: already a member of another pod')).toBeVisible({ timeout: 10000 });
  await page.evaluate(() => { Promise.reject({ response: { status: 500, data: {} } }); });
  await expect(page.getByText(/Something went wrong/)).toBeVisible({ timeout: 10000 });
  // the two deliberate rejections log console errors by design; nothing else may
  expect(c.problems().filter((p) => !/Unhandled rejection|Uncaught \(in promise\)|pageerror/.test(p)), 'unexpected problems').toEqual([]);
});

test('Pod Management: adding someone who is already in another pod shows why, on screen (nothing changes)', async ({ page, request }) => {
  const r = await api(request, 'GET', '/api/pods', SA.token);
  expect(r.status).toBe(200);
  const pods = Array.isArray(r.body) ? r.body : r.body.pods || [];
  const withMember = pods.find((p) => (p.members || []).some((m) => m.role === 'SDR'));
  const other = pods.find((p) => withMember && p.id !== withMember.id);
  test.skip(!withMember || !other, 'staging has no pod with an SDR plus a second pod');
  const member = withMember.members.find((m) => m.role === 'SDR');
  const c = await start(page, SA);
  await go(page, '#pods');
  await page.getByRole('button', { name: 'Manage Pods' }).click();
  const card = page.getByRole('heading', { name: other.name, exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  await card.getByText('-- Add SDR / AE --').click();
  await page.getByPlaceholder(/search/i).last().fill(member.name).catch(() => {});
  await page.getByRole('option', { name: new RegExp(member.name) }).first().click();
  await card.getByRole('button', { name: 'Add', exact: true }).last().click();   // the member Add (admin Add comes first)
  // the chosen long "Name (email)" must stay inside its box and not run over the Add button
  const pick = card.locator('button[aria-label="-- Add SDR / AE --"], button:has-text("@")').first();
  const [pb, ab] = [await pick.boundingBox(), await card.getByRole('button', { name: 'Add', exact: true }).last().boundingBox()];
  if (pb && ab) expect(pb.x + pb.width, 'Select overlaps the Add button').toBeLessThanOrEqual(ab.x + 1);
  await expect(page.getByText(/already a member|Cannot add/i).first()).toBeVisible({ timeout: 15000 });
  await shot(page, 'v13-9-pod-refusal');
  const after = await api(request, 'GET', '/api/pods', SA.token);
  const podsAfter = Array.isArray(after.body) ? after.body : after.body.pods || [];
  expect(podsAfter.find((p) => p.id === withMember.id).members.some((m) => m.id === member.id), 'member must still be in the original pod').toBe(true);
  expect(c.problems().filter((p) => !/400/.test(p)), 'unexpected problems').toEqual([]);
});


test('a session the server no longer accepts logs the person out with a message, not a dead page', async ({ page }) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const forged = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'x', role: 'Super Admin', email: 'x@example.com', name: 'X', exp: Math.floor(Date.now() / 1000) + 3600 })}.bad`;
  // top page only: blank widget frames share this storage and would re-seed the token after logout
  await page.addInitScript((t) => { try { if (window.top === window && !/login\.html/.test(location.pathname)) { localStorage.setItem('crm_token', t); localStorage.setItem('leadsHub', 'on'); } } catch { /* blocked */ } }, forged);
  await page.goto(`${process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com'}/#leads`);
  await page.waitForURL(/login\.html\?expired=1/, { timeout: 60000 });
  await expect(page.getByText(/session has ended/i).first()).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => localStorage.getItem('crm_token'))).toBeNull();
  await shot(page, 'v13-9-3-session-ended');
});
