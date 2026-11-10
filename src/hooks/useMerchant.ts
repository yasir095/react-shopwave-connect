import {
  fetchMerchant,
  updateMerchant,
  type Merchant,
  type MerchantPatch,
  type RequestOptions,
  type UpdateMerchantOptions,
} from "../core";
import { useMutation, useQuery, type MutationState, type QueryState } from "./shared";

/**
 * The logged-in user's merchant, fetched on mount. `data` is `null` while
 * loading or when the API has no merchant.
 *
 * @example
 * const { data: merchant, loading, refetch } = useMerchant();
 */
export function useMerchant(options?: RequestOptions): QueryState<Merchant | null> {
  return useQuery<Merchant | null>(
    (signal) => fetchMerchant({ ...options, signal }),
    [options?.baseUrl, options?.token]
  );
}

/**
 * Manually-triggered merchant update (see `updateMerchant`: the patch is merged
 * over the current merchant by default). Resolves to the saved merchant, or
 * `null` on error (then `error` / `errorStatus` are set).
 *
 * @example
 * const { mutate: saveMerchant, loading: saving } = useUpdateMerchant();
 * const saved = await saveMerchant({ vatNumber: "GB123" });
 */
export function useUpdateMerchant(options?: UpdateMerchantOptions): MutationState<Merchant, [MerchantPatch]> {
  return useMutation<Merchant, [MerchantPatch]>(
    (patch) => updateMerchant(patch, options),
    [options?.baseUrl, options?.token, options?.merge]
  );
}

export default useMerchant;
