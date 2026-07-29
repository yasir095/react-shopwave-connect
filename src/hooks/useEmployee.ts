import {
  fetchEmployees,
  type Employee,
  type FetchEmployeesParams,
  type RequestOptions,
} from "../core";
import { useQuery, type QueryState } from "./shared";

/**
 * Auto-fetches employees on mount and whenever the params change.
 */
export function useEmployee(
  params: FetchEmployeesParams = {},
  options?: RequestOptions
): QueryState<Employee[]> {
  return useQuery<Employee[]>(
    (signal) => fetchEmployees(params, { ...options, signal }),
    [JSON.stringify(params), options?.baseUrl, options?.token]
  );
}

export default useEmployee;
