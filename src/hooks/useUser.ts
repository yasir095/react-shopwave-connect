import { fetchUser, type RequestOptions, type User } from "../core";
import { useQuery, type QueryState } from "./shared";

/**
 * The logged-in user, fetched on mount. `errorStatus` is 401 when logged out.
 *
 * @example
 * const { data: user } = useUser();
 */
export function useUser(options?: RequestOptions & { enabled?: boolean }): QueryState<User | null> {
  const enabled = options?.enabled ?? true;
  return useQuery<User | null>(
    (signal) => fetchUser({ ...options, signal }),
    [options?.baseUrl, options?.token],
    enabled
  );
}

export default useUser;
