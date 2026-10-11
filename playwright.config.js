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
  // RCA 2026-08-24: fullyParallel:false only serializes tests WITHIN one
  // file — Playwright still ran separate spec files concurrently (3 workers
  // by default here), and staging's backend (512Mi) got OOM-killed mid-run.
  // tests/specs/playwright.config.js already encodes this exact lesson
  // ("Sequential — staging can't handle parallel load") with workers: 1;
  // this config just never inherited it.
  workers: 1,
  retries: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.STAGING_URL || 'https://messenger-frontend-staging.onrender.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
