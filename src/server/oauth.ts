import { ShopwaveAuthError } from "./errors";
import { tokenFromResponse, type ShopwaveToken, type ShopwaveTokenResponse } from "./token";

/**
 * Per-app OAuth settings. Everything that differs between Shopwave apps lives
 * here; the flow itself is identical for all of them.
 */
export interface ShopwaveOAuthConfig {
  /** e.g. `https://secure.merchantstack.com` (no trailing slash needed). */
  authServerUrl: string;
  clientId: string;
  /** Server-side only. Never expose it to the browser. */
  clientSecret: string;
  /**
   * The callback URL registered for this client on the auth server, e.g.
   * `https://admin.example.com/auth`. Must match exactly.
   */
  redirectUri: string;
  /** Where the auth server sends the user after logout. Defaults to `redirectUri`. */
  postLogoutRedirectUri?: string;
  /** Defaults to `"application"`. */
  scope?: string;
  /** Defaults to `"online"`. */
  accessType?: string;
  /**
   * Body encoding for `POST /oauth/token`. Defaults to standard
   * `application/x-www-form-urlencoded`; `"multipart"` sends `FormData`.
   */
  tokenRequestFormat?: "urlencoded" | "multipart";
  /** Auth-server paths. Defaults match Shopwave: `/login`, `/oauth/token`, `/logout`. */
  endpoints?: { login?: string; token?: string; logout?: string };
  /** Custom fetch (tests, proxies). Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

export interface ShopwaveOAuthClient {
  readonly config: Readonly<ShopwaveOAuthConfig>;
  /** URL to send the browser to so the user can sign in. */
  buildLoginUrl(params?: { state?: string }): string;
  /** URL to send the browser to so the auth server ends its own session. */
  buildLogoutUrl(params?: { redirectUri?: string }): string;
  /** Exchanges the `?code=` from the callback for tokens (server-to-server). */
  exchangeCode(code: string): Promise<ShopwaveToken>;
  /**
   * Gets a fresh access token. Shopwave keeps the same refresh token, so the
   * returned token carries the previous refresh token when none is sent back.
   */
  refreshToken(token: ShopwaveToken | string): Promise<ShopwaveToken>;
}

const REQUIRED_KEYS = ["authServerUrl", "clientId", "clientSecret", "redirectUri"] as const;

/** Throws a readable error when required settings are missing. */
export function assertOAuthConfig(config: Partial<ShopwaveOAuthConfig>): asserts config is ShopwaveOAuthConfig {
  const missing = REQUIRED_KEYS.filter((k) => !config?.[k]);
  if (missing.length > 0) {
    throw new ShopwaveAuthError(
      "config_invalid",
      `Shopwave auth is missing required settings: ${missing.join(", ")}`
    );
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Creates a framework-agnostic Shopwave OAuth client (authorization-code flow
 * with a client secret — the Shopwave auth server does not support PKCE, so
 * this must run on a server).
 *
 * Config is validated lazily on first use, so creating the client at module
 * scope doesn't break builds where env vars aren't present.
 */
export function createShopwaveOAuth(config: ShopwaveOAuthConfig): ShopwaveOAuthClient {
  const endpoints = {
    login: config.endpoints?.login ?? "/login",
    token: config.endpoints?.token ?? "/oauth/token",
    logout: config.endpoints?.logout ?? "/logout",
  };

  const base = () => {
    assertOAuthConfig(config);
    return trimSlash(config.authServerUrl);
  };

  const commonParams = (redirectUri: string) =>
    new URLSearchParams({
      access_type: config.accessType ?? "online",
      redirect_uri: redirectUri,
      response_type: "code",
      client_id: config.clientId,
      scope: config.scope ?? "application",
    });

  async function postToken(
    fields: Record<string, string>,
    errorCode: "token_exchange_failed" | "token_refresh_failed"
  ): Promise<ShopwaveTokenResponse> {
    const url = `${base()}${endpoints.token}`;
    const doFetch = config.fetch ?? globalThis.fetch;

    let body: URLSearchParams | FormData;
    if (config.tokenRequestFormat === "multipart") {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      body = fd;
    } else {
      body = new URLSearchParams(fields);
    }

    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        body,
        headers: { Accept: "application/json" },
        cache: "no-store",
      } as RequestInit);
    } catch (cause) {
      throw new ShopwaveAuthError("network_error", `Could not reach the Shopwave auth server`, { cause });
    }

    const text = await response.text();
    if (!response.ok) {
      throw new ShopwaveAuthError(
        errorCode,
        `Shopwave auth server returned ${response.status} for ${fields.grant_type}`,
        { status: response.status, body: text.slice(0, 2000) }
      );
    }

    try {
      return JSON.parse(text) as ShopwaveTokenResponse;
    } catch (cause) {
      throw new ShopwaveAuthError("token_response_invalid", "Token response was not JSON", {
        status: response.status,
        body: text.slice(0, 2000),
        cause,
      });
    }
  }

  return {
    config,

    buildLoginUrl({ state } = {}) {
      const params = commonParams(config.redirectUri);
      if (state) params.set("state", state);
      return `${base()}${endpoints.login}?${params.toString()}`;
    },

    buildLogoutUrl({ redirectUri } = {}) {
      const params = commonParams(redirectUri ?? config.postLogoutRedirectUri ?? config.redirectUri);
      return `${base()}${endpoints.logout}?${params.toString()}`;
    },

    async exchangeCode(code) {
      if (!code) {
        throw new ShopwaveAuthError("token_exchange_failed", "Missing authorization code");
      }
      const json = await postToken(
        {
          code,
          redirect_uri: config.redirectUri,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: config.scope ?? "application",
          grant_type: "authorization_code",
        },
        "token_exchange_failed"
      );
      const token = tokenFromResponse(json);
      if (!token) {
        throw new ShopwaveAuthError("token_response_invalid", "Token response had no access_token");
      }
      return token;
    },

    async refreshToken(tokenOrRefreshToken) {
      const previous =
        typeof tokenOrRefreshToken === "string"
          ? ({ accessToken: "", refreshToken: tokenOrRefreshToken, tokenType: "OAuth" } as ShopwaveToken)
          : tokenOrRefreshToken;

      if (!previous.refreshToken) {
        throw new ShopwaveAuthError("token_refresh_failed", "No refresh token available", { status: 400 });
      }

      const json = await postToken(
        {
          refresh_token: previous.refreshToken,
          redirect_uri: config.redirectUri,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
        },
        "token_refresh_failed"
      );
      const token = tokenFromResponse(json, previous);
      if (!token) {
        throw new ShopwaveAuthError("token_response_invalid", "Refresh response had no access_token");
      }
      return token;
    },
  };
}
