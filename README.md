# react-shopwave-connect

Shopwave API client split into two clearly separated layers:

- **`core`** — framework-agnostic async API functions + all TypeScript types. No React anywhere. Works in any TS/JS project (Node script, Vue, Angular, CLI, …).
- **`hooks`** — thin React wrappers around `core`, with a consistent `{ data, loading, error, refetch }` shape. React is a **peer dependency** and is never bundled.
- **`server` / `next`** — the other half of the contract: OAuth login and the `/api/*` route handlers that `core` calls, so an app's API routes are one line each.

```
browser / Node ──core──▶ your app's /api/<route> ──next route handlers──▶ Shopwave API
                         (session cookie or Authorization: OAuth <token>)
```

```
src/
  core/    index.ts + one file per domain (category, consumer, employee,
           product, store, report, session, entity, basket) — plus the shared
           request helper (request.ts) and API envelope types (types.ts)
  hooks/   index.ts + one wrapper per domain, all importing logic from core
```

## Install

```bash
npm install react-shopwave-connect
# React is only needed if you use the hooks layer:
npm install react react-dom
```

## Import paths

| Import                               | What you get                                  |
| ------------------------------------ | --------------------------------------------- |
| `react-shopwave-connect/core`         | Framework-agnostic functions + types only     |
| `react-shopwave-connect/hooks`        | React hooks only                              |
| `react-shopwave-connect`              | Both (re-exports `core` + `hooks`)            |
| `react-shopwave-connect/server`       | **Server-only.** Framework-agnostic Shopwave OAuth client + token helpers |
| `react-shopwave-connect/next`         | **Server-only.** Next.js login/callback/logout/session handlers, token refresh, proxy guard, and the `/api/*` route handlers (`createShopwaveApi`) |

Prefer the subpath imports when you want a hard boundary — e.g. a Node service should import from `/core` so React never enters the dependency graph.

## Configuration (`RequestOptions`)

Every `core` function (and every hook) accepts an optional `options` argument:

```ts
interface RequestOptions {
  baseUrl?: string;        // prefix for every path; omit in the browser to use
                           // relative URLs like "/api/products"
  token?: string;          // sent as `Authorization: OAuth <token>` on every
                           // request (GET, POST, PUT, DELETE alike)
  fetch?: typeof fetch;    // custom fetch (Node < 18, tests, interceptors)
  signal?: AbortSignal;    // cancellation (hooks pass this automatically)
}
```

