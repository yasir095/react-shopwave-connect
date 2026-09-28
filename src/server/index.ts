/**
 * react-shopwave-connect/server
 *
 * Framework-agnostic, server-only building blocks for Shopwave OAuth
 * (authorization-code flow with a client secret). Works in any runtime with
 * `fetch` and Web Crypto: Node 18+, Next.js route handlers, Express, edge.
 *
 * For Next.js apps, `react-shopwave-connect/next` wires these into ready-made
 * route handlers, session storage and a proxy guard.
 */

export { createShopwaveOAuth, assertOAuthConfig } from "./oauth";
export type { ShopwaveOAuthConfig, ShopwaveOAuthClient } from "./oauth";

export {
  tokenFromResponse,
  normalizeStoredToken,
  isTokenExpired,
  authorizationHeader,
  isExpiredTokenResponse,
  SHOPWAVE_TOKEN_EXPIRED_ERROR_ID,
} from "./token";
export type { ShopwaveToken, ShopwaveTokenResponse } from "./token";

export { sanitizeReturnTo, createState, safeEqual } from "./returnTo";

export { ShopwaveAuthError } from "./errors";
export type { ShopwaveAuthErrorCode } from "./errors";
