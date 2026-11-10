import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchProductTags,
  fetchProductInstanceTags,
  normalizeTagList,
  SHOPWAVE_LOOKUPS,
  type RequestOptions,
} from "../../src/core";
import { createShopwaveApiHandlers, type ShopwaveApiConfig } from "../../src/server";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const ok = { message: { success: { 203: { id: 203, title: "Request Processed Successfully" } } }, codeBaseVersion: 2 };

// ---------------------------------------------------------------------------
// Client half
// ---------------------------------------------------------------------------

type Call = { url: string; init: RequestInit };
let calls: Call[];
let responses: Response[];
const options: RequestOptions = {
  baseUrl: "http://app",
  token: "t0k",
  fetch: (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responses.shift() ?? json({});
  }) as unknown as typeof fetch,
};

beforeEach(() => {
  calls = [];
  responses = [];
});

describe("SHOPWAVE_LOOKUPS", () => {
  it("names the app routes and the Shopwave paths", () => {
    expect(SHOPWAVE_LOOKUPS.productTags).toEqual({ route: "products/tags", key: "tags", upstream: "product/tags" });
    expect(SHOPWAVE_LOOKUPS.productInstanceTags).toEqual({
      route: "products/instance-tags",
      key: "tags",
      upstream: "product/instance/tags",
    });
  });
});

describe("normalizeTagList", () => {
  it("trims, drops blanks and non-text, and removes exact duplicates in order", () => {
    expect(normalizeTagList([" Vegan", "Hot", "", "  ", null, {}, "Hot", "hot", 42])).toEqual(["Vegan", "Hot", "hot", "42"]);
  });

  it("accepts a map (values) and gives [] for anything else", () => {
    expect(normalizeTagList({ a: "Eat In", b: "Takeout" })).toEqual(["Eat In", "Takeout"]);
    expect(normalizeTagList(undefined)).toEqual([]);
    expect(normalizeTagList("Vegan")).toEqual([]);
  });
});

describe("fetchProductTags", () => {
  it("GETs /api/products/tags with the token and returns body.tags", async () => {
    responses = [json({ tags: ["Drinks", "Hot", "Vegan"], api: ok })];
    expect(await fetchProductTags(options)).toEqual(["Drinks", "Hot", "Vegan"]);
    expect(calls[0].url).toBe("http://app/api/products/tags");
    expect(calls[0].init.method).toBe("GET");
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe("OAuth t0k");
  });

  it("returns [] for an empty body", async () => {
    responses = [new Response(null, { status: 200 })];
    expect(await fetchProductTags(options)).toEqual([]);
  });

  it("throws ShopwaveApiError on an error status or api errors", async () => {
    responses = [json({ error: "unauthorized" }, 401)];
    await expect(fetchProductTags(options)).rejects.toMatchObject({ status: 401, isUnauthorized: true });
    responses = [json({ api: { message: { errors: { 899: { id: 899, title: "Database errors" } } } } })];
    await expect(fetchProductTags(options)).rejects.toMatchObject({ name: "ShopwaveApiError" });
  });
});

describe("fetchProductInstanceTags", () => {
  it("GETs /api/products/instance-tags and returns body.tags", async () => {
    responses = [json({ tags: ["Eat In", "Takeout"], api: ok })];
    expect(await fetchProductInstanceTags(options)).toEqual(["Eat In", "Takeout"]);
    expect(calls[0].url).toBe("http://app/api/products/instance-tags");
  });
});

// ---------------------------------------------------------------------------
// Server half
// ---------------------------------------------------------------------------

type Upstream = { url: string; method: string; headers: Headers };
let upstream: Upstream[];
let replies: Response[];
let getAuthorization: ReturnType<typeof vi.fn>;

function api() {
  return createShopwaveApiHandlers({
    apiUrl: "https://api.example.com",
    getAuthorization: getAuthorization as unknown as ShopwaveApiConfig["getAuthorization"],
    fetch: (async (url: string, init: RequestInit) => {
      upstream.push({ url, method: String(init.method ?? "GET"), headers: new Headers(init.headers) });
      return replies.shift() ?? json({ api: { message: {} } });
    }) as unknown as typeof fetch,
    onError: () => {},
  });
}

beforeEach(() => {
  upstream = [];
  replies = [];
  getAuthorization = vi.fn(async (o?: { forceRefresh?: boolean }) => (o?.forceRefresh ? "OAuth fresh" : "OAuth session"));
});

describe("lookup()", () => {
  it("productTags: GET /product/tags with the session token, body passed through", async () => {
    replies = [json({ tags: ["Vegan"], api: ok })];
    const res = await api().lookup("productTags").GET(new Request("https://app.example.com/api/products/tags"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tags: ["Vegan"], api: ok });
    expect(upstream).toHaveLength(1);
    expect(upstream[0].url).toBe("https://api.example.com/product/tags");
    expect(upstream[0].method).toBe("GET");
    expect(upstream[0].headers.get("authorization")).toBe("OAuth session");
    expect(upstream[0].headers.get("x-accept-version")).toBe("2.0");
  });

  it("productInstanceTags: GET /product/instance/tags", async () => {
    await api().lookup("productInstanceTags").GET(new Request("https://app.example.com/api/products/instance-tags"));
    expect(upstream[0].url).toBe("https://api.example.com/product/instance/tags");
  });

  it("doesn't forward the caller's extras", async () => {
    const req = new Request("https://app.example.com/api/products/tags", {
      headers: { extras: JSON.stringify({ productIds: "1,2", deleted: true }) },
    });
    await api().lookup("productTags").GET(req);
    expect(upstream[0].headers.get("productIds")).toBeNull();
    expect(upstream[0].headers.get("deleted")).toBeNull();
  });

  it("passes an upstream failure through with its status", async () => {
    replies = [json({ api: { message: { errors: { 899: { id: 899 } } } } }, 500)];
    const res = await api().lookup("productTags").GET(new Request("https://app.example.com/api/products/tags"));
    expect(res.status).toBe(500);
  });

  it("refreshes the token once on 401 and retries", async () => {
    replies = [json({}, 401), json({ tags: ["Hot"], api: ok })];
    const res = await api().lookup("productTags").GET(new Request("https://app.example.com/api/products/tags"));
    expect(res.status).toBe(200);
    expect(upstream).toHaveLength(2);
    expect(upstream[1].headers.get("authorization")).toBe("OAuth fresh");
  });

  it("throws for an unknown lookup", () => {
    expect(() => api().lookup("nope" as never)).toThrow(/Unknown Shopwave lookup/);
  });
});
