import { describe, it, expect, vi } from "vitest";
import {
  createShopwaveOAuth,
  tokenFromResponse,
  normalizeStoredToken,
  isTokenExpired,
  isExpiredTokenResponse,
  authorizationHeader,
  sanitizeReturnTo,
  createState,
  safeEqual,
  ShopwaveAuthError,
} from "../../src/server";

const baseConfig = {
  authServerUrl: "https://auth.example.com/",
  clientId: "client-123",
  clientSecret: "s3cret",
  redirectUri: "https://app.example.com/auth",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createShopwaveOAuth — URLs", () => {
  it("builds an encoded login URL with state", () => {
    const oauth = createShopwaveOAuth(baseConfig);
    const url = new URL(oauth.buildLoginUrl({ state: "abc" }));
    expect(url.origin + url.pathname).toBe("https://auth.example.com/login");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      access_type: "online",
      redirect_uri: "https://app.example.com/auth",
      response_type: "code",
      client_id: "client-123",
      scope: "application",
      state: "abc",
    });
  });

  it("encodes redirect URIs that contain query strings", () => {
    const oauth = createShopwaveOAuth({ ...baseConfig, redirectUri: "https://app.example.com/auth?x=1&y=2" });
    const url = new URL(oauth.buildLoginUrl());
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/auth?x=1&y=2");
    expect(url.searchParams.has("state")).toBe(false);
  });

  it("builds the logout URL with the post-logout redirect", () => {
    const oauth = createShopwaveOAuth({ ...baseConfig, postLogoutRedirectUri: "https://app.example.com/" });
    const url = new URL(oauth.buildLogoutUrl());
    expect(url.pathname).toBe("/logout");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/");
  });

  it("fails lazily with a readable error when config is missing", () => {
    const oauth = createShopwaveOAuth({ ...baseConfig, clientSecret: "" });
    expect(() => oauth.buildLoginUrl()).toThrowError(/clientSecret/);
  });
});

