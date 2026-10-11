// v13.0.6 staging check — cross-cadence comparison, SMS engagement, and
// per-rep stats actually respond correctly against real staging data, not
// just the mocked unit tests. API-first (mirrors v13-0-1's own style),
// since the data/shape matters more here than clicking through the UI.
//
// Run: V_SA_TOKEN=... npx playwright test tests/v13-0-6-cadence-reporting-staging.spec.js
const { test, expect } = require('@playwright/test');

const API = process.env.API_BASE_URL || 'https://messenger-crm-staging.onrender.com';
const SA_TOKEN = process.env.V_SA_TOKEN || '';

if (!/^https:\/\/messenger-crm-staging\.onrender\.com$/.test(API)) {
  throw new Error(`Refusing to run: not staging (${API})`);
}

async function call(request, method, path, token, body) {
  const res = await request.fetch(`${API}/api${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status(), body: await res.json().catch(() => null) };
}

test.describe('v13.0.6 cadence reporting — staging', () => {
  test.skip(!SA_TOKEN, 'V_SA_TOKEN not provided');

  test('bulk stats, SMS engagement, and per-rep endpoints respond with the expected shape', async ({ request }) => {
    const list = await call(request, 'GET', '/journeys', SA_TOKEN);
    expect(list.status).toBe(200);
    const ids = list.body.slice(0, 5).map((j) => j.id);
    test.skip(ids.length === 0, 'No cadences exist on staging to check against');

    const bulk = await call(request, 'GET', `/journeys/stats-bulk?ids=${ids.join(',')}`, SA_TOKEN);
    expect(bulk.status).toBe(200);
    expect(bulk.body).toHaveProperty('journeys');
    for (const id of ids) {
      expect(bulk.body.journeys).toHaveProperty(id);
      expect(bulk.body.journeys[id]).toHaveProperty('engagement');
    }

    const single = await call(request, 'GET', `/journeys/${ids[0]}/stats`, SA_TOKEN);
    expect(single.status).toBe(200);
    expect(single.body).toHaveProperty('sms_engagement');
    expect(single.body.sms_engagement).toHaveProperty('overall');
    expect(single.body.sms_engagement.overall).toHaveProperty('delivery_rate');
    expect(single.body.sms_engagement.overall).toHaveProperty('reply_rate');

    const byRep = await call(request, 'GET', `/journeys/${ids[0]}/stats/by-rep`, SA_TOKEN);
    expect(byRep.status).toBe(200);
    expect(byRep.body).toHaveProperty('reps');

    const trend = await call(request, 'GET', `/journeys/${ids[0]}/stats/trend`, SA_TOKEN);
    expect(trend.status).toBe(200);
    expect(trend.body).toHaveProperty('points');
    console.log('v13.0.6 staging check — all four new endpoints responded with the expected shape.');
  });

  test('bulk stats silently drops an id the caller cannot see (no 500, no leak)', async ({ request }) => {
    const bulk = await call(request, 'GET', '/journeys/stats-bulk?ids=not-a-real-journey-id', SA_TOKEN);
    expect(bulk.status).toBe(200);
    expect(bulk.body.journeys).toEqual({});
  });
});
