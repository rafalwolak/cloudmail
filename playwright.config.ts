import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  outputDir: './.ai/qa/artifacts_playwright',
  fullyParallel: true,
  workers: 2,
  timeout: 20000,
  retries: 0,
  use: { baseURL: process.env.BASE_URL || 'http://127.0.0.1:8787', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'user-browser', use: { browserName: 'chromium', viewport: { width: 615, height: 853 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
