import { describe, it, expect, beforeEach } from "vitest";
import {
  UPLOAD_PREFIXES,
  isUploadPrefix,
  productImageRole,
  saveProduct,
  toStoredProductImages,
  uploadImage,
  type RequestOptions,
} from "../../src/core";

type Call = { url: string; init: RequestInit };
let calls: Call[];
let responses: Response[];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
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

const png = () => new File([new Uint8Array([137, 80, 78, 71])], "shoe.png", { type: "image/png" });
// Shaped as the live API returns them (4 Nov 2026).
const BASE = "http://static.merchantstack.com/images/merchant/4321/product";
const THUMB = "product_thumbnail_a1b2c3d4e5f60718293a4b5c6d7e8f9012345678.png";
const GALLERY = "product_b2c3d4e5f60718293a4b5c6d7e8f901234567890.png";
const PLAIN = "c3d4e5f60718293a4b5c6d7e8f9012345678901a.png";

describe("upload prefixes", () => {
  it("lists the roles longest first", () => {
    expect(UPLOAD_PREFIXES).toEqual(["product_thumbnail", "variant_thumbnail", "product", "variant"]);
    expect(isUploadPrefix("product")).toBe(true);
    expect(isUploadPrefix("thumbnail")).toBe(false);
    expect(isUploadPrefix(undefined)).toBe(false);
  });

  it("uploadImage sends the prefix as a form field and returns the prefixed file name", async () => {
    responses = [json({ fileName: THUMB, path: `${BASE}/${THUMB}` }, 201)];
    const image = await uploadImage(png(), { kind: "product", prefix: "product_thumbnail" }, options);
    const form = calls[0].init.body as FormData;
    expect(calls[0].url).toBe("http://app/api/upload");
    expect(form.get("kind")).toBe("product");
    expect(form.get("prefix")).toBe("product_thumbnail");
    expect(image.id).toBe(THUMB);
    expect(image.url).toBe(`https://s3-eu-west-1.amazonaws.com/static.merchantstack.com/images/merchant/4321/product/${THUMB}`);
  });

  it("uploadImage sends no prefix field without one, and rejects an unknown one", async () => {
    responses = [json({ fileName: PLAIN, path: `${BASE}/${PLAIN}` }, 201)];
    await uploadImage(png(), { kind: "merchant" }, options);
    expect((calls[0].init.body as FormData).has("prefix")).toBe(false);
    await expect(uploadImage(png(), { kind: "product", prefix: "hero" as never }, options)).rejects.toThrow(/unknown prefix/);
    expect(calls).toHaveLength(1);
  });
});

describe("productImageRole", () => {
  it("reads the role from a file name or URL, preferring the longer prefix", () => {
    expect(productImageRole(THUMB)).toBe("product_thumbnail");
    expect(productImageRole(`${BASE}/${GALLERY}`)).toBe("product");
    expect(productImageRole("variant_thumbnail_d6f193683115a0224793c11711bfa2cff171d473.png")).toBe("variant_thumbnail");
    expect(productImageRole("variant_ab.jpg")).toBe("variant");
  });

  it("is null for names without a role", () => {
    expect(productImageRole(`${BASE}/${PLAIN}`)).toBeNull();
    expect(productImageRole("productline.png")).toBeNull();
    expect(productImageRole("product-ab.png")).toBeNull();
    expect(productImageRole("")).toBeNull();
    expect(productImageRole(null)).toBeNull();
  });
});

describe("toStoredProductImages", () => {
  it("sends file names from URLs or names, without duplicates, in order", () => {
    expect(toStoredProductImages([`${BASE}/${THUMB}`, THUMB, GALLERY, null, ""])).toEqual([THUMB, GALLERY]);
    expect(toStoredProductImages(undefined)).toEqual([]);
  });
});

describe("saveProduct images", () => {
  const echo = () => json({ products: { "0": { id: 9 } }, api: {} }, 201);
  const sent = () => JSON.parse(String(calls[0].init.body)).products["0"];

  it("sends images read back as URLs as file names", async () => {
    responses = [echo()];
    await saveProduct({ id: 9, images: [`${BASE}/${THUMB}`, GALLERY] }, options);
    expect(sent().images).toEqual([THUMB, GALLERY]);
  });

  it("sends an empty list to clear the images, and leaves them out when not given", async () => {
    responses = [echo(), echo()];
    await saveProduct({ id: 9, images: [] }, options);
    expect(sent().images).toEqual([]);
    calls = [];
    await saveProduct({ id: 9, name: "x" }, options);
    expect(sent()).not.toHaveProperty("images");
  });
});
