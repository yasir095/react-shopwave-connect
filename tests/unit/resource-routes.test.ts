import { describe, it, expect, vi, beforeEach } from "vitest";
import { createShopwaveApiHandlers, type ShopwaveApiConfig } from "../../src/server";

type Upstream = { url: string; method: string; headers: Headers; body: unknown };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let upstream: Upstream[];
let replies: Array<Response | Error>;
let getAuthorization: ReturnType<typeof vi.fn>;

const fetchMock = (async (url: string, init: RequestInit) => {
  upstream.push({ url, method: String(init.method), headers: new Headers(init.headers), body: init.body ?? null });
  const next = replies.shift() ?? json({ api: { message: {} } });
  if (next instanceof Error) throw next;
  return next;
}) as unknown as typeof fetch;

function api(overrides: Partial<ShopwaveApiConfig> = {}) {
  return createShopwaveApiHandlers({
    apiUrl: "https://api.example.com",
    getAuthorization: getAuthorization as unknown as ShopwaveApiConfig["getAuthorization"],
    fetch: fetchMock,
    onError: () => {},
    ...overrides,
  });
}

const postBodyOf = (u: Upstream) => JSON.parse(new URLSearchParams(String(u.body)).get("postBody")!);

function jsonReq(path: string, method: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function uploadReq(fields: Record<string, string | File>, headers: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request("https://app.example.com/api/upload", { method: "POST", body: form, headers });
}

const png = (bytes = 4, name = "logo.png", type = "image/png") => new File([new Uint8Array(bytes)], name, { type });

beforeEach(() => {
  upstream = [];
  replies = [];
  getAuthorization = vi.fn(async (o?: { forceRefresh?: boolean }) => (o?.forceRefresh ? "OAuth fresh" : "OAuth session"));
});

describe("resource('merchant')", () => {
  it("GET forwards to /merchant with the session token and passes the body through", async () => {
    replies = [json({ merchant: { id: 5644, name: "M" }, api: {} })];
    const res = await api().resource("merchant").GET(new Request("https://app.example.com/api/merchant"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ merchant: { id: 5644, name: "M" }, api: {} });
    expect(upstream[0]).toMatchObject({ url: "https://api.example.com/merchant", method: "GET" });
    expect(upstream[0].headers.get("authorization")).toBe("OAuth session");
    expect(upstream[0].headers.get("x-accept-version")).toBe("2.0");
  });

  it("PUT sends every field as postBody { merchant } (B4: companyNumber, vatNumber, links kept)", async () => {
    replies = [json({ merchant: { id: 5644 }, api: {} }, 201)];
    const merchant = {
      id: 5644,
      name: "M",
      companyNumber: "C1",
      vatNumber: "V1",
      links: { website: { home: "https://x" }, social: { twitter: "@x" } },
      colours: { primary: { main: "#111111", highlight: "#222222", contrast: "#ffffff" } },
      imageIds: { logo: { receipt: "r.png", square: "s.png" }, feature: ["f.png"] },
    };
    const res = await api().resource("merchant").PUT(jsonReq("/api/merchant", "PUT", { merchant }));

    expect(res.status).toBe(201);
    const u = upstream[0];
    expect(u).toMatchObject({ url: "https://api.example.com/merchant", method: "POST" });
    expect(u.headers.get("content-type")).toContain("application/x-www-form-urlencoded");
    expect(postBodyOf(u)).toEqual({ merchant });
  });

  it("accepts a bare object and a string id", async () => {
    await api().resource("merchant").POST(jsonReq("/api/merchant", "POST", { id: "5644", note: "n" }));
    expect(postBodyOf(upstream[0])).toEqual({ merchant: { id: 5644, note: "n" } });
  });

  it("answers 400 without an id (the API would create a second merchant)", async () => {
    const res = await api().resource("merchant").PUT(jsonReq("/api/merchant", "PUT", { merchant: { name: "x" } }));
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/merchant id/);
    expect(upstream).toHaveLength(0);
  });

  it("answers 400 for invalid JSON or a non-object merchant", async () => {
    expect((await api().resource("merchant").PUT(jsonReq("/api/merchant", "PUT", "{nope"))).status).toBe(400);
    expect((await api().resource("merchant").PUT(jsonReq("/api/merchant", "PUT", { merchant: [1] }))).status).toBe(400);
    expect((await api().resource("merchant").PUT(jsonReq("/api/merchant", "PUT", { merchant: { id: "a b" } }))).status).toBe(400);
    expect(upstream).toHaveLength(0);
  });

  it("refreshes the session token once when the save answers 908", async () => {
    replies = [
      json({ api: { message: { errors: { 908: { id: 908 } } } } }),
      json({ merchant: { id: 1 }, api: {} }, 201),
    ];
    const res = await api().resource("merchant").PUT(jsonReq("/api/merchant", "PUT", { id: 1, name: "x" }));
    expect(res.status).toBe(201);
    expect(upstream).toHaveLength(2);
    expect(upstream[1].headers.get("authorization")).toBe("OAuth fresh");
    expect(postBodyOf(upstream[1])).toEqual({ merchant: { id: 1, name: "x" } });
  });

  it("uses the caller's token when one is sent", async () => {
    await api().resource("merchant").GET(new Request("https://app.example.com/api/merchant", { headers: { Authorization: "OAuth caller" } }));
    expect(upstream[0].headers.get("authorization")).toBe("OAuth caller");
    expect(getAuthorization).not.toHaveBeenCalled();
  });
});

