# react-shopwave-connect

Shopwave API client split into two clearly separated layers:

- **`core`** — framework-agnostic async API functions + all TypeScript types. No React anywhere. Works in any TS/JS project (Node script, Vue, Angular, CLI, …).
- **`hooks`** — thin React wrappers around `core`, with a consistent `{ data, loading, error, refetch }` shape. React is a **peer dependency** and is never bundled.

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
| `react-shopwave-connect/next`         | **Server-only.** Next.js login/callback/logout/session route handlers, token refresh, proxy guard |

Prefer the subpath imports when you want a hard boundary — e.g. a Node service should import from `/core` so React never enters the dependency graph.

## Configuration (`RequestOptions`)

Every `core` function (and every hook) accepts an optional `options` argument:

```ts
interface RequestOptions {
  baseUrl?: string;        // prefix for every path; omit in the browser to use
                           // relative URLs like "/api/products"
  token?: string;          // forwarded as the `token` request header
  fetch?: typeof fetch;    // custom fetch (Node < 18, tests, interceptors)
  signal?: AbortSignal;    // cancellation (hooks pass this automatically)
}
```

In the browser / Next.js you can usually omit `options` entirely (relative URLs resolve against the current origin). Outside the browser, pass an absolute `baseUrl` and a `token`.

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
  baseUrl: "https://api.shopwave.example",
  token: process.env.SHOPWAVE_TOKEN,
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

await fetchStores({}, { baseUrl: "https://api.merchantstack.com", fetch });
```

Functions **throw** on network failure or API errors (the error message contains the serialized API errors), so wrap calls in `try/catch`.

### Available `core` functions

| Domain    | Function(s)                                              |
| --------- | ------------------------------------------------------- |
| category  | `fetchCategories`                                       |
| consumer  | `fetchConsumers`                                        |
| employee  | `fetchEmployees`                                        |
| product   | `fetchProducts`, `fetchProductsMap` (batched, keyed)    |
| store     | `fetchStores`                                           |
| report    | `fetchReport`                                           |
| session   | `fetchSession`, `loginPath`, `logoutPath`, `logout`     |
| entity    | `deleteEntity`, `submitEntity`                          |
| basket    | `buildBasketReportQuery`, `parseBasketReportData`, `combineBasketRows`, `computeBasketSummary`, … (pure transforms) |

All types/interfaces (`Product`, `Store`, `Category`, `Consumer`, `Employee`, `ReportQueryMap`, `Basket*`, `apiResponse`, …) are exported from `core` too.

---

## 2. Using `hooks` in React / Next.js

Every auto-fetching hook returns the same shape:

```ts
{ data, loading, error, refetch }
```

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

`useCategory`, `useConsumer`, `useEmployee`, `useProduct`, `usePromotion`, `useStore`, `useReport`, `useSession`.
They fetch on mount and re-run when their arguments change. `useConsumer` and `useReport` stay idle until you pass ids / a query (they return `loading: false`, `data: null` until then). `refetch()` replaces the old `reloadFlag` argument.

### Manually-triggered hooks (`useCallback`-based)

`useDelete`, `useSubmit`, `useLogout` return `{ mutate, data, loading, error }` — nothing fires until you call `mutate`:

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

### Other frameworks

`react-shopwave-connect/server` has the same building blocks without Next.js: `createShopwaveOAuth(config)` → `buildLoginUrl({ state })`, `exchangeCode(code)`, `refreshToken(token)`, `buildLogoutUrl()`, plus `createState`, `sanitizeReturnTo`, `isTokenExpired`, `isExpiredTokenResponse` and `authorizationHeader`. Store the token in your framework's session (Express `express-session`, iron-session's `getIronSession(req, res)`, …).

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

Unit tests (offline, no credentials) cover the OAuth client, token handling, the Next.js handlers (with an in-memory cookie store) and the session client:

```bash
npm test            # = npm run test:unit
```

Integration tests run against a live API using [Vitest](https://vitest.dev). Tests are located in `tests/integration/` and cover full CRUD lifecycles for Products, Categories, Consumers, and Employees.

### Environment Variables

| Variable    | Description                          | Example                                   |
|-------------|--------------------------------------|-------------------------------------------|
| `API_URL`   | Base URL for the API                 | `https://api.staging.merchantstack.com`   |
| `API_TOKEN` | Authentication token                 | `your-staging-token`                      |

### Running Tests

```bash
# Set environment variables
export API_URL=https://api.staging.merchantstack.com
export API_TOKEN=your-staging-token

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
  integration/
    setup.ts                       # Shared config and helpers
    products.integration.test.ts   # Products CRUD lifecycle
    categories.integration.test.ts # Categories CRUD lifecycle
    consumers.integration.test.ts  # Consumers CRUD lifecycle
    employees.integration.test.ts  # Employees CRUD lifecycle
```

Each test file uses `describe.sequential` to guarantee execution order (create → read → update → delete) with shared state across tests. An `afterAll` cleanup ensures created resources are deleted even if a test fails midway.
