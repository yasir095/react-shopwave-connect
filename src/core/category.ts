import { apiGet, getApiErrors, type RequestOptions } from "./request";
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
  /** Token override (also accepted via `options.token`). */
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
  if (params.token) {
    extras.token = params.token;
  }

  const json = await apiGet<CategoryResponse>("/api/categories", extras, options);

  const error = getApiErrors(json.api);
  if (error) {
    throw new Error(error);
  }

  return Object.values(json.categories ?? {});
}
