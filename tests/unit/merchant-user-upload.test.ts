import { describe, it, expect, beforeEach } from "vitest";
import {
  ShopwaveApiError,
  fetchMerchant,
  updateMerchant,
  normalizeMerchantLinks,
  merchantLinksToForm,
  merchantLinksFromForm,
  MERCHANT_COLOUR_KEYS,
  MERCHANT_OBJECT_FIELDS,
  MERCHANT_IMAGE_SLOTS,
  getMerchantImage,
  getMerchantImageUrl,
  setMerchantImage,
  toStoredImageIds,
  imageFileName,
  coverCrop,
  uploadMerchantImage,
  fetchUser,
  uploadImage,
  getImageUrl,
  validateMerchant,
  MERCHANT_FIELD_MAX_LENGTH,
  UPLOAD_KINDS,
  SHOPWAVE_RESOURCES,
  type RequestOptions,
} from "../../src/core";

type Call = { url: string; init: RequestInit };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const ok = { message: { success: { 203: { id: 203, title: "Request Processed Successfully" } } }, codeBaseVersion: 2 };

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

const headersOf = (i: number) => new Headers(calls[i].init.headers);
const sentBody = (i: number) => JSON.parse(String(calls[i].init.body));

// Shape of the live `GET /merchant` answer (30 Sep 2026).
const liveMerchant = {
  id: 5644,
  name: "Test Product Upload",
  description: null,
  companyNumber: null,
  vatNumber: null,
  categoryId: null,
  estAnnualRevenue: null,
  note: null,
  colours: {},
  links: {},
  imageIds: {},
};

describe("SHOPWAVE_RESOURCES", () => {
  it("addresses merchant (writable) and user (read-only)", () => {
    expect(SHOPWAVE_RESOURCES.merchant).toMatchObject({ route: "merchant", key: "merchant", upstream: "merchant", writable: true });
    expect(SHOPWAVE_RESOURCES.user).toMatchObject({ route: "user", key: "user", upstream: "user", writable: false });
    expect(Object.isFrozen(SHOPWAVE_RESOURCES)).toBe(true);
  });
});

describe("fetchMerchant", () => {
  it("GETs /api/merchant with the token and returns body.merchant", async () => {
    responses = [json({ merchant: liveMerchant, api: ok })];
    const m = await fetchMerchant(options);
    expect(calls[0].url).toBe("http://app/api/merchant");
    expect(calls[0].init.method).toBe("GET");
    expect(headersOf(0).get("authorization")).toBe("OAuth t0k");
    expect(m).toEqual(liveMerchant);
  });

  it("returns null for an empty body", async () => {
    responses = [new Response(null, { status: 200 })];
    expect(await fetchMerchant(options)).toBeNull();
  });

  it("throws ShopwaveApiError on API errors and HTTP errors", async () => {
    responses = [json({ api: { message: { errors: { 908: { id: 908, title: "Token expired" } } } } })];
    await expect(fetchMerchant(options)).rejects.toMatchObject({ name: "ShopwaveApiError", isUnauthorized: true });
    responses = [json({ error: "unauthorized", message: "Not logged in" }, 401)];
    await expect(fetchMerchant(options)).rejects.toMatchObject({ status: 401 });
  });
});

