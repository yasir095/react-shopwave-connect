import { apiGet, withToken, type RequestOptions } from "./request";
import { assertNoApiErrors } from "./errors";
import type { apiResponse } from "./types";

/** Promotion rule identifiers as stored by the Shopwave API. */
export enum PromotionRuleSet {
  Percentage = "|%^/",
  Combo = "&%</",
  MealDeal = "&=^/",
}

export interface Promotion {
  id: number;
  merchantId: number;
  storeIds: number[];
  categoryIds: { [key: string]: number };
  productIds: { [key: string]: any };
  title: string;
  details: string | null;
  terms: string | null;
  startDate: string;
  endDate: string;
  daysAvailable: number[];
  automatic: number;
  rule: PromotionRuleSet;
  x: number;
  y: number | null;
}

export interface PromotionResponse {
  promotions: {
    [key: number]: Promotion;
  };
  api: apiResponse;
}

export interface FetchPromotionsParams {
  /** Optional id filter. Forwarded when provided. */
  promotionIds?: Array<number>;
  /** Whether to include soft-deleted records. Defaults to `false`. */
  deleted?: boolean;
  /** Filter for imminent promotions. */
  imminent?: boolean;
  /** Filter for active promotions. */
  active?: boolean;
  /** Filter for expired promotions. */
  expired?: boolean;
  /** @deprecated Pass `options.token` instead. Sent the same way (Authorization header). */
  token?: string;
}

/**
 * Fetches promotions. Returns the flattened `Promotion[]`.
 */
export async function fetchPromotions(
  params: FetchPromotionsParams = {},
  options: RequestOptions = {}
): Promise<Promotion[]> {
  const extras: Record<string, unknown> = { deleted: params.deleted ?? false };

  if (params.promotionIds) {
    extras.promotionIds = params.promotionIds;
  }
  if (params.imminent !== undefined) {
    extras.imminent = params.imminent;
  }
  if (params.active !== undefined) {
    extras.active = params.active;
  }
  if (params.expired !== undefined) {
    extras.expired = params.expired;
  }

  const json = await apiGet<PromotionResponse | null>("/api/promotions", extras, withToken(options, params.token));

  assertNoApiErrors(json, 200);

  // Shopwave answers an empty body when nothing matches.
  return Object.values(json?.promotions ?? {});
}
