import { apiGet, getApiErrors, type RequestOptions } from "./request";
import type { apiResponse } from "./types";

export interface Consumer {
  id: number;
  activeCount: number;
  firstName: string;
  lastName: string;
  email: string;
}

export interface ConsumerResponse {
  consumers: {
    [key: number]: Consumer;
  };
  api: apiResponse;
}

/**
 * Fetches consumers by id. Returns an empty array when no ids are supplied
 * (the original hook short-circuited in that case).
 */
export async function fetchConsumers(
  consumerIds: number[] | null | undefined,
  options: RequestOptions = {}
): Promise<Consumer[]> {
  if (!consumerIds || consumerIds.length === 0) {
    return [];
  }

  const extras: Record<string, unknown> = { ids: consumerIds.join(",") };

  const json = await apiGet<ConsumerResponse>("/api/consumer", extras, options);

  const error = getApiErrors(json.api);
  if (error) {
    throw new Error(error);
  }

  return Object.values(json.consumers ?? {});
}
