import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only include integration tests
    include: ['tests/integration/**/*.integration.test.ts'],

    // Use Node environment (not jsdom) since we're testing the core layer
    environment: 'node',

    // Globals for describe, it, expect without imports
    globals: true,

    // Longer timeout for network requests (30 seconds)
    testTimeout: 30000,

    // Hook timeout for cleanup operations
    hookTimeout: 30000,

    // Run test files sequentially to avoid rate limiting
    sequence: {
      concurrent: false,
    },
  },
});
