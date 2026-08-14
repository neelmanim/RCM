/**
 * API Health Tests — verify every critical backend endpoint responds correctly.
 * These run FIRST to detect backend issues before UI tests.
 */
const { test, expect, apiGet } = require('./helpers');

test.describe('API Health', () => {

  test('GET /api/health returns 200', async ({ request }) => {
    const { status } = await apiGet(request, '/health');
    expect(status).toBe(200);
  });

  test('GET /api/auth/me returns user profile', async ({ request }) => {
    const { status, body } = await apiGet(request, '/auth/me');
    expect(status).toBe(200);
    expect(body).toHaveProperty('email');
    expect(body).toHaveProperty('role');
    expect(body.role).toBe('Super Admin');
  });

  test('GET /api/leads returns paginated leads', async ({ request }) => {
    const { status, body } = await apiGet(request, '/leads?page=1&per_page=10');
    expect(status).toBe(200);
    // Should have data array and pagination metadata
    const leads = body.data || body.leads || (Array.isArray(body) ? body : []);
    expect(Array.isArray(leads)).toBe(true);
    expect(leads.length).toBeGreaterThan(0);
  });

  test('GET /api/admin/users returns user list', async ({ request }) => {
    const { status, body } = await apiGet(request, '/admin/users');
    expect(status).toBe(200);
    const users = Array.isArray(body) ? body : (body.data || []);
    expect(users.length).toBeGreaterThan(0);
    // Each user should have core fields
    expect(users[0]).toHaveProperty('id');
    expect(users[0]).toHaveProperty('email');
    expect(users[0]).toHaveProperty('role');
  });

  test('GET /api/growth-intelligence returns metrics', async ({ request }) => {
    const { status, body } = await apiGet(request, '/growth-intelligence');
    expect(status).toBe(200);
    expect(body).toHaveProperty('metrics');
    expect(body).toHaveProperty('ai');
    expect(body.metrics).toHaveProperty('total_leads');
    expect(body.ai).toHaveProperty('health_score');
  });

  test('GET /api/admin/metrics/sdr-table returns SDR data', async ({ request }) => {
    const { status, body } = await apiGet(request, '/admin/metrics/sdr-table');
    expect(status).toBe(200);
    const sdrs = Array.isArray(body) ? body : (body.data || []);
    // Staging may have no call data — accept empty array, just confirm endpoint is up
    expect(Array.isArray(sdrs)).toBe(true);
    console.log(`  → SDR count from API: ${sdrs.length} (may be 0 on staging)`);
    sdrs.forEach(s => console.log(`    - ${s.user_name || s.name}: ${s.calls_logged || 0} calls`));
  });

  test('GET /api/admin/login-logs returns paginated logs', async ({ request }) => {
    const { status, body } = await apiGet(request, '/admin/login-logs?page=1&limit=10');
    expect(status).toBe(200);
    // Verify response structure — should be { data: [...], total, ... }
    console.log(`  → Login logs response keys: ${Object.keys(body).join(', ')}`);
    const logs = body.data || (Array.isArray(body) ? body : []);
    expect(Array.isArray(logs)).toBe(true);
    console.log(`  → Login log entries: ${logs.length}`);
  });

  test('GET /api/admin/activity-feed returns audit logs', async ({ request }) => {
    // Correct path: /admin/activity-feed (not /admin/audit/activity which does not exist)
    const { status, body } = await apiGet(request, '/admin/activity-feed');
    expect(status).toBe(200);
    console.log(`  → Activity feed response keys: ${Object.keys(body).join(', ')}`);
  });

  test('GET /api/admin/sync-settings returns settings', async ({ request }) => {
    const { status, body } = await apiGet(request, '/admin/sync-settings');
    expect(status).toBe(200);
    expect(body).toHaveProperty('lead_limit');
  });

  test('GET /api/email/config returns config (no 404)', async ({ request }) => {
    const { status } = await apiGet(request, '/email/config');
    // 200 or 401 are acceptable, just not 404
    expect(status).not.toBe(404);
  });

  test('GET /api/admin/leads/unassigned returns array', async ({ request }) => {
    const { status, body } = await apiGet(request, '/admin/leads/unassigned');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    console.log(`  → Unassigned leads: ${body.length}`);
  });

  test('GET /api/admin/leads/assigned returns array', async ({ request }) => {
    const { status, body } = await apiGet(request, '/admin/leads/assigned');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    console.log(`  → Assigned leads: ${body.length}`);
  });

  test('GET /api/admin/metrics/summary returns metrics', async ({ request }) => {
    const { status, body } = await apiGet(request, '/admin/metrics/summary');
    expect(status).toBe(200);
    expect(body).toHaveProperty('calls_logged');
  });

  test('GET /api/leads/dashboard-stats returns stats', async ({ request }) => {
    const { status, body } = await apiGet(request, '/leads/dashboard-stats');
    expect(status).toBe(200);
  });

  test('GET /api/pods returns pods list', async ({ request }) => {
    const { status, body } = await apiGet(request, '/pods');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    console.log(`  → Pods: ${body.length} (${body.map(p => p.name).join(', ')})`);
  });

  test('GET /api/admin/activity-feed returns feed', async ({ request }) => {
    const { status, body } = await apiGet(request, '/admin/activity-feed');
    expect(status).toBe(200);
  });

  test('GET /api/leaderboard returns data', async ({ request }) => {
    const { status } = await apiGet(request, '/leaderboard');
    expect(status).toBe(200);
  });

  test('GET /api/admin/leads/upload-logs returns upload history', async ({ request }) => {
    // Correct path: /admin/leads/upload-logs (not /uploads/logs)
    const { status, body } = await apiGet(request, '/admin/leads/upload-logs');
    expect(status).toBe(200);
    const logs = Array.isArray(body) ? body : (body.data || []);
    console.log(`  → Upload logs: ${logs.length} entries`);
  });

  // ── RCA Regression Guards (May 6 incident) ────────────────────────────────

  test('[RCA-RC3] GET /api/config — allow_demo is false (no demo accounts exposed)', async ({ request }) => {
    const { status, body } = await apiGet(request, '/config');
    expect(status).toBe(200);
    // If allow_demo is true on staging it means the RC3 fix was reverted
    expect(body.allow_demo).toBe(false);
    console.log(`  → /api/config allow_demo: ${body.allow_demo} ✅`);
  });

  test('[RCA-RC2] GET /api/health — returns 200 immediately (no StartupReadinessMiddleware)', async ({ request }) => {
    // Hit health three times in quick succession — if ReadinessMiddleware still
    // exists it may return 503 on the first few calls after a cold start.
    for (let i = 0; i < 3; i++) {
      const { status } = await apiGet(request, '/health');
      expect(status).toBe(200);
    }
    console.log('  → /api/health returned 200 on 3 consecutive calls ✅');
  });

  test('[RCA-RC1] GET /api/auth/me — response is fast (no OOM startup task blocking DB)', async ({ request }) => {
    const start = Date.now();
    const { status } = await apiGet(request, '/auth/me');
    const elapsed = Date.now() - start;
    expect(status).toBe(200);
    // If _repair_truncated_emails is still running, /me will be slow (5-30s)
    // Flag if > 8 seconds — that's a sign of a blocking startup task
    console.log(`  → /api/auth/me responded in ${elapsed}ms`);
    expect(elapsed).toBeLessThan(8000);
  });

});
