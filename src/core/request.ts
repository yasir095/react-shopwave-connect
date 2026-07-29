import type { apiResponse } from "./types";

/**
 * Per-call configuration shared by every core API function.
 *
 * Nothing here is React-specific. By accepting these options per call, the
 * core layer works in the browser/Next (relative `/api/...` URLs, the default)
 * AND in Node / CLI / Vue / Angular by passing an absolute `baseUrl`, an auth
 * `token`, and/or a custom `fetch` implementation.
 */
export interface RequestOptions {
  /**
   * Prefixed in front of every request path. Leave undefined in the browser to
   * use relative URLs (e.g. `/api/products`). In Node/CLI pass something like
   * `https://api.shopwave.com`.
   */
  baseUrl?: string;

  /** OAuth/session token forwarded in the `extras.token` header. */
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

function buildExtras(extras: Extras, options: RequestOptions): Extras {
  const merged: Extras = { "Content-Type": "application/json", ...extras };
  if (options.token != null && merged.token == null) {
    merged.token = options.token;
  }
  return merged;
}

/**
 * Returns a JSON string of API errors if the response carries any, otherwise
 * `null`. Mirrors the original `!responseJson.api.message.errors` checks.
 */
export function getApiErrors(api?: apiResponse): string | null {
  const errors = api?.message?.errors;
  if (errors && Object.keys(errors).length > 0) {
    return JSON.stringify(errors);
  }
  return null;
}

/**
 * GET helper. Sends request metadata via the `extras` header exactly like the
 * original hooks did, parses JSON, and returns the typed payload.
 */
export async function apiGet<T>(
  path: string,
  extras: Extras,
  options: RequestOptions = {}
): Promise<T> {
  const doFetch = resolveFetch(options);
  const url = (options.baseUrl ?? "") + path;

  const headers = { extras: JSON.stringify(buildExtras(extras, options)) };
  console.log('[API GET]', { url, headers });

  const response = await doFetch(url, {
    method: "GET",
    headers,
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Network response was not ok (${response.status})`);
  }

  return (await response.json()) as T;
}

/**
 * JSON body helper for POST/PUT mutations.
 */
export async function apiSend<T>(
  path: string,
  method: "POST" | "PUT",
  payload: unknown,
  options: RequestOptions = {}
): Promise<T> {
  const doFetch = resolveFetch(options);
  const url = (options.baseUrl ?? "") + path;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token != null) {
    headers.token = options.token;
  }

  console.log(`[API ${method}]`, { url, headers, payload });

  const response = await doFetch(url, {
    method,
    headers,
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to ${method.toLowerCase()}: ${response.statusText}`);
  }

  return (await response.json()) as T;
}

/**
 * DELETE helper.
 */
export async function apiDelete(
  path: string,
  options: RequestOptions = {}
): Promise<void> {
  const doFetch = resolveFetch(options);
  const url = (options.baseUrl ?? "") + path;

  const headers: Record<string, string> = {};
  if (options.token != null) {
    headers.token = options.token;
  }

  console.log('[API DELETE]', { url, headers });

  const response = await doFetch(url, {
    method: "DELETE",
    headers,
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Failed to delete: ${response.statusText}`);
  }
}