describe("updateMerchant", () => {
  it("reads first and sends the patch merged over the stored merchant (B4: nothing is dropped)", async () => {
    const stored = { ...liveMerchant, companyNumber: "01234567", vatNumber: "GB1", links: { website: { home: "https://a.b" } } };
    responses = [
      json({ merchant: stored, api: ok }),
      json({ merchant: { ...stored, name: "New name" }, api: ok }, 201),
    ];

    const saved = await updateMerchant({ name: "New name", colours: { primary: { main: "#112233" } } }, options);

    expect(calls).toHaveLength(2);
    expect(calls[1].url).toBe("http://app/api/merchant");
    expect(calls[1].init.method).toBe("PUT");
    expect(headersOf(1).get("content-type")).toBe("application/json");
    // links and imageIds weren't patched, so they're left out (the API keeps them)
    const { links: _links, imageIds: _imageIds, ...scalars } = stored;
    expect(sentBody(1)).toEqual({
      merchant: { ...scalars, name: "New name", colours: { primary: { main: "#112233" } } },
    });
    expect(saved).toMatchObject({ id: 5644, name: "New name", companyNumber: "01234567", vatNumber: "GB1" });
  });

  it("sends companyNumber, vatNumber and links when they are patched", async () => {
    responses = [json({ merchant: liveMerchant, api: ok }), json({ merchant: { id: 5644 }, api: ok }, 201)];
    const saved = await updateMerchant(
      { companyNumber: "C1", vatNumber: "V1", links: { website: { home: "https://x.y" }, social: { instagram: "@x" } } },
      options
    );
    expect(sentBody(1).merchant).toMatchObject({
      id: 5644,
      companyNumber: "C1",
      vatNumber: "V1",
      links: { website: { home: "https://x.y" }, social: { instagram: "@x" } },
    });
    // the echo only had the id: the rest comes from what was sent
    expect(saved).toMatchObject({ id: 5644, companyNumber: "C1", links: { website: { home: "https://x.y" } } });
  });

  it("never sends read-only fields back", async () => {
    responses = [
      json({ merchant: { ...liveMerchant, createdDate: "2020-01-01", modifiedDate: "2026-01-01" }, api: ok }),
      json({ merchant: { id: 5644 }, api: ok }, 201),
    ];
    await updateMerchant({ note: "n" }, options);
    expect(sentBody(1).merchant).not.toHaveProperty("createdDate");
    expect(sentBody(1).merchant).not.toHaveProperty("modifiedDate");
  });

  it("refuses to save a different merchant id", async () => {
    responses = [json({ merchant: liveMerchant, api: ok })];
    await expect(updateMerchant({ id: 1, name: "x" }, options)).rejects.toThrow(/not the logged-in merchant/);
    expect(calls).toHaveLength(1);
  });

  it("throws 404 when there's no merchant to update", async () => {
    responses = [new Response(null, { status: 200 })];
    await expect(updateMerchant({ name: "x" }, options)).rejects.toMatchObject({ status: 404 });
  });

  it("merge: false sends only the patch and needs the id", async () => {
    responses = [json({ merchant: { id: 5644, name: "N" }, api: ok }, 201)];
    await updateMerchant({ id: 5644, name: "N" }, { ...options, merge: false });
    expect(calls).toHaveLength(1);
    expect(sentBody(0)).toEqual({ merchant: { id: 5644, name: "N" } });

    await expect(updateMerchant({ name: "N" }, { ...options, merge: false })).rejects.toThrow(/id is missing/);
  });

  it("live shape: 205 with an empty body → reads the merchant back and returns what was stored", async () => {
    responses = [
      json({ merchant: liveMerchant, api: ok }),
      new Response(null, { status: 205 }),
      json({ merchant: { ...liveMerchant, vatNumber: "123456789", imageIds: {} }, api: ok }),
    ];
    const saved = await updateMerchant({ vatNumber: "123456789", imageIds: { logo: { receipt: "x.png" } } }, options);
    expect(calls.map((c) => c.init.method)).toEqual(["GET", "PUT", "GET"]);
    expect(sentBody(1).merchant).toMatchObject({ vatNumber: "123456789", imageIds: { logo: { receipt: "x.png" } } });
    // what's returned is the re-read, not what was sent
    expect(saved.imageIds).toEqual({});
    expect(saved.vatNumber).toBe("123456789");
  });

  it("rejects values longer than the API stores instead of letting it truncate them", async () => {
    expect(MERCHANT_FIELD_MAX_LENGTH).toMatchObject({ companyNumber: 11, vatNumber: 9 });
    expect(validateMerchant({ companyNumber: "12345678901", vatNumber: "123456789" })).toEqual([]);
    expect(validateMerchant({ companyNumber: "123456789012", vatNumber: "GB123456789" })).toEqual([
      "companyNumber is longer than 11 characters",
      "vatNumber is longer than 9 characters",
    ]);
    responses = [json({ merchant: liveMerchant, api: ok })];
    await expect(updateMerchant({ vatNumber: "GB123456789" }, options)).rejects.toThrow(/vatNumber is longer than 9/);
    expect(calls.map((c) => c.init.method)).toEqual(["GET"]); // nothing was sent
  });

  it("throws ShopwaveApiError when the save answers with API errors", async () => {
    responses = [
      json({ merchant: liveMerchant, api: ok }),
      json({ api: { message: { errors: { 400: { id: 400, title: "Bad", details: "vatNumber invalid" } } } } }, 200),
    ];
    const error = await updateMerchant({ vatNumber: "?" }, options).catch((e) => e);
    expect(error).toBeInstanceOf(ShopwaveApiError);
    expect(error.message).toMatch(/vatNumber invalid/);
  });
});