describe("resource('user')", () => {
  it("GET forwards to /user", async () => {
    replies = [json({ user: { id: 1 }, api: {} })];
    const res = await api().resource("user").GET(new Request("https://app.example.com/api/user"));
    expect(await res.json()).toEqual({ user: { id: 1 }, api: {} });
    expect(upstream[0].url).toBe("https://api.example.com/user");
  });

  it("is read-only: PUT/POST answer 405", async () => {
    const res = await api().resource("user").PUT(jsonReq("/api/user", "PUT", { id: 1 }));
    expect(res.status).toBe(405);
    expect((await api().resource("user").POST(jsonReq("/api/user", "POST", { id: 1 }))).status).toBe(405);
    expect(upstream).toHaveLength(0);
  });

  it("answers 401 when logged out", async () => {
    getAuthorization.mockResolvedValue(null);
    const res = await api().resource("user").GET(new Request("https://app.example.com/api/user"));
    expect(res.status).toBe(401);
  });

  it("throws for an unknown resource", () => {
    expect(() => api().resource("nope" as never)).toThrow(/Unknown Shopwave resource/);
  });
});

describe("upload()", () => {
  it("PUTs the file to /uploader as multipart with the contentType header", async () => {
    replies = [json({ fileName: "abc.png", path: "https://cdn/abc.png", api: {} }, 201)];
    const res = await api().upload().POST(uploadReq({ file: png(), kind: "merchant" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ fileName: "abc.png", path: "https://cdn/abc.png", api: {} });
    const u = upstream[0];
    expect(u).toMatchObject({ url: "https://api.example.com/uploader", method: "PUT" });
    expect(u.headers.get("contentType")).toBe("merchant");
    expect(u.headers.get("authorization")).toBe("OAuth session");
    expect(u.headers.get("content-type")).toBeNull(); // fetch adds the boundary
    expect(u.body).toBeInstanceOf(FormData);
    const file = (u.body as FormData).get("file") as File;
    expect(file.name).toBe("logo.png");
    expect(file.size).toBe(4);
    expect((u.body as FormData).get("kind")).toBeNull(); // only the file goes upstream
  });

  it("sends the featured-image kind as contentType merchantFeature", async () => {
    await api().upload().POST(uploadReq({ file: png(), kind: "merchantFeature" }));
    expect(upstream[0].headers.get("contenttype")).toBe("merchantFeature");
  });

  it("maps application kinds to the API's spelling", async () => {
    await api().upload().POST(uploadReq({ file: png(), kind: "applicationLogo" }));
    expect(upstream[0].headers.get("contentType")).toBe("applicaionLogo");
  });

  it("never forwards extras (callers can't add upstream headers)", async () => {
    await api().upload().POST(uploadReq({ file: png(), kind: "product" }, { extras: JSON.stringify({ contentType: "user", x: "1" }) }));
    expect(upstream[0].headers.get("contentType")).toBe("product");
    expect(upstream[0].headers.get("x")).toBeNull();
  });

  it("answers 400 for a missing/empty file, an unknown kind, or a non-multipart body", async () => {
    const h = api().upload();
    expect((await h.POST(uploadReq({ kind: "merchant" }))).status).toBe(400);
    expect((await h.POST(uploadReq({ file: png(0), kind: "merchant" }))).status).toBe(400);
    expect((await h.POST(uploadReq({ file: "text", kind: "merchant" }))).status).toBe(400);
    const badKind = await h.POST(uploadReq({ file: png(), kind: "logo" }));
    expect(badKind.status).toBe(400);
    expect((await badKind.json()).message).toMatch(/merchant, merchantFeature, product/);
    expect((await h.POST(jsonReq("/api/upload", "POST", { file: 1 }))).status).toBe(400);
    expect(upstream).toHaveLength(0);
  });

  it("answers 413 above maxBytes and 415 for types outside accept", async () => {
    const h = api().upload({ maxBytes: 10 });
    expect((await h.POST(uploadReq({ file: png(11), kind: "merchant" }))).status).toBe(413);
    expect((await h.POST(uploadReq({ file: png(4, "a.pdf", "application/pdf"), kind: "merchant" }))).status).toBe(415);
    const pdfOk = api().upload({ accept: ["image/", "application/pdf"] });
    expect((await pdfOk.POST(uploadReq({ file: png(4, "a.pdf", "application/pdf"), kind: "merchant" }))).status).toBe(200);
    expect(upstream).toHaveLength(1);
  });

  it("rejects an oversized Content-Length before reading the body", async () => {
    const request = new Request("https://app.example.com/api/upload", {
      method: "POST",
      headers: { "content-length": String(50 * 1024 * 1024) },
      body: "x",
    });
    const res = await api().upload().POST(request);
    expect(res.status).toBe(413);
  });

  it("re-sends the file after a token refresh", async () => {
    replies = [json({}, 401), json({ fileName: "f", path: "p" }, 201)];
    const res = await api().upload().POST(uploadReq({ file: png(), kind: "merchant" }));
    expect(res.status).toBe(201);
    expect(upstream).toHaveLength(2);
    expect(upstream[1].headers.get("authorization")).toBe("OAuth fresh");
    expect(((upstream[1].body as FormData).get("file") as File).size).toBe(4);
  });
});
