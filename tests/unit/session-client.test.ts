import { describe, it, expect, vi } from "vitest";
import { fetchSession, loginPath, logoutPath } from "../../src/core";

const asFetch = (fn: (...args: unknown[]) => Promise<Response>) => fn as unknown as typeof fetch;

describe("fetchSession", () => {
  it("reads the new { loggedIn } shape", async () => {
    const fetchMock = vi.fn(async () => Response.json({ loggedIn: true, expiresAt: 42 }));
    expect(await fetchSession({ fetch: asFetch(fetchMock) })).toEqual({ loggedIn: true, expiresAt: 42 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/session");
    expect(init.cache).toBe("no-store");
  });

  it("never surfaces tokens from a legacy route that returns the whole session", async () => {
    const result = await fetchSession({
      fetch: asFetch(async () => Response.json({ token: { access_token: "secret", refresh_token: "secret" } })),
    });
    expect(result).toEqual({ loggedIn: true });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("treats 401 as logged out and throws on other errors", async () => {
    expect(await fetchSession({ fetch: asFetch(async () => new Response(null, { status: 401 })) })).toEqual({
      loggedIn: false,
    });
    await expect(fetchSession({ fetch: asFetch(async () => new Response(null, { status: 500 })) })).rejects.toThrow(
      /500/
    );
  });
});

describe("login / logout paths", () => {
  it("builds encoded links", () => {
    expect(loginPath()).toBe("/auth");
    expect(loginPath("/products?tab=2")).toBe("/auth?returnTo=%2Fproducts%3Ftab%3D2");
    expect(loginPath("/x", "/tools/where-to-next/auth")).toBe("/tools/where-to-next/auth?returnTo=%2Fx");
    expect(logoutPath()).toBe("/auth/logout");
  });
});
