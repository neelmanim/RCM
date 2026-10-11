/**
 * Auth helper — gets a JWT token for any user via the Super Admin API.
 * Token is then used via the ?token= URL parameter that the app supports.
 *
 * NOTE (graph): This module is consumed by Playwright E2E tests via `require('./helpers/auth')`.
 * Because Playwright tests use dynamic module imports the knowledge graph cannot trace the
 * call edges, so this file appears as a 4-node "helpers-token" micro-community with low
 * cohesion. This is a known graph false-positive — not a dead-code or design concern.
 */

const BASE_URL = process.env.STAGING_URL || 'https://messenger-crm-staging.onrender.com';
// RCA 2026-08-24: staging is two separate Render services (a static frontend
// host and the FastAPI backend) — BASE_URL (from STAGING_URL) is the frontend
// host used for page navigation below, but the frontend doesn't proxy /api/*
// (it 404s to its own SPA index.html, which broke JSON parsing here for every
// spec using loginAs). The backend API host needs its own var — reusing
// tests/specs/helpers.js's existing API_BASE_URL convention rather than
// inventing a new one.
const API_BASE_URL = process.env.API_BASE_URL || 'https://messenger-crm-staging.onrender.com';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

function _decodeJwtEmail(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).email; }
  catch { return null; }
}

/**
 * Get a token for any user by email (via Super Admin's user-token endpoint).
 */
async function getTokenForUser(request, email) {
  if (!ADMIN_TOKEN) {
    throw new Error('ADMIN_TOKEN env variable is not set. Export a valid Super Admin JWT.');
  }
  // Quick JWT format sanity check (3 dot-separated segments)
  if (ADMIN_TOKEN.split('.').length !== 3) {
    throw new Error(
      `ADMIN_TOKEN does not look like a JWT (expected 3 dot-separated segments).\n` +
      `  Got: "${ADMIN_TOKEN.substring(0, 40)}..."\n` +
      `  To get a valid token, sign in as a Super Admin and use Control Center → Users → View As (GET /api/admin/users/{id}/token)`
    );
  }

  // RCA 2026-09-28: GET /admin/users/{id}/token 400s with "Cannot view as
  // yourself" when the target is the same account ADMIN_TOKEN belongs to
  // (get_user_token, backend/routes/admin_user_routes.py — a self-view
  // guard added 2026-09-04). That 400 body has no `token` field, so
  // `data.token` came back undefined and `?token=undefined` silently sent
  // every loginAs(..., ADMIN_TOKEN's own email) call to the login page
  // instead of the dashboard — every test in this file failed on the
  // waitForSelector timeout that followed, not on an auth error, so this
  // went unnoticed. ADMIN_TOKEN already IS that account's token — skip the
  // mint entirely instead of asking the API to hand back its own identity.
  if (_decodeJwtEmail(ADMIN_TOKEN) === email) {
    return ADMIN_TOKEN;
  }

  const usersRes = await request.get(`${API_BASE_URL}/api/admin/users`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });

  if (!usersRes.ok()) {
    const body = await usersRes.text();
    throw new Error(
      `GET /api/admin/users failed (${usersRes.status()}):\n  ${body}\n` +
      `  The ADMIN_TOKEN may be expired or invalid. Get a fresh one via View As (GET /api/admin/users/{id}/token)`
    );
  }

  const users = await usersRes.json();

  if (!Array.isArray(users)) {
    throw new Error(
      `GET /api/admin/users returned non-array: ${JSON.stringify(users).substring(0, 200)}\n` +
      `  The ADMIN_TOKEN is likely invalid or expired.`
    );
  }

  const user = users.find((u) => u.email === email);
  if (!user) throw new Error(`User not found: ${email}. Available: ${users.map(u => u.email).join(', ')}`);

  const tokenRes = await request.get(`${API_BASE_URL}/api/admin/users/${user.id}/token`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  const data = await tokenRes.json();
  return data.token;
}

/**
 * Login as a user: navigate to app with token in URL, wait for dashboard load.
 */
async function loginAs(page, request, email) {
  const token = await getTokenForUser(request, email);
  // RCA 2026-08-24: /frontend/index.html 404s on the current static site (it
  // serves from the root) — this staled out along with the API host above,
  // silently sending every spec using loginAs to a 404 page instead of the
  // app. sdr-lead-page-p1.spec.js's own separate helper already uses the
  // correct root path; matching it here.
  //
  // waitUntil: 'networkidle' also never resolves on this app — it has
  // persistent background network activity (heartbeat pings / SSE) that
  // never goes quiet for the required 500ms, so this always timed out at
  // 30s regardless of whether the page actually loaded. sdr-lead-page-p1's
  // helper avoids this the same way: no waitUntil override, then wait for a
  // real element instead of blind network-idleness.
  await page.goto(`${BASE_URL}/?token=${token}`);
  // #app-sidebar doesn't exist in the current markup either (confirmed via a
  // full page snapshot — the app had actually loaded correctly, sidebar and
  // all, this selector was just stale) — wait on the sidebar's own visible
  // "Dashboard" link instead, matching navigateTo()'s fixed lookup below.
  await page.waitForSelector('nav >> text=Dashboard', { timeout: 30000 });
  return token;
}

// RCA 2026-08-24: navigateTo() used `a[data-view="${viewName}"]`, which
// hasn't existed since the sidebar was rebuilt in React (NavSidebar.jsx —
// links are plain <a href="#"> with an onClick handler, no data attribute
// at all) — broken for every spec using it, not just today's. Mirrors
// NAV_ITEMS' id → label in frontend-react/src/layout/NavSidebar.jsx so
// existing call sites (admin, leads, settings, etc.) keep working unchanged.
const _NAV_LABELS = {
  dashboard: 'Dashboard', digest: 'Daily Digest', leads: 'Leads',
  'sales-journeys': 'Sales Cadences', pods: 'POD Management', leaderboard: 'Leaderboard',
  settings: 'Settings', admin: 'Admin', upload: 'Upload Center', 'audit-logs': 'System Logs',
  'activity-monitor': 'Activity Monitor', analytics: 'Analytics Hub', calendar: 'Calendar',
  'my-calls': 'Power Dialer', 'my-settings': 'My Settings', playground: 'Playground',
  'user-guide': 'Help',
};

/**
 * Navigate to a specific view via sidebar click.
 */
async function navigateTo(page, viewName) {
  const label = _NAV_LABELS[viewName] || viewName;
  await page.getByRole('link', { name: label, exact: true }).click();
  await page.waitForTimeout(2500);
}

module.exports = { BASE_URL, API_BASE_URL, ADMIN_TOKEN, getTokenForUser, loginAs, navigateTo };
