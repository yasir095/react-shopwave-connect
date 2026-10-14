import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createShopwaveApiHandlers,
  normalizeWriteBody,
  parseExtras,
  readRequestToken,
  type ShopwaveApiConfig,
} from "../../src/server";

type Upstream = { url: string; method: string; headers: Headers; body: string | null };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let upstream: Upstream[];
let replies: Array<Response | Error>;
let getAuthorization: ReturnType<typeof vi.fn>;

const fetchMock = (async (url: string, init: RequestInit) => {
  upstream.push({
    url,
    method: String(init.method),
    headers: new Headers(init.headers),
    body: init.body == null ? null : String(init.body),
  });
  const next = replies.shift() ?? json({ api: { message: {} } });
  if (next instanceof Error) throw next;
  return next;
}) as unknown as typeof fetch;

function api(overrides: Partial<ShopwaveApiConfig> = {}) {
  return createShopwaveApiHandlers({
    apiUrl: "https://api.example.com/",
    getAuthorization: getAuthorization as unknown as ShopwaveApiConfig["getAuthorization"],
    fetch: fetchMock,
    onError: () => {},
    ...overrides,
  });
}

function req(path: string, init: RequestInit & { extras?: unknown } = {}) {
  const headers = new Headers(init.headers);
  if (init.extras !== undefined) headers.set("extras", typeof init.extras === "string" ? init.extras : JSON.stringify(init.extras));
  return new Request(`https://app.example.com${path}`, { ...init, headers });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const postBodyOf = (u: Upstream) => JSON.parse(new URLSearchParams(u.body!).get("postBody")!);

beforeEach(() => {
  upstream = [];
  replies = [];
  getAuthorization = vi.fn(async (o?: { forceRefresh?: boolean }) => (o?.forceRefresh ? "OAuth fresh" : "OAuth session"));
});

describe("collection GET", () => {
  it("forwards extras as headers with the session token and x-accept-version", async () => {
    replies = [json({ products: { 1: { id: 1 } }, api: {} })];
    const res = await api().collection("product").GET(
      req("/api/products", { extras: { "Content-Type": "application/json", deleted: false, productIds: [1, 2] } })
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ products: { 1: { id: 1 } }, api: {} });
    const u = upstream[0];
    expect(u.url).toBe("https://api.example.com/product");
    expect(u.method).toBe("GET");
    expect(u.headers.get("authorization")).toBe("OAuth session");
    expect(u.headers.get("x-accept-version")).toBe("2.0");
    expect(u.headers.get("deleted")).toBe("false");
    expect(u.headers.get("productIds")).toBe("1,2");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("never forwards auth/transport headers from extras", async () => {
    await api().collection("product").GET(
      req("/api/products", {
        extras: {
          Authorization: "OAuth evil",
          Cookie: "a=b",
          "X-Forwarded-For": "1.1.1.1",
          "x-accept-version": "9",
          "bad header": "x",
          "Content-Type": "application/json",
          storeId: 3,
        },
      })
    );
    const h = upstream[0].headers;
    expect(h.get("authorization")).toBe("OAuth session");
    expect(h.get("cookie")).toBeNull();
    expect(h.get("x-forwarded-for")).toBeNull();
    expect(h.get("x-accept-version")).toBe("2.0");
    expect(h.get("content-type")).toBe("application/json"); // kept on reads, as before
    expect(h.get("storeId")).toBe("3");
  });

  it("does not let extras.Authorization in: with request tokens off, the session is used", async () => {
    await api({ allowRequestToken: false }).collection("product").GET(
      req("/api/products", { extras: { Authorization: "OAuth evil", token: "evil" } })
    );
    expect(upstream[0].headers.get("authorization")).toBe("OAuth session");
  });

  it("answers 400 for an extras header that isn't a JSON object", async () => {
    const res = await api().collection("product").GET(req("/api/products", { extras: "{not json" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_extras");
    expect(upstream).toHaveLength(0);
  });

  it("answers 401 when there is no session and no token", async () => {
    getAuthorization.mockResolvedValue(null);
    const res = await api().collection("product").GET(req("/api/products"));
    expect(res.status).toBe(401);
    expect(upstream).toHaveLength(0);
  });

  it("passes upstream errors through with their status", async () => {
    replies = [json({ api: { message: { errors: { 400: { id: 400 } } } } }, 400)];
    const res = await api().collection("product").GET(req("/api/products"));
    expect(res.status).toBe(400);
    expect((await res.json()).api.message.errors[400]).toBeDefined();
  });

  it("answers 502 (without leaking the token) when the API can't be reached", async () => {
    const onError = vi.fn();
    replies = [new TypeError("connect ECONNREFUSED")];
    const res = await api({ onError }).collection("product").GET(req("/api/products"));
    expect(res.status).toBe(502);
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError), { method: "GET", path: "product" });
    expect(JSON.stringify(await res.json())).not.toContain("session");
  });
});

describe("tokens", () => {
  it("uses Authorization: OAuth <token> from the caller (what the SDK sends)", async () => {
    await api().collection("category").GET(req("/api/categories", { headers: { Authorization: "OAuth caller" } }));
    expect(upstream[0].headers.get("authorization")).toBe("OAuth caller");
    expect(getAuthorization).not.toHaveBeenCalled();
  });

  it("accepts Bearer, the legacy token header and legacy extras.token", () => {
    expect(readRequestToken(req("/", { headers: { Authorization: "Bearer b1" } }))).toBe("b1");
    expect(readRequestToken(req("/", { headers: { token: "t1" } }))).toBe("t1");
    expect(readRequestToken(req("/", { extras: { token: "e1" } }))).toBe("e1");
    expect(readRequestToken(req("/", { headers: { Authorization: "Basic abc" } }))).toBeNull();
    expect(readRequestToken(req("/"))).toBeNull();
  });

  it("ignores caller tokens when allowRequestToken is false", async () => {
    await api({ allowRequestToken: false }).collection("category").GET(
      req("/api/categories", { headers: { Authorization: "OAuth caller" } })
    );
    expect(upstream[0].headers.get("authorization")).toBe("OAuth session");
  });
});

describe("refresh and retry once", () => {
  it("on 401 with the session token: refreshes and retries once", async () => {
    replies = [json({}, 401), json({ categories: {} })];
    const res = await api().collection("category").GET(req("/api/categories", { extras: { deleted: false } }));
    expect(res.status).toBe(200);
    expect(upstream.map((u) => u.headers.get("authorization"))).toEqual(["OAuth session", "OAuth fresh"]);
    expect(upstream[1].headers.get("deleted")).toBe("false");
    expect(getAuthorization).toHaveBeenLastCalledWith({ forceRefresh: true });
  });

  it("on API error 908 (HTTP 200): refreshes and retries once", async () => {
    replies = [json({ api: { message: { errors: { 908: { id: 908 } } } } }), json({ categories: {} })];
    const res = await api().collection("category").GET(req("/api/categories"));
    expect(res.status).toBe(200);
    expect(upstream).toHaveLength(2);
  });

  it("retries only once", async () => {
    replies = [json({}, 401), json({}, 401)];
    const res = await api().collection("category").GET(req("/api/categories"));
    expect(res.status).toBe(401);
    expect(upstream).toHaveLength(2);
  });

  it("re-sends the same form body on retry", async () => {
    replies = [json({}, 401), json({ categories: { 0: { id: 1 } } }, 201)];
    const res = await api().collection("category").POST(req("/api/categories", { method: "POST", body: JSON.stringify({ title: "A" }) }));
    expect(res.status).toBe(201);
    expect(postBodyOf(upstream[1])).toEqual({ categories: { 0: { title: "A" } } });
  });

  it("answers 401 when the refresh gives nothing (refresh token rejected)", async () => {
    getAuthorization.mockImplementation(async (o?: { forceRefresh?: boolean }) => (o?.forceRefresh ? null : "OAuth session"));
    replies = [json({}, 401)];
    const res = await api().collection("category").GET(req("/api/categories"));
    expect(res.status).toBe(401);
    expect(upstream).toHaveLength(1);
  });

  it("does not refresh for a caller-supplied token", async () => {
    replies = [json({}, 401)];
    const res = await api().collection("category").GET(req("/api/categories", { headers: { Authorization: "OAuth caller" } }));
    expect(res.status).toBe(401);
    expect(upstream).toHaveLength(1);
    expect(getAuthorization).not.toHaveBeenCalled();
  });
});

describe("collection POST/PUT (save)", () => {
  it("sends the SDK envelope as the form field postBody and passes 201 + the echo back", async () => {
    const echo = { categories: { 0: { id: 9, title: "A" } }, api: { message: { success: {} } } };
    replies = [json(echo, 201)];
    const res = await api().collection("category").POST(
      req("/api/categories", { method: "POST", body: JSON.stringify({ categories: { 0: { title: "A" } } }) })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(echo);

    const u = upstream[0];
    expect(u.method).toBe("POST");
    expect(u.url).toBe("https://api.example.com/category");
    expect(u.headers.get("content-type")).toContain("application/x-www-form-urlencoded");
    expect(postBodyOf(u)).toEqual({ categories: { 0: { title: "A" } } });
  });

  it("a JSON Content-Type in extras never replaces the form content type", async () => {
    replies = [json({}, 201)];
    await api().collection("category").POST(
      req("/api/categories", { method: "POST", body: JSON.stringify({ title: "A" }), extras: { "Content-Type": "application/json" } })
    );
    expect(upstream[0].headers.get("content-type")).toBe("application/x-www-form-urlencoded;charset=UTF-8");
  });

  it("PUT behaves like POST", async () => {
    replies = [json({}, 201)];
    await api().collection("store").PUT(req("/api/stores", { method: "PUT", body: JSON.stringify({ id: 4, city: "X" }) }));
    expect(upstream[0].method).toBe("POST");
    expect(postBodyOf(upstream[0])).toEqual({ stores: { 0: { id: 4, city: "X" } } });
  });

  it("answers 400 for a body that isn't JSON", async () => {
    const res = await api().collection("category").POST(req("/api/categories", { method: "POST", body: "nope" }));
    expect(res.status).toBe(400);
    expect(upstream).toHaveLength(0);
  });
});

describe("normalizeWriteBody", () => {
  const def = { collection: "categories" };
  it("keeps refs", () => {
    expect(normalizeWriteBody(def, { categories: { a: { t: 1 }, b: { t: 2 } } })).toEqual({ categories: { a: { t: 1 }, b: { t: 2 } } });
  });
  it("maps the old { new } / { updated } shapes to ref 0", () => {
    expect(normalizeWriteBody(def, { categories: { new: { t: 1 } } })).toEqual({ categories: { 0: { t: 1 } } });
    expect(normalizeWriteBody(def, { categories: { updated: { t: 1 } } })).toEqual({ categories: { 0: { t: 1 } } });
  });
  it("wraps a bare entity", () => {
    expect(normalizeWriteBody(def, { t: 1 })).toEqual({ categories: { 0: { t: 1 } } });
  });
  it("forces the URL id (numeric when it is a number)", () => {
    expect(normalizeWriteBody(def, { categories: { updated: { id: 1, t: 1 } } }, "42")).toEqual({ categories: { 0: { id: 42, t: 1 } } });
  });
  it("rejects bad shapes", () => {
    expect(() => normalizeWriteBody(def, [])).toThrow();
    expect(() => normalizeWriteBody(def, { categories: [] })).toThrow();
    expect(() => normalizeWriteBody(def, { categories: {} })).toThrow();
    expect(() => normalizeWriteBody(def, { categories: { 0: "x" } })).toThrow();
    expect(() => normalizeWriteBody(def, { categories: { 0: {}, 1: {} } }, "5")).toThrow("Only one");
  });
});

describe("item routes", () => {
  it("GET reads one record through the ids header", async () => {
    replies = [json({ stores: { 7: { id: 7 } } })];
    const res = await api().item("store").GET(req("/api/stores/7", { extras: { deleted: true, storeIds: 999 } }), ctx("7"));
    expect(res.status).toBe(200);
    expect(upstream[0].url).toBe("https://api.example.com/store");
    expect(upstream[0].headers.get("storeIds")).toBe("7"); // URL id wins over extras
    expect(upstream[0].headers.get("deleted")).toBe("true");
  });

  it("PUT updates the record at the URL id", async () => {
    replies = [json({ products: { 0: { id: 12 } } }, 201)];
    const res = await api().item("product").PUT(
      req("/api/products/12", { method: "PUT", body: JSON.stringify({ products: { 0: { id: 99, name: "N" } } }) }),
      ctx("12")
    );
    expect(res.status).toBe(201);
    expect(postBodyOf(upstream[0])).toEqual({ products: { 0: { id: 12, name: "N" } } });
  });

  it("DELETE sends <entity>Id and passes 205 with an empty body through", async () => {
    replies = [new Response(null, { status: 205 })];
    const res = await api().item("store").DELETE(req("/api/stores/5", { method: "DELETE", extras: { storeId: 1 } }), ctx("5"));
    expect(res.status).toBe(205);
    expect(await res.text()).toBe("");
    expect(upstream[0].method).toBe("DELETE");
    expect(upstream[0].url).toBe("https://api.example.com/store");
    expect(upstream[0].headers.get("storeId")).toBe("5");
    expect(upstream[0].body).toBeNull();
  });

  it("employees: DELETE retires the record by POSTing exitDate (the API has no employee DELETE)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T16:05:09.123Z"));
    try {
      replies = [json({ employees: { 0: { id: 5, exitDate: "2026-09-28 16:05:09" } } }, 201)];
      const res = await api().item("employee").DELETE(req("/api/employees/5", { method: "DELETE" }), ctx("5"));
      expect(res.status).toBe(201);
      expect(upstream[0].method).toBe("POST");
      expect(upstream[0].url).toBe("https://api.example.com/employee");
      expect(postBodyOf(upstream[0])).toEqual({ employees: { 0: { id: 5, exitDate: "2026-09-28 16:05:09" } } });
    } finally {
      vi.useRealTimers();
    }
  });

  describe("promotions: DELETE expires the promotion (never deleted; the API rejects a partial save)", () => {
    // As the live API returns it (14 Oct 2026): dates as ISO with Z.
    const promotion = (startDate: string, endDate: string) => ({
      id: 8,
      merchantId: 5644,
      storeIds: [6341],
      categoryIds: { "16320": 2 },
      productIds: {},
      title: "Lunch deal",
      details: null,
      terms: null,
      startDate,
      endDate,
      daysAvailable: [0, 1, 2, 3, 4, 5, 6],
      automatic: 0,
      rule: "&=^/",
      x: 1000,
      y: null,
    });
    const expire = () => api().item("promotion").DELETE(req("/api/promotions/8", { method: "DELETE", extras: { promotionIds: 99 } }), ctx("8"));

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-14T16:29:37.456Z"));
    });
    afterEach(() => vi.useRealTimers());

    it("a started promotion: reads it, then saves the whole record back with endDate = now and the start kept", async () => {
      replies = [
        json({ promotions: { 8: promotion("2026-10-14T15:00:00.000Z", "2026-10-31T23:59:00.000Z") } }),
        json({ promotions: { 0: { id: 8 } } }, 201),
      ];
      const res = await expire();
      expect(res.status).toBe(201);
      expect(upstream).toHaveLength(2);
      expect(upstream[0].method).toBe("GET");
      expect(upstream[0].url).toBe("https://api.example.com/promotion");
      expect(upstream[0].headers.get("promotionIds")).toBe("8");
      expect(upstream[1].method).toBe("POST");
      expect(upstream[1].url).toBe("https://api.example.com/promotion");
      expect(postBodyOf(upstream[1])).toEqual({
        promotions: { 0: { ...promotion("2026-10-14 15:00:00", "2026-10-14 16:29:37") } },
      });
    });

    it("a promotion that hasn't started: start and end both become now", async () => {
      replies = [
        json({ promotions: { 8: promotion("2026-10-21T09:00:00.000Z", "2026-10-21T17:00:00.000Z") } }),
        json({ promotions: { 0: { id: 8 } } }, 201),
      ];
      await expire();
      const saved = postBodyOf(upstream[1]).promotions[0];
      expect(saved.startDate).toBe("2026-10-14 16:29:37");
      expect(saved.endDate).toBe("2026-10-14 16:29:37");
    });

    it("reads a zoneless start as UTC", async () => {
      replies = [
        json({ promotions: { 0: promotion("2026-10-14 16:30:00", "2026-10-20 00:00:00") } }),
        json({ promotions: { 0: { id: 8 } } }, 201),
      ];
      await expire();
      // 16:30 UTC is after now (16:29:37 UTC), so it hasn't started: start moves to now.
      expect(postBodyOf(upstream[1]).promotions[0].startDate).toBe("2026-10-14 16:29:37");
    });

    it("no such promotion: 404 and nothing is saved", async () => {
      replies = [json({ promotions: {}, api: { message: {} } })];
      const res = await expire();
      expect(res.status).toBe(404);
      expect(upstream).toHaveLength(1);
    });

    it("a failed read is passed through and nothing is saved", async () => {
      replies = [json({ api: { message: { errors: { 899: { id: 899 } } } } }, 500)];
      const res = await expire();
      expect(res.status).toBe(500);
      expect(upstream).toHaveLength(1);
    });

    it("the save's failure is passed through", async () => {
      replies = [
        json({ promotions: { 8: promotion("2026-10-14T15:00:00.000Z", "2026-10-31T23:59:00.000Z") } }),
        json({ api: { message: { errors: { 899: { id: 899 } } } } }, 500),
      ];
      expect((await expire()).status).toBe(500);
    });
  });

  it("consumers are read-only: writes and deletes answer 405 without calling the API", async () => {
    const consumer = api();
    const del = await consumer.item("consumer").DELETE(req("/api/consumer/3", { method: "DELETE" }), ctx("3"));
    const post = await consumer.collection("consumer").POST(req("/api/consumer", { method: "POST", body: JSON.stringify({ firstName: "A" }) }));
    const put = await consumer.item("consumer").PUT(req("/api/consumer/3", { method: "PUT", body: "{}" }), ctx("3"));
    expect([del.status, post.status, put.status]).toEqual([405, 405, 405]);
    expect((await post.json()).error).toBe("method_not_allowed");
    expect(upstream).toHaveLength(0);
  });

  it("consumer reads use the ids header", async () => {
    replies = [json({ consumers: {} })];
    await api().item("consumer").GET(req("/api/consumer/3"), ctx("3"));
    expect(upstream[0].url).toBe("https://api.example.com/consumer");
    expect(upstream[0].headers.get("ids")).toBe("3");
  });

  it("answers 400 for a missing or odd id", async () => {
    const handlers = api().item("category");
    expect((await handlers.DELETE(req("/api/categories/x", { method: "DELETE" }), ctx("1;drop"))).status).toBe(400);
    expect((await handlers.GET(req("/api/categories/"), { params: Promise.resolve({}) })).status).toBe(400);
    expect((await handlers.GET(req("/api/categories/"))).status).toBe(400);
    expect(upstream).toHaveLength(0);
  });

  it("accepts plain (non-promise) params and a custom param name", async () => {
    replies = [json({})];
    await api().item("category", { param: "categoryId" }).GET(req("/api/c/4"), { params: { categoryId: "4" } });
    expect(upstream[0].headers.get("categoryIds")).toBe("4");
  });
});

