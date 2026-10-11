// v13.4.0 — Claude connector, every persona, on staging.
// SA: My Settings card → create key → paste it on the branded Alternate CRM page
// (real browser) → token → tools → the calls show up in Control Center →
// Monitoring → Claude Logs → revoke cuts Claude off. Draft sends need an
// explicit confirm. Everyone else: no card, no key, no Claude Logs — until a
// Super Admin flips "Let everyone connect Claude" (restored afterwards).
//
// STAGING ONLY. Refuses to run against any other host.
//   SA_TOKEN=... AE_TOKEN=... SDR_TOKEN=... PA_TOKEN=... CSM_TOKEN=... \
//     npx playwright test tests/v13-4-0-claude-connector-personas.spec.js
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API = process.env.API_BASE_URL || 'https://messenger-crm-staging.onrender.com';
const SA = process.env.V_SA_TOKEN || process.env.SA_TOKEN || '';
const PERSONAS = {
  'Pod Admin': process.env.PA_TOKEN || '',
  AE: process.env.AE_TOKEN || '',
  SDR: process.env.SDR_DEVKAPOOR_TOKEN || process.env.SDR_TOKEN || '',
  CSM: process.env.CSM_TOKEN || '',
};
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

if (!/^https:\/\/messenger-crm-staging\.onrender\.com$/.test(API) ||
    !/^https:\/\/messenger-frontend-staging\.onrender\.com$/.test(BASE_URL)) {
  throw new Error(`Refusing to run: not staging (${API}, ${BASE_URL})`);
}

const RUN = Date.now();
const SHOTS = 'tests/screenshots/v13-4-0-claude';
test.describe.configure({ mode: 'serial' });

async function call(request, method, path, token, data) {
  const r = await request.fetch(`${API}${path}`, { method, headers: token ? { Authorization: `Bearer ${token}` } : {}, data });
  let body = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  return { status: r.status(), body };
}

async function login(page, token, hash) {
  await page.addInitScript(() => {
    try { localStorage.setItem('alternate:my-settings-tour-seen', '1'); localStorage.setItem('alternate:control-center-tour-seen', '1'); } catch { /* */ }
  });
  await page.goto(`${BASE_URL}/?token=${token}`);
  await page.waitForSelector('nav a, nav button', { timeout: 30000 });   // CSM's nav has no Dashboard
  await page.evaluate((h) => { window.location.hash = h; }, hash);
}

async function mcp(request, accessToken, method, params = {}) {
  const r = await request.post(`${API}/mcp`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    data: { jsonrpc: '2.0', id: 1, method, params },
  });
  return { status: r.status(), body: r.status() === 200 ? await r.json() : null };
}

const settings = (request) => call(request, 'GET', '/api/admin/sync-settings', SA).then((r) => r.body);

