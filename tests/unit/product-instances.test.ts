import { describe, it, expect, beforeEach } from "vitest";
import {
  findRepricedInstances,
  isSameInstancePrice,
  saveProduct,
  toProductInstancesForSave,
  type RequestOptions,
} from "../../src/core";

// As GET /product returns them: keyed by instance id.
const original = {
  "533512": { id: 533512, price: "422.0", taxPercentage: "0.000", timestamp: "2023-01-16T13:46:56.000Z", name: "", tags: "Take Away", activeDate: "2022-08-18T11:59:00.000Z" },
  "533513": { id: 533513, price: "400.0", taxPercentage: "0.200", timestamp: "2023-01-16T13:46:56.000Z", name: "Eat in", tags: "Eat In", activeDate: "2022-08-18T11:59:00.000Z" },
};

describe("isSameInstancePrice", () => {
  it("compares price and tax as numbers", () => {
    expect(isSameInstancePrice({ price: "422.0", taxPercentage: "0.000" }, { price: 422, taxPercentage: "0" })).toBe(true);
    expect(isSameInstancePrice({ price: "422.0", taxPercentage: "0.2" }, { price: "422", taxPercentage: "0.200" })).toBe(true);
    expect(isSameInstancePrice({ price: "423", taxPercentage: "0" }, { price: "422", taxPercentage: "0" })).toBe(false);
    expect(isSameInstancePrice({ price: "422", taxPercentage: "0.2" }, { price: "422", taxPercentage: "0" })).toBe(false);
  });

  it("treats blanks as equal to each other only", () => {
    expect(isSameInstancePrice({ price: "", taxPercentage: null }, { price: undefined, taxPercentage: "" })).toBe(true);
    expect(isSameInstancePrice({ price: "", taxPercentage: "0" }, { price: "0", taxPercentage: "0" })).toBe(false);
  });
});

describe("toProductInstancesForSave", () => {
  it("keeps the id of an unchanged instance and keys by position", () => {
    const form = Object.values(original).map((i) => ({ ...i }));
    const out = toProductInstancesForSave(form, original);
    expect(Object.keys(out)).toEqual(["0", "1"]);
    expect(out["0"].id).toBe(533512);
    expect(out["1"].id).toBe(533513);
    // server field removed, everything else kept
    expect(out["0"]).not.toHaveProperty("timestamp");
    expect(out["0"]).toMatchObject({ price: "422.0", tags: "Take Away", activeDate: "2022-08-18T11:59:00.000Z" });
  });

  it("drops the id of an instance whose price or tax changed (Shopwave creates a new one)", () => {
    const form = [
      { ...original["533512"], price: "450" },
      { ...original["533513"], taxPercentage: "0.050" },
    ];
    const out = toProductInstancesForSave(form, original);
    expect(out["0"]).not.toHaveProperty("id");
    expect(out["0"].price).toBe("450");
    expect(out["1"]).not.toHaveProperty("id");
  });

  it("keeps the id when only non-price fields changed", () => {
    const out = toProductInstancesForSave([{ ...original["533512"], name: "Takeaway", tags: "TA" }], original);
    expect(out["0"].id).toBe(533512);
    expect(out["0"].name).toBe("Takeaway");
  });

  it("drops ids that the original product doesn't have (e.g. copied from another product)", () => {
    const out = toProductInstancesForSave([{ id: 999, price: "100", taxPercentage: "0" }], original);
    expect(out["0"]).not.toHaveProperty("id");
  });

  it("drops every id when there's no original (a new product or a duplicate)", () => {
    const out = toProductInstancesForSave(original);
    expect(Object.values(out).every((i) => !("id" in i))).toBe(true);
    expect(Object.keys(out)).toEqual(["0", "1"]);
  });

  it("sends new rows without an id and omits removed instances", () => {
    const form = [{ ...original["533513"] }, { id: undefined, price: "300", taxPercentage: "0" }];
    const out = toProductInstancesForSave(form, original);
    expect(Object.keys(out)).toEqual(["0", "1"]);
    expect(out["0"].id).toBe(533513);
    expect(out["1"]).not.toHaveProperty("id");
    expect(JSON.stringify(out)).not.toContain("533512");
  });

  it("accepts string ids and an empty list", () => {
    const out = toProductInstancesForSave([{ ...original["533512"], id: "533512" }], original);
    expect(out["0"].id).toBe("533512");
    expect(toProductInstancesForSave([], original)).toEqual({});
    expect(toProductInstancesForSave(null, original)).toEqual({});
  });
});

describe("findRepricedInstances", () => {
  it("lists instances whose price or tax changed, with before/after", () => {
    const form = [
      { ...original["533512"] },
      { ...original["533513"], price: "425.5" },
      { price: "100", taxPercentage: "0" }, // new row: not a re-price
    ];
    expect(findRepricedInstances(form, original)).toEqual([
      {
        index: 1,
        id: 533513,
        name: "Eat in",
        before: { price: "400.0", taxPercentage: "0.200" },
        after: { price: "425.5", taxPercentage: "0.200" },
      },
    ]);
  });

  it("is empty when nothing was re-priced or there's no original", () => {
    expect(findRepricedInstances(Object.values(original), original)).toEqual([]);
    expect(findRepricedInstances(Object.values(original), null)).toEqual([]);
  });
});

describe("saveProduct", () => {
  type Call = { url: string; init: RequestInit };
  let calls: Call[];
  const options: RequestOptions = {
    baseUrl: "http://app",
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ products: { 0: { id: 77 } } }), { status: 201 });
    }) as unknown as typeof fetch,
  };
  const sent = () => JSON.parse(String(calls[0].init.body)).products["0"];

  beforeEach(() => {
    calls = [];
  });

  it("never sends instance ids when creating a product (B13: duplicate kept the original's ids)", async () => {
    await saveProduct({ name: "Copy", barcode: "B1", instances: original }, options);
    const body = sent();
    expect(body).not.toHaveProperty("id");
    expect(Object.keys(body.instances)).toEqual(["0", "1"]);
    expect(JSON.stringify(body.instances)).not.toMatch(/53351[23]/);
    expect(body.instances["0"].price).toBe("422.0");
  });

  it("sends instances as given when updating", async () => {
    const instances = toProductInstancesForSave(Object.values(original), original);
    await saveProduct({ id: 55, name: "Tea", instances }, options);
    expect(sent().instances).toEqual(instances);
  });

  it("leaves a create without instances alone", async () => {
    await saveProduct({ name: "No prices", barcode: "B2" }, options);
    expect(sent()).toEqual({ name: "No prices", barcode: "B2" });
  });
});
