# Architecture

How `react-shopwave-connect` is built, and the rules for changing it. This page is for people
working on the SDK; app developers start with the [README](../README.md).

What the live Shopwave API actually does, where it differs from the
[API reference](https://developer.merchantstack.com/api-reference.html), is recorded in JSDoc
next to the code that depends on it (the contract tables and the typed functions). Read those
comments before changing a call.

---

## 1. Layers

| Import path | Source | Runs in | Holds |
|---|---|---|---|
| `react-shopwave-connect/core` | `src/core/` | Anywhere | Fetch and save functions, types, errors, normalisers and the contract tables. No React. |
| `react-shopwave-connect/hooks` | `src/hooks/` | React | Thin hooks over `core`. |
| `react-shopwave-connect/server` | `src/server/` | Server | OAuth client, token helpers and the route handlers (`createShopwaveApiHandlers`). Web `Request` → `Response`, no framework. |
| `react-shopwave-connect/next` | `src/next/` | Server (Next.js) | Session cookie, auth routes, proxy guard and `createShopwaveApi`, which gives the `server` handlers the session token. |
| `react-shopwave-connect` | `src/index.ts` | Browser | `core` + `hooks` only, so server code can't reach a client bundle. |

```
hooks ──► core ◄── server ◄── next
```

- `core` imports nothing from the other layers.
- `server` imports only the contract tables from `core` (`entities.ts`, `resources.ts`).
- `next` imports `server`, plus the session types from `core`.
- `react`, `react-dom`, `next` and `iron-session` are optional peer dependencies, external in
  `tsdown.config.ts` (one build entry per import path, ESM + CJS + `.d.ts`).

## 2. Request flow

The browser never calls Shopwave. `core` functions call the app's own `/api/<route>`; the
`server` handlers mounted there add the token and forward the call.

```
fetchProductTags()  ──►  GET /api/products/tags  ──►  forward()  ──►  GET {apiUrl}/product/tags
     normalizeTagList ◄──  status and body unchanged  ◄─────────────────  { tags: [...] }
```

`forward()` in `src/server/api.ts` is the only code that talks to Shopwave. For every call it:

1. uses the caller's `Authorization: OAuth <token>` when `allowRequestToken` is on (the
   default), otherwise the session's token;
