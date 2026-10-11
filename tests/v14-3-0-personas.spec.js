// v14.3.0 on STAGING - every persona: what they see, what is refused, and that every guided tour works for them.
// Read-only (nothing is saved; the one place that could write - the ICP words - is only called by a persona that must be refused).
// Run one persona at a time so a small staging server is never hit with everything at once:
//   npx playwright test tests/v14-3-0-personas.spec.js -g "Super Admin"      (then "Pod Admin", "SDR", "AE", "CSM")
const { test, expect } = require('@playwright/test');
const { warmUp, API, PERSONAS, watch, login, shot, api } = require('./helpers/v13-7-0-staging');

test.beforeAll(async ({ request }) => { await warmUp(request); });
test.describe.configure({ mode: 'serial' });

const B = '/api/admin/analytics/daily-digest';
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const Q = `from=${day(7)}&to=${day(1)}`;

// What each person's navigation and Help -> Guided tours must contain (mirrors frontend-react/src/features/help-hub/data/tours.js).
const ALL = ['Super Admin', 'Admin', 'Pod Admin', 'AE', 'SDR', 'CSM'];
const REPS = ['Super Admin', 'Admin', 'Pod Admin', 'AE', 'SDR'];
const ADMINS = ['Super Admin', 'Admin', 'Pod Admin'];
const TOURS = [
  ['Team Digest', ADMINS], ['Control Center', ADMINS], ['Dashboard', REPS], ['My Tasks', ALL], ['Leads', REPS], ['Sales Tools', REPS],
  ['Leaderboard', REPS], ['Analytics Hub', REPS], ['AE Pipeline', ['AE']], ['CSM Inbox', ['CSM']], ['CSM Portfolio', ['CSM']],
  ['CSM Playbooks', ['CSM']], ['CSM Digest', ['CSM']], ['My Settings', ALL],
];
const NAV = { 'Team Digest': ADMINS, 'Control Center': ADMINS, 'My Tasks': ALL, Dashboard: ['Super Admin', 'Pod Admin', 'AE', 'SDR'] };

const WHO = [
  { name: 'Super Admin', p: PERSONAS.sa, role: 'Super Admin', admin: true, superAdmin: true },
  { name: 'Pod Admin', p: PERSONAS.pa, role: 'Pod Admin', admin: true },
  { name: 'SDR', p: PERSONAS.sdr, role: 'SDR' },
  { name: 'AE', p: PERSONAS.ae, role: 'AE' },
  { name: 'CSM', p: PERSONAS.csm, role: 'CSM' },
];
// Known test-login race (not a product fault): the first load via ?token= fires the bell's fetches before the token is stored; the same endpoints answer 200 when asked normally.
const clean = (c) => c.problems().filter((p) => !/^(40[139]|409) /.test(p) && !/NotificationBell\] failed to fetch pending notifications/.test(p));

