import { fetchProductInstanceTags, fetchProductTags, type RequestOptions } from "../core";
import { useQuery, type QueryState } from "./shared";

type LookupOptions = RequestOptions & {
  /** Fetch only when true (e.g. once a tag field is first opened). Defaults to true. */
  enabled?: boolean;
};

/**
 * The merchant's distinct product tags, for a tag field's suggestions.
 * `data` is `string[]` once loaded.
 *
 * @example
 * const [opened, setOpened] = useState(false);
 * const { data: tags, loading } = useProductTags({ enabled: opened });
 */
export function useProductTags(options?: LookupOptions): QueryState<string[]> {
  return useQuery<string[]>(
    (signal) => fetchProductTags({ ...options, signal }),
    [options?.baseUrl, options?.token],
    options?.enabled ?? true
  );
}

/**
 * The merchant's distinct price-instance (channel) tags: Eat In, Takeout, …
 * `data` is `string[]` once loaded.
 */
export function useProductInstanceTags(options?: LookupOptions): QueryState<string[]> {
  return useQuery<string[]>(
    (signal) => fetchProductInstanceTags({ ...options, signal }),
    [options?.baseUrl, options?.token],
    options?.enabled ?? true
  );
}

export default useProductTags;
