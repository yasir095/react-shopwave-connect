import { apiDelete, type RequestOptions } from "./request";

/**
 * Ends the current server session.
 *
 * This is the framework-agnostic half of the original `useLogout` hook. The
 * Next.js-specific redirect logic (router.push to the auth server logout URL,
 * built from server actions) is intentionally NOT included here because it is
 * tied to `next/navigation` and `'use server'` actions — see the README.
 */
export async function logout(options: RequestOptions = {}): Promise<void> {
  await apiDelete("/api/session?action=logout", options);
}
