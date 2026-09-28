import { apiGet, withToken, type RequestOptions } from "./request";
import { assertNoApiErrors } from "./errors";
import type { apiResponse } from "./types";

export interface Store {
  id: number;
  lat: number;
  lng: number;
  addressLine1: string;
  addressLine2: string | null;
  addressLine3: string;
  phoneNumber: string;
  city: string;
  postcode: string;
  countryId: number | null;
  timezoneId: number | null;
  storeDeleteDate: string | null;
  email: string | null;
  sandbox: boolean | null;
}

export interface StoreResponse {
  stores: {
    [key: number]: Store;
  };
  api: apiResponse;
}

export interface FetchStoresParams {
  /** Optional id filter. */
  storeIds?: Array<number>;
  /** Whether to include soft-deleted records. Defaults to `false`. */
  deleted?: boolean;
  /** @deprecated Pass `options.token` instead. Sent the same way (Authorization header). */
  token?: string;
}

/**
 * Fetches stores. Returns the flattened `Store[]`.
 */
export async function fetchStores(
  params: FetchStoresParams = {},
  options: RequestOptions = {}
): Promise<Store[]> {
  const extras: Record<string, unknown> = { deleted: params.deleted ?? false };
  if (params.storeIds) {
    extras.storeIds = params.storeIds;
  }

  const json = await apiGet<StoreResponse | null>("/api/stores", extras, withToken(options, params.token));

  assertNoApiErrors(json, 200);

  // Shopwave answers an empty body when nothing matches.
  return Object.values(json?.stores ?? {});
}