describe("createShopwaveOAuth — token endpoint", () => {
  it("exchanges a code (urlencoded) and normalises the token", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ refresh_token: "r1", token_type: "OAuth", expires_in: 43200, access_token: "a1" })
    );
    const oauth = createShopwaveOAuth({ ...baseConfig, fetch: fetchMock as unknown as typeof fetch });
    const before = Date.now();
    const token = await oauth.exchangeCode("the-code");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://auth.example.com/oauth/token");
    expect(init.method).toBe("POST");
    const body = Object.fromEntries(new URLSearchParams(String(init.body)));
    expect(body).toEqual({
      code: "the-code",
      redirect_uri: "https://app.example.com/auth",
      client_id: "client-123",
      client_secret: "s3cret",
      scope: "application",
      grant_type: "authorization_code",
    });

    expect(token.accessToken).toBe("a1");
    expect(token.refreshToken).toBe("r1");
    expect(token.tokenType).toBe("OAuth");
    expect(token.expiresAt).toBeGreaterThanOrEqual(before + 43200 * 1000);
    expect(token.expiresAt).toBeLessThanOrEqual(Date.now() + 43200 * 1000);
  });

  it("can send multipart FormData instead", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: "a1", expires_in: 10 }));
    const oauth = createShopwaveOAuth({
      ...baseConfig,
      tokenRequestFormat: "multipart",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await oauth.exchangeCode("c");
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("grant_type")).toBe("authorization_code");
  });

  it("keeps the existing refresh token when the refresh response omits it", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: "a2", expires_in: 43200, token_type: "OAuth" }));
    const oauth = createShopwaveOAuth({ ...baseConfig, fetch: fetchMock as unknown as typeof fetch });
    const token = await oauth.refreshToken({ accessToken: "a1", refreshToken: "r1", tokenType: "OAuth" });
    const body = Object.fromEntries(
      new URLSearchParams(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    );
    expect(body.grant_type).toBe("refresh_token");
    expect(body.refresh_token).toBe("r1");
    expect(body.client_secret).toBe("s3cret");
    expect(token).toMatchObject({ accessToken: "a2", refreshToken: "r1" });
  });

  it("marks 4xx refresh failures as invalid grants", async () => {
    const oauth = createShopwaveOAuth({
      ...baseConfig,
      fetch: (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as unknown as typeof fetch,
    });
    const error = await oauth.refreshToken("bad").catch((e) => e);
    expect(error).toBeInstanceOf(ShopwaveAuthError);
    expect(error.code).toBe("token_refresh_failed");
    expect(error.status).toBe(400);
    expect(error.isInvalidGrant).toBe(true);
  });

  it("does not treat 5xx / network errors as invalid grants", async () => {
    const oauth5xx = createShopwaveOAuth({
      ...baseConfig,
      fetch: (async () => new Response("oops", { status: 503 })) as unknown as typeof fetch,
    });
    const e1 = await oauth5xx.exchangeCode("c").catch((e) => e);
    expect(e1.isInvalidGrant).toBe(false);

    const oauthNet = createShopwaveOAuth({
      ...baseConfig,
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    const e2 = await oauthNet.exchangeCode("c").catch((e) => e);
    expect(e2.code).toBe("network_error");
    expect(e2.isInvalidGrant).toBe(false);
  });

  it("rejects a 200 without access_token", async () => {
    const oauth = createShopwaveOAuth({
      ...baseConfig,
      fetch: (async () => jsonResponse({ nope: true })) as unknown as typeof fetch,
    });
    await expect(oauth.exchangeCode("c")).rejects.toMatchObject({ code: "token_response_invalid" });
  });
});

describe("token helpers", () => {
  it("tokenFromResponse returns null without access_token", () => {
    expect(tokenFromResponse({})).toBeNull();
  });

  it("normalises the legacy snake_case session token", () => {
    expect(
      normalizeStoredToken({ access_token: "a", refresh_token: "r", token_type: "OAuth", expires_in: 43200 })
    ).toEqual({ accessToken: "a", refreshToken: "r", tokenType: "OAuth" });
    expect(normalizeStoredToken({ accessToken: "a", tokenType: "OAuth", expiresAt: 5 })).toMatchObject({
      accessToken: "a",
      expiresAt: 5,
    });
    expect(normalizeStoredToken(undefined)).toBeNull();
    expect(normalizeStoredToken({ foo: 1 })).toBeNull();
  });

  it("isTokenExpired respects expiry, skew and unknown expiry", () => {
    const now = 1_000_000;
    expect(isTokenExpired({ accessToken: "a", tokenType: "OAuth", expiresAt: now + 1000 }, { now })).toBe(false);
    expect(isTokenExpired({ accessToken: "a", tokenType: "OAuth", expiresAt: now }, { now })).toBe(true);
    expect(
      isTokenExpired({ accessToken: "a", tokenType: "OAuth", expiresAt: now + 30_000 }, { now, skewSeconds: 60 })
    ).toBe(true);
    expect(isTokenExpired({ accessToken: "a", tokenType: "OAuth" }, { now })).toBe(false);
  });

  it("detects expired-token API responses (401 or error 908)", () => {
    expect(isExpiredTokenResponse(401)).toBe(true);
    expect(isExpiredTokenResponse(200, { api: { message: { errors: { "908": { id: 908 } } } } })).toBe(true);
    expect(isExpiredTokenResponse(200, { api: { message: { errors: { "0": { id: 908 } } } } })).toBe(true);
    expect(isExpiredTokenResponse(200, { api: { message: { errors: { "12": { id: 12 } } } } })).toBe(false);
    expect(isExpiredTokenResponse(500, null)).toBe(false);
  });

  it("builds the Authorization header with the token type", () => {
    expect(authorizationHeader({ accessToken: "abc", tokenType: "OAuth" })).toBe("OAuth abc");
  });
});

describe("returnTo / state", () => {
  it.each([
    ["/products", "/products"],
    ["/products?tab=1#x", "/products?tab=1#x"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["https://evil.com", "/"],
    ["javascript:alert(1)", "/"],
    ["/ok\r\nSet-Cookie: x", "/"],
    ["", "/"],
    [undefined, "/"],
  ])("sanitizeReturnTo(%j) → %j", (input, expected) => {
    expect(sanitizeReturnTo(input)).toBe(expected);
  });

  it("creates unique 32-char hex states and compares them safely", () => {
    const a = createState();
    const b = createState();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(safeEqual(a, a)).toBe(true);
    expect(safeEqual(a, b)).toBe(false);
    expect(safeEqual(a, a.slice(1))).toBe(false);
  });
});
