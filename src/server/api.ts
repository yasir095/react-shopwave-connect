/**
 * Server half of the SDK's API contract: route handlers that sit between the
 * `core` client functions (which call `/api/<route>`) and the Shopwave REST API.
 *
 * Framework-neutral (Web `Request` → `Response`), so they work in Next.js route
 * handlers, Remix, Hono, Bun, Deno or Node 18+. `react-shopwave-connect/next`
 * wires them to the Next.js session (`createShopwaveApi`).
 *
 * What a handler does for every call:
 *  1. Picks the token: the one the caller sent (`Authorization: OAuth <token>`,
 *     when `allowRequestToken` is on), otherwise the logged-in user's.
 *  2. Turns the client's `extras` header (query parameters, JSON) into upstream
 *     headers, dropping anything that could override auth or transport headers.
 *  3. Sends writes as the form field `postBody=<JSON>` that Shopwave expects.
 *  4. When the API says the session token expired (HTTP 401 or error 908),
 *     refreshes it once and retries.
 *  5. Answers with the upstream status and body unchanged (201 for saves,
 *     205 + empty body for deletes, Shopwave error envelopes as-is).
 */

import {
  SHOPWAVE_ENTITIES,
  type EntityDefinition,
  type EntityKind,
} from "../core/entities";
import { isExpiredTokenResponse } from "./token";

// ---------------------------------------------------------------------------
// Request token
// ---------------------------------------------------------------------------

/**
 * The OAuth token a caller sent with the request, without its scheme, or `null`.
 *
 * Reads, in order: `Authorization: OAuth|Bearer <token>` (what the SDK sends
 * from 0.3), the `token` header (SDK ≤ 0.2 writes), and `extras.token`
 * (SDK ≤ 0.2 reads).
 */
