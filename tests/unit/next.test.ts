import { describe, it, expect, vi, beforeEach } from "vitest";
import { unsealData } from "iron-session";

// ---- In-memory cookie jar standing in for next/headers `cookies()` ----------
const jar = new Map<string, string>();
const lastCookieOptions: { maxAge?: number; secure?: boolean; httpOnly?: boolean; sameSite?: unknown }[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (nameOrOptions: string | { name: string; value: string; maxAge?: number }, value?: string, options?: { maxAge?: number }) => {
      const o =
        typeof nameOrOptions === "object"
          ? nameOrOptions
          : { name: nameOrOptions, value: value ?? "", ...(options ?? {}) };
      lastCookieOptions.push(o as never);
      if (o.value === "" || o.maxAge === 0) jar.delete(o.name);
      else jar.set(o.name, o.value);
    },
  }),
}));

import { createShopwaveAuth, type ShopwaveSessionData } from "../../src/next";

const PASSWORD = "a-very-long-session-password-for-tests-0123456789";
const COOKIE = "shopwave_session";
const APP = "https://app.example.com";

let fetchMock: ReturnType<typeof vi.fn>;

function makeAuth(overrides: Record<string, unknown> = {}) {
  return createShopwaveAuth({
    authServerUrl: "https://auth.example.com",
    clientId: "client-123",
    clientSecret: "s3cret",
    redirectUri: `${APP}/auth`,
    session: { password: PASSWORD },
    fetch: fetchMock as unknown as typeof fetch,
    ...overrides,
  });
}

