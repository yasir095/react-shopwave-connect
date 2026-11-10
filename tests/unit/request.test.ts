import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  apiDelete,
  apiGet,
  apiSend,
  authorizationFor,
  fetchProducts,
  fetchStores,
  fetchEmployees,
  submitEntity,
  deleteEntity,
  ShopwaveApiError,
  type RequestOptions,
} from "../../src/core";

type Call = { url: string; init: RequestInit };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let calls: Call[];
let responses: Array<Response | Error>;
let fetchMock: typeof fetch;

function headersOf(call: Call): Record<string, string> {
  return Object.fromEntries(new Headers(call.init.headers).entries());
}

beforeEach(() => {
  calls = [];
  responses = [];
  fetchMock = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift() ?? json({ api: { message: { success: {} } } });
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
});

const opts = (extra: RequestOptions = {}): RequestOptions => ({ baseUrl: "http://app", fetch: fetchMock, ...extra });

describe("token transport — the same Authorization header for every method", () => {
  it("GET, POST, PUT and DELETE all send Authorization: OAuth <token>, and nothing else carries it", async () => {
    responses = [json({}), json({}), json({}), new Response(null, { status: 205 })];
    const o = opts({ token: "abc123" });

    await apiGet("/api/products", { deleted: false }, o);
    await apiSend("/api/products", "POST", { a: 1 }, o);
    await apiSend("/api/products", "PUT", { a: 1 }, o);
    await apiDelete("/api/products/1", o);

    expect(calls.map((c) => c.init.method)).toEqual(["GET", "POST", "PUT", "DELETE"]);
    for (const call of calls) {
      const h = headersOf(call);
      expect(h.authorization).toBe("OAuth abc123");
      expect(h.token).toBeUndefined();
      if (h.extras) expect(JSON.parse(h.extras).token).toBeUndefined();
    }
  });

  it("sends no Authorization header when no token is given (browser + session cookie)", async () => {
    await apiGet("/api/products", {}, opts());
    expect(headersOf(calls[0]).authorization).toBeUndefined();
  });

  it("keeps an explicit scheme", () => {
    expect(authorizationFor("xyz")).toBe("OAuth xyz");
    expect(authorizationFor("Bearer xyz")).toBe("Bearer xyz");
    expect(authorizationFor("OAuth xyz")).toBe("OAuth xyz");
  });

  it("moves the deprecated params.token into the header", async () => {
    responses = [json({ products: {} }), json({ stores: {} }), json({ employees: {} })];
    await fetchProducts({ token: "legacy" }, opts());
    await fetchStores({ token: "legacy", storeIds: [4, 5] }, opts());
    await fetchEmployees({ token: "legacy" }, opts());
    for (const call of calls) {
      expect(headersOf(call).authorization).toBe("OAuth legacy");
      expect(JSON.parse(headersOf(call).extras).token).toBeUndefined();
    }
    expect(JSON.parse(headersOf(calls[1]).extras).storeIds).toEqual([4, 5]);
  });

  it("options.token wins over params.token", async () => {
    responses = [json({ products: {} })];
    await fetchProducts({ token: "legacy" }, opts({ token: "current" }));
    expect(headersOf(calls[0]).authorization).toBe("OAuth current");
  });
});

describe("no logging", () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => log.mockRestore());

  it("never console.logs requests (they used to include the token)", async () => {
    responses = [json({}), json({}), new Response(null, { status: 205 })];
    const o = opts({ token: "secret-token" });
    await apiGet("/api/x", {}, o);
    await apiSend("/api/x", "POST", {}, o);
    await apiDelete("/api/x/1", o);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("errors carry the HTTP status", () => {
  it("throws ShopwaveApiError with status and API errors for non-2xx responses", async () => {
    responses = [json({ api: { message: { errors: { 908: { id: 908, title: "Token expired" } } } } }, 401)];
    const error: any = await apiGet("/api/products", {}, opts()).catch((e: any) => e);
    expect(error).toBeInstanceOf(ShopwaveApiError);
    expect(error.status).toBe(401);
    expect(error.isUnauthorized).toBe(true);
    expect(error.errors).toEqual({ 908: { id: 908, title: "Token expired" } });
    expect(error.message).toContain("(401)");
    expect(error.message).toContain("Token expired");
  });

  it("uses the { error, message } body from the SDK routes", async () => {
    responses = [json({ error: "unauthorized", message: "Not logged in" }, 401)];
    const error: any = await apiSend("/api/products", "POST", {}, opts()).catch((e: any) => e);
    expect(error.status).toBe(401);
    expect(error.message).toBe("Shopwave API error (401): Not logged in");
  });

  it("reports API errors inside a 200 response with that status", async () => {
    responses = [json({ api: { message: { errors: { 400: { id: 400, title: "Bad", details: "nope" } } } } })];
    const error = await fetchProducts({}, opts()).catch((e: any) => e);
    expect(error).toBeInstanceOf(ShopwaveApiError);
    expect(error.status).toBe(200);
    expect(error.message).toContain("Bad: nope");
  });

  it("uses status 0 when the request never got a response", async () => {
    responses = [new TypeError("fetch failed")];
    const error: any = await apiGet("/api/products", {}, opts()).catch((e: any) => e);
    expect(error).toBeInstanceOf(ShopwaveApiError);
    expect(error.status).toBe(0);
  });

  it("lets AbortError through unchanged", async () => {
    const abort = new DOMException("aborted", "AbortError");
    responses = [abort as unknown as Error];
    await expect(apiGet("/api/products", {}, opts())).rejects.toBe(abort);
  });
});

describe("empty read responses", () => {
  it("list reads return [] when Shopwave answers with an empty body (no matches)", async () => {
    responses = [new Response(null, { status: 200 }), new Response("", { status: 200 }), new Response(null, { status: 204 })];
    await expect(fetchProducts({ productIds: [999999999] }, opts())).resolves.toEqual([]);
    await expect(fetchStores({ storeIds: [999999999] }, opts())).resolves.toEqual([]);
    await expect(fetchEmployees({ employeeIds: [999999999] }, opts())).resolves.toEqual([]);
  });
});

describe("deletes", () => {
  it("accepts 205 with an empty body", async () => {
    responses = [new Response(null, { status: 205 })];
    await expect(apiDelete("/api/categories/1", opts())).resolves.toBeNull();
  });

  it("throws when a delete response carries API errors", async () => {
    responses = [json({ api: { message: { errors: { 1: { id: 1, title: "Locked" } } } } })];
    await expect(apiDelete("/api/categories/1", opts())).rejects.toBeInstanceOf(ShopwaveApiError);
  });

  it("deleteEntity still rejects a missing id", async () => {
    await expect(deleteEntity("categories", "", opts())).rejects.toThrow("entityId is missing");
  });
});

describe("submitEntity (low-level)", () => {
  it("returns `result` when the route wraps its answer", async () => {
    responses = [json({ message: "ok", result: { id: 1 } })];
    await expect(submitEntity({ endpoint: "/api/merchant", method: "PUT", payload: {} }, opts())).resolves.toEqual({ id: 1 });
  });

  it("otherwise returns the whole body", async () => {
    const body = { categories: { 0: { id: 9 } }, api: { message: { success: {} } } };
    responses = [json(body, 201)];
    await expect(submitEntity({ endpoint: "/api/categories", payload: {} }, opts())).resolves.toEqual(body);
  });
});