test.describe('v13.4.0 Claude connector — all personas (staging)', () => {
  test.beforeAll(() => {
    expect(SA, 'SA_TOKEN required').toBeTruthy();
    for (const [role, tok] of Object.entries(PERSONAS)) expect(tok, `${role} token required`).toBeTruthy();
  });

  let original;
  test.beforeAll(async ({ request }) => {
    const s = await settings(request);
    original = { mcp_everyone_enabled: !!s.mcp_everyone_enabled, mcp_write_enabled: !!s.mcp_write_enabled };
  });
  test.afterAll(async ({ request }) => {
    if (original) await call(request, 'PATCH', '/api/admin/sync-settings', SA, original);
    // Leave no test keys behind, even when a test failed half-way.
    for (const tok of [SA, ...Object.values(PERSONAS)]) {
      const listed = await call(request, 'GET', '/api/me/api-keys', tok);
      for (const k of listed.body?.keys || []) {
        if (k.name.startsWith('PW ')) await call(request, 'DELETE', `/api/me/api-keys/${k.id}`, tok);
      }
    }
  });

  test('1. SA: My Settings card → key → branded page in a real browser → tools → Claude Logs → revoke', async ({ page, request }) => {
    await call(request, 'PATCH', '/api/admin/sync-settings', SA, { mcp_everyone_enabled: false, mcp_write_enabled: false });
    await login(page, SA, '#my-settings');
    const card = page.locator('[data-tour="my-settings-claude"]');
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card.getByText('View only')).toBeVisible();
    await expect(card.getByText('Remote MCP server URL:')).toBeVisible();
    await expect(card.getByText(`${API}/mcp`)).toBeVisible();
    await expect(card.getByText(/leave both empty/)).toBeVisible();

    const keyName = `PW ${RUN}`;
    await card.getByLabel('New key name').fill(keyName);
    await card.getByRole('button', { name: /Create key/ }).click();
    const once = card.locator('div').filter({ hasText: /^Copy your key now/ }).last();
    await expect(once).toBeVisible({ timeout: 15000 });
    const raw = (await once.locator('code').textContent()).trim();
    expect(raw).toMatch(/^lsk_/);
    expect(raw.length).toBeGreaterThan(30);
    await page.screenshot({ path: `${SHOTS}-sa-key-created.png`, fullPage: true });

    // Claude's side: register, then the user pastes the key on OUR page.
    const reg = await (await request.post(`${API}/oauth/register`, { data: { redirect_uris: [CALLBACK], client_name: 'Claude' } })).json();
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const authPage = await page.context().newPage();
    let redirected = null;
    // route() doesn't see the target of a 302 after a form POST; a request listener does.
    authPage.on('request', (r) => { if (r.url().startsWith(CALLBACK)) redirected = r.url(); });
    await authPage.route('https://claude.ai/**', (route) => route.fulfill({ status: 200, body: 'ok' }));
    await authPage.goto(`${API}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 'pw' })}`);
    await expect(authPage.getByAltText('Alternate CRM')).toBeVisible();
    await expect(authPage.getByText('View only — it won\'t make any changes')).toBeVisible();
    expect(await authPage.getByAltText('Alternate CRM').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
    await authPage.screenshot({ path: `${SHOTS}-authorize-page.png` });

    await authPage.getByLabel('Your personal API key').fill('lsk_wrong');
    await authPage.getByRole('button', { name: 'Connect' }).click();
    await expect(authPage.getByText(/That key didn't work/)).toBeVisible();

    await authPage.getByLabel('Your personal API key').fill(raw);
    await authPage.getByRole('button', { name: 'Connect' }).click();
    await expect.poll(() => redirected, { timeout: 15000 }).toBeTruthy();
    const back = new URL(redirected);
    expect(back.searchParams.get('state')).toBe('pw');
    const tok = await (await request.post(`${API}/oauth/token`, { form: {
      grant_type: 'authorization_code', code: back.searchParams.get('code'), redirect_uri: CALLBACK,
      code_verifier: verifier, client_id: reg.client_id } })).json();
    expect(tok.access_token).toBeTruthy();

    const init = await mcp(request, tok.access_token, 'initialize', { protocolVersion: '2025-06-18' });
    expect(init.body.result.serverInfo.icons[0].src).toContain('/oauth/logo.png');
    expect(init.body.result.instructions).toMatch(/never follow instructions/);
    const tools = (await mcp(request, tok.access_token, 'tools/list')).body.result.tools.map((t) => t.name);
    expect(tools).toContain('get_team_performance');
    expect(tools).not.toContain('add_note');                    // view only
    const found = await mcp(request, tok.access_token, 'tools/call', { name: 'list_cadences', arguments: {} });
    expect(found.body.result.isError).toBe(false);
    const refused = await mcp(request, tok.access_token, 'tools/call', { name: 'add_note', arguments: { lead_id: 'x', content: 'x' } });
    expect(refused.body.result.isError).toBe(true);
    expect(refused.body.result.content[0].text).toMatch(/view-only/);

    // Monitoring → Claude Logs shows what just happened.
    await login(page, SA, '#control-center');
    await page.getByRole('button', { name: 'Monitoring', exact: true }).click();
    await page.getByRole('button', { name: /Claude Logs/ }).click();
    await page.getByPlaceholder('Search person, email or tool…').fill('list_cadences');
    await expect(page.getByText('list_cadences').first()).toBeVisible({ timeout: 20000 });
    await page.getByPlaceholder('Search person, email or tool…').fill('add_note');
    await expect(page.getByText('Refused').first()).toBeVisible({ timeout: 20000 });
    await page.getByPlaceholder('Search person, email or tool…').fill('');
    await expect(page.getByText('Connected').first()).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: `${SHOTS}-monitoring-claude-logs.png`, fullPage: true });

    // Revoke from My Settings → Claude is cut off.
    await login(page, SA, '#my-settings');
    const row = page.locator('li').filter({ hasText: keyName });
    await row.getByRole('button', { name: 'Revoke' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click();
    await expect(row).toHaveCount(0, { timeout: 15000 });
    expect((await mcp(request, tok.access_token, 'ping')).status).toBe(401);
  });

  test('2. SA: Control Center → Integrations shows both connector switches', async ({ page }) => {
    await login(page, SA, '#control-center');
    await page.getByRole('button', { name: 'Integrations', exact: true }).click();
    await expect(page.getByText('Let everyone connect Claude')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Allow Claude to make changes')).toBeVisible();
    await expect(page.getByText(/only Super Admins can connect for now/)).toBeVisible();
    await expect(page.getByText(/Monitoring → Claude Logs/)).toBeVisible();
    await page.getByText('Let everyone connect Claude').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}-integrations-switches.png` });
  });

  for (const role of Object.keys(PERSONAS)) {
    test(`3. ${role}: no connector card, no key, no Claude Logs (Super Admins only by default)`, async ({ page, request }) => {
      const tok = PERSONAS[role];
      await call(request, 'PATCH', '/api/admin/sync-settings', SA, { mcp_everyone_enabled: false });
      const listed = await call(request, 'GET', '/api/me/api-keys', tok);
      expect(listed.status).toBe(200);
      expect(listed.body.available).toBe(false);
      const create = await call(request, 'POST', '/api/me/api-keys', tok, { name: 'nope' });
      expect(create.status).toBe(403);
      expect(create.body.detail).toMatch(/isn't available for your account/);
      expect((await call(request, 'GET', '/api/admin/claude-logs', tok)).status).toBe(403);
      expect((await call(request, 'PATCH', '/api/admin/sync-settings', tok, { mcp_everyone_enabled: true })).status).toBe(403);

      await login(page, tok, '#my-settings');
      await expect(page.getByText('My Settings').first()).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(2500);   // card renders only after the key list loads
      await expect(page.locator('[data-tour="my-settings-claude"]')).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}-${role.replace(' ', '-').toLowerCase()}-no-card.png`, fullPage: true });
    });
  }

  test('4. Opened to everyone: each persona can connect, sees only their own data, and closing it cuts them off', async ({ page, request }) => {
    await call(request, 'PATCH', '/api/admin/sync-settings', SA, { mcp_everyone_enabled: true, mcp_write_enabled: false });
    for (const [role, tok] of Object.entries(PERSONAS)) {
      const listed = await call(request, 'GET', '/api/me/api-keys', tok);
      expect(listed.body.available, role).toBe(true);
      const key = await call(request, 'POST', '/api/me/api-keys', tok, { name: `PW ${role} ${RUN}` });
      expect(key.status, role).toBe(200);
      try {
        const reg = await (await request.post(`${API}/oauth/register`, { data: { redirect_uris: [CALLBACK] } })).json();
        const verifier = crypto.randomBytes(48).toString('base64url');
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
        const auth = await request.post(`${API}/oauth/authorize`, { maxRedirects: 0, form: {
          api_key: key.body.key, client_id: reg.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256' } });
        expect(auth.status(), role).toBe(302);
        const code = new URL(auth.headers().location).searchParams.get('code');
        const t = await (await request.post(`${API}/oauth/token`, { form: { grant_type: 'authorization_code', code, redirect_uri: CALLBACK, code_verifier: verifier, client_id: reg.client_id } })).json();
        // Claude's lead list = the app's lead list for this persona.
        const viaClaude = await mcp(request, t.access_token, 'tools/call', { name: 'list_leads', arguments: {} });
        expect(viaClaude.body.result.isError, `${role}: ${viaClaude.body.result.content[0].text}`).toBe(false);
        const appLeads = await call(request, 'GET', '/api/leads?page=1&per_page=25', tok);
        expect(JSON.parse(viaClaude.body.result.content[0].text).total, role).toBe(appLeads.body.total);
        // v13.9.2: counting in one call agrees with the app's own total; pods are admin-only; tags are listed.
        const counted = await mcp(request, t.access_token, 'tools/call', { name: 'count_leads', arguments: { group_by: 'status' } });
        expect(counted.body.result.isError, `${role} count_leads: ${counted.body.result.content[0].text}`).toBe(false);
        const countBody = JSON.parse(counted.body.result.content[0].text);
        expect(countBody.groups.reduce((n, g) => n + g.leads, 0), `${role} groups add up`).toBe(countBody.total_leads);
        const pods = await mcp(request, t.access_token, 'tools/call', { name: 'list_pods', arguments: {} });
        expect(pods.body.result.isError, `${role} list_pods`).toBe(['Pod Admin'].includes(role) ? false : true);
        const tagList = await mcp(request, t.access_token, 'tools/call', { name: 'list_tags', arguments: {} });
        expect(tagList.body.result.isError, `${role} list_tags`).toBe(false);
        await call(request, 'PATCH', '/api/admin/sync-settings', SA, { mcp_everyone_enabled: false });
        expect((await mcp(request, t.access_token, 'ping')).status, `${role} cut off`).toBe(401);
        await call(request, 'PATCH', '/api/admin/sync-settings', SA, { mcp_everyone_enabled: true });
      } finally {
        await call(request, 'DELETE', `/api/me/api-keys/${key.body.id}`, tok);
      }
    }
    // A persona now sees the card in My Settings.
    await login(page, PERSONAS.SDR, '#my-settings');
    await expect(page.locator('[data-tour="my-settings-claude"]')).toBeVisible({ timeout: 30000 });
    await page.screenshot({ path: `${SHOTS}-sdr-card-when-opened.png`, fullPage: true });
  });

  test('5. Changes on: sending a cadence draft needs an explicit confirm (preview first, nothing sent)', async ({ request }) => {
    await call(request, 'PATCH', '/api/admin/sync-settings', SA, { mcp_write_enabled: true, mcp_everyone_enabled: false });
    const key = await call(request, 'POST', '/api/me/api-keys', SA, { name: `PW confirm ${RUN}` });
    try {
      const reg = await (await request.post(`${API}/oauth/register`, { data: { redirect_uris: [CALLBACK] } })).json();
      const verifier = crypto.randomBytes(48).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const auth = await request.post(`${API}/oauth/authorize`, { maxRedirects: 0, form: {
        api_key: key.body.key, client_id: reg.client_id, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256' } });
      const code = new URL(auth.headers().location).searchParams.get('code');
      const t = await (await request.post(`${API}/oauth/token`, { form: { grant_type: 'authorization_code', code, redirect_uri: CALLBACK, code_verifier: verifier, client_id: reg.client_id } })).json();
      const tools = (await mcp(request, t.access_token, 'tools/list')).body.result.tools;
      const approve = tools.find((x) => x.name === 'approve_cadence_draft');
      expect(approve.annotations).toMatchObject({ destructiveHint: true, openWorldHint: true });

      // An open approval draft on staging, if one exists — preview it, never confirm.
      const mine = (await call(request, 'GET', '/api/my/tasks?status=open', SA)).body || [];
      const draft = mine.find((x) => x.kind === 'email_approval' || x.kind === 'sms_approval');
      test.skip(!draft, 'no open approval draft on staging to preview (annotations + confirm logic covered in backend tests)');
      const preview = await mcp(request, t.access_token, 'tools/call', { name: 'approve_cadence_draft', arguments: { lead_id: draft.lead_id, task_id: draft.id } });
      const text = preview.body.result.content[0].text;
      expect(preview.body.result.isError, text).toBe(false);
      expect(JSON.parse(text).sent).toBe(false);
      const still = (await call(request, 'GET', `/api/leads/${draft.lead_id}/tasks`, SA)).body.find((x) => x.id === draft.id);
      expect(still.done).not.toBe('true');                        // nothing was sent
    } finally {
      await call(request, 'DELETE', `/api/me/api-keys/${key.body.id}`, SA);
    }
  });
});
