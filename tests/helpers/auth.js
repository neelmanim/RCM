/**
 * Auth helper — gets a JWT token for any user via the Super Admin API.
 * Token is then used via the ?token= URL parameter that the app supports.
 *
 * NOTE (graph): This module is consumed by Playwright E2E tests via `require('./helpers/auth')`.
 * Because Playwright tests use dynamic module imports the knowledge graph cannot trace the
 * call edges, so this file appears as a 4-node "helpers-token" micro-community with low
 * cohesion. This is a known graph false-positive — not a dead-code or design concern.
 */

const BASE_URL = process.env.STAGING_URL || 'https://rcm-crm-staging.onrender.com';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

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
      `  To get a valid token, call: GET ${BASE_URL}/api/auth/demo?role=Super%20Admin`
    );
  }

  const usersRes = await request.get(`${BASE_URL}/api/admin/users`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });

  if (!usersRes.ok()) {
    const body = await usersRes.text();
    throw new Error(
      `GET /api/admin/users failed (${usersRes.status()}):\n  ${body}\n` +
      `  The ADMIN_TOKEN may be expired or invalid. Get a fresh one from /api/auth/demo?role=Super%20Admin`
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

  const tokenRes = await request.get(`${BASE_URL}/api/admin/users/${user.id}/token`, {
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
  await page.goto(`${BASE_URL}/frontend/index.html?token=${token}`, { waitUntil: 'networkidle', timeout: 30000 });
  // Wait for the app to initialize and render
  await page.waitForTimeout(2000);
  return token;
}

/**
 * Navigate to a specific view via sidebar click.
 */
async function navigateTo(page, viewName) {
  await page.click(`a[data-view="${viewName}"]`);
  await page.waitForTimeout(2500);
}

module.exports = { BASE_URL, ADMIN_TOKEN, getTokenForUser, loginAs, navigateTo };
