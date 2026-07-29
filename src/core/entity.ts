import { apiDelete, apiSend, type RequestOptions } from "./request";

/**
 * Generic CRUD-style mutations extracted from `useHandleDelete` /
 * `useHandleSubmit`. The original hooks also surfaced notistack snackbars; that
 * UI concern is deliberately left to the hooks/host layer so core stays
 * dependency-free.
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
 * Sends a create/update mutation and returns the parsed `result` field
 * (matching the original `result.result` access).
 */
export async function submitEntity<R = any>(
  { endpoint, method = "POST", payload }: SubmitEntityArgs,
  options: RequestOptions = {}
): Promise<R | undefined> {
  const json = await apiSend<SubmitEntityResponse<R>>(
    endpoint,
    method,
    payload,
    options
  );
  return json.result;
}
