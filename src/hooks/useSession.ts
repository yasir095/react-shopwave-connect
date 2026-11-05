import { fetchSession, type RequestOptions, type SessionStatus } from "../core";
import { useQuery, type QueryState } from "./shared";

/**
 * Current login status (`{ loggedIn, expiresAt }`) from `GET /api/session`.
 * Tokens are never exposed to the browser.
 *
 * @example
 * const { data: session, loading } = useSession();
 * if (!loading && !session?.loggedIn) window.location.href = loginPath(location.pathname);
 */
export function useSession(options?: RequestOptions): QueryState<SessionStatus> {
  return useQuery<SessionStatus>(
    (signal) => fetchSession({ ...options, signal }),
    [options?.baseUrl]
  );
}

export default useSession;
