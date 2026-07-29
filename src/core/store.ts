import { apiGet, getApiErrors, type RequestOptions } from "./request";
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
  /** Whether to include soft-deleted records. Defaults to `false`. */
  deleted?: boolean;
}

/**
 * Fetches stores. Returns the flattened `Store[]`.
 */
export async function fetchStores(
  params: FetchStoresParams = {},
  options: RequestOptions = {}
): Promise<Store[]> {
  const extras: Record<string, unknown> = { deleted: params.deleted ?? false };

  const json = await apiGet<StoreResponse>("/api/stores", extras, options);

  const error = getApiErrors(json.api);
  if (error) {
    throw new Error(error);
  }

  return Object.values(json.stores ?? {});
}
