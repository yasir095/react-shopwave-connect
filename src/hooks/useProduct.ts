import {
  fetchProducts,
  type Product,
  type FetchProductsParams,
  type RequestOptions,
} from "../core";
import { useQuery, type QueryState } from "./shared";

/**
 * Auto-fetches products on mount and whenever the params change.
 */
export function useProduct(
  params: FetchProductsParams = {},
  options?: RequestOptions
): QueryState<Product[]> {
  return useQuery<Product[]>(
    (signal) => fetchProducts(params, { ...options, signal }),
    [JSON.stringify(params), options?.baseUrl, options?.token]
  );
}

export default useProduct;
