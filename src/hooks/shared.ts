import { useCallback, useEffect, useState } from "react";

/**
 * Consistent return shape for every auto-fetching ("query") hook.
 */
export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** Re-runs the underlying fetch. */
  refetch: () => void;
}

/**
 * Consistent return shape for manually-triggered ("mutation") hooks.
 */
export interface MutationState<TData, TArgs extends any[]> {
  /** Triggers the request. Resolves to the result, or `null` on error. */
  mutate: (...args: TArgs) => Promise<TData | null>;
  data: TData | null;
  loading: boolean;
  error: string | null;
}

function toMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Internal primitive powering the auto-fetch hooks. Runs `fetcher` on mount and
 * whenever `deps` change, tracks loading/error/data, cancels in-flight requests
 * on unmount or dep change, and exposes `refetch`.
 *
 * When `enabled` is false the fetch is skipped (used for hooks that need
 * arguments before they can run, e.g. consumers-by-id).
 */
export function useQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>,
  enabled = true
): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;

    setData(null);
    setError(null);
    setLoading(true);

    fetcher(controller.signal)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active && (e as { name?: string })?.name !== "AbortError") {
          setError(toMessage(e));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
    // `fetcher` is intentionally excluded; callers pass stable `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  return { data, loading, error, refetch };
}

/**
 * Internal primitive powering the manually-triggered hooks.
 */
export function useMutation<TData, TArgs extends any[]>(
  action: (...args: TArgs) => Promise<TData>,
  deps: ReadonlyArray<unknown>
): MutationState<TData, TArgs> {
  const [data, setData] = useState<TData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutate = useCallback(
    async (...args: TArgs): Promise<TData | null> => {
      setLoading(true);
      setError(null);
      try {
        const result = await action(...args);
        setData(result);
        return result;
      } catch (e) {
        setError(toMessage(e));
        return null;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps
  );

  return { mutate, data, loading, error };
}
