/**
 * react-shopwave-connect/next
 *
 * Drop-in Shopwave OAuth for Next.js (App Router, v14+): login + callback +
 * logout route handlers, an encrypted httpOnly session cookie (iron-session),
 * automatic token refresh, a route-handler guard and a proxy/middleware guard.
 *
 * Per app you only supply config (client id/secret, redirect URI, session
 * password). Server-only: never import this from a client component.
 *
 * Peer dependencies: `next` (>=14) and `iron-session` (8 or 9).
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getIronSession, unsealData, type IronSession, type SessionOptions } from "iron-session";

import { createShopwaveOAuth, type ShopwaveOAuthClient, type ShopwaveOAuthConfig } from "../server/oauth";
import {
  authorizationHeader,
  isTokenExpired,
  normalizeStoredToken,
  type ShopwaveToken,
} from "../server/token";
import { createState, safeEqual, sanitizeReturnTo } from "../server/returnTo";
import { ShopwaveAuthError } from "../server/errors";
import {
  createShopwaveApiHandlers,
  readRequestToken,
  type ShopwaveApiConfig,
  type ShopwaveApiHandlers,
} from "../server/api";
import type { SessionStatus } from "../core/session";

export type { SessionStatus } from "../core/session";
export type { ShopwaveToken } from "../server/token";
export { ShopwaveAuthError } from "../server/errors";
export { isExpiredTokenResponse, authorizationHeader } from "../server/token";
export { readRequestToken, SHOPWAVE_ENTITIES } from "../server";
export type {
  ShopwaveApiHandlers,
  CollectionHandlers,
  ItemHandlers,
  RouteContext,
  RouteHandler,
  ForwardInit,
  EntityKind,
  EntityDefinition,
} from "../server";

// ---------------------------------------------------------------------------
// Config & types
// ---------------------------------------------------------------------------

export interface ShopwaveSessionConfig {
  /**
   * Encrypts the session cookie. At least 32 characters. Pass a map such as
   * `{ 2: newPassword, 1: oldPassword }` to rotate without logging users out.
   */
  password: string | Record<string, string>;
  /** Defaults to `"shopwave_session"`. Use a different name per app on a shared domain. */
  cookieName?: string;
  /** Session lifetime in seconds. Defaults to iron-session's 14 days. */
  ttl?: number;
  /** Defaults to `true` in production, `false` otherwise (so http://localhost works). */
  secure?: boolean;
  /** Defaults to `"lax"`, which the OAuth redirect back to your app needs. */
  sameSite?: "lax" | "strict" | "none";
  domain?: string;
}

export interface ShopwaveAuthConfig extends ShopwaveOAuthConfig {
  session: ShopwaveSessionConfig;
  /**
   * Path where `handlers.auth` is mounted. It starts the login AND receives the
   * callback, so it should be the path of `redirectUri`. Defaults to `"/auth"`.
   */
  authPath?: string;
  /** Path where `handlers.logout` is mounted. Defaults to `${authPath}/logout`. */
  logoutPath?: string;
  /**
   * Path where `handlers.session` is mounted. Always public, because it is how
   * the browser finds out it is logged out. Defaults to `"/api/session"`.
   */
  sessionPath?: string;
  /** Where users land after login when no `returnTo` was given. Defaults to `"/"`. */
  defaultReturnTo?: string;
  /**
   * Reject callbacks whose `state` doesn't match the one we sent (login-CSRF
   * protection). Defaults to `true`. Only turn off if the auth server does not
   * echo `state` back.
   */
  requireState?: boolean;
  /**
   * Refresh this many seconds before expiry. Defaults to `0`, because the
   * Shopwave server only issues a new access token once the old one expired.
   */
  refreshSkewSeconds?: number;
  /** How long a started login stays valid, in seconds. Defaults to 600. */
  loginTimeoutSeconds?: number;
}

/** What we keep in the encrypted cookie. Tokens never leave the server. */
export interface ShopwaveSessionData {
  token?: ShopwaveToken | Record<string, unknown>;
  pendingLogin?: { state: string; returnTo: string; createdAt: number };
}