describe("merchant links", () => {
  const nested = { website: { home: "https://a" }, social: { twitter: "@t", instagram: "@i" } };

  it("reads adminV1's nested shape as flat form fields, dropping empty values", () => {
    expect(merchantLinksToForm(nested)).toEqual({ website: "https://a", twitter: "@t", instagram: "@i" });
    expect(merchantLinksToForm({ website: { home: " " }, social: { facebook: null } })).toEqual({});
  });

  it("also reads flat keys (0.4.0 pre-release) and older arrays", () => {
    expect(merchantLinksToForm({ website: " https://only.example.com " })).toEqual({ website: "https://only.example.com" });
    expect(merchantLinksToForm(["w", "", "f", "i"])).toEqual({ website: "w", facebook: "f", instagram: "i" });
  });

  it("builds the nested shape from form fields, leaving out empty groups", () => {
    expect(merchantLinksFromForm({ website: "https://a", twitter: "@t", facebook: "", instagram: "@i" })).toEqual(nested);
    expect(merchantLinksFromForm({ twitter: "@t" })).toEqual({ social: { twitter: "@t" } });
    expect(merchantLinksFromForm({})).toEqual({});
  });

  it("normalizeMerchantLinks turns any shape into the nested one", () => {
    expect(normalizeMerchantLinks({ website: "https://a", twitter: "@t", instagram: "@i" })).toEqual(nested);
    expect(normalizeMerchantLinks(nested)).toEqual(nested);
    expect(normalizeMerchantLinks(null)).toEqual({});
    expect(normalizeMerchantLinks("x")).toEqual({});
  });

  it("colour keys match adminV1 (colours.primary.main / highlight / contrast)", () => {
    expect(MERCHANT_COLOUR_KEYS).toEqual(["main", "highlight", "contrast"]);
  });
});

