import { apiDelete, apiSend, type RequestOptions } from "./request";
import { assertNoApiErrors } from "./errors";

/**
 * Low-level, untyped mutations: the caller supplies the route and payload.
 *
 * Prefer the typed functions in `./entities` (`saveProduct`, `deleteCategory`,
 * …): they know each route, build the request envelope, check the response and
 * return the saved entity with its id. Keep these for routes that have no typed
 * function yet (e.g. `/api/merchant`).
 */

/**
 * Deletes `/api/{resourcePath}/{entityId}`.
 */
export async function deleteEntity(
  resourcePath: string,
  entityId: number | string,
  options: RequestOptions = {}
): Promise<void> {
  if (entityId == null || entityId === "") {
    throw new Error("entityId is missing");
  }
  await apiDelete(`/api/${resourcePath}/${entityId}`, options);
}

export interface SubmitEntityArgs {
  /** Fully-resolved endpoint, e.g. `/api/products` or `/api/products/42`. */
  endpoint: string;
  /** Defaults to PUT when an `entityId` exists, otherwise POST. */
  method?: "POST" | "PUT";
  /** The request payload (already transformed by the caller). */
  payload: unknown;
}

export interface SubmitEntityResponse<R = any> {
  result?: R;
  [key: string]: unknown;
}

/**
 * Sends a create/update mutation. Returns the response's `result` field when it
 * has one (older app routes wrapped their answer that way), otherwise the whole
 * parsed response body. Throws `ShopwaveApiError` on HTTP or API errors.
 */
export async function submitEntity<R = any>(
  { endpoint, method = "POST", payload }: SubmitEntityArgs,
  options: RequestOptions = {}
): Promise<R | undefined> {
  const json = await apiSend<SubmitEntityResponse<R> | null>(
    endpoint,
    method,
    payload,
    options
  );
  assertNoApiErrors(json, 200);
  if (json && typeof json === "object" && "result" in json) return json.result;
  return (json ?? undefined) as R | undefined;
}
