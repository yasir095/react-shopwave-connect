import { apiGet, withToken, type RequestOptions } from "./request";
import { assertNoApiErrors } from "./errors";
import type { apiResponse } from "./types";

export interface ProductInstance {
  id: number;
  price: string;
  taxPercentage: string;
  timestamp: string;
  size: string;
  name: string;
  activeDate: string;
  tags: string;
}

export interface Product {
  id: number;
  barcode: string;
  name: string;
  details: string;
  tags: string;
  unit: number;
  timestamp: string;
  activeDate: string;
  deleteDate: string;
  images: Array<string>;
  categories: Array<number>;
  instances: {
    [key: number]: ProductInstance;
  };
}

export interface ProductResponse {
  products: {
    [key: number]: Product;
  };
  api: apiResponse;
}

export interface FetchProductsParams {
  productIds?: Array<number>;
  storeId?: number;
  /** Whether to include soft-deleted records. Defaults to `false`. */
  deleted?: boolean;
  /** @deprecated Pass `options.token` instead. Sent the same way (Authorization header). */
  token?: string;
}

/**
 * Fetches products. Returns the flattened `Product[]`.
 */
export async function fetchProducts(
  params: FetchProductsParams = {},
  options: RequestOptions = {}
): Promise<Product[]> {
  const extras: Record<string, unknown> = { deleted: params.deleted ?? false };

  if (params.productIds) {
    extras.productIds = params.productIds;
  }
  if (params.storeId) {
    extras.storeId = params.storeId;
  }

  const json = await apiGet<ProductResponse | null>("/api/products", extras, withToken(options, params.token));

  assertNoApiErrors(json, 200);

  // Shopwave answers an empty body when nothing matches.
  return Object.values(json?.products ?? {});
}

/**
 * Fetches products by id and returns them keyed by id, transparently batching
 * the request (default 200 ids per call) to stay within API limits. Extracted
 * from the original `useBasketReport` inline batching loop so it can be reused
 * outside React.
 */
export async function fetchProductsMap(
  productIds: number[] | null | undefined,
  options: RequestOptions = {},
  batchSize = 200
): Promise<{ [id: number]: Product }> {
  const result: { [id: number]: Product } = {};
  if (!productIds || productIds.length === 0) {
    return result;
  }

  for (let i = 0; i < productIds.length; i += batchSize) {
    const batch = productIds.slice(i, i + batchSize);
    const products = await fetchProducts({ productIds: batch }, options);
    for (const product of products) {
      result[product.id] = product;
    }
  }

  return result;
}