async function closeAircall(page) {
  const h = page.getByText('Aircall — log in below');
  if (await h.isVisible({ timeout: 3000 }).catch(() => false)) {
    await h.locator('xpath=ancestor::*[.//button][1]').locator('button').first().click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}
const guide = (page) => page.getByRole('dialog', { name: /guided tour/i });
async function dismissGuide(page) {
  if (await guide(page).first().isVisible({ timeout: 2500 }).catch(() => false)) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
}
async function openHelpTours(page) {
  await page.evaluate(() => window._loadView('user-guide'));
  const head = page.getByRole('button', { name: /^Guided tours$/ });
  await expect(head).toBeVisible({ timeout: 30000 });
  if (!(await page.getByRole('button', { name: /^Start the .* tour$/ }).first().isVisible().catch(() => false))) await head.click();
  await expect(page.getByRole('button', { name: /^Start the .* tour$/ }).first()).toBeVisible({ timeout: 15000 });
}

for (const w of WHO) {
  test.describe(w.name, () => {
    test.skip(!w.p.token, `${w.name} token missing from .env.test`);

    test(`${w.name}: the API says yes or no exactly as the access table`, async ({ request }) => {
      const t = w.p.token;
      const reads = [`${B}/breakdown?${Q}&dimension=icp`, `${B}/accounts?${Q}`, `${B}/calls?${Q}`, `${B}/drilldown/leads?${Q}&dimension=icp&segment=In%20ICP`, '/api/admin/analytics/icp'];
      for (const r of reads) expect((await api(request, 'GET', r, t)).status, `${w.name} GET ${r.split('?')[0]}`).toBe(w.admin ? 200 : 403);
      expect((await api(request, 'GET', '/api/admin/audit-log?category=export', t)).status).toBe(w.superAdmin ? 200 : 403);
      if (!w.superAdmin) expect((await api(request, 'PUT', '/api/admin/analytics/icp', t, { keywords: ['health'] })).status, 'only a Super Admin changes the ICP').toBe(403);
      if (!w.admin) expect((await api(request, 'GET', `${B}/drilldown.xlsx?${Q}`, t)).status).toBe(403);
      if (w.admin) {
        const sa = (await api(request, 'GET', `${B}/breakdown?${Q}&dimension=country&compare=false`, PERSONAS.sa.token)).body.total;
        const me = (await api(request, 'GET', `${B}/breakdown?${Q}&dimension=country&compare=false`, t)).body.total;
        expect(me.calls, 'never more than the whole org').toBeLessThanOrEqual(sa.calls);
        if (!w.superAdmin) expect((await api(request, 'GET', `${B}/breakdown?${Q}&dimension=country&compare=false&pod_id=not-mine`, t)).body.total.calls, 'a pod_id from a Pod Admin changes nothing').toBe(me.calls);
      }
    });

    test(`${w.name}: the navigation shows exactly the right pages`, async ({ page }) => {
      const c = watch(page);
      await login(page, w.p.token, { tours: true });
      await closeAircall(page);
      await dismissGuide(page);
      for (const [item, roles] of Object.entries(NAV)) {
        const count = await page.locator('nav').getByText(item, { exact: true }).count();
        expect(count > 0, `${w.name} ${item}`).toBe(roles.includes(w.role));
      }
      expect(clean(c)).toEqual([]);
    });

    test(`${w.name}: the first visit starts a guide by itself, closing it is remembered, and it does not come back`, async ({ page }) => {
      const c = watch(page);
      await login(page, w.p.token, { tours: true });
      await closeAircall(page);
      await expect(guide(page).first(), 'a first-time visitor is offered a guide on the page they land on').toBeVisible({ timeout: 45000 });
      await expect(guide(page).first().getByText(/^\d+ of \d+$/)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(guide(page)).toHaveCount(0);
      await page.reload();
      await page.waitForSelector('nav >> text=My Tasks', { timeout: 45000 });
      await closeAircall(page);
      await page.waitForTimeout(3500);
      expect(await guide(page).count(), 'not shown again').toBe(0);
      expect(clean(c)).toEqual([]);
    });

    test(`${w.name}: Help -> Guided tours lists exactly their guides`, async ({ page }) => {
      await login(page, w.p.token, { tours: true });
      await closeAircall(page);
      await dismissGuide(page);
      await openHelpTours(page);
      const names = await page.getByRole('button', { name: /^Start the .* tour$/ }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label').replace(/^Start the /, '').replace(/ tour$/, '')));
      const expected = TOURS.filter(([, roles]) => roles.includes(w.role)).map(([n]) => n);
      expect(names.sort()).toEqual(expected.sort());
      await shot(page, `v14-3-help-tours-${w.name.replace(/ /g, '')}`);
    });

    test(`${w.name}: every guide on their list starts, points at real things on screen, and reaches the end`, async ({ page }) => {
      test.setTimeout(900000);
      const c = watch(page);
      await login(page, w.p.token, { tours: true });
      await closeAircall(page);
      await dismissGuide(page);
      const mine = TOURS.filter(([, roles]) => roles.includes(w.role)).map(([n]) => n);
      const report = [];
      for (const name of mine) {
        await openHelpTours(page);
        await page.getByRole('button', { name: `Start the ${name} tour` }).click();
        await closeAircall(page);
        const dlg = guide(page).first();
        const started = await expect(dlg).toBeVisible({ timeout: 40000 }).then(() => true, () => false);
        if (!started) { report.push({ name, started: false, steps: [] }); continue; }
        const steps = [];
        let ended = 'got it';
        for (let i = 0; i < 20; i++) {
          await page.waitForTimeout(900);   // let a page that is still settling finish before the step is measured
          const title = (await dlg.locator('h4').first().textContent()).trim();
          const counter = (await dlg.getByText(/^\d+ of \d+$/).textContent()).trim();
          const box = await dlg.locator('div.bg-white').first().boundingBox();
          const vp = page.viewportSize();
          const onScreen = !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width + 1 && box.y + box.height <= vp.height + 1;
          const ring = await dlg.locator('div.ring-2').first().boundingBox();
          steps.push({ title, counter, onScreen, ring: !!ring && ring.width > 0 && ring.height > 0 });
          if (i === 0) await shot(page, `v14-3-tour-${w.name.replace(/ /g, '')}-${name.replace(/ /g, '')}-1`);
          const last = await dlg.getByRole('button', { name: 'Got it' }).count();
          if (last) { await shot(page, `v14-3-tour-${w.name.replace(/ /g, '')}-${name.replace(/ /g, '')}-last`); await dlg.getByRole('button', { name: 'Got it' }).click(); break; }
          await dlg.getByRole('button', { name: 'Next' }).click({ timeout: 20000 }).catch(() => {});
          await page.waitForTimeout(300);
          await expect(dlg.getByRole('button', { name: /^(Next|Got it)$/ })).toBeEnabled({ timeout: 25000 }).catch(() => {});   // the move has finished
          if (!(await guide(page).count())) { ended = 'early'; break; }   // nothing more on this page to point at: the guide closed itself
        }
        // another guide on the same page (e.g. Sales Tools has two) now takes its turn: it must come ONE AT A TIME, never over this one
        for (let k = 0; k < 4 && (await guide(page).count().catch(() => 0)); k++) {
          expect(await guide(page).count(), 'two guides on screen at once').toBe(1);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(700);
        }
        await expect(guide(page)).toHaveCount(0, { timeout: 10000 });
        report.push({ name, started: true, steps, ended });
      }
      console.log(`PERSONA ${w.name} GUIDES\n` + report.map((r) => `  ${r.name}: ${r.started ? r.steps.map((s) => s.counter.split(' ')[0]).join(',') + ` of ${r.steps.at(-1)?.counter.split(' ')[2]}` + (r.ended === 'early' ? ' (ended early)' : '') : 'DID NOT START'}`).join('\n'));
      const notStarted = report.filter((r) => !r.started).map((r) => r.name);
      expect(notStarted, 'every guide on the list starts').toEqual([]);
      const badPlace = report.flatMap((r) => r.steps.filter((s) => !s.onScreen || !s.ring).map((s) => `${r.name}: ${s.title}`));
      expect(badPlace, 'every step has its card on screen and a highlight around something').toEqual([]);
      // what each guide must still say for this person
      const byName = Object.fromEntries(report.map((r) => [r.name, r.steps.map((s) => s.title)]));
      if (byName['Team Digest']) {
        expect(byName['Team Digest']).toEqual(expect.arrayContaining(['Choose the period', 'Your numbers', 'Funnel', 'Drill-down: who the work goes to', 'Accounts and Calls', 'Leads touched']));
      }
      if (byName['Control Center']) {
        expect(byName['Control Center']).toEqual(expect.arrayContaining(['Welcome to Control Center', 'Team & Access', 'Who may download data']));
        // staging has no Salesforce, so the Salesforce steps are only required where the page has them (Super Admin)
        if (w.superAdmin) expect(byName['Control Center']).toEqual(expect.arrayContaining(['What syncs', 'Field mapping']));
        if (w.superAdmin) expect(byName['Control Center']).toContain('Export History');
        else expect(byName['Control Center'], 'a Pod Admin has no Export History tab').not.toContain('Export History');
      }
      expect(clean(c)).toEqual([]);
    });

    test(`${w.name}: the Guide button at the top replays the guide of the page they are on`, async ({ page }) => {
      await login(page, w.p.token, { tours: true });
      await closeAircall(page);
      for (let k = 0, quiet = 0; k < 10 && quiet < 2; k++) {   // first-visit guides start late and take turns: close them all, until none shows twice in a row
        await page.waitForTimeout(2500);
        if (await guide(page).first().isVisible().catch(() => false)) { await page.keyboard.press('Escape'); quiet = 0; } else quiet++;
      }
      const guideBtn = page.locator('#nh-page-guide-btn');
      await expect(guideBtn, 'the landing page has a guide, so the button is there').toBeVisible({ timeout: 45000 });
      await guideBtn.click();
      await expect(guide(page).first()).toBeVisible({ timeout: 15000 });
      await expect(guide(page).first().getByText(/^1 of \d+$/)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(guide(page)).toHaveCount(0);
    });
  });
}

test('Pod Admin and Super Admin Team Digest: the drill-down, tooltips and Export respect who they are', async ({ page }) => {
  test.setTimeout(240000);
  for (const w of WHO.filter((x) => x.admin)) {
    const c = watch(page);
    await login(page, w.p.token, { tours: true });
    await closeAircall(page);
    await dismissGuide(page);
    await page.locator('nav').getByText('Team Digest', { exact: true }).first().click();
    await dismissGuide(page);
    const card = page.locator('[data-tour="digest-drilldown"]');
    await card.scrollIntoViewIfNeeded();
    await expect(card.getByText(/Leads worked|No activity/).first()).toBeVisible({ timeout: 60000 });
    expect(await card.getByRole('button', { name: /Edit ICP/ }).count() > 0, `${w.name}: only a Super Admin sees Edit ICP`).toBe(!!w.superAdmin);
    // plain-language help on the numbers
    const tip = card.getByRole('button', { name: 'About Conversations' }).first();
    if (await tip.count()) { await tip.hover(); await expect(page.getByRole('tooltip')).toContainText(/talked with you/i, { timeout: 8000 }); await page.mouse.move(0, 0); }
    // Export follows the person's own switch
    const caps = (await api(page.request, 'GET', '/api/me/capabilities', w.p.token)).body;
    expect(await card.getByRole('button', { name: /Export/ }).count() > 0, `${w.name}: Export button matches capability`).toBe(!!caps.export);
    await shot(page, `v14-3-digest-${w.name.replace(/ /g, '')}`);
    expect(clean(c)).toEqual([]);
  }
});

test('the people who must not see Team Digest are refused if they open it directly', async ({ page, request }) => {
  for (const w of WHO.filter((x) => !x.admin)) {
    expect((await api(request, 'GET', `${B}?${Q}`, w.p.token)).status, `${w.name} Team Digest data`).toBe(403);
    await login(page, w.p.token, { tours: true });
    await closeAircall(page);
    await dismissGuide(page);
    await page.evaluate(() => window._loadView('digest'));
    await page.waitForTimeout(2500);
    expect(await page.locator('[data-tour="digest-drilldown"]').count(), `${w.name} must not get the drill-down`).toBe(0);
  }
});
