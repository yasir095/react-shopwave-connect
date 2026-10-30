/**
 * react-shopwave-connect
 *
 * Root entry re-exporting both client layers. Prefer the subpath imports when you
 * want a hard boundary:
 *   - `react-shopwave-connect/core`  — framework-agnostic, no React
 *   - `react-shopwave-connect/hooks` — React hooks
 *
 * Never re-exports `server` or `next`, so server code can't reach client bundles.
 *
 * Types live in `core` and are shared by both layers (no duplication).
 */

export * from "./core";
export * from "./hooks";
