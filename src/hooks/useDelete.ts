import { deleteEntity, type RequestOptions } from "../core";
import { useMutation, type MutationState } from "./shared";

/**
 * Manually-triggered delete. Returns `{ mutate, loading, error, data }`.
 *
 * Note: the original `useHandleDelete` surfaced notistack toasts. That UI
 * concern is left to the host app — handle success/error from the returned
 * state or the promise resolved by `mutate`.
 *
 * @example
 * const { mutate, loading } = useDelete();
 * await mutate("products", 42);
 */
export function useDelete(
  options?: RequestOptions
): MutationState<void, [resourcePath: string, entityId: number | string]> {
  return useMutation<void, [string, number | string]>(
    (resourcePath, entityId) => deleteEntity(resourcePath, entityId, options),
    [options?.baseUrl, options?.token]
  );
}

export default useDelete;
