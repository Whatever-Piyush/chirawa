import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    include:     ['src/**/*.test.ts'],
    setupFiles:  ['./src/test-setup.ts'],
    coverage: {
      provider:  'v8',
      reporter:  ['text', 'html'],
      include:   ['src/modules/pricing/**'],
      thresholds: {
        lines:      100,
        functions:  100,
        branches:   100,
        statements: 100,
      },
    },
  },
});
