/**
 * @shopwave/sdk
 *
 * Root entry re-exporting both layers. Prefer the subpath imports when you want
 * a hard boundary:
 *   - `@shopwave/sdk/core`  — framework-agnostic, no React
 *   - `@shopwave/sdk/hooks` — React hooks
 *
 * Types live in `core` and are shared by both layers (no duplication).
 */

export * from "./core";
export * from "./hooks";