describe("passthrough, forward and config", () => {
  it("passthrough proxies a Shopwave path", async () => {
    replies = [json({ reports: {} })];
    const res = await api().passthrough("report").GET(req("/api/report", { extras: { query: '{"a":1}' } }));
    expect(res.status).toBe(200);
    expect(upstream[0].url).toBe("https://api.example.com/report");
    expect(upstream[0].headers.get("query")).toBe('{"a":1}');
  });

  it("forward can POST a custom postBody (e.g. merchant)", async () => {
    replies = [json({ merchant: { id: 1 } })];
    await api().forward(req("/api/merchant", { method: "PUT" }), { method: "POST", path: "/merchant", postBody: { merchant: { id: 1 } } });
    expect(upstream[0].url).toBe("https://api.example.com/merchant");
    expect(postBodyOf(upstream[0])).toEqual({ merchant: { id: 1 } });
  });

  it("entity overrides change the addressing", async () => {
    replies = [new Response(null, { status: 205 })];
    const handlers = api({ entities: { employee: { idHeader: "userId", deleteMode: "delete" } } });
    expect(handlers.entity("employee").idHeader).toBe("userId");
    await handlers.item("employee").DELETE(req("/api/employees/1", { method: "DELETE" }), ctx("1"));
    expect(upstream[0].method).toBe("DELETE");
    expect(upstream[0].headers.get("userId")).toBe("1");
  });

  it("blockedExtras drops extra keys", async () => {
    await api({ blockedExtras: ["StoreId"] }).collection("product").GET(req("/api/products", { extras: { storeId: 1, deleted: false } }));
    expect(upstream[0].headers.get("storeId")).toBeNull();
    expect(upstream[0].headers.get("deleted")).toBe("false");
  });

  it("uses a custom x-accept-version", async () => {
    await api({ apiVersion: "3.0" }).collection("product").GET(req("/api/products"));
    expect(upstream[0].headers.get("x-accept-version")).toBe("3.0");
  });
});

describe("parseExtras", () => {
  it("stringifies arrays and objects, drops null and header-splitting values", () => {
    expect(parseExtras(JSON.stringify({ a: [1, 2], b: { c: 1 }, d: null, e: "x\r\nInjected: 1", f: true }))).toEqual({
      a: "1,2",
      b: '{"c":1}',
      f: "true",
    });
  });
  it("returns {} for no header and null for non-objects", () => {
    expect(parseExtras(null)).toEqual({});
    expect(parseExtras("[1]")).toBeNull();
    expect(parseExtras("5")).toBeNull();
  });
});
