import { apiGet, getApiErrors, type RequestOptions } from "./request";
import type { apiResponse } from "./types";

export interface ReportKey {
  name: string;
  type: string;
  item?: ReportKey[];
}

export interface ReportData {
  keys: ReportKey[];
  data: any[][];
}

export interface ReportResponse {
  reports: {
    [key: string]: ReportData;
  };
  api: apiResponse;
}

export interface ReportQuery {
  FROM: string;
  WHERE?: {
    AND?: string[];
    OR?: string[];
  };
  SELECT?: string[];
  LIMIT?: number;
  OFFSET?: number;
}

export interface ReportQueryMap {
  [key: string]: ReportQuery;
}

/**
 * Runs one or more report queries and returns the `reports` map keyed by query
 * name. The query is JSON-encoded into the `extras.query` header, matching the
 * original endpoint contract.
 */
export async function fetchReport(
  query: ReportQueryMap,
  options: RequestOptions = {}
): Promise<ReportResponse["reports"]> {
  const extras: Record<string, unknown> = { query: JSON.stringify(query) };

  const json = await apiGet<ReportResponse>("/api/report", extras, options);

  const error = getApiErrors(json.api);
  if (error) {
    throw new Error(error);
  }

  return json.reports ?? {};
}
