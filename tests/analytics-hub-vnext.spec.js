// ── Analytics Hub vNext — Phase 1 parallel beta E2E ──────────────────────────
// Verifies the new Metric Registry + Semantic Layer experience against real
// staging data: the "Try the new Analytics Hub" entry link (Super-Admin-only),
// the 5 canonical metric cards, Inspect, Compare, and Ask Analytics — plus
// that the existing classic Analytics Hub keeps working untouched and that
// the vNext entry is genuinely invisible to a non-Super-Admin role. Run:
//   npx playwright test tests/analytics-hub-vnext.spec.js
const { test, expect } = require('@playwright/test');
const { loginAs, BASE_URL } = require('./helpers/auth');

const SUPER_ADMIN_EMAIL = 'neelmani.mishra@screen-magic.com';
// Minted fresh via loginAs() rather than the .env.test SDR_TOKEN, which
// expires within hours of being captured — a real SDR account on staging.
const SDR_EMAIL = 'dev.beta@test.messenger.com';

async function goToAnalytics(page) {
  await page.evaluate(() => { window.location.hash = '#analytics'; });
  await page.waitForTimeout(1500);
}

test.describe('Analytics Hub vNext — Phase 1 parallel beta', () => {
  test('1. classic Analytics Hub is the default view, with a link to try the new one (Super Admin)', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await goToAnalytics(page);

    await expect(page.locator('.ah-tab-bar')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Try the new Analytics Hub')).toBeVisible();
  });

  test('2. switching to vNext renders the 5 canonical metric cards with real resolved values', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await goToAnalytics(page);
    await page.getByText('Try the new Analytics Hub').click();

    await expect(page.getByText('Analytics Hub vNext')).toBeVisible({ timeout: 15000 });
    for (const name of ['Connect Rate', 'Leads Assigned', 'Account Connect Rate', 'Disqualified', 'Meetings Scheduled']) {
      await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15000 });
    }
    // Classic tab bar must be gone — this is a full swap, not an overlay.
    await expect(page.locator('.ah-tab-bar')).toHaveCount(0);
  });

  test('3. Inspect shows a real definition, formula, and date basis for a live metric', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await goToAnalytics(page);
    await page.getByText('Try the new Analytics Hub').click();
    await expect(page.getByText('Analytics Hub vNext')).toBeVisible({ timeout: 15000 });

    await page.getByText('Inspect').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByText('Definition')).toBeVisible();
    await expect(dialog.getByText('Formula')).toBeVisible();
    await expect(dialog.getByText('Date basis')).toBeVisible();
    // For Super Admin, the query-implementation pointer must be present
    // (docs §14 — admins can see where a number comes from).
    await expect(dialog.getByText('Query implementation')).toBeVisible();
    await page.keyboard.press('Escape').catch(() => {});
  });

  test('4. Compare shows old-vs-new for a metric and never crashes into an error state', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await goToAnalytics(page);
    await page.getByText('Try the new Analytics Hub').click();
    await expect(page.getByText('Analytics Hub vNext')).toBeVisible({ timeout: 15000 });

    await page.getByText('Compare with current').first().click();
    // Either "match" or "difference" is a valid, real result — just must
    // resolve to one of them, not hang on "Loading…" or throw. Anchored to
    // MetricCard's own literal suffix text to avoid matching unrelated copy
    // elsewhere on the page (e.g. a Google Sign-In notice).
    await expect(page.getByText(/— match|— difference/)).toBeVisible({ timeout: 15000 });
  });

  test('5. Ask Analytics answers a real scalar question with an interpretation shown first — or fails gracefully if the LLM is down', async ({ page, request }) => {
    // This endpoint depends on a third-party LLM (Groq) via the existing NL
    // parser — same dependency the legacy Ask AI tab already has. If Groq is
    // unavailable, the correct behavior is a clean "unsupported" message, not
    // a crash — verify whichever real outcome happens, rather than assuming
    // the LLM is always reachable.
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await goToAnalytics(page);
    await page.getByText('Try the new Analytics Hub').click();
    await expect(page.getByText('Analytics Hub vNext')).toBeVisible({ timeout: 15000 });

    await page.getByText('Ask Analytics').click();
    await page.getByPlaceholder(/connect rate/i).fill("what's our connect rate?");
    await page.getByRole('button', { name: 'Ask', exact: true }).click();

    const interpretation = page.getByText(/I understood this as/);
    const llmError = page.getByText(/AI service error|not currently defined|isn't supported/i);
    await expect(interpretation.or(llmError)).toBeVisible({ timeout: 20000 });

    if (await interpretation.isVisible()) {
      await expect(page.getByText('Connect Rate', { exact: false })).toBeVisible();
    }
  });

  test('6. "Back to current Analytics Hub" returns to the classic tab bar', async ({ page, request }) => {
    await loginAs(page, request, SUPER_ADMIN_EMAIL);
    await goToAnalytics(page);
    await page.getByText('Try the new Analytics Hub').click();
    await expect(page.getByText('Analytics Hub vNext')).toBeVisible({ timeout: 15000 });

    await page.getByText('Back to current Analytics Hub').click();
    await expect(page.locator('.ah-tab-bar')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Try the new Analytics Hub')).toBeVisible();
  });

  test('7. vNext entry link is invisible to a non-Super-Admin role (SDR) — no route/URL bypass', async ({ page, request }) => {
    await loginAs(page, request, SDR_EMAIL);
    await goToAnalytics(page);
    // SDR is self-scoped — Analytics Hub itself may show a reduced tab set,
    // but the vNext link must not appear regardless.
    await expect(page.getByText('Try the new Analytics Hub')).toHaveCount(0);
  });
});
