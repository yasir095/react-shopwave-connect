import {
  fetchConsumers,
  type Consumer,
  type RequestOptions,
} from "../core";
import { useQuery, type QueryState } from "./shared";

/**
 * Auto-fetches consumers by id. Disabled (no request) until at least one id is
 * supplied, mirroring the original early-return behaviour.
 */
export function useConsumer(
  consumerIds: number[] | null,
  options?: RequestOptions
): QueryState<Consumer[]> {
  const enabled = !!consumerIds && consumerIds.length > 0;
  return useQuery<Consumer[]>(
    (signal) => fetchConsumers(consumerIds, { ...options, signal }),
    [JSON.stringify(consumerIds), options?.baseUrl, options?.token],
    enabled
  );
}

export default useConsumer;