describe("merchant images", () => {
  const read = {
    logo: {
      receipt: "http://static.merchantstack.com/images/merchant/5644/logo/aaa.png",
      square: "http://static.merchantstack.com/images/merchant/5644/logo/bbb.png",
    },
    feature: ["http://static.merchantstack.com/images/merchant/5644/feature/ccc.png"],
  };

  it("slots match adminV1: keys, upload kinds and exact sizes", () => {
    expect(MERCHANT_IMAGE_SLOTS).toEqual({
      receipt: { field: "logo.receipt", uploadKind: "merchant", width: 576, height: 325 },
      square: { field: "logo.square", uploadKind: "merchant", width: 1000, height: 1000 },
      featured: { field: "feature[0]", uploadKind: "merchantFeature", width: 1200, height: 600 },
    });
    expect(UPLOAD_KINDS.merchantFeature).toBe("merchantFeature");
  });

  it("reads each slot, and gives HTTPS URLs for stored values", () => {
    expect(getMerchantImage(read, "receipt")).toBe(read.logo.receipt);
    expect(getMerchantImage(read, "featured")).toBe(read.feature[0]);
    expect(getMerchantImage({}, "square")).toBeNull();
    expect(getMerchantImage(null, "square")).toBeNull();
    expect(getMerchantImageUrl(read, "square")).toBe(
      "https://s3-eu-west-1.amazonaws.com/static.merchantstack.com/images/merchant/5644/logo/bbb.png"
    );
    // a bare file name (fresh upload) has no known URL
    expect(getMerchantImageUrl({ logo: { receipt: "new.png" } }, "receipt")).toBe("");
  });

  it("sets and clears slots without touching the others", () => {
    const withNew = setMerchantImage(read, "receipt", "new.png");
    expect(withNew.logo).toEqual({ receipt: "new.png", square: read.logo.square });
    expect(withNew.feature).toBe(read.feature);

    expect(setMerchantImage({}, "featured", "f.png")).toEqual({ feature: ["f.png"] });
    expect(setMerchantImage({ feature: ["a.png", "b.png"] }, "featured", "c.png")).toEqual({ feature: ["c.png", "b.png"] });
    expect(setMerchantImage({ feature: ["a.png"] }, "featured", null)).toEqual({});
    expect(setMerchantImage({ logo: { square: "s.png" } }, "square", null)).toEqual({});
    expect(setMerchantImage(null, "square", "s.png")).toEqual({ logo: { square: "s.png" } });
  });

  it("toStoredImageIds turns read URLs back into file names (what adminV1 does)", () => {
    expect(toStoredImageIds(read)).toEqual({ logo: { receipt: "aaa.png", square: "bbb.png" }, feature: ["ccc.png"] });
    expect(toStoredImageIds({ logo: { receipt: "x.png?v=2", square: "" }, feature: [null, ""] })).toEqual({
      logo: { receipt: "x.png" },
    });
    expect(toStoredImageIds(undefined)).toEqual({});
    expect(imageFileName("https://h/a/b/c%20d.png#x")).toBe("c d.png");
    expect(imageFileName(5)).toBeNull();
  });

  it("updateMerchant sends imageIds as file names", async () => {
    responses = [json({ merchant: { ...liveMerchant, imageIds: read }, api: ok }), new Response(null, { status: 205 }), json({ merchant: liveMerchant, api: ok })];
    await updateMerchant({ imageIds: setMerchantImage(read, "square", "new.png") }, options);
    expect(sentBody(1).merchant.imageIds).toEqual({ logo: { receipt: "aaa.png", square: "new.png" }, feature: ["ccc.png"] });
  });

  it("updateMerchant leaves unpatched object fields out, so the API keeps them", async () => {
    responses = [json({ merchant: { ...liveMerchant, imageIds: read, colours: { primary: { main: "#000" } } }, api: ok }), new Response(null, { status: 205 }), json({ merchant: liveMerchant, api: ok })];
    await updateMerchant({ name: "N" }, options);
    const sent = sentBody(1).merchant;
    for (const field of MERCHANT_OBJECT_FIELDS) expect(sent).not.toHaveProperty(field);
    expect(sent).toMatchObject({ id: 5644, name: "N", companyNumber: null });
  });

  it("coverCrop centre-crops to the target aspect ratio", () => {
    expect(coverCrop(1000, 1000, 1200, 600)).toEqual({ sx: 0, sy: 250, sw: 1000, sh: 500 });
    expect(coverCrop(2000, 1000, 1000, 1000)).toEqual({ sx: 500, sy: 0, sw: 1000, sh: 1000 });
    expect(coverCrop(576, 325, 576, 325)).toEqual({ sx: 0, sy: 0, sw: 576, sh: 325 });
    expect(() => coverCrop(0, 1, 1, 1)).toThrow(/positive/);
  });

  it("uploadMerchantImage uses the slot's kind (fit: false in Node, where there's no canvas)", async () => {
    responses = [json({ fileName: "f.png", path: "http://static.merchantstack.com/images/merchant/5644/feature/f.png" }, 201)];
    const image = await uploadMerchantImage(new File(["x"], "a.png", { type: "image/png" }), "featured", { ...options, fit: false });
    expect((calls[0].init.body as FormData).get("kind")).toBe("merchantFeature");
    expect(image.id).toBe("f.png");
    await expect(uploadMerchantImage(new Blob(["x"]), "featured", options)).rejects.toThrow(/needs a browser/);
  });
});

describe("fetchUser", () => {
  it("GETs /api/user and returns body.user", async () => {
    const user = { id: 1268823, firstName: "Test", lastName: "Account", email: "t@e.st", employee: { merchantId: 5644, roleId: 1, stores: {} } };
    responses = [json({ user, api: ok })];
    expect(await fetchUser(options)).toEqual(user);
    expect(calls[0].url).toBe("http://app/api/user");
    expect(calls[0].init.method).toBe("GET");
    expect(headersOf(0).get("authorization")).toBe("OAuth t0k");
  });

  it("returns null for an empty body and throws on 401", async () => {
    responses = [new Response(null, { status: 200 })];
    expect(await fetchUser(options)).toBeNull();
    responses = [json({ error: "unauthorized" }, 401)];
    await expect(fetchUser(options)).rejects.toMatchObject({ status: 401, isUnauthorized: true });
  });
});

