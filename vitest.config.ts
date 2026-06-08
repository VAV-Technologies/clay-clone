import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit + integration runner. Browser E2E lives in tests/e2e and is run by
// Playwright (`npm run test:e2e`), NOT vitest — hence the include globs below
// deliberately exclude *.spec.ts.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // `forks` pool is the safe choice on Windows with the native better-sqlite3 addon.
    pool: 'forks',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
