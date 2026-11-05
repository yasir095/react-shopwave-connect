/**
 * Helpers for the round trip through the auth server.
 */

/**
 * Only allows same-origin relative paths ("/products?tab=1"). Anything that
 * could send the user to another site after login — absolute URLs,
 * protocol-relative "//evil.com", backslash tricks, control characters —
 * falls back to `fallback`.
 */
export function sanitizeReturnTo(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return fallback;
  }
  // Must start with a single "/" not followed by "/" or "\".
  if (!/^\/(?![/\\])/.test(value)) return fallback;
  // No control characters (CR/LF header injection, tabs, NUL, …).
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  if (value.includes("\\")) return fallback;
  return value;
}

/** Random, URL-safe value for the OAuth `state` parameter (128 bits, hex). */
export function createState(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison for state values. */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
