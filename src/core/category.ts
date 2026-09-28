import { apiGet, withToken, type RequestOptions } from "./request";
import { assertNoApiErrors } from "./errors";
import type { apiResponse } from "./types";

export interface Category {
  id: number;
  title: string;
  parentId: number | null;
  deleteDate: string;
  activeDate: string;
  type: number;
}

export interface CategoryResponse {
  categories: {
    [key: number]: Category;
  };
  api: apiResponse;
}

export interface FetchCategoriesParams {
  categoryIds?: Array<number>;
  /** Whether to include soft-deleted records. Defaults to `false`. */
  deleted?: boolean;
  /** @deprecated Pass `options.token` instead. Sent the same way (Authorization header). */
  token?: string;
}

/**
 * Fetches categories. Framework-agnostic: returns the flattened `Category[]`
 * or throws on API errors.
 */
export async function fetchCategories(
  params: FetchCategoriesParams = {},
  options: RequestOptions = {}
): Promise<Category[]> {
  const extras: Record<string, unknown> = { deleted: params.deleted ?? false };

  if (params.categoryIds) {
    extras.categoryIds = params.categoryIds;
  }

  const json = await apiGet<CategoryResponse | null>("/api/categories", extras, withToken(options, params.token));

  assertNoApiErrors(json, 200);

  // Shopwave answers an empty body when nothing matches.
  return Object.values(json?.categories ?? {});
}
