import { describe, it, expect, beforeEach } from "vitest";
import {
  SHOPWAVE_ENTITIES,
  ShopwaveApiError,
  saveCategory,
  saveProduct,
  saveEntities,
  deleteCategory,
  deleteEmployee,
  fetchCategory,
  fetchConsumer,
  saveEmployee,
  type RequestOptions,
} from "../../src/core";

type Call = { url: string; init: RequestInit };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const ok = { message: { success: { 206: { id: 206, title: "Resource Created" } } }, codeBaseVersion: 2 };

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

const sentBody = (i = 0) => JSON.parse(String(calls[i].init.body));

describe("save", () => {
  it("creates: POSTs { categories: { '0': … } } and returns the echoed entity with its id", async () => {
    responses = [json({ categories: { 0: { id: 123, title: "Drinks", parentId: null, merchantId: 7 } }, api: ok }, 201)];

    const saved = await saveCategory({ title: "Drinks", parentId: null, activeDate: null as unknown as string }, options);

    expect(calls[0].url).toBe("http://app/api/categories");
    expect(calls[0].init.method).toBe("POST");
    expect(sentBody()).toEqual({ categories: { 0: { title: "Drinks", parentId: null, activeDate: null } } });
    expect(saved.id).toBe(123);
    expect(saved.title).toBe("Drinks");
    expect((saved as unknown as { merchantId: number }).merchantId).toBe(7);
    // fields the echo leaves out are kept from the input
    expect(saved.activeDate).toBeNull();
  });

  it("updates: sends the id and returns the saved entity", async () => {
    responses = [json({ products: { 0: { id: 55, name: "Tea" } }, api: ok }, 201)];
    const saved = await saveProduct({ id: 55, name: "Tea", barcode: "B1" }, options);
    expect(sentBody()).toEqual({ products: { 0: { id: 55, name: "Tea", barcode: "B1" } } });
    expect(saved).toMatchObject({ id: 55, name: "Tea", barcode: "B1" });
  });

  it("coerces a string id from the API to a number", async () => {
    responses = [json({ employees: { 0: { id: "77" } }, api: ok }, 201)];
    const saved = await saveEmployee({ firstName: "A" }, options);
    expect(saved.id).toBe(77);
  });

  it("throws ShopwaveApiError (with the status) when api.message.errors is set", async () => {
    responses = [
      json({ api: { message: { errors: { 409: { id: 409, title: "Duplicate barcode" } } } } }, 201),
    ];
    const error = await saveProduct({ name: "X" }, options).catch((e) => e);
    expect(error).toBeInstanceOf(ShopwaveApiError);
    expect(error.status).toBe(201);
    expect(error.errors).toHaveProperty("409");
    expect(error.message).toContain("Duplicate barcode");
  });

  it("throws when the ref didn't come back", async () => {
    responses = [json({ categories: {}, api: ok }, 201)];
    const error = await saveCategory({ title: "Lost" }, options).catch((e) => e);
    expect(error).toBeInstanceOf(ShopwaveApiError);
    expect(error.message).toContain('ref "0"');
  });

  it("throws when the echoed entity has no id", async () => {
    responses = [json({ categories: { 0: { title: "No id" } }, api: ok }, 201)];
    await expect(saveCategory({ title: "No id" }, options)).rejects.toBeInstanceOf(ShopwaveApiError);
  });

  it("throws with the HTTP status for a failed request", async () => {
    responses = [json({ error: "unauthorized", message: "Not logged in" }, 401)];
    const error = await saveCategory({ title: "x" }, options).catch((e) => e);
    expect(error.status).toBe(401);
  });

  it("saveEntities matches several results back by ref, in order", async () => {
    responses = [json({ categories: { 1: { id: 2, title: "B" }, 0: { id: 1, title: "A" } }, api: ok }, 201)];
    const saved = await saveEntities("category", [{ title: "A" }, { title: "B" }], options);
    expect(sentBody()).toEqual({ categories: { 0: { title: "A" }, 1: { title: "B" } } });
    expect(saved.map((c) => c.id)).toEqual([1, 2]);
  });

  it("saveEntities with nothing to save makes no request", async () => {
    await expect(saveEntities("category", [], options)).resolves.toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("sends the token in the Authorization header", async () => {
    responses = [json({ categories: { 0: { id: 1 } }, api: ok }, 201)];
    await saveCategory({ title: "a" }, options);
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe("OAuth t0k");
  });
});

describe("delete", () => {
  it("DELETEs /api/<route>/<id> and resolves on 205 with an empty body", async () => {
    responses = [new Response(null, { status: 205 })];
    await expect(deleteCategory(42, options)).resolves.toBeUndefined();
    expect(calls[0].url).toBe("http://app/api/categories/42");
    expect(calls[0].init.method).toBe("DELETE");
  });

  it("resolves for unknown ids too (the API gives no not-found)", async () => {
    responses = [new Response(null, { status: 205 })];
    await expect(deleteEmployee(999999999, options)).resolves.toBeUndefined();
  });

  it("employees use the same DELETE route (the server retires them via exitDate)", async () => {
    responses = [json({ employees: { 0: { id: 3, exitDate: "2026-09-28 16:00:00" } } }, 201)];
    await expect(deleteEmployee(3, options)).resolves.toBeUndefined();
    expect(calls[0].url).toBe("http://app/api/employees/3");
    expect(calls[0].init.method).toBe("DELETE");
  });

  it("rejects a missing id without calling the API", async () => {
    await expect(deleteCategory("", options)).rejects.toThrow("category id is missing");
    expect(calls).toHaveLength(0);
  });

  it("encodes the id", async () => {
    responses = [new Response(null, { status: 205 })];
    await deleteCategory("a/b", options);
    expect(calls[0].url).toBe("http://app/api/categories/a%2Fb");
  });

  it("surfaces the status of a failed delete", async () => {
    responses = [json({ error: "unauthorized", message: "Not logged in" }, 401)];
    const error = await deleteCategory(1, options).catch((e) => e);
    expect(error).toBeInstanceOf(ShopwaveApiError);
    expect(error.status).toBe(401);
  });
});

describe("fetch by id", () => {
  it("GETs /api/<route>/<id> and returns the record", async () => {
    responses = [json({ categories: { 5: { id: 5, title: "Five" } }, api: ok })];
    await expect(fetchCategory(5, {}, options)).resolves.toEqual({ id: 5, title: "Five" });
    expect(calls[0].url).toBe("http://app/api/categories/5");
    expect(JSON.parse(new Headers(calls[0].init.headers).get("extras")!)).toMatchObject({ deleted: false });
  });

  it("passes deleted: true", async () => {
    responses = [json({ consumers: { 8: { id: 8 } }, api: ok })];
    await fetchConsumer(8, { deleted: true }, options);
    expect(calls[0].url).toBe("http://app/api/consumer/8");
    expect(JSON.parse(new Headers(calls[0].init.headers).get("extras")!).deleted).toBe(true);
  });

  it("returns null when the record isn't there", async () => {
    responses = [json({ categories: {}, api: ok })];
    await expect(fetchCategory(5, {}, options)).resolves.toBeNull();
  });

  it("finds the record when the map isn't keyed by id", async () => {
    responses = [json({ categories: { 0: { id: 5 } }, api: ok })];
    await expect(fetchCategory("5", {}, options)).resolves.toEqual({ id: 5 });
  });
});

describe("error map key", () => {
  it("also reads api.message.error (the name used in the API reference)", async () => {
    responses = [json({ api: { message: { error: { 913: { id: 913, title: "Required parameter or object missing" } } } } }, 201)];
    const error = await saveCategory({ title: "x" }, options).catch((e) => e);
    expect(error).toBeInstanceOf(ShopwaveApiError);
    expect(error.message).toContain("913 Required parameter");
  });
});

describe("entity table", () => {
  it("covers every entity with the Shopwave naming", () => {
    expect(SHOPWAVE_ENTITIES.product).toEqual({
      route: "products",
      collection: "products",
      upstream: "product",
      idsHeader: "productIds",
      idHeader: "productId",
      writable: true,
      deleteMode: "delete",
    });
    expect(SHOPWAVE_ENTITIES.consumer.route).toBe("consumer");
    expect(SHOPWAVE_ENTITIES.consumer.idsHeader).toBe("ids");
    expect(SHOPWAVE_ENTITIES.consumer).toMatchObject({ writable: false, deleteMode: "none" });
    expect(SHOPWAVE_ENTITIES.employee).toMatchObject({ deleteMode: "retire", retireField: "exitDate" });
    expect(SHOPWAVE_ENTITIES.promotion).toMatchObject({ deleteMode: "retire", retireField: "endDate" });
    expect(Object.keys(SHOPWAVE_ENTITIES).sort()).toEqual(
      ["category", "consumer", "employee", "product", "promotion", "store"]
    );
  });
});
