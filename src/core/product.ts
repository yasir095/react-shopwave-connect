import { apiGet, withToken, type RequestOptions } from "./request";
import { assertNoApiErrors } from "./errors";
import type { apiResponse } from "./types";

export interface ProductInstance {
  id: number;
  price: string;
  taxPercentage: string;
  timestamp: string;
  size: string;
  name: string;
  activeDate: string;
  tags: string;
}

export interface Product {
  id: number;
  barcode: string;
  name: string;
  details: string;
  tags: string;
  unit: number;
  timestamp: string;
  activeDate: string;
  deleteDate: string;
  images: Array<string>;
  categories: Array<number>;
  instances: {
    [key: number]: ProductInstance;
  };
}

export interface ProductResponse {
  products: {
    [key: number]: Product;
  };
  api: apiResponse;
}

export interface FetchProductsParams {
  productIds?: Array<number>;
  storeId?: number;
  /** Whether to include soft-deleted records. Defaults to `false`. */
  deleted?: boolean;
  /** @deprecated Pass `options.token` instead. Sent the same way (Authorization header). */
  token?: string;
}

/**
 * Fetches products. Returns the flattened `Product[]`.
 */
export async function fetchProducts(
  params: FetchProductsParams = {},
  options: RequestOptions = {}
): Promise<Product[]> {
  const extras: Record<string, unknown> = { deleted: params.deleted ?? false };

  if (params.productIds) {
    extras.productIds = params.productIds;
  }
  if (params.storeId) {
    extras.storeId = params.storeId;
  }

  const json = await apiGet<ProductResponse | null>("/api/products", extras, withToken(options, params.token));

  assertNoApiErrors(json, 200);

  // Shopwave answers an empty body when nothing matches.
  return Object.values(json?.products ?? {});
}

// ---------------------------------------------------------------------------
// Instances (prices) on a product save
// ---------------------------------------------------------------------------
//
// Shopwave API reference, POST /product: "Product instances cannot be updated —
// they are stored for historical reference. To change pricing, remove the old
// instance and create a new one." An instance is therefore only sent with its
// `id` when it is unchanged; a new or re-priced instance is sent without one, and
// Shopwave gives it a new id. (adminV2 does the same and warns before saving.)

/** An instance as a form or caller holds it: `id` is absent for new rows. */
export type ProductInstanceInput = {
  id?: number | string | null;
  price?: string | number | null;
  taxPercentage?: string | number | null;
  name?: string | null;
};

/** Instances as the API returns them (keyed by id) or as a plain list. */
export type ProductInstances<T = ProductInstanceInput> =
  | Readonly<Record<string, T>>
  | Readonly<Record<number, T>>
  | ReadonlyArray<T>;

/**
 * What `saveProduct` accepts: any product fields, with `instances` either as the
 * API returns them or as built by {@link toProductInstancesForSave}. Include `id`
 * to update; leave it out to create.
 */
export type ProductSaveInput = Partial<Omit<Product, "instances">> & {
  instances?: ProductInstances;
  [field: string]: unknown;
};

/** Fields the server sets on an instance; never sent back. */
const SERVER_INSTANCE_FIELDS = ["timestamp"] as const;

function instanceList<T>(instances: ProductInstances<T> | null | undefined): T[] {
  if (!instances) return [];
  const list: unknown[] = Array.isArray(instances) ? [...instances] : Object.values(instances);
  return list.filter(
    (inst): inst is T => inst != null && typeof inst === "object"
  );
}

function hasId(id: unknown): id is number | string {
  return id != null && String(id).trim() !== "";
}

/** Same number, so `"422.0"`, `"422"` and `422` are equal; blanks equal each other. */
function sameAmount(a: unknown, b: unknown): boolean {
  const blank = (v: unknown) => v == null || String(v).trim() === "";
  if (blank(a) || blank(b)) return blank(a) && blank(b);
  const x = Number(a);
  const y = Number(b);
  return Number.isNaN(x) || Number.isNaN(y) ? String(a).trim() === String(b).trim() : x === y;
}

