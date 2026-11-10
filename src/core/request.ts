import type { apiResponse } from "./types";
import { ShopwaveApiError, getApiErrorMap, toShopwaveApiError } from "./errors";

/**
 * Per-call configuration shared by every core API function.
 *
 * Nothing here is React-specific. In the browser/Next leave `baseUrl` empty to
 * call the app's own `/api/...` routes (which hold the session). From Node, a
 * CLI or tests, pass an absolute `baseUrl` pointing at such an app plus a
 * `token`.
 */
export interface RequestOptions {
  /**
   * Prefixed in front of every request path. Leave undefined in the browser to
   * use relative URLs (e.g. `/api/products`). From Node pass the app origin,
   * e.g. `http://localhost:3000`.
   */
  baseUrl?: string;

  /**
   * Shopwave OAuth access token. Sent as `Authorization: OAuth <token>` on every
   * request (GET, POST, PUT and DELETE alike). A value that already starts with
   * a scheme (`OAuth …` / `Bearer …`) is sent as-is. Leave unset in the browser:
   * the app's routes use the session cookie.
   */
  token?: string;

  /**
   * Custom fetch implementation. Defaults to the global `fetch`. Useful for
   * Node < 18, testing, or injecting interceptors.
   */
  fetch?: typeof fetch;

  /** Optional abort signal for cancellation (used by the hooks layer). */
  signal?: AbortSignal;
}

/** The Shopwave API ships request metadata inside a single `extras` header. */
export type Extras = Record<string, unknown>;

function resolveFetch(options: RequestOptions): typeof fetch {
  const f = options.fetch ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!f) {
    throw new Error(
      "No fetch implementation available. Pass `options.fetch` (e.g. node-fetch / undici) when running outside the browser."
    );
  }
  return f;
}

/** Options with `token` filled in from a legacy per-call `params.token`, unless `options.token` is set. */
export function withToken(options: RequestOptions, token: string | undefined): RequestOptions {
  return token && !options.token ? { ...options, token } : options;
}

/** `Authorization` header value for a token (`OAuth <token>` unless it already has a scheme). */
export function authorizationFor(token: string): string {
  const t = token.trim();
  return /^(oauth|bearer)\s+\S/i.test(t) ? t : `OAuth ${t}`;
}

/** Headers shared by every request: Accept + the token, when one is given. */
function baseHeaders(options: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.token) headers.Authorization = authorizationFor(options.token);
  return headers;
}

function buildExtras(extras: Extras): Extras {
  const merged: Extras = { "Content-Type": "application/json", ...extras };
  // Tokens never travel inside extras any more (see RequestOptions.token).
  delete merged.token;
  return merged;
}

/** Parses a response body as JSON; `null` for an empty body, `{ raw }` for non-JSON. */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

/**
 * Low-level request: resolves `{ status, body }` for 2xx responses and throws
 * {@link ShopwaveApiError} otherwise. `init.headers` are merged over the
 * standard ones (Accept + Authorization).
 */
export async function apiRequest(
  path: string,
  init: RequestInit,
  options: RequestOptions = {}
): Promise<{ status: number; body: unknown }> {
  return send(path, { ...init, headers: { ...baseHeaders(options), ...(init.headers as Record<string, string>) } }, options);
}

async function send(path: string, init: RequestInit, options: RequestOptions): Promise<{ status: number; body: unknown }> {
  const doFetch = resolveFetch(options);
  const url = (options.baseUrl ?? "") + path;

  let response: Response;
  try {
    response = await doFetch(url, { ...init, signal: options.signal });
  } catch (error) {
    if ((error as { name?: string })?.name === "AbortError") throw error;
    throw new ShopwaveApiError(0, `Shopwave API request failed: ${(error as Error)?.message ?? error}`, { cause: error });
  }

  const body = await readBody(response);
  if (!response.ok) {
    throw toShopwaveApiError(response.status, body, response.statusText || undefined);
  }
  return { status: response.status, body };
}

/**
 * Returns a JSON string of API errors if the response carries any, otherwise
 * `null`. Kept for backwards compatibility; prefer `ShopwaveApiError`.
 */
export function getApiErrors(api?: apiResponse): string | null {
  const errors = getApiErrorMap({ api });
  return errors ? JSON.stringify(errors) : null;
}

/**
 * GET helper. Sends request metadata via the `extras` header, parses JSON and
 * returns the payload. Throws {@link ShopwaveApiError} for non-2xx responses.
 */
export async function apiGet<T>(path: string, extras: Extras, options: RequestOptions = {}): Promise<T> {
  const { body } = await send(
    path,
    {
      method: "GET",
      headers: { ...baseHeaders(options), extras: JSON.stringify(buildExtras(extras)) },
    },
    options
  );
  return body as T;
}

/**
 * JSON body helper for POST/PUT mutations. Returns the parsed body (`null` for
 * an empty one). Throws {@link ShopwaveApiError} for non-2xx responses.
 */
export async function apiSend<T>(
  path: string,
  method: "POST" | "PUT",
  payload: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const { body } = await send(
    path,
    {
      method,
      headers: { ...baseHeaders(options), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    options
  );
  return body as T;
}

/**
 * DELETE helper. Shopwave answers deletes with 205 and an empty body; if a body
 * does come back and carries API errors, they are thrown. Returns the parsed
 * body (`null` when empty).
 */
export async function apiDelete(path: string, options: RequestOptions = {}): Promise<unknown> {
  const { status, body } = await send(path, { method: "DELETE", headers: baseHeaders(options) }, options);
  if (getApiErrorMap(body)) throw toShopwaveApiError(status, body);
  return body;
}
