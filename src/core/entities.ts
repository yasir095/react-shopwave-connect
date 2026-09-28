import { apiDelete, apiGet, apiRequest, type RequestOptions } from "./request";
import { ShopwaveApiError, assertNoApiErrors } from "./errors";
import type { Product } from "./product";
import type { Category } from "./category";
import type { Store } from "./store";
import type { Promotion } from "./promotion";
import type { Employee } from "./employee";
import type { Consumer } from "./consumer";

/**
 * How each Shopwave entity is addressed, shared by the client functions below
 * and the server route handlers in `react-shopwave-connect/next`, so the two
 * halves of the contract can't drift apart.
 */
export interface EntityDefinition {
  /** App route segment: `/api/<route>` and `/api/<route>/<id>`. */
  route: string;
  /** Key of the entity map in requests and responses (`{ products: { … } }`). */
  collection: string;
  /** Shopwave API path (`GET/POST/DELETE {apiUrl}/<upstream>`). */
  upstream: string;
  /** Header that filters reads by id (`productIds: 1,2`). */
  idsHeader: string;
  /** Header that names the record to delete (`productId: 1`). */
  idHeader: string;
  /** False for read-only entities (the API has no POST for them). */
  writable: boolean;
  /**
   * How a delete is done upstream:
   * - `"delete"`: `DELETE {apiUrl}/<upstream>` with the `idHeader` (205, empty body)
   * - `"retire"`: the API has no DELETE; the record is retired by POSTing
   *   `{ id, [retireField]: <now> }` (employees: `exitDate`, promotions: `endDate`)
   * - `"none"`: can't be deleted
   */
  deleteMode: "delete" | "retire" | "none";
  /** Date field set to "now" when `deleteMode` is `"retire"`. */
  retireField?: string;
}

export type EntityKind = "product" | "category" | "store" | "promotion" | "employee" | "consumer";

/** Entities that can be created/updated through the API. */
export type WritableEntityKind = Exclude<EntityKind, "consumer">;

/** Entities that can be deleted (or retired) through the API. */
export type DeletableEntityKind = Exclude<EntityKind, "consumer">;

/**
 * Addressing per entity, following the Shopwave API reference
 * (https://developer.merchantstack.com/api-reference.html) and checked against
 * the live API where noted:
 * - category/product/store: GET filtered by `<x>Ids`, POST upsert, DELETE with `<x>Id` → 205.
 * - promotion: no DELETE; "deleting" a promotion ends it by setting `endDate` to now.
 * - employee: POST updates `roleId`, `joinedDate`, `exitDate` (names can't be
 *   changed); no DELETE (live API: "Cannot DELETE /employee") → retired via `exitDate`.
 * - consumer: read-only (`GET` with `ids`, comma-separated); live POST → 404.
 */
export const SHOPWAVE_ENTITIES: Readonly<Record<EntityKind, EntityDefinition>> = Object.freeze({
  product: { route: "products", collection: "products", upstream: "product", idsHeader: "productIds", idHeader: "productId", writable: true, deleteMode: "delete" },
  category: { route: "categories", collection: "categories", upstream: "category", idsHeader: "categoryIds", idHeader: "categoryId", writable: true, deleteMode: "delete" },
  store: { route: "stores", collection: "stores", upstream: "store", idsHeader: "storeIds", idHeader: "storeId", writable: true, deleteMode: "delete" },
  promotion: { route: "promotions", collection: "promotions", upstream: "promotion", idsHeader: "promotionIds", idHeader: "promotionId", writable: true, deleteMode: "retire", retireField: "endDate" },
  employee: { route: "employees", collection: "employees", upstream: "employee", idsHeader: "employeeIds", idHeader: "employeeId", writable: true, deleteMode: "retire", retireField: "exitDate" },
  consumer: { route: "consumer", collection: "consumers", upstream: "consumer", idsHeader: "ids", idHeader: "consumerId", writable: false, deleteMode: "none" },
});

export interface EntityTypes {
  product: Product;
  category: Category;
  store: Store;
  promotion: Promotion;
  employee: Employee;
  consumer: Consumer;
}

/**
 * What a save accepts: any subset of the entity's fields (plus extra API
 * fields the type doesn't list). Include `id` to update; leave it out to create.
 */
export type EntityInput<T> = Partial<T> & { [field: string]: unknown };

/** A saved entity: always has its `id`. */
export type Saved<T> = T & { id: number };

export type EntityId = number | string;

function definition(kind: EntityKind): EntityDefinition {
  const def = SHOPWAVE_ENTITIES[kind];
  if (!def) throw new Error(`Unknown Shopwave entity "${kind}"`);
  return def;
}

function assertId(kind: EntityKind, id: EntityId): string {
  const s = id == null ? "" : String(id).trim();
  if (!s) throw new Error(`${kind} id is missing`);
  return encodeURIComponent(s);
}

/**
 * Creates or updates several entities of one kind in a single request and
 * returns them as saved (with their ids), in the order given.
 *
 * The request is `{ <collection>: { "0": item0, "1": item1, … } }`. Shopwave
 * answers 201 and echoes every entity under the ref it was sent with, so each
 * result is matched back by ref. Throws {@link ShopwaveApiError} when the
 * response carries `api.message.errors` or any ref is missing from it.
 *
 * The API's partial-success semantics for multi-entity saves haven't been
 * confirmed yet; single saves (`saveProduct` etc.) are the tested path.
 */
