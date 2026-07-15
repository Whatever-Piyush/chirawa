import { defineConfig } from 'vitest/config';

// Unit tests for framework-free logic only (pure utils + services). React Native
// component rendering is intentionally out of scope — this project has no RN test
// harness and the bubble is verified by driving the app.
export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    include:     ['src/**/*.test.ts'],
  },
});
