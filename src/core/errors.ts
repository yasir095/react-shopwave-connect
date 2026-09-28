import type { ErrorMessage } from "./types";

/** Map of Shopwave API errors as found in `api.message.errors`, keyed by error code. */
export type ShopwaveErrorMap = Record<string, Partial<ErrorMessage>>;

/**
 * Thrown by every `core` function when a request fails, either at the HTTP
 * level (`status` is the HTTP status) or because the Shopwave response carried
 * `api.message.errors` (then `status` is the HTTP status of that response,
 * usually 200/201, and `errors` holds the API errors).
 *
 * Branch on `status` (e.g. `isUnauthorized` → send the user to log in) rather
 * than parsing `message`.
 */
export class ShopwaveApiError extends Error {
  /** HTTP status of the response (0 when the request never got a response). */
  readonly status: number;
  /** Shopwave API errors, when the response carried any. */
  readonly errors: ShopwaveErrorMap | null;
  /** Parsed response body, when there was one. */
  readonly body?: unknown;

  constructor(
    status: number,
    message: string,
    details: { errors?: ShopwaveErrorMap | null; body?: unknown; cause?: unknown } = {}
  ) {
    super(message, details.cause !== undefined ? { cause: details.cause } : undefined);
    this.name = "ShopwaveApiError";
    this.status = status;
    this.errors = details.errors ?? null;
    this.body = details.body;
  }

  /** 401, or the Shopwave "token expired / invalid" error 908. */
  get isUnauthorized(): boolean {
    if (this.status === 401) return true;
    return !!this.errors && Object.entries(this.errors).some(([k, v]) => k === "908" || Number(v?.id) === 908);
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/** The `api.message.errors` (or `api.message.error`) map of a Shopwave response, or `null` when there are none. */
export function getApiErrorMap(body: unknown): ShopwaveErrorMap | null {
  // The API reference names the map `error`; responses seen so far use `errors`.
  const message = (body as { api?: { message?: { errors?: unknown; error?: unknown } } } | null)?.api?.message;
  const errors = message?.errors ?? message?.error;
  if (errors && typeof errors === "object" && Object.keys(errors).length > 0) {
    return errors as ShopwaveErrorMap;
  }
  return null;
}

function describeErrors(errors: ShopwaveErrorMap): string {
  return Object.entries(errors)
    .map(([code, e]) => {
      const text = [e?.title, e?.details].filter(Boolean).join(": ");
      return text ? `${code} ${text}` : code;
    })
    .join("; ");
}

/**
 * Builds a {@link ShopwaveApiError} for a response. Understands the Shopwave
 * envelope (`api.message.errors`) and the `{ error, message }` bodies returned
 * by the `react-shopwave-connect/next` routes.
 */
export function toShopwaveApiError(status: number, body: unknown, fallback?: string): ShopwaveApiError {
  const errors = getApiErrorMap(body);
  let detail = errors ? describeErrors(errors) : "";
  if (!detail && body && typeof body === "object") {
    const b = body as { message?: unknown; error?: unknown };
    if (typeof b.message === "string") detail = b.message;
    else if (typeof b.error === "string") detail = b.error;
  }
  if (!detail) detail = fallback ?? (status >= 400 ? "request failed" : "API returned errors");
  return new ShopwaveApiError(status, `Shopwave API error (${status}): ${detail}`, { errors, body });
}

/** Throws a {@link ShopwaveApiError} when the response body carries API errors. */
export function assertNoApiErrors(body: unknown, status: number): void {
  if (getApiErrorMap(body)) throw toShopwaveApiError(status, body);
}
