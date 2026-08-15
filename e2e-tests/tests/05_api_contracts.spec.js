import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_BASE || 'https://backend-production-4147.up.railway.app';

test.describe('Commercial API Contracts & Health', () => {
  test('GET /api/auth/demo returns valid authentication token and user role', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/auth/demo?role=Super%20Admin`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('token');
    expect(body).toHaveProperty('user');
    expect(body.user).toHaveProperty('role');
    expect(body.token.length).toBeGreaterThan(20);
  });

  test('GET /api/seed_demo_temp returns success response with database records', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/seed_demo_temp`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('success', true);
    expect(body).toHaveProperty('message');
  });
});
