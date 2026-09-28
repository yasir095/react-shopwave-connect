import { apiGet, withToken, type RequestOptions } from "./request";
import { assertNoApiErrors } from "./errors";
import type { apiResponse } from "./types";

export const rolesById = {
  "1": "Owner",
  "2": "Manager",
  "3": "Assistant",
  "4": "Guest",
  "5": "Assistant Manager",
} as const;

export interface Employee {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  roleId: number;
  joinedDate: string;
  exitDate: string;
  stores: {
    [key: number]: {
      id: number;
      roleId: number;
    };
  };
}

export interface EmployeeResponse {
  employees: {
    [key: number]: Employee;
  };
  api: apiResponse;
}

export interface FetchEmployeesParams {
  /** Optional id filter. Forwarded when provided. */
  employeeIds?: Array<number>;
  /** Whether to include soft-deleted records. Defaults to `false`. */
  deleted?: boolean;
  /** @deprecated Pass `options.token` instead. Sent the same way (Authorization header). */
  token?: string;
}

/**
 * Fetches employees. Returns the flattened `Employee[]`.
 */
export async function fetchEmployees(
  params: FetchEmployeesParams = {},
  options: RequestOptions = {}
): Promise<Employee[]> {
  const extras: Record<string, unknown> = { deleted: params.deleted ?? false };

  if (params.employeeIds) {
    extras.employeeIds = params.employeeIds;
  }

  const json = await apiGet<EmployeeResponse | null>("/api/employees", extras, withToken(options, params.token));

  assertNoApiErrors(json, 200);

  // Shopwave answers an empty body when nothing matches.
  return Object.values(json?.employees ?? {});
}