export async function saveEntities<K extends WritableEntityKind>(
  kind: K,
  items: ReadonlyArray<EntityInput<EntityTypes[K]>>,
  options: RequestOptions = {}
): Promise<Array<Saved<EntityTypes[K]>>> {
  const def = definition(kind);
  if (items.length === 0) return [];

  const refs = items.map((_, i) => String(i));
  const payload = { [def.collection]: Object.fromEntries(refs.map((ref, i) => [ref, items[i]])) };

  const { status, body: raw } = await apiRequest(
    `/api/${def.route}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    options
  );
  const body = raw as Record<string, unknown> | null;
  assertNoApiErrors(body, status);

  const echoed = (body?.[def.collection] ?? {}) as Record<string, Record<string, unknown> | undefined>;
  return refs.map((ref, i) => {
    const saved = echoed[ref];
    if (!saved || saved.id == null) {
      throw new ShopwaveApiError(status, `Shopwave API error (${status}): the saved ${kind} (ref "${ref}") was not returned`, {
        body,
      });
    }
    // The write response echoes what was sent plus server fields; keep any
    // field it leaves out.
    return { ...items[i], ...saved, id: Number(saved.id) } as unknown as Saved<EntityTypes[K]>;
  });
}

/** Creates (no `id`) or updates (with `id`) one entity and returns it with its id. */
export async function saveEntity<K extends WritableEntityKind>(
  kind: K,
  item: EntityInput<EntityTypes[K]>,
  options: RequestOptions = {}
): Promise<Saved<EntityTypes[K]>> {
  const [saved] = await saveEntities(kind, [item], options);
  return saved;
}

/**
 * Deletes one entity (a soft delete: it stays readable with `deleted: true`).
 * Employees and promotions can't be deleted in Shopwave; for them the route
 * sets `exitDate` / `endDate` to now instead (see `SHOPWAVE_ENTITIES`).
 *
 * Shopwave answers 205 with an empty body — also for ids that don't exist — so
 * a resolved promise means "the API accepted the request", not "a record was
 * deleted".
 */
export async function deleteEntityById(kind: DeletableEntityKind, id: EntityId, options: RequestOptions = {}): Promise<void> {
  await apiDelete(`/api/${definition(kind).route}/${assertId(kind, id)}`, options);
}

export interface FetchByIdParams {
  /** Also return the record when it has been deleted. Defaults to `false`. */
  deleted?: boolean;
}

/** Reads one entity by id, or `null` when there's no such (non-deleted) record. */
export async function fetchEntityById<K extends EntityKind>(
  kind: K,
  id: EntityId,
  params: FetchByIdParams = {},
  options: RequestOptions = {}
): Promise<EntityTypes[K] | null> {
  const def = definition(kind);
  const body = await apiGet<Record<string, unknown> | null>(
    `/api/${def.route}/${assertId(kind, id)}`,
    { deleted: params.deleted ?? false },
    options
  );
  assertNoApiErrors(body, 200);
  const map = (body?.[def.collection] ?? {}) as Record<string, EntityTypes[K]>;
  const match = map[String(id)] ?? Object.values(map).find((e) => String((e as { id?: unknown })?.id) === String(id));
  return match ?? null;
}

// ---------------------------------------------------------------------------
// Typed per-entity functions
// ---------------------------------------------------------------------------

export const saveProduct = (product: EntityInput<Product>, options?: RequestOptions) =>
  saveEntity("product", product, options);
export const deleteProduct = (id: EntityId, options?: RequestOptions) => deleteEntityById("product", id, options);
export const fetchProduct = (id: EntityId, params?: FetchByIdParams, options?: RequestOptions) =>
  fetchEntityById("product", id, params, options);

export const saveCategory = (category: EntityInput<Category>, options?: RequestOptions) =>
  saveEntity("category", category, options);
export const deleteCategory = (id: EntityId, options?: RequestOptions) => deleteEntityById("category", id, options);
export const fetchCategory = (id: EntityId, params?: FetchByIdParams, options?: RequestOptions) =>
  fetchEntityById("category", id, params, options);

export const saveStore = (store: EntityInput<Store>, options?: RequestOptions) => saveEntity("store", store, options);
export const deleteStore = (id: EntityId, options?: RequestOptions) => deleteEntityById("store", id, options);
export const fetchStore = (id: EntityId, params?: FetchByIdParams, options?: RequestOptions) =>
  fetchEntityById("store", id, params, options);

export const savePromotion = (promotion: EntityInput<Promotion>, options?: RequestOptions) =>
  saveEntity("promotion", promotion, options);
/** Ends a promotion: Shopwave has no promotion DELETE, so this sets `endDate` to now. */
export const deletePromotion = (id: EntityId, options?: RequestOptions) => deleteEntityById("promotion", id, options);
export const fetchPromotion = (id: EntityId, params?: FetchByIdParams, options?: RequestOptions) =>
  fetchEntityById("promotion", id, params, options);

/**
 * Creates an employee, or updates one (with `id`). On update Shopwave only
 * applies `roleId`, `joinedDate` and `exitDate` (and store roles); names and
 * email can't be changed, and the echo only carries the updated fields — re-read
 * with `fetchEmployee` if you need the stored record.
 */
export const saveEmployee = (employee: EntityInput<Employee>, options?: RequestOptions) =>
  saveEntity("employee", employee, options);
/** Retires an employee: Shopwave has no employee DELETE, so this sets `exitDate` to now. */
export const deleteEmployee = (id: EntityId, options?: RequestOptions) => deleteEntityById("employee", id, options);
export const fetchEmployee = (id: EntityId, params?: FetchByIdParams, options?: RequestOptions) =>
  fetchEntityById("employee", id, params, options);

// Consumers are read-only in the Shopwave API: there is no save or delete.
export const fetchConsumer = (id: EntityId, params?: FetchByIdParams, options?: RequestOptions) =>
  fetchEntityById("consumer", id, params, options);
