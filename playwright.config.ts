import { defineConfig, devices } from '@playwright/test';

const evidence = process.env.EVIDENCE_DIR || 'artifacts';
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: `${evidence}/test-results`,
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { outputFolder: `${evidence}/playwright-report`, open: 'never' }]],
  use: { baseURL: process.env.BASE_URL || 'http://localhost:8080', trace: 'on-first-retry', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 960 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }
  ]
});