describe("uploadImage", () => {
  const png = () => new File([new Uint8Array([137, 80, 78, 71])], "logo.png", { type: "image/png" });

  it("POSTs multipart file + kind to /api/upload and returns { id, url }", async () => {
    responses = [json({ fileName: "abc123.png", path: "https://cdn/abc123.png", api: ok }, 201)];

    const image = await uploadImage(png(), { kind: "merchant" }, options);

    expect(image).toEqual({ id: "abc123.png", url: "https://cdn/abc123.png", path: "https://cdn/abc123.png" });
    expect(calls[0].url).toBe("http://app/api/upload");
    expect(calls[0].init.method).toBe("POST");
    const h = headersOf(0);
    expect(h.get("authorization")).toBe("OAuth t0k");
    // fetch must set the multipart boundary itself
    expect(h.get("content-type")).toBeNull();
    const form = calls[0].init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("kind")).toBe("merchant");
    const file = form.get("file") as File;
    expect(file.name).toBe("logo.png");
    expect(file.size).toBe(4);
  });

  it("uses params.fileName for a Blob without a name", async () => {
    responses = [json({ fileName: "f", path: "p" }, 201)];
    await uploadImage(new Blob(["x"], { type: "image/png" }), { kind: "product", fileName: "x.png" }, options);
    expect(((calls[0].init.body as FormData).get("file") as File).name).toBe("x.png");
  });

  it("rejects an unknown kind or a missing file before calling the API", async () => {
    await expect(uploadImage(png(), { kind: "logo" as never }, options)).rejects.toThrow(/unknown kind/);
    await expect(uploadImage(null as never, { kind: "merchant" }, options)).rejects.toThrow(/File or Blob/);
    expect(calls).toHaveLength(0);
  });

  it("throws when the answer has no fileName, or on HTTP/API errors", async () => {
    responses = [json({ api: ok }, 201)];
    await expect(uploadImage(png(), { kind: "merchant" }, options)).rejects.toThrow(/no fileName/);
    responses = [json({ error: "too_large" }, 413)];
    await expect(uploadImage(png(), { kind: "merchant" }, options)).rejects.toMatchObject({ status: 413 });
    responses = [json({ api: { message: { errors: { 1: { id: 1, title: "Upload failed" } } } } }, 200)];
    await expect(uploadImage(png(), { kind: "merchant" }, options)).rejects.toThrow(/Upload failed/);
  });

  it("live shape: returns an HTTPS url for the http static.merchantstack.com path", async () => {
    const path = "http://static.merchantstack.com/images/merchant/5644/logo/ea3c.png";
    responses = [json({ fileName: "ea3c.png", path, api: ok }, 201)];
    const image = await uploadImage(png(), { kind: "merchant" }, options);
    expect(image).toEqual({
      id: "ea3c.png",
      path,
      url: "https://s3-eu-west-1.amazonaws.com/static.merchantstack.com/images/merchant/5644/logo/ea3c.png",
    });
  });

  it("maps application kinds to the API's spelling", () => {
    expect(UPLOAD_KINDS.applicationLogo).toBe("applicaionLogo");
    expect(UPLOAD_KINDS.applicationImages).toBe("applicaionImages");
    expect(UPLOAD_KINDS.merchant).toBe("merchant");
  });
});

describe("getImageUrl", () => {
  const S3 = "https://s3-eu-west-1.amazonaws.com/static.merchantstack.com/images";
  it("rewrites the static host (http or https) to the HTTPS base", () => {
    expect(getImageUrl("http://static.merchantstack.com/images/a/b.png")).toBe(`${S3}/a/b.png`);
    expect(getImageUrl("https://static.merchantstack.com/images/a.png")).toBe(`${S3}/a.png`);
  });
  it("prefixes relative paths and keeps other absolute URLs", () => {
    expect(getImageUrl("merchant/1/x.png")).toBe(`${S3}/merchant/1/x.png`);
    expect(getImageUrl("/x.png")).toBe(`${S3}/x.png`);
    expect(getImageUrl("https://cdn.example.com/x.png")).toBe("https://cdn.example.com/x.png");
    expect(getImageUrl("data:image/png;base64,AA")).toBe("data:image/png;base64,AA");
  });
  it("takes a custom base and handles empty input", () => {
    expect(getImageUrl("x.png", "https://img.example.com/")).toBe("https://img.example.com/x.png");
    expect(getImageUrl("")).toBe("");
    expect(getImageUrl(null)).toBe("");
  });
});