/** True when two instances have the same price and tax (the fields Shopwave won't update). */
export function isSameInstancePrice(a: ProductInstanceInput, b: ProductInstanceInput): boolean {
  return sameAmount(a.price, b.price) && sameAmount(a.taxPercentage, b.taxPercentage);
}

/** An instance whose price or tax was edited, so saving it will give it a new id. */
export interface RepricedInstance {
  /** Position of the instance in the list that was passed in. */
  index: number;
  /** The id it has now, which Shopwave will replace. */
  id: number | string;
  name: string;
  before: { price: string; taxPercentage: string };
  after: { price: string; taxPercentage: string };
}

const text = (v: unknown) => (v == null ? "" : String(v));

/**
 * Lists the instances whose price or tax differs from the `original` instance
 * with the same id: saving them creates new instances with new ids, which can
 * affect anything that stores instance ids (integrations, reports, modifiers).
 * Use it to warn before saving. New rows (no id) aren't listed.
 */
export function findRepricedInstances(
  instances: ProductInstances | null | undefined,
  original: ProductInstances | null | undefined
): RepricedInstance[] {
  const byId = new Map(instanceList(original).filter((o) => hasId(o.id)).map((o) => [String(o.id), o]));
  const result: RepricedInstance[] = [];
  instanceList(instances).forEach((inst, index) => {
    if (!hasId(inst.id)) return;
    const before = byId.get(String(inst.id));
    if (!before || isSameInstancePrice(inst, before)) return;
    result.push({
      index,
      id: inst.id,
      name: text(inst.name),
      before: { price: text(before.price), taxPercentage: text(before.taxPercentage) },
      after: { price: text(inst.price), taxPercentage: text(inst.taxPercentage) },
    });
  });
  return result;
}

/**
 * Builds the `instances` map for a product save:
 * - keyed by position (`"0"`, `"1"`, …), like every other ref in a save;
 * - an instance keeps its `id` only when `original` has an instance with that id
 *   and the same price and tax; otherwise the id is removed, so Shopwave creates
 *   a new instance instead of re-pointing or rewriting someone else's;
 * - server fields (`timestamp`) are removed.
 *
 * Pass the product as last read from the API as `original`. Leave it out for a
 * new product (including a duplicate): every id is then removed.
 * Instances left out of the list are left out of the save (removed).
 */
export function toProductInstancesForSave<T extends ProductInstanceInput>(
  instances: ProductInstances<T> | null | undefined,
  original?: ProductInstances | null
): Record<string, Omit<T, "id"> & { id?: number | string }> {
  const keep = new Map(instanceList(original).filter((o) => hasId(o.id)).map((o) => [String(o.id), o]));
  const out: Record<string, Omit<T, "id"> & { id?: number | string }> = {};
  instanceList(instances).forEach((inst, index) => {
    const { id, ...rest } = inst;
    for (const field of SERVER_INSTANCE_FIELDS) delete (rest as Record<string, unknown>)[field];
    const before = hasId(id) ? keep.get(String(id)) : undefined;
    out[String(index)] = (before && isSameInstancePrice(inst, before) ? { id, ...rest } : rest) as Omit<T, "id"> & {
      id?: number | string;
    };
  });
  return out;
}

/**
 * Fetches products by id and returns them keyed by id, transparently batching
 * the request (default 200 ids per call) to stay within API limits. Extracted
 * from the original `useBasketReport` inline batching loop so it can be reused
 * outside React.
 */
export async function fetchProductsMap(
  productIds: number[] | null | undefined,
  options: RequestOptions = {},
  batchSize = 200
): Promise<{ [id: number]: Product }> {
  const result: { [id: number]: Product } = {};
  if (!productIds || productIds.length === 0) {
    return result;
  }

  for (let i = 0; i < productIds.length; i += batchSize) {
    const batch = productIds.slice(i, i + batchSize);
    const products = await fetchProducts({ productIds: batch }, options);
    for (const product of products) {
      result[product.id] = product;
    }
  }

  return result;
}
