// @ts-check
import { defineConfig } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

// Load test environment variables from .env.test
// This populates SDR_TOKEN, LEAD_*_ID, CRM_URL etc. for all specs.
loadEnv({ path: '.env.test', override: false });

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.STAGING_URL || 'https://rcm-frontend-staging.onrender.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
