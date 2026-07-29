import {
  fetchCategories,
  type Category,
  type FetchCategoriesParams,
  type RequestOptions,
} from "../core";
import { useQuery, type QueryState } from "./shared";

/**
 * Auto-fetches categories on mount and whenever the params change.
 * Manual reloads are available via `refetch` (replaces the old `reloadFlag`).
 */
export function useCategory(
  params: FetchCategoriesParams = {},
  options?: RequestOptions
): QueryState<Category[]> {
  return useQuery<Category[]>(
    (signal) => fetchCategories(params, { ...options, signal }),
    [JSON.stringify(params), options?.baseUrl, options?.token]
  );
}

export default useCategory;
