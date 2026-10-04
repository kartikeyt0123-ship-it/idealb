import { defineConfig } from '@playwright/test';

/**
 * UI end-to-end suite. Runs against a live stack (real API, worker, runner, PostgreSQL):
 *   npm run dev            # terminal 1 (DEMO_MODE=true)
 *   npm run test:e2e       # terminal 2
 * Uses the seeded demo commander and crews; registers its own fresh crews.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE ?? 'http://127.0.0.1:5173', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