export interface AuthContext {
  accessToken: string;
  /** Ready-to-use `Authorization` header value, e.g. `OAuth 111ad…`. */
  authorization: string;
  token: ShopwaveToken;
}

export interface ProtectOptions {
  /**
   * Paths that don't need a login. A path matches itself and everything below
   * it (`"/tools/tag-joiner"` covers `/tools/tag-joiner/x`). `"/"` matches only
   * the root. The auth, logout and session paths are always public.
   */
  publicPaths?: string[];
  /** Paths that get a 401 JSON response instead of a login redirect. Defaults to `["/api"]`. */
  apiPaths?: string[];
  /**
   * Let API requests that carry their own token (`Authorization: OAuth <token>`,
   * or the legacy `token` header / `extras.token`) through without a session
   * cookie. The route handlers from {@link createShopwaveApi} forward that token
   * to the Shopwave API, which validates it. Defaults to `false`.
   */
  allowRequestToken?: boolean;
}

export interface ShopwaveAuth {
  /** The underlying framework-agnostic OAuth client. */
  readonly oauth: ShopwaveOAuthClient;
  /** Route handlers to export from your app. */
  readonly handlers: {
    /** Mount at the redirect-URI path (e.g. `app/auth/route.ts`): `export const GET = auth.handlers.auth`. */
    auth: (request: Request) => Promise<Response>;
    /** Mount at `app/auth/logout/route.ts`: `export const GET = auth.handlers.logout`. */
    logout: (request: Request) => Promise<Response>;
    /** Mount at `app/api/session/route.ts`: `export const { GET, DELETE } = auth.handlers.session`. */
    session: {
      GET: (request?: Request) => Promise<Response>;
      DELETE: (request?: Request) => Promise<Response>;
    };
  };
  /** Login status for the current request. Never includes tokens. */
  getStatus(): Promise<SessionStatus>;
  /**
   * A valid access token for the current user, refreshing it when expired
   * (and saving the new one in the cookie when called from a route handler,
   * server action or proxy). `null` when logged out or the refresh token was
   * rejected. Pass `forceRefresh` after the API answered 401 / error 908.
   */
  getAccessToken(options?: { forceRefresh?: boolean }): Promise<string | null>;
  /** Same as `getAccessToken` but returns the whole token object. */
  getToken(options?: { forceRefresh?: boolean }): Promise<ShopwaveToken | null>;
  /** `Authorization` header value (`"OAuth <token>"`), or `null` when logged out. */
  getAuthorizationHeader(options?: { forceRefresh?: boolean }): Promise<string | null>;
  /** Wraps a route handler; responds 401 JSON when there's no valid session. */
  withAuth<C = unknown>(
    handler: (request: Request, context: C, auth: AuthContext) => Response | Promise<Response>
  ): (request: Request, context: C) => Promise<Response>;
  /**
   * For `proxy.ts` / `middleware.ts`. Returns a redirect (pages) or 401
   * (API paths) when the request has no session, or `undefined` to continue.
   * Only reads the cookie — it never calls the auth server.
   */
  protect(request: Request, options?: ProtectOptions): Promise<Response | undefined>;
  /** Cookie-only check usable anywhere you have the Request. */
  isAuthenticated(request: Request): Promise<boolean>;
  /** Link that starts the login and comes back to `returnTo`. */
  loginPath(returnTo?: string): string;
  /** Link that logs the user out of the app and the auth server. */
  readonly logoutPath: string;
  /** Raw iron-session for advanced use (e.g. storing app data alongside the token). */
  getSession(): Promise<IronSession<ShopwaveSessionData>>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function normalizePath(p: string): string {
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

function pathMatches(pathname: string, list: string[]): boolean {
  return list.some((raw) => {
    const p = normalizePath(raw);
    if (p === "/") return pathname === "/";
    return pathname === p || pathname.startsWith(`${p}/`);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

function readCookie(request: Request, name: string): string | undefined {
  const fromNext = (request as { cookies?: { get?: (n: string) => { value?: string } | undefined } })
    .cookies?.get?.(name)?.value;
  if (fromNext) return fromNext;
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      const value = part.slice(idx + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return undefined;
}

let warnedAboutReadOnlyCookies = false;

/**
 * Creates the Shopwave auth instance for one Next.js app. Call once at module
 * scope (e.g. `lib/auth.ts`) and reuse. Config is validated on first use, so
 * a missing env var doesn't fail `next build`.
 */
export function createShopwaveAuth(config: ShopwaveAuthConfig): ShopwaveAuth {
  if (typeof window !== "undefined") {
    throw new Error("react-shopwave-connect/next is server-only. Import it from route handlers, server code or proxy.ts.");
  }

  const oauth = createShopwaveOAuth(config);
  const authPath = normalizePath(config.authPath ?? "/auth");
  const logoutPath = normalizePath(config.logoutPath ?? `${authPath}/logout`);
  const sessionPath = normalizePath(config.sessionPath ?? "/api/session");
  const defaultReturnTo = sanitizeReturnTo(config.defaultReturnTo, "/");
  const requireState = config.requireState ?? true;
  const skewSeconds = config.refreshSkewSeconds ?? 0;
  const loginTimeoutMs = (config.loginTimeoutSeconds ?? 600) * 1000;
  const cookieName = config.session?.cookieName ?? "shopwave_session";

  /**
   * Refresh de-duplication, per server instance. Requests that read the same
   * (old) token share one refresh while it's in flight, and for a short while
   * afterwards reuse its result instead of refreshing again.
   */
  const inflightRefresh = new Map<string, Promise<ShopwaveToken>>();
  const recentRefresh = new Map<string, { token: ShopwaveToken; at: number }>();
  const RECENT_REFRESH_MS = 30_000;

  function sessionOptions(): SessionOptions {
    const password = config.session?.password;
    const passwords = typeof password === "string" ? [password] : Object.values(password ?? {});
    if (passwords.length === 0 || passwords.some((p) => typeof p !== "string" || p.length < 32)) {
      throw new ShopwaveAuthError(
        "config_invalid",
        "Shopwave auth: session.password must be at least 32 characters (set a long random secret in your env)."
      );
    }
    const cookieOptions: SessionOptions["cookieOptions"] = {
      httpOnly: true,
      secure: config.session.secure ?? process.env.NODE_ENV === "production",
      sameSite: config.session.sameSite ?? "lax",
      path: "/",
    };
    if (config.session.domain) cookieOptions.domain = config.session.domain;
    const options: SessionOptions = {
      cookieName,
      password: password as SessionOptions["password"],
      cookieOptions,
    };
    // Only pass ttl when set: an explicit `undefined` overrides iron-session's
    // 14-day default and produces `Max-Age=NaN`.
    if (typeof config.session.ttl === "number") options.ttl = config.session.ttl;
    return options;
  }

  async function getSession(): Promise<IronSession<ShopwaveSessionData>> {
    return getIronSession<ShopwaveSessionData>(await cookies(), sessionOptions());
  }

  /**
   * Cookies can only be written from route handlers, server actions and proxy.
   * From a Server Component the token is still usable for this request; it will
   * simply be refreshed again next time.
   */
  async function trySave(session: IronSession<ShopwaveSessionData>): Promise<void> {
    try {
      await session.save();
    } catch (error) {
      if (!warnedAboutReadOnlyCookies) {
        warnedAboutReadOnlyCookies = true;
        console.warn(
          "[react-shopwave-connect] Could not update the session cookie (called outside a route handler / server action?).",
          (error as Error)?.message
        );
      }
    }
  }

  function tryDestroy(session: IronSession<ShopwaveSessionData>): void {
    try {
      session.destroy();
    } catch {
      /* read-only cookie context — nothing to clear */
    }
  }

  function refreshOnce(token: ShopwaveToken): Promise<ShopwaveToken> {
    const key = `${token.refreshToken}\u0000${token.accessToken}`;
    const now = Date.now();

    const recent = recentRefresh.get(key);
    if (recent && now - recent.at < RECENT_REFRESH_MS) return Promise.resolve(recent.token);

    let pending = inflightRefresh.get(key);
    if (!pending) {
      pending = oauth
        .refreshToken(token)
        .then((fresh) => {
          for (const [k, v] of recentRefresh) if (now - v.at >= RECENT_REFRESH_MS) recentRefresh.delete(k);
          recentRefresh.set(key, { token: fresh, at: Date.now() });
          return fresh;
        })
        .finally(() => inflightRefresh.delete(key));
      inflightRefresh.set(key, pending);
    }
    return pending;
  }

  async function getToken({ forceRefresh = false }: { forceRefresh?: boolean } = {}): Promise<ShopwaveToken | null> {
    const session = await getSession();
    const token = normalizeStoredToken(session.token);
    if (!token) return null;

    const expired = isTokenExpired(token, { skewSeconds });
    if (!forceRefresh && !expired) return token;

    if (!token.refreshToken) {
      if (expired || forceRefresh) {
        tryDestroy(session);
        return null;
      }
      return token;
    }

    try {
      const refreshed = await refreshOnce(token);
      session.token = refreshed;
      await trySave(session);
      return refreshed;
    } catch (error) {
      if (error instanceof ShopwaveAuthError && error.isInvalidGrant) {
        // Refresh token rejected: the user has to sign in again.
        tryDestroy(session);
        return null;
      }
      throw error;
    }
  }

  function loginPath(returnTo?: string): string {
    if (!returnTo) return authPath;
    const safe = sanitizeReturnTo(returnTo, defaultReturnTo);
    return `${authPath}?returnTo=${encodeURIComponent(safe)}`;
  }

  function redirectTo(location: string, request: Request): Response {
    return NextResponse.redirect(new URL(location, request.url), 302);
  }

  function errorPage(status: number, message: string, retryHref: string): Response {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in problem</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">Sign-in didn’t complete</h1><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(retryHref)}">Try again</a></p></body></html>`;
    return new NextResponse(html, {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  async function authHandler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const session = await getSession();
    const pending = session.pendingLogin;

    // The auth server reported a problem (e.g. user cancelled).
    const oauthError = url.searchParams.get("error");
    if (oauthError) {
      delete session.pendingLogin;
      await trySave(session);
      const detail = url.searchParams.get("error_description") || oauthError;
      return errorPage(400, `Shopwave sign-in reported: ${detail}.`, loginPath(pending?.returnTo));
    }

    const code = url.searchParams.get("code");

    // 1) No code: start a login.
    if (!code) {
      const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"), defaultReturnTo);
      const state = createState();
      session.pendingLogin = { state, returnTo, createdAt: Date.now() };
      await session.save();
      return NextResponse.redirect(oauth.buildLoginUrl({ state }), 302);
    }

    // 2) Callback: verify state, exchange the code, store the token.
    const returnedState = url.searchParams.get("state");
    const isFresh = !!pending && Date.now() - pending.createdAt <= loginTimeoutMs;
    const stateMatches = !!pending && !!returnedState && safeEqual(returnedState, pending.state);
    const rejected = requireState
      ? !(stateMatches && isFresh)
      : !!pending && !!returnedState && !stateMatches;

    if (rejected) {
      delete session.pendingLogin;
      await trySave(session);
      return errorPage(
        400,
        "This sign-in link has expired or didn’t start from this browser. Please sign in again.",
        loginPath(pending?.returnTo)
      );
    }

    let token: ShopwaveToken;
    try {
      token = await oauth.exchangeCode(code);
    } catch (error) {
      console.error("[react-shopwave-connect] Code exchange failed:", (error as Error)?.message);
      delete session.pendingLogin;
      await trySave(session);
      const status = error instanceof ShopwaveAuthError && error.isInvalidGrant ? 400 : 502;
      return errorPage(status, "We couldn’t complete sign-in with Shopwave.", loginPath(pending?.returnTo));
    }

    const returnTo = pending?.returnTo ?? defaultReturnTo;
    delete session.pendingLogin;
    session.token = token;
    await session.save();
    return redirectTo(returnTo, request);
  }

  async function logoutHandler(_request: Request): Promise<Response> {
    const session = await getSession();
    session.destroy();
    return NextResponse.redirect(oauth.buildLogoutUrl(), 302);
  }

  async function getStatus(): Promise<SessionStatus> {
    const session = await getSession();
    const token = normalizeStoredToken(session.token);
    if (!token) return { loggedIn: false };
    const usable = !isTokenExpired(token) || !!token.refreshToken;
    return usable ? { loggedIn: true, expiresAt: token.expiresAt } : { loggedIn: false };
  }

  async function isAuthenticated(request: Request): Promise<boolean> {
    const value = readCookie(request, cookieName);
    if (!value) return false;
    try {
      const { password, ttl } = sessionOptions();
      const data = await unsealData<ShopwaveSessionData>(value, { password, ttl });
      const token = normalizeStoredToken(data?.token);
      return !!token && (!isTokenExpired(token) || !!token.refreshToken);
    } catch {
      return false;
    }
  }

  const noStore = { "Cache-Control": "no-store" };

  return {
    oauth,
    logoutPath,
    loginPath,
    getSession,
    getStatus,
    getToken,

    async getAccessToken(options) {
      return (await getToken(options))?.accessToken ?? null;
    },

    async getAuthorizationHeader(options) {
      const token = await getToken(options);
      return token ? authorizationHeader(token) : null;
    },

    withAuth(handler) {
      return async (request, context) => {
        const token = await getToken();
        if (!token) {
          return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
        }
        return handler(request, context, {
          accessToken: token.accessToken,
          authorization: authorizationHeader(token),
          token,
        });
      };
    },

    isAuthenticated,

    async protect(request, options = {}) {
      const { pathname, search } = new URL(request.url);
      if (pathMatches(pathname, [authPath, logoutPath, sessionPath, ...(options.publicPaths ?? [])])) {
        return undefined;
      }
      const isApi = pathMatches(pathname, options.apiPaths ?? ["/api"]);
      if (isApi && options.allowRequestToken && readRequestToken(request)) return undefined;
      if (await isAuthenticated(request)) return undefined;
      if (isApi) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
      }
      return redirectTo(loginPath(pathname + search), request);
    },

    handlers: {
      auth: authHandler,
      logout: logoutHandler,
      session: {
        async GET() {
          return NextResponse.json(await getStatus(), { headers: noStore });
        },
        async DELETE() {
          const session = await getSession();
          session.destroy();
          return new NextResponse(null, { status: 204, headers: noStore });
        },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// API route handlers
// ---------------------------------------------------------------------------

export interface ShopwaveNextApiConfig extends Omit<ShopwaveApiConfig, "getAuthorization"> {
  /** The app's auth instance: supplies (and refreshes) the logged-in user's token. */
  auth: Pick<ShopwaveAuth, "getAuthorizationHeader">;
}

/**
 * Ready-made Next.js route handlers for the SDK's `/api/*` contract, using the
 * session from `createShopwaveAuth`. Create once (e.g. `lib/shopwave.ts`):
 *
 * ```ts
 * export const shopwave = createShopwaveApi({ auth, apiUrl: process.env.SHOPWAVE_API_SERVER_URL! });
 * ```
 *
 * then each route file is one line:
 *
 * ```ts
 * // app/api/products/route.ts
 * export const { GET, POST, PUT } = shopwave.collection("product");
 * // app/api/products/[id]/route.ts
 * export const { GET, PUT, DELETE } = shopwave.item("product");
 * // app/api/report/route.ts
 * export const { GET } = shopwave.passthrough("report");
 * ```
 */
export function createShopwaveApi(config: ShopwaveNextApiConfig): ShopwaveApiHandlers {
  if (typeof window !== "undefined") {
    throw new Error("react-shopwave-connect/next is server-only. Import it from route handlers or server code.");
  }
  const { auth, ...rest } = config;
  return createShopwaveApiHandlers({
    ...rest,
    getAuthorization: (options) => auth.getAuthorizationHeader(options),
  });
}
