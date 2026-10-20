import { defineConfig, devices } from '@playwright/test';
import { randomInt } from 'node:crypto';

/**
 * Browser tests for the web portal. They need the full stack running:
 *
 *   node scripts/e2e-stack.mjs up        # database, API :3031, web :3030
 *   pnpm --filter e2e test               # this suite
 *
 * E2E_BASE_URL points the suite at another web origin (default
 * http://localhost:3030). See DEPLOYMENT.md -> "Browser tests".
 */
const CI = !!process.env.CI;

/**
 * Each test process presents its own client address (X-Forwarded-For, which
 * the web forwards to the API as the client IP): the API budgets sign-in per
 * address (10 per 15 minutes), and back-to-back local runs from one address
 * would otherwise exhaust it. Distinct clients, as in real use.
 */
const clientIp = `10.${randomInt(1, 254)}.${randomInt(1, 254)}.${randomInt(1, 254)}`;

export default defineConfig({
  testDir: './tests',
  globalSetup: './support/global-setup.ts',
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : 3,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['github']]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3030',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'en-GB',
    timezoneId: 'Asia/Phnom_Penh',
    extraHTTPHeaders: { 'X-Forwarded-For': clientIp },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});
