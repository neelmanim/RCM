/**
 * v12.6.4 performance audit — the post-v12.4 feature set (AE Pipeline, CSM
 * Portal's 4 flat sections, the merged Super Admin Pipeline hub) under real
 * staging load, plus the app's own already-built performance monitor
 * (backend/routes/perf_routes.py's perf-summary, which aggregates real
 * request timings + RAIL distribution — reused here rather than building a
 * second, parallel load-test harness).
 *
 * Tokens via env: SA_TOKEN, AE_TOKEN, CSM_TOKEN.
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com';
const API_BASE = process.env.STAGING_API || 'https://messenger-crm-staging.onrender.com';
const SA_TOKEN = process.env.SA_TOKEN;
const AE_TOKEN = process.env.AE_TOKEN;
const CSM_TOKEN = process.env.CSM_TOKEN;

// Generous ceiling for a free-tier Render staging dyno with a possible cold
// start — this catches a real regression (N+1, missing index, infinite
// retry), not staging's normal cold-start variance.
const SLOW_PAGE_MS = 10_000;
const SLOW_API_MS = 5_000;

const timings = [];
const record = (area, ms) => { timings.push({ area, ms }); console.log(`TIMING ${area}: ${ms}ms`); };

async function login(page, token) {
  await page.addInitScript(() => {
    try { void localStorage.length; } catch { return; }
    ['sales-tools', 'control-center', 'daily-digest', 'cadence-readonly', 'my-settings',
     'leaderboard', 'aircall-drawer', 'ae-pipeline', 'my-tasks', 'csm-portal-inbox',
     'csm-portal-portfolio', 'csm-portal-playbooks', 'csm-portal-digest', 'csm-account-360',
     ].forEach((t) => localStorage.setItem(`alternatecrm:${t}-tour-seen`, '1'));
    localStorage.setItem('leadsHub', 'on');
  });
  await page.goto(`${BASE_URL}/?token=${token}`);
  await page.waitForSelector('nav', { timeout: 45_000 });
}

// Waits for a real content selector, not 'networkidle' — a persistent
// connection (Aircall's SSE, dialer polling) means networkidle never
// resolves and the measurement silently degrades into "however long the
// timeout was", not real page-load time.
async function timedNavigation(page, hash, label, readySelector) {
  const start = Date.now();
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await page.locator(readySelector).first().waitFor({ state: 'visible', timeout: SLOW_PAGE_MS });
  const ms = Date.now() - start;
  record(label, ms);
  if (ms > SLOW_PAGE_MS) console.error(`SLOW [${label}] ${ms}ms exceeds ${SLOW_PAGE_MS}ms ceiling`);
  return ms;
}

test.beforeAll(() => {
  if (!SA_TOKEN) throw new Error('SA_TOKEN env var is required');
  if (!AE_TOKEN) throw new Error('AE_TOKEN env var is required');
  if (!CSM_TOKEN) throw new Error('CSM_TOKEN env var is required');
});

test('Backend perf-summary: real request timings + RAIL distribution for the last 24h', async ({ request }) => {
  const res = await request.get(`${API_BASE}/api/admin/perf-summary`, {
    headers: { Authorization: `Bearer ${SA_TOKEN}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  console.log('perf-summary:', JSON.stringify(body, null, 2).slice(0, 2000));
  // Informational, not a hard gate — this endpoint reflects real aggregate
  // production-shaped traffic, so we log it for the human decision rather
  // than fail the suite on a distribution shape we can't control from here.
});

test('Page load: AE Pipeline (AE)', async ({ page }) => {
  await login(page, AE_TOKEN);
  const ms = await timedNavigation(page, '#ae-pipeline', 'ae-pipeline (AE)', '[data-tour="ae-pipeline-table"]');
  expect(ms).toBeLessThan(SLOW_PAGE_MS);
});

test('Page load: all 4 CSM flat sections (CSM)', async ({ page }) => {
  await login(page, CSM_TOKEN);
  const ready = {
    'csm-inbox': 'h1:has-text("Inbox")',
    'csm-portfolio': 'h1:has-text("Portfolio")',
    'csm-playbooks': 'h1:has-text("Playbooks")',
    'csm-digest': 'h1:has-text("Digest")',
  };
  for (const [hash, selector] of Object.entries(ready)) {
    const ms = await timedNavigation(page, `#${hash}`, `${hash} (CSM)`, selector);
    expect(ms).toBeLessThan(SLOW_PAGE_MS);
  }
});

test('Page load: merged Pipeline hub, both tabs (Super Admin)', async ({ page }) => {
  await login(page, SA_TOKEN);
  const ms1 = await timedNavigation(page, '#pipeline-hub', 'pipeline-hub AE tab (Super Admin)', '[data-tour="ae-pipeline-table"]');
  expect(ms1).toBeLessThan(SLOW_PAGE_MS);

  const start = Date.now();
  await page.getByRole('button', { name: /CSM Portal/ }).click();
  await page.getByText(/account\(s\) total|Every customer account/).first().waitFor({ state: 'visible', timeout: SLOW_PAGE_MS });
  const ms2 = Date.now() - start;
  record('pipeline-hub CSM tab switch (Super Admin)', ms2);
  expect(ms2).toBeLessThan(SLOW_PAGE_MS);
});

test('API latency: new CSM call-log write endpoint', async ({ request }) => {
  // Read-only timing check (GET), since a write here would create test data
  // on every run — the write path itself is already exercised live in
  // v12-6-4-staging-audit.spec.js's call-logging test.
  const start = Date.now();
  const res = await request.get(
    `${API_BASE}/api/csm-portal/accounts/815a7287-1ba8-4f98-aa4c-3217526c07bb`,
    { headers: { Authorization: `Bearer ${CSM_TOKEN}` } },
  );
  const ms = Date.now() - start;
  record('GET account 360 (Account+Opportunities+calls+activities)', ms);
  expect(res.status()).toBe(200);
  if (ms > SLOW_API_MS) console.error(`SLOW [account-360-api] ${ms}ms exceeds ${SLOW_API_MS}ms ceiling`);
  expect(ms).toBeLessThan(SLOW_API_MS);
});

test.afterAll(() => {
  console.log('\n=== v12.6.4 performance summary ===');
  timings.forEach((t) => console.log(`${t.area}: ${t.ms}ms`));
});
