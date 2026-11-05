import { defineConfig } from "vitest/config";

/** Fast, offline unit tests (no API credentials needed). */
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    globals: true,
  },
});
