const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './specs',
  timeout: 60000,
  retries: 0,
  workers: 1,             // Sequential — staging can't handle parallel load
  fullyParallel: false,
  reporter: [
    ['list'],
    ['html', { outputFolder: '../test-results/html', open: 'never' }],
    ['json', { outputFile: '../test-results/results.json' }],
  ],
  outputDir: '../test-results/artifacts',
  use: {
    baseURL: process.env.STAGING_URL || 'https://rcm-frontend-staging.onrender.com',
    screenshot: 'on',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
  ],
});
