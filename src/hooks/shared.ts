import { useCallback, useEffect, useReducer, useState } from "react";
import { ShopwaveApiError } from "../core/errors";

/**
 * Consistent return shape for every auto-fetching ("query") hook.
 */
export interface QueryState<T> {
  /**
   * The latest data for the current params. Kept while a `refetch()` is in
   * flight (and after a failed refetch), so lists don't blank out and flash a
   * skeleton after every save. Reset to `null` when the params change.
   */
  data: T | null;
  /** True while there's no data to show yet (first load, or params changed). */
  loading: boolean;
  /** True whenever a request is in flight, including background refetches. */
  fetching: boolean;
  error: string | null;
  /** HTTP status of the last error (0 = no response), or `null`. */
  errorStatus: number | null;
  /** Re-runs the underlying fetch, keeping the current data visible meanwhile. */
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
  /** HTTP status of the last error (0 = no response), or `null`. */
  errorStatus: number | null;
}

function toMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function toStatus(e: unknown): number | null {
  return e instanceof ShopwaveApiError ? e.status : null;
}

// ---------------------------------------------------------------------------
// Query state machine (pure, unit-tested)
// ---------------------------------------------------------------------------

export interface QueryInternalState<T> {
  data: T | null;
  /** Params key the `data` belongs to. */
  key: string | null;
  fetching: boolean;
  error: string | null;
  errorStatus: number | null;
}

export type QueryAction<T> =
  | { type: "start"; key: string }
  | { type: "success"; key: string; data: T }
  | { type: "failure"; key: string; error: string; errorStatus: number | null }
  | { type: "idle" };

export function queryReducer<T>(state: QueryInternalState<T>, action: QueryAction<T>): QueryInternalState<T> {
  switch (action.type) {
    case "start":
      // New params: the old data describes something else, so drop it.
      if (action.key !== state.key) {
        return { data: null, key: action.key, fetching: true, error: null, errorStatus: null };
      }
      // Same params (refetch): keep showing what we have.
      return { ...state, fetching: true, error: null, errorStatus: null };
    case "success":
      if (action.key !== state.key) return state;
      return { data: action.data, key: action.key, fetching: false, error: null, errorStatus: null };
    case "failure":
      if (action.key !== state.key) return state;
      return { ...state, fetching: false, error: action.error, errorStatus: action.errorStatus };
    case "idle":
      return state.fetching ? { ...state, fetching: false } : state;
    default:
      return state;
  }
}

/** Public view of the internal state for the params currently being rendered. */
export function selectQueryView<T>(
  state: QueryInternalState<T>,
  key: string,
  enabled: boolean
): Pick<QueryState<T>, "data" | "loading" | "fetching" | "error" | "errorStatus"> {
  // Params changed but the effect hasn't run yet: don't show the old data.
  if (state.key !== key) {
    return { data: null, loading: enabled, fetching: enabled, error: null, errorStatus: null };
  }
  return {
    data: state.data,
    loading: state.fetching && state.data === null,
    fetching: state.fetching,
    error: state.error,
    errorStatus: state.errorStatus,
  };
}

function depsKey(deps: ReadonlyArray<unknown>): string {
  try {
    return JSON.stringify(deps);
  } catch {
    return String(deps);
  }
}

/**
 * Internal primitive powering the auto-fetch hooks. Runs `fetcher` on mount and
 * whenever `deps` change, tracks loading/error/data, cancels in-flight requests
 * on unmount or dep change, and exposes `refetch` (which keeps the current data
 * visible until the new data arrives).
 *
 * When `enabled` is false the fetch is skipped (used for hooks that need
 * arguments before they can run, e.g. consumers-by-id).
 */
export function useQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>,
  enabled = true
): QueryState<T> {
  const key = depsKey(deps);
  const [state, dispatch] = useReducer(queryReducer<T>, {
    data: null,
    key: enabled ? key : null,
    fetching: enabled,
    error: null,
    errorStatus: null,
  } as QueryInternalState<T>);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) {
      dispatch({ type: "idle" });
      return;
    }

    const controller = new AbortController();
    dispatch({ type: "start", key });

    fetcher(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) dispatch({ type: "success", key, data: result });
      })
      .catch((e) => {
        if (!controller.signal.aborted && (e as { name?: string })?.name !== "AbortError") {
          dispatch({ type: "failure", key, error: toMessage(e), errorStatus: toStatus(e) });
        }
      });

    return () => {
      controller.abort();
    };
    // `fetcher` is intentionally excluded; callers pass stable `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, enabled]);

  return { ...selectQueryView(state, key, enabled), refetch };
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
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const mutate = useCallback(
    async (...args: TArgs): Promise<TData | null> => {
      setLoading(true);
      setError(null);
      setErrorStatus(null);
      try {
        const result = await action(...args);
        setData(result);
        return result;
      } catch (e) {
        setError(toMessage(e));
        setErrorStatus(toStatus(e));
        return null;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps
  );

  return { mutate, data, loading, error, errorStatus };
}
