import {
  fetchReport,
  type ReportQueryMap,
  type ReportResponse,
  type RequestOptions,
} from "../core";
import { useQuery, type QueryState } from "./shared";

/**
 * Auto-fetches one or more reports. Disabled (no request) until a non-null
 * query is supplied, mirroring the original early-return behaviour.
 */
export function useReport(
  query: ReportQueryMap | null,
  options?: RequestOptions
): QueryState<ReportResponse["reports"]> {
  const enabled = !!query;
  return useQuery<ReportResponse["reports"]>(
    (signal) => fetchReport(query as ReportQueryMap, { ...options, signal }),
    [JSON.stringify(query), options?.baseUrl, options?.token],
    enabled
  );
}

export default useReport;