function tokenResponse(access = "a1", refresh: string | undefined = "r1", expiresIn = 43200) {
  return new Response(
    JSON.stringify({ access_token: access, refresh_token: refresh, token_type: "OAuth", expires_in: expiresIn }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

async function sessionData(): Promise<ShopwaveSessionData> {
  const value = jar.get(COOKIE);
  if (!value) return {};
  return unsealData<ShopwaveSessionData>(value, { password: PASSWORD });
}

function requestWithCookie(url: string) {
  const value = jar.get(COOKIE);
  return new Request(url, { headers: value ? { cookie: `${COOKIE}=${value}` } : {} });
}

async function seedToken(token: Record<string, unknown>) {
  const auth = makeAuth();
  const session = await auth.getSession();
  session.token = token;
  await session.save();
}

beforeEach(() => {
  jar.clear();
  lastCookieOptions.length = 0;
  fetchMock = vi.fn();
});

describe("handlers.auth — starting a login", () => {
  it("stores a pending login and redirects to the auth server with state", async () => {
    const auth = makeAuth();
    const res = await auth.handlers.auth(new Request(`${APP}/auth?returnTo=%2Fproducts%3Ftab%3D2`));

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://auth.example.com/login");
    expect(location.searchParams.get("redirect_uri")).toBe(`${APP}/auth`);

    const data = await sessionData();
    expect(data.pendingLogin?.returnTo).toBe("/products?tab=2");
    expect(location.searchParams.get("state")).toBe(data.pendingLogin?.state);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never lets returnTo point off-site", async () => {
    const auth = makeAuth();
    await auth.handlers.auth(new Request(`${APP}/auth?returnTo=${encodeURIComponent("//evil.com")}`));
    expect((await sessionData()).pendingLogin?.returnTo).toBe("/");
  });
});

describe("handlers.auth — callback", () => {
  async function startLogin(returnTo = "/products") {
    const auth = makeAuth();
    const res = await auth.handlers.auth(new Request(`${APP}/auth?returnTo=${encodeURIComponent(returnTo)}`));
    return new URL(res.headers.get("location")!).searchParams.get("state")!;
  }

  it("exchanges the code, stores the token and returns to the original page", async () => {
    const state = await startLogin("/products");
    fetchMock.mockResolvedValueOnce(tokenResponse("a1", "r1"));

    const res = await makeAuth().handlers.auth(new Request(`${APP}/auth?code=CODE&state=${state}`));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP}/products`);
    const data = await sessionData();
    expect(data.pendingLogin).toBeUndefined();
    expect(data.token).toMatchObject({ accessToken: "a1", refreshToken: "r1", tokenType: "OAuth" });
    const body = new URLSearchParams(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.get("code")).toBe("CODE");
  });

  it("rejects a mismatched state without calling the auth server", async () => {
    await startLogin();
    const res = await makeAuth().handlers.auth(new Request(`${APP}/auth?code=CODE&state=forged`));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Try again");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await sessionData()).token).toBeUndefined();
  });

  it("rejects a callback that didn't start in this browser", async () => {
    const res = await makeAuth().handlers.auth(new Request(`${APP}/auth?code=CODE&state=abc`));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an expired pending login", async () => {
    const state = await startLogin();
    const session = await makeAuth().getSession();
    session.pendingLogin!.createdAt = Date.now() - 11 * 60 * 1000;
    await session.save();
    const res = await makeAuth().handlers.auth(new Request(`${APP}/auth?code=CODE&state=${state}`));
    expect(res.status).toBe(400);
  });

  it("with requireState=false, accepts a callback without state", async () => {
    await startLogin("/team");
    fetchMock.mockResolvedValueOnce(tokenResponse());
    const res = await makeAuth({ requireState: false }).handlers.auth(new Request(`${APP}/auth?code=CODE`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP}/team`);
  });

  it("shows an error page when the auth server rejects the code", async () => {
    const state = await startLogin();
    fetchMock.mockResolvedValueOnce(new Response('{"error":"invalid_grant"}', { status: 400 }));
    const res = await makeAuth().handlers.auth(new Request(`${APP}/auth?code=BAD&state=${state}`));
    expect(res.status).toBe(400);
    expect((await sessionData()).token).toBeUndefined();
  });

  it("shows an error page for ?error= from the auth server (escaped)", async () => {
    const res = await makeAuth().handlers.auth(
      new Request(`${APP}/auth?error=access_denied&error_description=${encodeURIComponent("<b>no</b>")}`)
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("&lt;b&gt;no&lt;/b&gt;");
    expect(html).not.toContain("<b>no</b>");
  });
});

describe("getAccessToken", () => {
  it("returns null when logged out", async () => {
    expect(await makeAuth().getAccessToken()).toBeNull();
  });

  it("returns a valid token without calling the auth server", async () => {
    await seedToken({ accessToken: "a1", refreshToken: "r1", tokenType: "OAuth", expiresAt: Date.now() + 60_000 });
    expect(await makeAuth().getAccessToken()).toBe("a1");
    expect(await makeAuth().getAuthorizationHeader()).toBe("OAuth a1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expired token once, even for concurrent callers, and saves it", async () => {
    await seedToken({ accessToken: "old", refreshToken: "r1", tokenType: "OAuth", expiresAt: Date.now() - 1 });
    fetchMock.mockImplementation(async () => tokenResponse("new", undefined));
    const auth = makeAuth();

    const [a, b] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);

    expect(a).toBe("new");
    expect(b).toBe("new");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const data = await sessionData();
    expect(data.token).toMatchObject({ accessToken: "new", refreshToken: "r1" });
  });

  it("forceRefresh refreshes even when the clock says the token is fine", async () => {
    await seedToken({ accessToken: "a1", refreshToken: "r1", tokenType: "OAuth", expiresAt: Date.now() + 60_000 });
    fetchMock.mockResolvedValueOnce(tokenResponse("a2"));
    expect(await makeAuth().getAccessToken({ forceRefresh: true })).toBe("a2");
  });

  it("logs the user out when the refresh token is rejected", async () => {
    await seedToken({ accessToken: "old", refreshToken: "dead", tokenType: "OAuth", expiresAt: Date.now() - 1 });
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    expect(await makeAuth().getAccessToken()).toBeNull();
    expect(jar.has(COOKIE)).toBe(false);
  });

  it("keeps the session when the auth server is temporarily down", async () => {
    await seedToken({ accessToken: "old", refreshToken: "r1", tokenType: "OAuth", expiresAt: Date.now() - 1 });
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 }));
    await expect(makeAuth().getAccessToken()).rejects.toMatchObject({ code: "token_refresh_failed", status: 503 });
    expect(jar.has(COOKIE)).toBe(true);
  });

  it("accepts the legacy session shape written by older apps", async () => {
    await seedToken({ access_token: "legacy", refresh_token: "r1", token_type: "OAuth", expires_in: 43200 });
    expect(await makeAuth().getAccessToken()).toBe("legacy");
    expect(await makeAuth().getStatus()).toEqual({ loggedIn: true, expiresAt: undefined });
  });
});

describe("session route", () => {
  it("GET returns login status and never the tokens", async () => {
    await seedToken({ accessToken: "secret-access", refreshToken: "secret-refresh", tokenType: "OAuth", expiresAt: 123 });
    const res = await makeAuth().handlers.session.GET();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ loggedIn: true, expiresAt: 123 });
    expect(text).not.toContain("secret");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("GET reports logged out without a session", async () => {
    const res = await makeAuth().handlers.session.GET();
    expect(await res.json()).toEqual({ loggedIn: false });
  });

  it("DELETE ends the session with a real 204", async () => {
    await seedToken({ accessToken: "a", tokenType: "OAuth" });
    const res = await makeAuth().handlers.session.DELETE();
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(jar.has(COOKIE)).toBe(false);
  });
});

