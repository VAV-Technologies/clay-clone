import { defineConfig } from '@playwright/test';

// Browser E2E suite. Point at a target with DATAFLOW_TEST_BASE_URL
// (e.g. the prod QA sandbox or a local `next start`). Auth is carried by
// injecting the dataflow_device_token cookie inside the specs.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: process.env.DATAFLOW_TEST_BASE_URL || 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
