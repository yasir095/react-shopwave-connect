import {
  fetchStores,
  type Store,
  type FetchStoresParams,
  type RequestOptions,
} from "../core";
import { useQuery, type QueryState } from "./shared";

/**
 * Auto-fetches stores on mount. Manual reloads via `refetch`
 * (replaces the old `reloadFlag` argument).
 */
export function useStore(
  params: FetchStoresParams = {},
  options?: RequestOptions
): QueryState<Store[]> {
  return useQuery<Store[]>(
    (signal) => fetchStores(params, { ...options, signal }),
    [JSON.stringify(params), options?.baseUrl, options?.token]
  );
}

export default useStore;
