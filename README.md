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
| session   | `logout`                                                |
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

`useCategory`, `useConsumer`, `useEmployee`, `useProduct`, `useStore`, `useReport`.
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

## Auth & Next.js note

The original `useLogin` / `useLogout` were tightly coupled to Next.js (`next/navigation` router + `'use server'` actions) and **cannot** be framework-agnostic, so they are **not** shipped here. Instead:

- `core.logout()` / `useLogout()` end the server session (`DELETE /api/session?action=logout`) — no redirect.
- The redirect to the auth server's login/logout URL stays in your app, since it depends on your server actions and router:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useLogout } from "react-shopwave-connect/hooks";
import { getLogoutUrl } from "@/app/actions";

export function LogoutButton() {
  const router = useRouter();
  const { mutate: endSession } = useLogout();

  const onClick = async () => {
    await endSession();
    router.push(await getLogoutUrl(window.location.origin + "/auth"));
  };

  return <button onClick={onClick}>Log out</button>;
}
```

---

## Build

Built with [`tsdown`](https://tsdown.dev) into dual ESM + CJS with `.d.ts` types, via two separate entries (`core` with no externals, `hooks` with `react`/`react-dom` marked external so they're never bundled).

```bash
npm run build       # emit dist/
npm run typecheck   # tsc --noEmit
```

---

## Testing

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

# Run tests in watch mode
npm test
```

### Test Structure

```
tests/
  integration/
    setup.ts                       # Shared config and helpers
    products.integration.test.ts   # Products CRUD lifecycle
    categories.integration.test.ts # Categories CRUD lifecycle
    consumers.integration.test.ts  # Consumers CRUD lifecycle
    employees.integration.test.ts  # Employees CRUD lifecycle
```

Each test file uses `describe.sequential` to guarantee execution order (create → read → update → delete) with shared state across tests. An `afterAll` cleanup ensures created resources are deleted even if a test fails midway.
