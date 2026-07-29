import {
  submitEntity,
  type SubmitEntityArgs,
  type RequestOptions,
} from "../core";
import { useMutation, type MutationState } from "./shared";

/**
 * Manually-triggered create/update. Returns `{ mutate, loading, error, data }`,
 * where `data` is the API `result` payload.
 *
 * The original `useHandleSubmit` bundled validation, payload transformation and
 * notistack toasts. Those are app concerns: resolve the endpoint/method/payload
 * in your component and pass them in, then react to the returned state.
 *
 * @example
 * const { mutate, loading } = useSubmit<Product>();
 * const saved = await mutate({
 *   endpoint: id ? `/api/products/${id}` : "/api/products",
 *   method: id ? "PUT" : "POST",
 *   payload,
 * });
 */
export function useSubmit<R = any>(
  options?: RequestOptions
): MutationState<R | undefined, [args: SubmitEntityArgs]> {
  return useMutation<R | undefined, [SubmitEntityArgs]>(
    (args) => submitEntity<R>(args, options),
    [options?.baseUrl, options?.token]
  );
}

export default useSubmit;