export function readRequestToken(request: Request): string | null {
  const authz = request.headers.get("authorization");
  if (authz) {
    const match = /^(?:oauth|bearer)\s+(\S+)\s*$/i.exec(authz);
    if (match) return match[1];
  }
  const legacyHeader = request.headers.get("token");
  if (legacyHeader && legacyHeader.trim()) return legacyHeader.trim();

  const extras = request.headers.get("extras");
  if (extras) {
    try {
      const token = (JSON.parse(extras) as { token?: unknown } | null)?.token;
      if (typeof token === "string" && token.trim()) return token.trim();
    } catch {
      /* invalid extras are reported by the handler */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// extras → upstream headers
// ---------------------------------------------------------------------------

/**
 * `extras` keys that are never forwarded upstream (case-insensitive).
 * `Content-Type` is allowed (SDK clients have always sent `application/json`
 * on reads) but is replaced by the form content type on writes.
 */
export const BLOCKED_EXTRAS: ReadonlySet<string> = new Set([
  "authorization",
  "token",
  "cookie",
  "host",
  "x-accept-version",
  "content-length",
  "connection",
  "transfer-encoding",
  "te",
  "upgrade",
  "expect",
  "keep-alive",
  "proxy-authorization",
  "forwarded",
]);

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

function headerValue(value: unknown): string | null {
  if (value == null) return null;
  let text: string;
  if (Array.isArray(value)) text = value.map((v) => (v != null && typeof v === "object" ? JSON.stringify(v) : String(v))).join(",");
  else if (typeof value === "object") text = JSON.stringify(value);
  else text = String(value);
  // CR/LF/NUL would make the header invalid (and could split it).
  return /[\r\n\0]/.test(text) ? null : text;
}

/**
 * Parses the `extras` request header into upstream headers.
 * Returns `null` when the header isn't a JSON object.
 */
export function parseExtras(
  raw: string | null,
  blocked: ReadonlySet<string> = BLOCKED_EXTRAS
): Record<string, string> | null {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (!HEADER_NAME.test(key) || blocked.has(lower) || lower.startsWith("x-forwarded-") || lower.startsWith("proxy-")) {
      continue;
    }
    const text = headerValue(value);
    if (text !== null) headers[key] = text;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Write bodies
// ---------------------------------------------------------------------------

export class RequestBodyError extends Error {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalises a write request body into the Shopwave envelope
 * `{ <collection>: { <ref>: entity, … } }`.
 *
 * Accepts:
 *  - the SDK ≥ 0.3 shape `{ <collection>: { "0": {...}, "1": {...} } }` (refs kept),
 *  - the older AdminUI shapes `{ <collection>: { new: {...} } }` / `{ updated: {...} }`,
 *  - a bare entity object `{ title: … }`.
 *
 * With `forcedId` (item routes) exactly one entity is allowed and its `id` is
 * set from the URL.
 */
export function normalizeWriteBody(
  def: Pick<EntityDefinition, "collection">,
  body: unknown,
  forcedId?: string
): Record<string, Record<string, Record<string, unknown>>> {
  if (!isPlainObject(body)) throw new RequestBodyError("Request body must be a JSON object");

  let refs: Record<string, Record<string, unknown>>;
  const wrapped = body[def.collection];

  if (wrapped !== undefined) {
    if (!isPlainObject(wrapped)) throw new RequestBodyError(`"${def.collection}" must be an object keyed by ref`);
    const keys = Object.keys(wrapped);
    const legacy = keys.length === 1 && (keys[0] === "new" || keys[0] === "updated");
    const entries = legacy ? [["0", wrapped[keys[0]]] as const] : Object.entries(wrapped);
    refs = {};
    for (const [ref, entity] of entries) {
      if (!isPlainObject(entity)) throw new RequestBodyError(`"${def.collection}.${ref}" must be an object`);
      refs[ref] = { ...entity };
    }
  } else {
    refs = { "0": { ...body } };
  }

  const count = Object.keys(refs).length;
  if (count === 0) throw new RequestBodyError(`No ${def.collection} to save`);

  if (forcedId !== undefined) {
    if (count !== 1) throw new RequestBodyError("Only one entity can be saved at an id route");
    const only = refs[Object.keys(refs)[0]];
    only.id = /^\d+$/.test(forcedId) ? Number(forcedId) : forcedId;
  }

  return { [def.collection]: refs };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export interface ShopwaveApiConfig {
  /** Shopwave API base URL, e.g. `process.env.SHOPWAVE_API_SERVER_URL`. */
  apiUrl: string;
  /**
   * `Authorization` header value for the logged-in user (`"OAuth <token>"`),
   * or `null` when logged out. Called again with `forceRefresh: true` when the
   * API reports the token expired.
   */
  getAuthorization?: (options?: { forceRefresh?: boolean }) => Promise<string | null>;
  /**
   * Accept a token sent by the caller (`Authorization: OAuth <token>`, or the
   * legacy `token` header / `extras.token`) instead of the session. The token
   * is only forwarded to the Shopwave API, which validates it. Defaults to `true`
   * (SDK integration tests, scripts and server-to-server calls rely on it).
   */
  allowRequestToken?: boolean;
  /** `x-accept-version` sent upstream. Defaults to `"2.0"`. */
  apiVersion?: string;
  /** Custom fetch for the upstream call. */
  fetch?: typeof fetch;
  /** Override how an entity is addressed (e.g. a different id header). */
  entities?: Partial<Record<EntityKind, Partial<EntityDefinition>>>;
  /** Extra `extras` keys to drop, on top of {@link BLOCKED_EXTRAS}. */
  blockedExtras?: string[];
  /**
   * Called when the upstream call throws (network error). Defaults to a
   * `console.error` with the method and path only — never headers or tokens.
   */
  onError?: (error: unknown, context: { method: string; path: string }) => void;
}

export interface ForwardInit {
  /** HTTP method sent upstream. Defaults to `GET`. */
  method?: string;
  /** Shopwave API path, e.g. `"product"`. */
  path: string;
  /** Extra upstream headers; they win over `extras`. */
  headers?: Record<string, string>;
  /** Sent as the form field `postBody=<JSON>`. */
  postBody?: unknown;
  /** Forward the caller's `extras` header as upstream headers. Defaults to `true`. */
  forwardExtras?: boolean;
}

/** Second argument Next.js (and similar) pass to dynamic route handlers. */
export interface RouteContext {
  params?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
}

export type RouteHandler = (request: Request, context?: RouteContext) => Promise<Response>;

export interface CollectionHandlers {
  /** List/filter via `extras` (e.g. `productIds`, `deleted`). */
  GET: RouteHandler;
  /** Create or update (Shopwave upserts: an `id` means update). */
  POST: RouteHandler;
  /** Same as POST (kept for older clients). */
  PUT: RouteHandler;
}

export interface ItemHandlers {
  /** Read one record by the `[id]` route param. */
  GET: RouteHandler;
  /** Update the record at `[id]` (the id in the URL wins). */
  PUT: RouteHandler;
  /** Delete the record at `[id]`. Shopwave answers 205 with an empty body. */
  DELETE: RouteHandler;
}

export interface ShopwaveApiHandlers {
  /** Calls the Shopwave API for this request (token, extras, refresh-retry) and returns its answer. */
  forward(request: Request, init: ForwardInit): Promise<Response>;
  /** Handlers for `app/api/<route>/route.ts`. */
  collection(kind: EntityKind): CollectionHandlers;
  /** Handlers for `app/api/<route>/[id]/route.ts`. */
  item(kind: EntityKind, options?: { param?: string }): ItemHandlers;
  /** GET-only proxy for a Shopwave path (e.g. `"report"`, `"user"`, `"merchant"`). */
  passthrough(path: string): { GET: RouteHandler };
  /** The entity table in use (defaults merged with `config.entities`). */
  entity(kind: EntityKind): EntityDefinition;
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

function jsonError(status: number, error: string, message: string): Response {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { "Content-Type": "application/json", ...NO_STORE },
  });
}

/** `YYYY-MM-DD HH:mm:ss` in UTC, the datetime format Shopwave writes use (e.g. promotions). */
export function shopwaveDateTime(date: Date = new Date()): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

async function readUpstream(response: Response): Promise<{ text: string; json: unknown }> {
  const text = await response.text();
  if (!text) return { text, json: null };
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
}

async function routeParam(context: RouteContext | undefined, name: string): Promise<string | null> {
  const params = await context?.params;
  const value = params?.[name];
  const id = Array.isArray(value) ? value[0] : value;
  return typeof id === "string" && ID_PATTERN.test(id) ? id : null;
}

export function createShopwaveApiHandlers(config: ShopwaveApiConfig): ShopwaveApiHandlers {
  const allowRequestToken = config.allowRequestToken ?? true;
  const apiVersion = config.apiVersion ?? "2.0";
  const blocked = new Set([...BLOCKED_EXTRAS, ...(config.blockedExtras ?? []).map((k) => k.toLowerCase())]);
  const onError =
    config.onError ??
    ((error: unknown, ctx: { method: string; path: string }) =>
      console.error(`[react-shopwave-connect] Shopwave API ${ctx.method} /${ctx.path} failed:`, (error as Error)?.message ?? error));

  function apiBase(): string {
    const url = config.apiUrl;
    if (!url) throw new Error("Shopwave API: apiUrl is not set (e.g. SHOPWAVE_API_SERVER_URL).");
    return url.replace(/\/+$/, "");
  }

  function entity(kind: EntityKind): EntityDefinition {
    const base = SHOPWAVE_ENTITIES[kind];
    if (!base) throw new Error(`Unknown Shopwave entity "${kind}"`);
    return { ...base, ...(config.entities?.[kind] ?? {}) };
  }

  async function forward(request: Request, init: ForwardInit): Promise<Response> {
    const method = (init.method ?? "GET").toUpperCase();
    const path = init.path.replace(/^\/+/, "");

    const extras = init.forwardExtras === false ? {} : parseExtras(request.headers.get("extras"), blocked);
    if (!extras) return jsonError(400, "invalid_extras", "The extras header must be a JSON object");

    const requestToken = allowRequestToken ? readRequestToken(request) : null;
    let authorization: string | null;
    try {
      authorization = requestToken ? `OAuth ${requestToken}` : (await config.getAuthorization?.()) ?? null;
    } catch (error) {
      onError(error, { method, path: "oauth/token" });
      return jsonError(502, "auth_unavailable", "Could not refresh the Shopwave session");
    }
    if (!authorization) return jsonError(401, "unauthorized", "Not logged in");

    const body =
      init.postBody === undefined ? undefined : new URLSearchParams({ postBody: JSON.stringify(init.postBody) });

    const call = (authz: string) => {
      // Headers is case-insensitive, so explicit headers replace any extras
      // key that differs only in case.
      const headers = new Headers(extras);
      for (const [k, v] of Object.entries(init.headers ?? {})) headers.set(k, v);
      headers.set("Authorization", authz);
      headers.set("x-accept-version", apiVersion);
      if (body) headers.set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
      const doFetch = config.fetch ?? fetch;
      return doFetch(`${apiBase()}/${path}`, { method, headers, body, cache: "no-store" } as RequestInit);
    };

    try {
      let response = await call(authorization);
      let upstream = await readUpstream(response);

      // Session token expired: refresh once and retry. Caller-supplied tokens
      // are the caller's to refresh.
      if (!requestToken && config.getAuthorization && isExpiredTokenResponse(response.status, upstream.json)) {
        const fresh = await config.getAuthorization({ forceRefresh: true });
        if (!fresh) return jsonError(401, "unauthorized", "The Shopwave session has expired");
        response = await call(fresh);
        upstream = await readUpstream(response);
      }

      if (NULL_BODY_STATUS.has(response.status) || !upstream.text) {
        return new Response(null, { status: response.status, headers: NO_STORE });
      }
      return new Response(upstream.text, {
        status: response.status,
        headers: {
          "Content-Type": upstream.json !== null ? "application/json" : response.headers.get("content-type") ?? "text/plain",
          ...NO_STORE,
        },
      });
    } catch (error) {
      onError(error, { method, path });
      return jsonError(502, "upstream_unavailable", "The Shopwave API could not be reached");
    }
  }

  async function readJsonBody(request: Request): Promise<unknown> {
    const text = await request.text();
    if (!text) throw new RequestBodyError("Request body is empty");
    try {
      return JSON.parse(text);
    } catch {
      throw new RequestBodyError("Request body is not valid JSON");
    }
  }

  function notSupported(def: EntityDefinition, what: string): Response {
    return jsonError(405, "method_not_allowed", `The Shopwave API doesn't support ${what} for ${def.collection}`);
  }

  async function write(request: Request, def: EntityDefinition, forcedId?: string): Promise<Response> {
    if (!def.writable) return notSupported(def, "writes");
    let postBody: unknown;
    try {
      postBody = normalizeWriteBody(def, await readJsonBody(request), forcedId);
    } catch (error) {
      if (error instanceof RequestBodyError) return jsonError(400, "invalid_body", error.message);
      throw error;
    }
    return forward(request, { method: "POST", path: def.upstream, postBody });
  }

  function badId(): Response {
    return jsonError(400, "invalid_id", "Missing or invalid id");
  }

  return {
    forward,
    entity,

    collection(kind) {
      const def = entity(kind);
      const save: RouteHandler = (request) => write(request, def);
      return {
        GET: (request) => forward(request, { path: def.upstream }),
        POST: save,
        PUT: save,
      };
    },

    item(kind, options = {}) {
      const def = entity(kind);
      const param = options.param ?? "id";
      return {
        async GET(request, context) {
          const id = await routeParam(context, param);
          if (!id) return badId();
          return forward(request, { path: def.upstream, headers: { [def.idsHeader]: id } });
        },
        async PUT(request, context) {
          const id = await routeParam(context, param);
          if (!id) return badId();
          return write(request, def, id);
        },
        async DELETE(request, context) {
          const id = await routeParam(context, param);
          if (!id) return badId();
          if (def.deleteMode === "none") return notSupported(def, "deletes");
          if (def.deleteMode === "retire") {
            // No DELETE upstream (employees, promotions): set the end date to now.
            const field = def.retireField ?? "exitDate";
            return forward(request, {
              method: "POST",
              path: def.upstream,
              postBody: { [def.collection]: { 0: { id: /^\d+$/.test(id) ? Number(id) : id, [field]: shopwaveDateTime() } } },
              forwardExtras: false,
            });
          }
          return forward(request, { method: "DELETE", path: def.upstream, headers: { [def.idHeader]: id }, forwardExtras: false });
        },
      };
    },

    passthrough(path) {
      return { GET: (request) => forward(request, { path }) };
    },
  };
}
