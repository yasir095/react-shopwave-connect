import { apiDelete, type RequestOptions } from "./request";

/**
 * Login status returned by the app's `/api/session` route. It deliberately
 * never contains tokens — those stay in the encrypted httpOnly cookie.
 */
export interface SessionStatus {
  loggedIn: boolean;
  /** Access-token expiry (epoch ms), when known. */
  expiresAt?: number;
}

/**
 * Reads the current login status from `GET /api/session`.
 *
 * Works with the new `react-shopwave-connect/next` session route
 * (`{ loggedIn }`) and with older routes that returned the raw session
 * (`{ token: {...} }`) — in that case only a boolean is surfaced.
 */
export async function fetchSession(options: RequestOptions = {}): Promise<SessionStatus> {
  const doFetch = options.fetch ?? (typeof fetch !== "undefined" ? fetch : undefined);
  if (!doFetch) {
    throw new Error("No fetch implementation available. Pass `options.fetch`.");
  }

  const response = await doFetch(`${options.baseUrl ?? ""}/api/session`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal,
  } as RequestInit);

  if (response.status === 401) return { loggedIn: false };
  if (!response.ok) {
    throw new Error(`Session request failed (${response.status})`);
  }

  const json = (await response.json()) as Record<string, unknown> | null;
  if (json && typeof json.loggedIn === "boolean") {
    return {
      loggedIn: json.loggedIn,
      expiresAt: typeof json.expiresAt === "number" ? json.expiresAt : undefined,
    };
  }
  // Legacy route that returns the whole session: never pass tokens through.
  return { loggedIn: Boolean(json && (json as { token?: unknown }).token) };
}

/**
 * Path that starts a login and returns to `returnTo` afterwards.
 * Navigate the browser to it (`window.location.href = loginPath(...)`).
 */
export function loginPath(returnTo?: string, authPath = "/auth"): string {
  return returnTo ? `${authPath}?returnTo=${encodeURIComponent(returnTo)}` : authPath;
}

/** Path that logs out of the app and the Shopwave auth server. */
export function logoutPath(authPath = "/auth"): string {
  return `${authPath}/logout`;
}

/**
 * Ends the current server session (no redirect).
 *
 * Prefer navigating to {@link logoutPath} when using
 * `react-shopwave-connect/next`: it also signs the user out of the auth server.
 */
export async function logout(options: RequestOptions = {}): Promise<void> {
  await apiDelete("/api/session?action=logout", options);
}