describe("handlers.logout", () => {
  it("clears the session and redirects to the auth server logout", async () => {
    await seedToken({ accessToken: "a", tokenType: "OAuth" });
    const res = await makeAuth().handlers.logout(new Request(`${APP}/auth/logout`));
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/logout");
    expect(location.searchParams.get("redirect_uri")).toBe(`${APP}/auth`);
    expect(jar.has(COOKIE)).toBe(false);
  });
});

describe("protect (proxy guard)", () => {
  it("lets public paths and the auth routes through", async () => {
    const auth = makeAuth();
    expect(await auth.protect(new Request(`${APP}/auth?code=x`))).toBeUndefined();
    expect(await auth.protect(new Request(`${APP}/auth/logout`))).toBeUndefined();
    expect(await auth.protect(new Request(`${APP}/api/session`))).toBeUndefined();
    expect(
      await auth.protect(new Request(`${APP}/tools/tag-joiner/x`), { publicPaths: ["/tools/tag-joiner"] })
    ).toBeUndefined();
  });

  it("redirects pages to login with returnTo, and answers 401 for APIs", async () => {
    const auth = makeAuth();
    const page = await auth.protect(new Request(`${APP}/products?tab=2`));
    expect(page?.status).toBe(302);
    expect(page?.headers.get("location")).toBe(`${APP}/auth?returnTo=${encodeURIComponent("/products?tab=2")}`);

    const api = await auth.protect(new Request(`${APP}/api/products`));
    expect(api?.status).toBe(401);
  });

  it("'/' in publicPaths only matches the root", async () => {
    const auth = makeAuth();
    expect(await auth.protect(new Request(`${APP}/`), { publicPaths: ["/"] })).toBeUndefined();
    expect((await auth.protect(new Request(`${APP}/products`), { publicPaths: ["/"] }))?.status).toBe(302);
  });

  it("lets requests with a valid session cookie through (cookie-only check)", async () => {
    await seedToken({ accessToken: "a", refreshToken: "r", tokenType: "OAuth", expiresAt: Date.now() - 1 });
    const auth = makeAuth();
    expect(await auth.protect(requestWithCookie(`${APP}/products`))).toBeUndefined();
    expect(await auth.isAuthenticated(new Request(`${APP}/products`, { headers: { cookie: `${COOKIE}=garbage` } }))).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("withAuth", () => {
  it("returns 401 without a session and passes the auth context otherwise", async () => {
    const handler = vi.fn(async (_req: Request, _ctx: unknown, a: { authorization: string }) =>
      Response.json({ auth: a.authorization })
    );
    const wrapped = makeAuth().withAuth(handler);

    const denied = await wrapped(new Request(`${APP}/api/x`), {});
    expect(denied.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();

    await seedToken({ accessToken: "a1", refreshToken: "r1", tokenType: "OAuth", expiresAt: Date.now() + 60_000 });
    const ok = await wrapped(new Request(`${APP}/api/x`), {});
    expect(await ok.json()).toEqual({ auth: "OAuth a1" });
  });
});

describe("cookie attributes", () => {
  it("sets a finite Max-Age (iron-session default 14 days) and safe flags", async () => {
    await makeAuth().handlers.auth(new Request(`${APP}/auth`));
    const opts = lastCookieOptions.at(-1)!;
    expect(Number.isFinite(opts.maxAge)).toBe(true);
    expect(opts.maxAge).toBe(14 * 24 * 3600 - 60);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
  });

  it("honours a custom ttl", async () => {
    await makeAuth({ session: { password: PASSWORD, ttl: 3600 } }).handlers.auth(new Request(`${APP}/auth`));
    expect(lastCookieOptions.at(-1)!.maxAge).toBe(3600 - 60);
  });
});

describe("config validation", () => {
  it("is lazy (creating the instance never throws) and clear when used", async () => {
    const auth = makeAuth({ session: { password: "short" } });
    await expect(auth.handlers.auth(new Request(`${APP}/auth`))).rejects.toThrow(/at least 32 characters/);
  });

  it("loginPath sanitises returnTo", () => {
    const auth = makeAuth();
    expect(auth.loginPath()).toBe("/auth");
    expect(auth.loginPath("/x?y=1")).toBe("/auth?returnTo=%2Fx%3Fy%3D1");
    expect(auth.loginPath("https://evil.com")).toBe("/auth?returnTo=%2F");
    expect(auth.logoutPath).toBe("/auth/logout");
  });
});
