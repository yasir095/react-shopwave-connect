import { logout, type RequestOptions } from "../core";
import { useMutation, type MutationState } from "./shared";

/**
 * Manually-triggered logout (ends the server session).
 *
 * This is framework-agnostic and does NOT redirect. The original `useLogout`
 * also pushed the browser to the auth-server logout URL via `next/navigation`
 * and `'use server'` actions; that part is Next-specific and stays in your app.
 *
 * @example
 * const { mutate: doLogout } = useLogout();
 * await doLogout();
 * router.push(logoutUrl); // app-specific redirect
 */
export function useLogout(
  options?: RequestOptions
): MutationState<void, []> {
  return useMutation<void, []>(
    () => logout(options),
    [options?.baseUrl, options?.token]
  );
}

export default useLogout;
