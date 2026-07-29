import { defineConfig } from "tsdown";

/**
 * Two clearly separated build entries:
 *
 *  - `core`  : framework-agnostic API client. No React anywhere, so nothing
 *              needs to be marked external.
 *  - `hooks` : React-only wrappers. `react` / `react-dom` are marked external
 *              so they are NEVER bundled — the host app's React instance is used.
 *
 * The root entry (`.`) re-exports both layers and, because it includes the
 * hooks, also treats React as external.
 */
export default defineConfig([
  {
    entry: { index: "src/core/index.ts" },
    outDir: "dist/core",
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    // core has no React dependency -> no externals needed
  },
  {
    entry: { index: "src/hooks/index.ts" },
    outDir: "dist/hooks",
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ["react", "react-dom"],
  },
  {
    entry: { index: "src/index.ts" },
    outDir: "dist",
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ["react", "react-dom"],
  },
]);
