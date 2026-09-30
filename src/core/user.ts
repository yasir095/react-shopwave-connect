import { apiGet, type RequestOptions } from "./request";
import { assertNoApiErrors } from "./errors";
import type { apiResponse } from "./types";
import type { Merchant } from "./merchant";
import { SHOPWAVE_RESOURCES } from "./resources";

/** The logged-in user's employee record (`GET /user` → `user.employee`). */
export interface UserEmployee {
  merchantId?: number;
  /** See `rolesById`. */
  roleId?: number;
  /** Store roles, keyed by store id. */
  stores?: Record<string, unknown>;
  [field: string]: unknown;
}

/** The logged-in user (`GET /user`). */
export interface User {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  employee?: UserEmployee | null;
  /** Documented in the API reference but not returned by the live API (Sep 2026). */
  createdDate?: string;
  /** Not returned by the live API (Sep 2026); use `fetchMerchant()`. */
  merchant?: Merchant | null;
  /** Other fields the API returns are kept as-is. */
  [field: string]: unknown;
}

export interface UserResponse {
  user: User;
  api: apiResponse;
}

/** Reads the logged-in user, or `null` when the API returns none. */
export async function fetchUser(options: RequestOptions = {}): Promise<User | null> {
  const json = await apiGet<UserResponse | null>(`/api/${SHOPWAVE_RESOURCES.user.route}`, {}, options);
  assertNoApiErrors(json, 200);
  return json?.user ?? null;
}