In the browser / Next.js you can usually omit `options` entirely (relative URLs resolve against the current origin, and the app's routes use the session cookie). Outside the browser, pass the absolute `baseUrl` of an app that mounts the SDK routes (see [API routes](#4-api-routes-nextjs)) and a `token`.

`core` always calls `/api/<route>` paths with the request metadata in an `extras` header, so `baseUrl` must point at such an app, not at the Shopwave API itself.

> **0.3 change:** the token used to travel in `extras.token` for reads and a separate `token` header for writes. It is now always the `Authorization` header. The 0.3 route handlers still accept both old forms, so older clients keep working.

---

## 1. Using `core` standalone (no React)

Plain async functions — usable in a Node script, CLI, Vue, Angular, a server route, etc.

```ts
import {
  fetchProducts,
  fetchStores,
  fetchReport,
  type Product,
} from "react-shopwave-connect/core";

const options = {
  baseUrl: "https://admin.example.com", // an app with the SDK's /api routes
  token: process.env.SHOPWAVE_TOKEN,    // bare access token
};

async function main() {
  const stores = await fetchStores({}, options);
  console.log(`${stores.length} stores`);

  const products: Product[] = await fetchProducts(
    { storeId: stores[0].id },
    options
  );
  console.log(products.map((p) => p.name));

  const reports = await fetchReport(
    { sales: { FROM: "Basket", WHERE: { AND: ["Basket.status = 'completed'"] } } },
    options
  );
  console.log(reports.sales?.data.length, "rows");
}

main().catch(console.error);
```

On Node < 18 (no global `fetch`), inject one:

```ts
import { fetchStores } from "react-shopwave-connect/core";
import fetch from "node-fetch";

await fetchStores({}, { baseUrl: "https://admin.example.com", token, fetch });
```

Functions **throw** `ShopwaveApiError` on failure:

```ts
import { saveProduct, ShopwaveApiError } from "react-shopwave-connect/core";

try {
  await saveProduct({ name: "Tea", barcode: "123" });
} catch (e) {
  if (e instanceof ShopwaveApiError) {
    e.status;          // HTTP status (0 = no response). 200/201 when the API answered with errors.
    e.errors;          // api.message.errors, e.g. { 908: { id: 908, title: … } }
    e.isUnauthorized;  // 401 or error 908 → send the user to log in
  }
}
```

The SDK never logs requests (older versions `console.log`ged headers, including tokens).

### Saving and deleting (typed)

Each entity has `save…`, `delete…` and `fetch…(id)`:

```ts
import { saveCategory, deleteCategory, fetchCategory } from "react-shopwave-connect/core";

const created = await saveCategory({ title: "Drinks", parentId: null }); // no id → create
created.id;                                                              // the new id, straight from the save

const updated = await saveCategory({ id: created.id, title: "Hot drinks" }); // id → update

await fetchCategory(created.id);                     // Category | null
await fetchCategory(created.id, { deleted: true });  // include soft-deleted

await deleteCategory(created.id);
```

| Entity    | Save / delete / read one                                  | App routes                    |
| --------- | --------------------------------------------------------- | ----------------------------- |
| product   | `saveProduct`, `deleteProduct`, `fetchProduct`             | `/api/products[/:id]`         |
| category  | `saveCategory`, `deleteCategory`, `fetchCategory`          | `/api/categories[/:id]`       |
| store     | `saveStore`, `deleteStore`, `fetchStore`                   | `/api/stores[/:id]`           |
| promotion | `savePromotion`, `deletePromotion` (ends it), `fetchPromotion` | `/api/promotions[/:id]`       |
| employee  | `saveEmployee`, `deleteEmployee` (retires), `fetchEmployee` | `/api/employees[/:id]`        |
| consumer  | `fetchConsumer` only — read-only in the API                | `/api/consumer[/:id]` (GET)   |

How they behave (matches what the Shopwave API does):

- **Save** sends `{ <collection>: { "0": entity } }`. Shopwave upserts (an `id` means update), answers **201** and echoes the entity under the same ref with its `id` and server fields. The function checks `api.message.errors` and that the ref came back, and returns the saved entity (fields the echo leaves out are kept from your input). `saveEntities(kind, [a, b])` saves several at once and matches results back by ref.
- **Delete** is a soft delete (read it back with `deleted: true`). Shopwave answers **205 with an empty body — also for ids that don't exist**, so a resolved promise means "accepted", not "a record was deleted".
- **Read one** calls `GET /api/<route>/:id` and returns the record or `null`. List reads return `[]` when nothing matches (Shopwave answers with an empty body).
- **Promotions:** Shopwave has no promotion DELETE; `deletePromotion` (and `DELETE /api/promotions/:id`) ends the promotion by setting `endDate` to now.
- **Employees:** Shopwave has no employee DELETE, so `deleteEmployee` (and `DELETE /api/employees/:id`) retires the employee by setting `exitDate`. Updating an existing employee only changes `roleId`, `joinedDate` and `exitDate` — names and email are fixed — and the echo carries only those fields, so re-read with `fetchEmployee` if you need the stored record.
- **Consumers** are read-only (`GET /consumer` by `ids`); their write/delete routes answer 405.
- Errors are read from `api.message.errors` and also `api.message.error` (the name used in the [API reference](https://developer.merchantstack.com/api-reference.html)).

The generic forms are `saveEntity(kind, item)`, `deleteEntityById(kind, id)` and `fetchEntityById(kind, id)`; `SHOPWAVE_ENTITIES` lists each entity's route, collection key, Shopwave path and id headers.

### Merchant, current user and image uploads

The merchant and the logged-in user are single records (one per login), and images go to the Shopwave CDN:

```ts
import {
  fetchMerchant, updateMerchant, fetchUser,
  uploadMerchantImage, setMerchantImage, getMerchantImageUrl,
  merchantLinksToForm, merchantLinksFromForm,
} from "react-shopwave-connect/core";

const merchant = await fetchMerchant();          // Merchant | null
const user = await fetchUser();                  // User | null  ({ id, firstName, lastName, email, employee })

// Reads the merchant, merges the patch over it and saves the record, so
// fields you don't mention (companyNumber, vatNumber, links, …) are kept.
// Returns the merchant as stored (read back after the save).
await updateMerchant({ vatNumber: "123456789", links: merchantLinksFromForm({ website: "https://example.com" }) });

// Images: fit to the slot's size, upload with the slot's kind, then save the file name.
const image = await uploadMerchantImage(file, "square");          // { id, url, path }
await updateMerchant({ imageIds: setMerchantImage(merchant?.imageIds, "square", image.id) });
getMerchantImageUrl(saved.imageIds, "square");                     // HTTPS URL for <img src>
```

The shapes below are the ones adminV1 saves and adminV2 reads, so all three admins share one record (confirmed on the live API with merchant 5644, 30 Sep 2026):

| Field | Shape |
|---|---|
| `imageIds` | `{ logo: { receipt, square }, feature: [ … ] }` — **file names** on write (the uploader's `fileName`), **full `http://static.merchantstack.com/…` URLs** on read |
| `colours` | `{ primary: { main, highlight, contrast } }` (hex strings; adminV2 uses `primary.main` behind the logo) |
| `links` | `{ website: { home }, social: { twitter, facebook, instagram } }` |

- **Merchant fields** (`GET`/`POST /merchant`): `id`, `name`, `description`, `companyNumber`, `vatNumber`, `categoryId`, `estAnnualRevenue`, `note`, and the three objects above. The API returns `{}` for an empty object.
- **What the live API does on `POST /merchant`** (checked 30 Sep 2026): it replaces the record. A scalar field left out (`companyNumber`, `vatNumber`, `note`, …) becomes `null`; an object field left out (`colours`, `links`, `imageIds`) is kept, and one that is sent replaces the stored one (`{}` clears it). It answers **205 with an empty body**. It silently cuts `companyNumber` to 11 characters and `vatNumber` to 9 (a UK VAT number without `GB`).
- **`updateMerchant(patch, { merge })`**: `merge` (default `true`) reads first and merges the scalar fields, so nothing is wiped. Object fields (`MERCHANT_OBJECT_FIELDS`) are sent only when the patch has them, and then replace the stored one — to change one image, pass the whole `imageIds` (`setMerchantImage` does that). `imageIds` is always sent as file names (`toStoredImageIds`), so you can pass back what you read. It refuses a different merchant `id`, never sends `createdDate`/`modifiedDate`, rejects values longer than `MERCHANT_FIELD_MAX_LENGTH` (`validateMerchant(m)` lists them) instead of letting the API cut them, and returns the merchant **read back after the save**, so you see exactly what was kept. `merge: false` sends only the patch (which must include `id`, and clears the scalar fields you leave out).
- **Merchant image slots** (`MERCHANT_IMAGE_SLOTS`): the API doesn't resize, and adminV1 accepts only these exact sizes.

  | Slot | Stored at | Upload kind | Size |
  |---|---|---|---|
  | `receipt` | `imageIds.logo.receipt` | `merchant` | 576 × 325 |
  | `square` | `imageIds.logo.square` | `merchant` | 1000 × 1000 |
  | `featured` | `imageIds.feature[0]` | `merchantFeature` | 1200 × 600 |

  The API builds each image URL from its key, not from where the file was uploaded (`logo.*` → `…/merchant/<id>/logo/<file>`, `feature` → `…/feature/<file>`), so the featured image must be uploaded as `merchantFeature`. `POST /merchant` stores all three objects with the SDK's `{ merchant: … }` body; adminV1's `{ merchants: { "0": … } }` form isn't needed.

  `uploadMerchantImage(file, slot, { fit = true })` scales and centre-crops the image to the slot's size in the browser (`fitImageToSize`, `coverCrop`) and uploads it with the slot's kind; `fit: false` sends the file as-is. `getMerchantImage` / `getMerchantImageUrl` / `setMerchantImage` read and write a slot; `imageFileName(url)` gives the file name in a URL. Hook: `useUploadMerchantImage()`.
- **Links:** `merchantLinksToForm(links)` gives flat fields (`website`, `twitter`, `facebook`, `instagram`) from the stored shape, flat keys or the old array form; `merchantLinksFromForm(fields)` builds the stored shape; `normalizeMerchantLinks(links)` converts any of them to the stored shape. Colour keys: `MERCHANT_COLOUR_KEYS`.
- **User** (`GET /user`): the live API returns `id`, `firstName`, `lastName`, `email` and `employee: { merchantId, roleId, stores }` — no `createdDate` and **no `merchant`**, although the reference lists them. There's no option to include it (adminV1 also reads `GET /merchant` separately and attaches it to its session). Read the merchant with `fetchMerchant()`.
- **`uploadImage(file, { kind, fileName? })`** posts the file to `/api/upload`, which `PUT`s it to Shopwave's `/uploader` (multipart `file`, header `contentType: <kind>`). Kinds: `merchant`, `merchantFeature`, `product`, `user`, `applicationLogo`, `applicationImages` (the last two sent as the API's own spelling, `applicaionLogo`/`applicaionImages`). Live: 201 `{ fileName, path }`. Returns `{ id, url, path }`: `id` is the generated file name (what records store), `path` the URL as the API gave it (`http://static.merchantstack.com/images/…`, which has no HTTPS endpoint), and `url` the same file over HTTPS via `getImageUrl(path)` (`SHOPWAVE_IMAGE_BASE_URL`, the S3 bucket behind the CDN). The upload alone changes no record.

`SHOPWAVE_RESOURCES` (merchant, user) and `SHOPWAVE_UPLOAD` are shared with the server routes, like `SHOPWAVE_ENTITIES`.

### Available `core` functions

| Domain    | Function(s)                                              |
| --------- | ------------------------------------------------------- |
| category  | `fetchCategories`, `fetchCategory`, `saveCategory`, `deleteCategory` |
| consumer  | `fetchConsumers`, `fetchConsumer` (read-only)            |
| employee  | `fetchEmployees`, `fetchEmployee`, `saveEmployee`, `deleteEmployee` |
| product   | `fetchProducts`, `fetchProductsMap` (batched, keyed), `fetchProduct`, `saveProduct`, `deleteProduct` |
| promotion | `fetchPromotions`, `fetchPromotion`, `savePromotion`, `deletePromotion` |
| store     | `fetchStores` (now with `storeIds`), `fetchStore`, `saveStore`, `deleteStore` |
| report    | `fetchReport`                                           |
| merchant  | `fetchMerchant`, `updateMerchant`, `validateMerchant`; links `merchantLinksToForm`, `merchantLinksFromForm`, `normalizeMerchantLinks`; images `MERCHANT_IMAGE_SLOTS`, `uploadMerchantImage`, `getMerchantImage`, `getMerchantImageUrl`, `setMerchantImage`, `toStoredImageIds`, `imageFileName` |
| user      | `fetchUser`                                              |
| upload    | `uploadImage`, `getImageUrl`, `fitImageToSize`, `readImageSize`, `coverCrop` |
| session   | `fetchSession`, `loginPath`, `logoutPath`, `logout`     |
| entity    | `saveEntity`, `saveEntities`, `deleteEntityById`, `fetchEntityById`; low-level `submitEntity` / `deleteEntity` (raw endpoint) |
| errors    | `ShopwaveApiError`, `getApiErrorMap`, `assertNoApiErrors` |
| basket    | `buildBasketReportQuery`, `parseBasketReportData`, `combineBasketRows`, `computeBasketSummary`, … (pure transforms) |

All types/interfaces (`Product`, `Store`, `Category`, `Consumer`, `Employee`, `Merchant`, `User`, `UploadedImage`, `ReportQueryMap`, `Basket*`, `apiResponse`, …) are exported from `core` too.

---

## 2. Using `hooks` in React / Next.js

Every auto-fetching hook returns the same shape:

```ts
{ data, loading, fetching, error, errorStatus, refetch }
```

- `loading` is true only while there's nothing to show yet (first load, or the params changed).
- `refetch()` keeps the current `data` on screen until the new data arrives (`fetching` is true meanwhile), so lists don't flash a skeleton after every save. A failed refetch keeps the old data and sets `error`.
- `errorStatus` is the HTTP status of the last error.

```tsx
"use client";
import { useProduct, useStore } from "react-shopwave-connect/hooks";

export function ProductList({ storeId }: { storeId: number }) {
  const { data: products, loading, error, refetch } = useProduct({ storeId });

  if (loading) return <p>Loading…</p>;
  if (error) return <p>Error: {error}</p>;

  return (
    <>
      <button onClick={refetch}>Reload</button>
      <ul>{products?.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
    </>
  );
}
```

In the browser you don't need `baseUrl` — relative `/api/...` URLs work. To target another host or pass a token, give every hook the same optional second argument:

```tsx
const { data } = useProduct({ storeId }, { baseUrl: "https://api.merchantstack.com", token });
```

### Auto-fetch hooks (`useEffect`-based)

`useCategory`, `useConsumer`, `useEmployee`, `useProduct`, `usePromotion`, `useStore`, `useReport`, `useSession`, `useMerchant`, `useUser` (`useUser({ enabled: false })` stays idle).
They fetch on mount and re-run when their arguments change. `useConsumer` and `useReport` stay idle until you pass ids / a query (they return `loading: false`, `data: null` until then). `refetch()` replaces the old `reloadFlag` argument.

### Manually-triggered hooks (`useCallback`-based)

For saves and deletes, prefer calling the typed `core` functions (`saveProduct`, `deleteStore`, …) from your event handlers — they return the saved entity with its id.

`useUpdateMerchant`, `useUploadImage`, `useUploadMerchantImage`, `useDelete`, `useSubmit`, `useLogout` return `{ mutate, data, loading, error, errorStatus }` — nothing fires until you call `mutate`:

```tsx
import { useDelete, useSubmit } from "react-shopwave-connect/hooks";

const { mutate: remove, loading } = useDelete();
await remove("products", productId);

const { mutate: save } = useSubmit<Product>();
const saved = await save({
  endpoint: id ? `/api/products/${id}` : "/api/products",
  method: id ? "PUT" : "POST",
  payload,
});
```

> The original `useHandleDelete` / `useHandleSubmit` also showed notistack toasts and did validation/payload transforms. Those are app concerns and are intentionally left out of the package — drive them from the returned state or the value `mutate` resolves to.

### Composite hook

`useBasketReport(options?)` orchestrates the report → consumers → products pipeline and returns rows, summary, filters, pagination and a `refresh()`. All of its data-shaping logic lives in `core/basket` (pure, testable functions); the hook is just the React glue.

---

## 3. Authentication (Shopwave OAuth)

Login is the same for every Shopwave app; only the **config** differs (client id/secret, redirect URL, session secret). The Shopwave auth server uses the authorization-code flow **with a client secret** (no PKCE), so the exchange must happen on a server — the browser only follows redirects and never sees a token.

```
browser ──/auth?returnTo=/products──▶ your app ──302──▶ {authServer}/login?…&state=…
        ◀──────────── user signs in on Shopwave ─────────────┘
browser ──/auth?code=…&state=…──▶ your app ──POST /oauth/token (secret)──▶ auth server
        ◀──302 /products + encrypted httpOnly cookie (tokens stay server-side)
```

What the SDK handles for you:

- `state` check (login-CSRF protection) and a safe `returnTo` (same-origin paths only).
- One callback URL per app: `returnTo` rides along in the session, so tools/sub-sections don't need their own redirect URIs.
- Tokens stored as `{ accessToken, refreshToken, tokenType, expiresAt }` in an **iron-session** cookie (httpOnly, SameSite=Lax, Secure in production).
- Refresh when the access token has expired (Shopwave issues a new one only after expiry; the refresh token is not rotated), de-duplicated across concurrent requests. A rejected refresh token logs the user out.
- `GET /api/session` returns `{ loggedIn, expiresAt }` — **never tokens**.
- Sessions written by older apps (raw `{ access_token, refresh_token, … }` in `session.token`) keep working.

### Next.js (App Router) setup

Install the peer dependencies once: `npm install react-shopwave-connect iron-session`.

**1. One config file per app**

```ts
// lib/auth.ts
import { createShopwaveAuth } from "react-shopwave-connect/next";

export const auth = createShopwaveAuth({
  authServerUrl: process.env.SHOPWAVE_AUTH_SERVER_URL!, // e.g. https://secure.merchantstack.com
  clientId:      process.env.SHOPWAVE_CLIENT_ID!,
  clientSecret:  process.env.SHOPWAVE_CLIENT_SECRET!,
  redirectUri:   process.env.SHOPWAVE_REDIRECT_URL!,    // e.g. https://admin.example.com/auth (registered on the auth server)
  session: {
    password:   process.env.SESSION_SECRET!,            // ≥ 32 random chars
    cookieName: "shopwave_session_cookie",              // keep your existing name to keep users logged in
  },
  // authPath: "/auth", logoutPath: "/auth/logout", sessionPath: "/api/session",
  // defaultReturnTo: "/", requireState: true, refreshSkewSeconds: 0,
});
```

Config is validated on first use, so a missing env var doesn't break `next build`.

**2. Three route files**

```ts
// app/auth/route.ts          — the redirect-URI path: starts login AND receives the callback
import { auth } from "@/lib/auth";
export const GET = auth.handlers.auth;

// app/auth/logout/route.ts   — clears the session, then logs out of the auth server
import { auth } from "@/lib/auth";
export const GET = auth.handlers.logout;

// app/api/session/route.ts   — { loggedIn, expiresAt } for the browser; DELETE ends the session
import { auth } from "@/lib/auth";
export const { GET, DELETE } = auth.handlers.session;
```

**3. Protect pages and APIs** (`proxy.ts` in Next 16, `middleware.ts` before that)

```ts
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  return (await auth.protect(request, { publicPaths: ["/tools/tag-joiner"] })) ?? NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

Logged-out page requests are redirected to `/auth?returnTo=<page>`; paths under `/api` get a `401` JSON instead. The auth, logout and session paths are always public. `protect` only reads the cookie — it never calls the auth server.

**4. Use the token in route handlers**

```ts
import { auth } from "@/lib/auth";
import { isExpiredTokenResponse } from "react-shopwave-connect/next";

export const GET = auth.withAuth(async (request, context, { authorization }) => {
  const call = (header: string) =>
    fetch(`${process.env.SHOPWAVE_API_SERVER_URL}/product`, {
      headers: { Authorization: header, "x-accept-version": "2.0" },
    });

  let res = await call(authorization);
  let body = await res.json();

  // Clock said valid but the API says expired (HTTP 401 / API error 908): refresh once and retry.
  if (isExpiredTokenResponse(res.status, body)) {
    const fresh = await auth.getAuthorizationHeader({ forceRefresh: true });
    if (!fresh) return Response.json({ error: "unauthorized" }, { status: 401 });
    res = await call(fresh);
    body = await res.json();
  }
  return Response.json(body, { status: res.status });
});
```

Also available: `auth.getAccessToken()`, `auth.getAuthorizationHeader()`, `auth.getToken()`, `auth.getStatus()`, `auth.loginPath(returnTo)`, `auth.logoutPath`, `auth.isAuthenticated(request)`. Refreshed tokens are saved automatically from route handlers, server actions and proxy (Server Components can read tokens but can't write cookies).

**5. In the browser**

```tsx
"use client";
import { useSession, loginPath, logoutPath } from "react-shopwave-connect";

export function AccountButton() {
  const { data: session, loading } = useSession();
  if (loading) return null;
  return session?.loggedIn
    ? <a href={logoutPath()}>Log out</a>
    : <a href={loginPath(window.location.pathname)}>Log in</a>;
}
```

Use plain links / `window.location` for login and logout — they are full-page redirects to the auth server, not client-side navigations.

### 4. API routes (Next.js)

`core` calls `/api/<route>` on your app. `createShopwaveApi` provides those routes, using the session from step 1:

```ts
// lib/shopwave.ts
import { createShopwaveApi } from "react-shopwave-connect/next";
import { auth } from "@/lib/auth";

export const shopwave = createShopwaveApi({ auth, apiUrl: process.env.SHOPWAVE_API_SERVER_URL! });
```

```ts
// app/api/products/route.ts       — list/filter, create/update
import { shopwave } from "@/lib/shopwave";
export const { GET, POST, PUT } = shopwave.collection("product");

// app/api/products/[id]/route.ts  — read one, update, delete
import { shopwave } from "@/lib/shopwave";
export const { GET, PUT, DELETE } = shopwave.item("product");

// app/api/report/route.ts         — any other Shopwave path, read-only
import { shopwave } from "@/lib/shopwave";
export const { GET } = shopwave.passthrough("report");

// app/api/merchant/route.ts       — read / update the merchant
export const { GET, PUT } = shopwave.resource("merchant");

// app/api/user/route.ts           — the logged-in user (read-only)
export const { GET } = shopwave.resource("user");

// app/api/upload/route.ts         — image upload (uploadImage)
export const { POST } = shopwave.upload();              // or upload({ maxBytes, accept })
```

- `resource("merchant")`: `PUT`/`POST` take `{ merchant: {…} }` or the bare object and send every field on as `postBody`. The `id` is required (400 without it), because a POST without one would create a second merchant. `resource("user")` answers 405 to writes.
- `upload()`: takes multipart `file` + `kind`, checks the size (default 10 MB → 413) and type (default `image/*` → 415), and `PUT`s only the file to `/uploader` with the `contentType` header. `extras` are ignored on uploads. Shopwave's reply (201 `{ fileName, path }`) is passed through.

Entities: `product`, `category`, `store`, `promotion`, `employee` (DELETE retires via `exitDate`), `promotion` (DELETE ends it via `endDate`), `consumer` (mounted at `/api/consumer`; GET only, writes answer 405). For anything else, `shopwave.forward(request, { method, path, headers, postBody })` does the same token/refresh/encoding work for a custom handler.

Every handler:

- uses the caller's `Authorization: OAuth <token>` when present (also the legacy `token` header / `extras.token`), otherwise the logged-in user's token; `401` when there's neither. Turn caller tokens off with `allowRequestToken: false`.
- turns the `extras` JSON header into upstream headers, dropping `Authorization`, `token`, `Cookie`, `Host`, `x-accept-version` and other transport headers; `400` if it isn't a JSON object.
- sends writes as the form field `postBody=<JSON>`, accepting the SDK shape `{ products: { "0": {…} } }`, the older `{ products: { new | updated: {…} } }`, or a bare entity. Item `PUT` forces the id from the URL.
- on HTTP 401 or API error 908 with the session token, refreshes once and retries.
- answers with Shopwave's own status and body (201 + echo for saves, 205 + empty body for deletes, error envelopes as-is); `502` if the API can't be reached. Only the method and path are ever logged.

For calls that bring their own token (scripts, the integration tests), let them past the proxy guard:

```ts
await auth.protect(request, { publicPaths: [...], allowRequestToken: true });
```

Options: `apiVersion` (default `"2.0"`), `fetch`, `entities` (override a route/header, e.g. `{ employee: { idHeader: "userId" } }`), `blockedExtras`, `onError`.

### Other frameworks

`react-shopwave-connect/server` has the same building blocks without Next.js: `createShopwaveOAuth(config)` → `buildLoginUrl({ state })`, `exchangeCode(code)`, `refreshToken(token)`, `buildLogoutUrl()`, plus `createState`, `sanitizeReturnTo`, `isTokenExpired`, `isExpiredTokenResponse` and `authorizationHeader`. The API routes are `createShopwaveApiHandlers({ apiUrl, getAuthorization })` — plain `Request → Response` handlers, the same ones `createShopwaveApi` wraps. Store the token in your framework's session (Express `express-session`, iron-session's `getIronSession(req, res)`, …).

### Moving an existing app over

- Keep `redirectUri` equal to the URL already registered on the auth server (AdminUI: `…/auth`) and mount `handlers.auth` at that path.
- Keep `cookieName` the same and use the same `SESSION_SECRET` value as the old iron-session password — current users stay logged in; their old token shape is read and upgraded on the next refresh.
- Per-tool auth routes can go: link to `auth.loginPath("/tools/where-to-next")` instead.
- `core.logout()` / `useLogout()` still work (`DELETE /api/session`), but prefer linking to `logoutPath()` so the auth-server session ends too.

---

## Build

Built with [`tsdown`](https://tsdown.dev) into dual ESM + CJS with `.d.ts` types, via separate entries: `core` (no externals), `hooks` (`react`/`react-dom` external), `server` (no externals) and `next` (`next`/`iron-session` external — optional peer dependencies). `server` and `next` are never re-exported from the root entry, so they can't end up in client bundles.

```bash
npm run build       # emit dist/
npm run typecheck   # tsc --noEmit
```

---

## Testing

Unit tests (offline, no credentials) cover the OAuth client, token handling, the Next.js handlers (with an in-memory cookie store), the session client, the request layer (token header, errors, no logging), the typed save/delete/read functions, the API route handlers (extras filtering, refresh-and-retry, body normalisation, 205 pass-through) and the hooks' query state:

```bash
npm test            # = npm run test:unit
```

Integration tests use [Vitest](https://vitest.dev) and run against **an app that mounts the SDK routes** (e.g. AdminUI on `npm run dev`), which forwards to the Shopwave API. They cover create → read (by id and by filter) → update → delete with the typed functions for Products and Categories, create → read → role update → retire for Employees, read-only checks for Consumers, plus unknown ids and the legacy `submitEntity` body. They create and delete real records on the account behind the token.

### Environment Variables

| Variable    | Description                          | Example                                   |
|-------------|--------------------------------------|-------------------------------------------|
| `API_URL`   | Origin of the app with the SDK routes | `http://localhost:3000`                  |
| `API_TOKEN` | Bare Shopwave access token (no `OAuth`/`Bearer` prefix) | `111ad…`                |

### Running Tests

```bash
# Set environment variables
# with the app running (AdminUI: npm run dev)
export API_URL=http://localhost:3000
export API_TOKEN=<bare access token>

# Run all integration tests
npm run test:integration

# Run unit tests
npm test
```

### Test Structure

```
tests/
  unit/
    server.test.ts                 # OAuth client, tokens, returnTo/state
    next.test.ts                   # Next.js handlers, refresh, proxy guard
    session-client.test.ts         # fetchSession / loginPath / logoutPath
    request.test.ts                # token header, ShopwaveApiError, no logging
    entities.test.ts               # save/delete/fetch-by-id per entity
    api-routes.test.ts             # /api route handlers
    query-state.test.ts            # useQuery keeps data while refetching
  integration/
    setup.ts                       # Shared config and helpers
    products.integration.test.ts   # Products CRUD lifecycle
    categories.integration.test.ts # Categories CRUD lifecycle
    consumers.integration.test.ts  # Consumers CRUD lifecycle
    employees.integration.test.ts  # Employees CRUD lifecycle
```

Each test file uses `describe.sequential` to guarantee execution order (create → read → update → delete) with shared state across tests. An `afterAll` cleanup ensures created resources are deleted even if a test fails midway.