2. turns the `extras` header into upstream headers, minus `BLOCKED_EXTRAS`;
3. sends writes as the form field `postBody=<JSON>`;
4. on HTTP 401 or API error 908 with the session token, refreshes once and retries (a token
   the caller sent is the caller's to refresh);
5. answers with the upstream status and body unchanged: 201 for saves, 205 and no body for
   deletes, and Shopwave's error envelopes as they are, including errors inside a 2xx. That is
   why `core` interprets every response (`assertNoApiErrors`, normalising, typed results).

### What the handlers answer themselves

Only these, each with a `{ error, message }` body. Don't add one without adding it here.

| Status | `error` | When |
|---|---|---|
| 400 | `invalid_extras`, `invalid_body`, `invalid_id` | Bad `extras` header (incl. an unusable child-id list on a delete), write body (incl. an upload's kind or prefix) or route id |
| 401 | `unauthorized` | No token, or the session expired and the refresh gave none |
| 404 | `not_found` | A promotion to expire doesn't exist |
| 405 | `method_not_allowed` | A write to a read-only entity or resource; a delete where `deleteMode` is `"none"` |
| 413, 415 | `too_large`, `unsupported_type` | Uploads |
| 502 | `auth_unavailable` | Getting the session token threw |
| 502 | `upstream_unavailable` | The upstream call threw |
| 502 | `invalid_upstream` | The promotion read for an expiry wasn't JSON |

An app can pass its own `fetch`. A `Response` it **returns** passes through like any upstream
answer; anything it **throws** becomes 502 `upstream_unavailable`. Apps rely on this (a
`fetch` that returns 504 `upstream_timeout` after 20 seconds, say), so never rewrite a returned response.

## 3. Contract tables

Each endpoint is one row in a frozen table in `core`. The client builds `/api/<route>` from
the row and reads the response key from it; the server forwards to `upstream`. A route or
path is never typed twice, so the two halves can't drift apart.

```ts
// src/core/resources.ts
productTags: { route: "products/tags", key: "tags", upstream: "product/tags" },
```

- One table per kind, typed by a string-literal union (`LookupKind`), wrapped in `Object.freeze`.
- Every field of a definition interface has a one-line JSDoc, and the table's JSDoc names the
  Shopwave call, its shape and any live finding.
- Anything that takes a kind throws on an unknown one:
  `` throw new Error(`Unknown Shopwave lookup "${kind}"`) ``.
- Runtime guards use `Object.prototype.hasOwnProperty.call(TABLE, value)` (`isUploadKind`).

## 4. Endpoint kinds

Grouped by what the Shopwave API returns, because that decides how a call is read, written
and routed.

| Kind | Table | Server factory | Shopwave answers | Methods |
|---|---|---|---|---|
| Entity | `SHOPWAVE_ENTITIES` | `collection(kind)`, `item(kind)` | A map by id: `{ products: { "12": {…} } }` | GET, POST/PUT, DELETE |
| Resource | `SHOPWAVE_RESOURCES` | `resource(kind)` | One object: `{ merchant: {…} }` | GET; PUT/POST when writable |
| Lookup | `SHOPWAVE_LOOKUPS` | `lookup(kind)` | A list of values: `{ tags: [...] }` | GET |
| Upload | `SHOPWAVE_UPLOAD`, `UPLOAD_KINDS`, `UPLOAD_PREFIXES` | `upload(options)` | `{ fileName, path }` | POST → `PUT /uploader` |
| Passthrough | none | `passthrough(path)` | Anything | GET |
| Custom | none | `forward(request, init)` | Anything | Any |

**Entity** (`entities.ts`): `product`, `category`, `store`, `promotion`, `employee`, `consumer`, `productComponent`.

- Rows carry `route`, `collection`, `upstream`, `idsHeader` (filters reads), `idHeader`
  (names the record to delete), `writable` and `deleteMode`.
- Writes are upserts, `{ <collection>: { "0": item } }`: with an `id` they update, without one
  they create. Shopwave echoes each item under the ref it was sent with.
- `childIdsHeader` (optional, `deleteMode: "delete"` only) names child records a delete can
  target instead of the whole record (`productComponent`: `productComponentInstanceIds`, its
  option rows). `item()` DELETE forwards that one key from `extras`, checked as a non-empty
  list of ids (400 `invalid_extras` otherwise, never a fall-back to deleting the record);
  every other `extras` key is still dropped.
- `deleteMode`: `"delete"` sends `DELETE` (205). `"retire"` is for entities the API can't
  delete: it sets `retireField` to now (`employee.exitDate`, `promotion.endDate`). With
  `retireWithRecord`, the whole record is read and saved back, because the API rejects a
  partial promotion save (error 899). `"none"` answers 405.
- `collection(kind)` serves GET (filtered through `extras`), POST and PUT; `item(kind)` serves
  GET, PUT and DELETE by `[id]`. Apps can override addressing with `ShopwaveApiConfig.entities`.

**Resource** (`resources.ts`): `merchant` (writable) and `user` (read-only), one per signed-in
user. A write must carry the record's `id`, or Shopwave would create a second record, so the
route answers 400 without one. Writes to `user` answer 405.

**Lookup** (`resources.ts`): `productTags` and `productInstanceTags`, read-only lists of values
with no parameters, so `extras` aren't forwarded. Their routes are static segments beside
`products/[id]`. `core` returns trimmed, de-duplicated strings, and `[]` for an empty body.

**Upload**: multipart `file` + `kind` to `POST /api/upload`, then `PUT {apiUrl}/uploader` with
the `contentType` header from `UPLOAD_KINDS`, which maps correct spellings to the API's
misspelt values (`applicationLogo` → `applicaionLogo`). The defaults are 10 MB and `image/*`.
An optional `prefix` field (the image's role, `UPLOAD_PREFIXES`) goes upstream as the `prefix`
header; anything outside the table is 400 `invalid_body`, so a caller can't steer the header.

**Passthrough and `forward`**: `passthrough(path)` proxies one GET path with no table row
(`report`). `forward` is the building block for a handler none of the factories fit.

### Choosing a kind

1. Records keyed by id, filtered by id, maybe writable → **entity**.
2. Exactly one per signed-in user, no id in the URL → **resource**.
3. A read-only list of values with no parameters → **lookup**.
4. A file upload → a new **upload** kind.
5. A one-off read with its own parameters (reports, aggregates) → **passthrough** with a typed
   `core` function.
6. Anything else → a custom handler on **`forward`**.

Add a new kind (a new table and factory) only when more endpoints of that shape are expected.

## 5. Adding an endpoint

1. Pick the kind (above).
2. **Contract:** add the kind to its union and a row to its table. Document the Shopwave call,
   its shape and any live finding in the table's JSDoc.
3. **Core:** add the typed function in the domain file. Call `assertNoApiErrors`, normalise the
   result, and export it from `src/core/index.ts`.
4. **Server:** usually nothing, since the factory reads the new row. A new kind needs a factory
   on `ShopwaveApiHandlers`.
5. **Hook:** add `use<Thing>` in `src/hooks/` and export it from `src/hooks/index.ts`.
6. **Exports:** add new tables and types to `src/server/index.ts` and `src/next/index.ts`.
7. **Tests:** one unit test file for both halves (see `tests/unit/product-tags.test.ts`).
8. **README:** the route-file line, and the function and hook names.
9. **Check:** `npm run typecheck && npm test && npm run build`.

## 6. Code rules

**Errors**

- `core` throws `ShopwaveApiError` (`status`, `errors`, `body`) for every failure: HTTP errors,
  an unreachable API (`status` 0) and 2xx bodies carrying `api.message.errors`.
- Call `assertNoApiErrors(body, status)` after every request, because Shopwave reports many
  errors inside a 2xx.
- Branch on `status` or `isUnauthorized`, never on the message.
- Abort errors are re-thrown untouched, so hooks can ignore them.

**Normalising**

- Lists come back as `[]`, never `null`.
- Saved entities always have a numeric `id` (`Saved<T>`).
- Normalisers are exported pure functions that accept `unknown` and tolerate other shapes the
  API might send.

**Hooks**

- A hook calls one `core` function and holds no request logic.
- Queries use `useQuery(fetcher, deps, enabled?)` and pass the `signal` through. Mutations use
  `useMutation`, whose `mutate` resolves to the result, or `null` on error.
- `deps` are the request inputs (`options?.baseUrl`, `options?.token`, …).
- A hook that may need to wait takes `enabled` (default `true`).
- Each hook file has a named export and a default export.
- Exception: `useBasketReport` runs its own effect around `fetchProductsMap`. Don't copy it;
  move it onto `useQuery` when it next changes.

**Server**

- Handlers are built only through the factories, and all of them go through `forward()`.
- `forwardExtras: false` for anything the caller mustn't steer: deletes, retires, uploads
  and lookups.
- Route params are checked against `ID_PATTERN` before they go into upstream headers.
- Dates written upstream are UTC `YYYY-MM-DD HH:mm:ss` (`shopwaveDateTime()`).

**Logging**

- `core` never logs.
- The server's only output is the default `onError` (method, path and the error's message,
  never headers, tokens or bodies), the code-exchange failure in the sign-in callback, and a
  one-time cookie warning. Apps with their own telemetry pass `onError`.

**Naming**

- Reads: `fetch<Thing>`. Writes: `save`, `update`, `delete`, `upload` + `<Thing>`.
- Hooks: `use<Thing>`, and `use<Verb><Thing>` for mutations.
- Tables: `SHOPWAVE_<KIND>S`. Kinds and definitions: `<Kind>Kind`, `<Kind>Definition`.
- App routes are plural and kebab-case (`products/instance-tags`); singletons are singular
  (`merchant`). Exception: the consumer route is `consumer`, which apps already serve.
- Use the correct spelling in the SDK, and map to the API's misspellings at the edge.

**TypeScript**

- Strict mode.
- Inline type imports (`import { apiGet, type RequestOptions }`).
- `unknown` at the edges, then narrow. New code uses `any` only where generics need it; a few
  older uses remain (`report.ts`, `promotion.ts`, `entity.ts`, `basket.ts`).

## 7. Known gaps

Open requests:

- `createShopwaveAuth` has no `onError`, so a failed code exchange always prints.
- Decide what the default `onError` prints, and what apps plug in.
- A token refresh that throws after a 401 / error 908 is answered 502
  `upstream_unavailable` instead of `auth_unavailable`.

## 8. Versioning and commits

- **Semver, while still 0.x:**
  - minor for a new area, or a change callers must adapt to (0.4.0: merchant, upload, user);
  - patch for fixes, and for additions that leave existing calls unchanged (0.4.3: the
    product tag lists).
- **Conventional commits** with a scope, a subject that states the behaviour, the JIRA ticket
  first when there is one, and the version when it's a release:
  `feat(product): product and instance tag lists (0.4.3)`.
- **Releases publish from CI.** `.github/workflows/publish.yml` runs on every push to
  `master`: typecheck, unit tests and build, then `npm publish` through npm trusted
  publishing (no npm token anywhere). It publishes only when the `package.json` version isn't
  on npm yet, so a release is: bump the version on `dev`, then merge `dev` into `master`.
  A push without a bump publishes nothing. Don't publish from a laptop.
- Test an unpublished version in an app through a tarball: run `npm pack` here, then
  `npm install ../ShopwaveUtils/CoreNReactSDK/react-shopwave-connect-<version>.tgz` in the app.
  Don't use `npm link` or `file:` to the folder.
