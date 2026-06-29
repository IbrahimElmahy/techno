import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Electron E2E tests should run sequentially to prevent focus/port collisions
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 800 },
  },
});
