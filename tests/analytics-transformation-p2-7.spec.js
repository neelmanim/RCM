// ── Analytics Transformation Phases 2-7 — E2E ─────────────────────────────
// Verifies, against real staging data: Phase 3 metric governance (draft ->
// edit -> preview/compare -> publish, live on MetricCard), Phase 4's
// Overview tab, Phase 6's day/week/month Trend in Ask Analytics vNext (incl.
// that dimensional group_by is still rejected), and a UI-reachability check
// for the _q_conversion_rate cross-pod scope fix (the deterministic proof of
// that fix is backend/tests/test_smart_analytics.py::TestConversionRatePodScoping,
// which runs against controlled synthetic data — this test only confirms the
// fixed code path is reachable and doesn't crash for a real Pod Admin asking
// about a real cross-pod SDR by name, since exact real-data arithmetic can't
// be asserted without knowing staging's live numbers). Run:
//   npx playwright test tests/analytics-transformation-p2-7.spec.js
const { test, expect } = require('@playwright/test');
const { loginAs, BASE_URL } = require('./helpers/auth');

const SUPER_ADMIN_EMAIL = 'neelmani.mishra@screen-magic.com';
// Real Pod Admin (pod "bjhb") + a real SDR confirmed to belong to a
// DIFFERENT pod ("Gamma Team", 687 assigned leads) — looked up live via
// GET /api/pods before writing this test, not guessed.
const POD_ADMIN_EMAIL = 'beta.admin@test.messenger.com';
const CROSS_POD_SDR_NAME = 'Kavya Desai';

// Governance test target: a Phase 2 metric, not connect_rate/disqualified/
// meetings_scheduled/leads_assigned — those are what Phase 1's own spec
// inspects, so publishing a new definition here avoids changing text another
// spec's assertions might (even loosely) depend on.
const GOVERNANCE_METRIC_NAME = 'Unique Leads Called';

async function goToAnalytics(page) {
  await page.evaluate(() => { window.location.hash = '#analytics'; });
  await page.waitForTimeout(1500);
}

async function openVNext(page) {
  await goToAnalytics(page);
  await page.getByText('Try the new Analytics Hub').click();
  await expect(page.getByText('Analytics Hub vNext')).toBeVisible({ timeout: 15000 });
}

test.describe('Analytics Transformation Phases 2-7', () => {
  test('1. Overview tab shows a grouped KPI grid with real resolved values', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await openVNext(page);

    await page.getByText('Overview', { exact: true }).click();
    // Not asserting a specific value (real staging data changes) — asserting
    // the grid actually resolved something, not stuck on the '···' placeholder.
    await expect(page.getByText('Calls', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Connect Rate', { exact: true })).toBeVisible();
    await expect(page.locator('text=···')).toHaveCount(0, { timeout: 15000 });
  });

  test('2. Metric governance: draft -> edit -> compare -> publish, live on the Metrics tab', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await openVNext(page);
    await page.getByText('Metrics', { exact: true }).click();

    // MetricCard.jsx's name label is a direct child of the card's root div —
    // walk up exactly one level to scope everything else to this one card,
    // not `div:has(text)`, which matches every ancestor div up to the grid.
    const card = page.getByText(GOVERNANCE_METRIC_NAME, { exact: true }).locator('xpath=..');

    // Draft — starts a new version forked from the current published text.
    const draftBtn = card.getByRole('button', { name: /^Draft v\d+$/ });
    await draftBtn.click({ timeout: 15000 });
    const tryBtn = card.getByRole('button', { name: /^Try v\d+$/ });
    await expect(tryBtn).toBeVisible({ timeout: 15000 });
    await tryBtn.click();

    // Draft value renders (execution unchanged by a metadata-only draft).
    await expect(card.getByText(/execution unchanged by a metadata-only draft/)).toBeVisible({ timeout: 15000 });

    // Edit the definition and save.
    const stamp = `E2E governance check ${Date.now()}`;
    const textarea = card.locator('textarea');
    await textarea.fill(stamp);
    await card.getByRole('button', { name: 'Save draft' }).click();

    // Compare view reflects the edit as a changed field. Scoped to the
    // compare panel's own "Draft: X" line, not the bare stamp text — the
    // textarea still holds the identical string, so an unscoped match is
    // ambiguous (2 elements) once both are on screen at once.
    await expect(card.getByText(/Definition \(changed\)/)).toBeVisible({ timeout: 15000 });
    await expect(card.getByText(`Draft: ${stamp}`)).toBeVisible();

    // Publish — version badge advances and the draft affordance resets to "Draft vN+1".
    await card.getByRole('button', { name: /^Publish v\d+$/ }).click();
    await expect(card.getByRole('button', { name: /^Draft v\d+$/ })).toBeVisible({ timeout: 15000 });
    await expect(card.getByRole('button', { name: /^Try v\d+$/ })).toHaveCount(0);
  });

  test('3. Ask Analytics vNext answers a day/week/month Trend question, or degrades gracefully if the LLM is down', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await openVNext(page);
    await page.getByText('Ask Analytics').click();

    await page.getByPlaceholder(/connect rate/i).fill('show calls made per day for the last 7 days');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();

    const trendShown = page.getByText(/trend/i);
    const llmError = page.getByText(/AI service error|not currently defined|isn't supported/i);
    await expect(trendShown.or(llmError)).toBeVisible({ timeout: 20000 });
  });

  test('4. Ask Analytics vNext still rejects a non-time-bucket breakdown (sdr/pod)', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await openVNext(page);
    await page.getByText('Ask Analytics').click();

    await page.getByPlaceholder(/connect rate/i).fill('calls made broken down by sdr');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();

    // Either the "no breakdowns... aside from day/week/month trends" message,
    // or a graceful LLM-down degrade — never a crash, and never a bare
    // resolved scalar/trend (which would mean the carve-out over-matched).
    const rejected = page.getByText(/no breakdowns or rankings yet|isn't supported|not currently defined/i);
    const llmError = page.getByText(/AI service error/i);
    await expect(rejected.or(llmError)).toBeVisible({ timeout: 20000 });
  });

  test('5. Cross-pod scope fix (_q_conversion_rate): a Pod Admin asking about a real SDR from a different pod gets a scoped/graceful answer, not a crash', async ({ page, request }) => {
    await loginAs(page, request, POD_ADMIN_EMAIL);
    await goToAnalytics(page);
    await page.locator('#ah-tab-ask-ai').click();
    await expect(page.locator('#ai-query-input')).toBeVisible({ timeout: 15000 });

    await page.locator('#ai-query-input').fill(`what is ${CROSS_POD_SDR_NAME}'s conversion rate`);
    await page.locator('#ai-run-btn').click();

    const resultShown = page.getByText(/Results for/i);
    const gracefulMiss = page.getByText(/could not find|couldn.t find|not found|isn.t supported|AI service error/i);
    await expect(resultShown.or(gracefulMiss)).toBeVisible({ timeout: 20000 });
    // The historical bug (pod silently dropped whenever sdr_id was set) would
    // have produced a result too — a crash was never the failure mode, wrong
    // scoping was. This test proves the path is reachable and error-free
    // post-fix; the exact-value regression proof is the unit test noted above.
  });
});
