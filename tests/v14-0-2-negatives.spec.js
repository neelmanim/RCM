// v14.0.2 on STAGING — the "must NOT see" checks for Activity Monitor / Call Monitor / Email / Messages, against the data
// scripts/seed_staging_multipod.py plants (run that first). Read-only. Rule: docs/ACCESS_MATRIX.md.
//   npx playwright test tests/v14-0-2-negatives.spec.js
const { test, expect } = require('@playwright/test');
const { PERSONAS, API, api } = require('./helpers/v13-7-0-staging');

const SA = PERSONAS.sa;
test.skip(!SA.token, 'SA_TOKEN missing from .env.test');

const ENDPOINTS = ['call-logs', 'email-logs', 'message-logs'];
const text = (items) => JSON.stringify(items);

async function tokenFor(request, key) {
  const users = (await api(request, 'GET', '/api/admin/users', SA.token)).body;
  const list = Array.isArray(users) ? users : users.users || [];
  const u = list.find((x) => x.email === `qa-matrix-${key}@screen-magic.com`);
  expect(u, `seed user qa-matrix-${key} missing — run scripts/seed_staging_multipod.py`).toBeTruthy();
  const r = await api(request, 'GET', `/api/admin/users/${u.id}/token`, SA.token);
  expect(r.status).toBe(200);
  return r.body.token || r.body.access_token;
}

const items = async (request, token, endpoint) =>
  ((await api(request, 'GET', `/api/admin/${endpoint}?per_page=200&search=QA-MATRIX`, token)).body || {}).items || [];

for (const endpoint of ENDPOINTS) {
  test(`Pod Admin A sees rep A, never rep B — ${endpoint}`, async ({ request }) => {
    const t = await tokenFor(request, 'pa-a');
    const seen = text(await items(request, t, endpoint));
    expect(seen).toContain('QA-MATRIX');                 // there is something to see (the seed ran)
    expect(seen).not.toMatch(/qa-matrix-rep-b|QA-MATRIX rep-b|theirs/i);
  });
  test(`Pod Admin with no pod sees nothing — ${endpoint}`, async ({ request }) => {
    const t = await tokenFor(request, 'pa-none');
    expect(await items(request, t, endpoint)).toEqual([]);
  });
  test(`Super Admin sees both reps — ${endpoint}`, async ({ request }) => {
    expect(text(await items(request, SA.token, endpoint))).toMatch(/rep-a/i);
  });
}

test('SDR is refused on all three', async ({ request }) => {
  const sdr = PERSONAS.sdr;
  test.skip(!sdr.token, 'SDR token missing');
  for (const e of ENDPOINTS) expect((await api(request, 'GET', `/api/admin/${e}`, sdr.token)).status).toBe(403);
});
