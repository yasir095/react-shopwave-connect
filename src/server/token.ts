/**
 * Token model + helpers shared by every server-side integration.
 *
 * The Shopwave auth server returns (snake_case):
 *   { access_token, refresh_token, token_type: "OAuth", expires_in: 43200 }
 *
 * We store a normalised, camelCase shape with an absolute expiry so any
 * request can decide whether the token is still usable without extra state.
 */

export interface ShopwaveToken {
  accessToken: string;
  /** Long-lived; the Shopwave server does not rotate it on refresh. */
  refreshToken?: string;
  /** Scheme used in the Authorization header. Shopwave uses "OAuth". */
  tokenType: string;
  /** Absolute expiry, epoch milliseconds. Undefined if the server didn't say. */
  expiresAt?: number;
}

/** Raw token response from `POST {authServer}/oauth/token`. */
export interface ShopwaveTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number | string;
  [key: string]: unknown;
}

/** Shopwave API error id meaning "access token expired / invalid". */
export const SHOPWAVE_TOKEN_EXPIRED_ERROR_ID = 908;

/**
 * Converts a token-endpoint response into a {@link ShopwaveToken}.
 * Returns `null` when the response has no access token.
 *
 * @param previous  the token being refreshed; its refresh token is kept when
 *                  the server doesn't send a new one.
 */
export function tokenFromResponse(
  response: ShopwaveTokenResponse,
  previous?: ShopwaveToken,
  now: number = Date.now()
): ShopwaveToken | null {
  if (!response || typeof response.access_token !== "string" || !response.access_token) {
    return null;
  }

  const expiresIn = Number(response.expires_in);

  return {
    accessToken: response.access_token,
    refreshToken:
      (typeof response.refresh_token === "string" && response.refresh_token) ||
      previous?.refreshToken,
    tokenType: (typeof response.token_type === "string" && response.token_type) || "OAuth",
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : undefined,
  };
}

/**
 * Reads a token from session storage. Accepts both the current shape and the
 * legacy raw response that older apps (e.g. AdminUI ≤ 0.1) stored directly in
 * the session, so existing sessions survive an upgrade.
 */
export function normalizeStoredToken(raw: unknown): ShopwaveToken | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;

  if (typeof t.accessToken === "string" && t.accessToken) {
    return {
      accessToken: t.accessToken,
      refreshToken: typeof t.refreshToken === "string" ? t.refreshToken : undefined,
      tokenType: typeof t.tokenType === "string" && t.tokenType ? t.tokenType : "OAuth",
      expiresAt: typeof t.expiresAt === "number" ? t.expiresAt : undefined,
    };
  }

  if (typeof t.access_token === "string" && t.access_token) {
    // Legacy shape: we don't know when it was issued, so no expiresAt.
    // It will be refreshed reactively when the API reports it expired.
    return {
      accessToken: t.access_token,
      refreshToken: typeof t.refresh_token === "string" ? t.refresh_token : undefined,
      tokenType: typeof t.token_type === "string" && t.token_type ? t.token_type : "OAuth",
    };
  }

  return null;
}

/**
 * True when the token has passed its expiry (minus `skewSeconds`).
 * Tokens without a known expiry are treated as valid.
 *
 * Shopwave only issues a new access token once the old one has actually
 * expired, so the default skew is 0 — refreshing early just returns the same
 * token.
 */
export function isTokenExpired(
  token: ShopwaveToken,
  { skewSeconds = 0, now = Date.now() }: { skewSeconds?: number; now?: number } = {}
): boolean {
  if (token.expiresAt === undefined) return false;
  return now >= token.expiresAt - skewSeconds * 1000;
}

/** `Authorization` header value, e.g. `OAuth 111ad…`. */
export function authorizationHeader(token: ShopwaveToken): string {
  return `${token.tokenType || "OAuth"} ${token.accessToken}`;
}

/**
 * True when a Shopwave API response means "your access token is no longer
 * valid": HTTP 401, or the API error 908 in the response envelope.
 * Use it to trigger a forced refresh + a single retry.
 */
export function isExpiredTokenResponse(status: number, body?: unknown): boolean {
  if (status === 401) return true;
  // `errors` in responses seen so far; the API reference calls it `error`.
  const message = (body as { api?: { message?: { errors?: Record<string, { id?: number }>; error?: Record<string, { id?: number }> } } })
    ?.api?.message;
  const errors = message?.errors ?? message?.error;
  if (!errors || typeof errors !== "object") return false;
  return Object.entries(errors).some(
    ([key, value]) =>
      key === String(SHOPWAVE_TOKEN_EXPIRED_ERROR_ID) ||
      Number(value?.id) === SHOPWAVE_TOKEN_EXPIRED_ERROR_ID
  );
}
