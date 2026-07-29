import {
  fetchPromotions,
  type Promotion,
  type FetchPromotionsParams,
  type RequestOptions,
} from "../core";
import { useQuery, type QueryState } from "./shared";

/**
 * Auto-fetches promotions on mount and whenever the params change.
 * Manual reloads are available via `refetch`.
 */
export function usePromotion(
  params: FetchPromotionsParams = {},
  options?: RequestOptions
): QueryState<Promotion[]> {
  return useQuery<Promotion[]>(
    (signal) => fetchPromotions(params, { ...options, signal }),
    [JSON.stringify(params), options?.baseUrl, options?.token]
  );
}

export default usePromotion;
