/**
 * Singleton resources (one per logged-in user) and the uploader.
 *
 * Like `SHOPWAVE_ENTITIES`, this table is shared by the client functions
 * (`fetchMerchant`, `fetchUser`, `uploadImage`, …) and the server route
 * handlers in `react-shopwave-connect/server`, so the two halves of the contract
 * can't drift apart. These aren't in `SHOPWAVE_ENTITIES` because they aren't
 * keyed collections: `GET /merchant` answers `{ merchant: {…} }`, not a map by id.
 */

export interface ResourceDefinition {
  /** App route: `/api/<route>`. */
  route: string;
  /** Key of the object in requests and responses (`{ merchant: {…} }`). */
  key: string;
  /** Shopwave API path. */
  upstream: string;
  /** False for read-only resources. */
  writable: boolean;
}

export type ResourceKind = "merchant" | "user";

/**
 * - merchant: `GET /merchant`; `POST /merchant` with `{ merchant: { id, … } }`
 *   updates it (without an `id` the API would create a second merchant, so the
 *   route requires one).
 * - user: `GET /user` (read-only here; the API's `POST /user` invites users and
 *   needs the admin scope).
 */
export const SHOPWAVE_RESOURCES: Readonly<Record<ResourceKind, ResourceDefinition>> = Object.freeze({
  merchant: { route: "merchant", key: "merchant", upstream: "merchant", writable: true },
  user: { route: "user", key: "user", upstream: "user", writable: false },
});

/**
 * What an upload is for. Sent to Shopwave as the `contentType` header of
 * `PUT /uploader`. `merchant` is for the receipt and square logos (stored
 * under `…/merchant/<id>/logo/`), `merchantFeature` for the featured image.
 * The API spells two of its values `applicaionLogo` / `applicaionImages`; use
 * the correctly spelt names here and the server maps them.
 */
export type UploadKind = "merchant" | "merchantFeature" | "product" | "user" | "applicationLogo" | "applicationImages";

/** `UploadKind` → the API's `contentType` value. */
export const UPLOAD_KINDS: Readonly<Record<UploadKind, string>> = Object.freeze({
  merchant: "merchant",
  /** The merchant's featured image (adminV1; not in the API reference). */
  merchantFeature: "merchantFeature",
  product: "product",
  user: "user",
  applicationLogo: "applicaionLogo",
  applicationImages: "applicaionImages",
});

/** How uploads are addressed (app route and Shopwave uploader). */
export const SHOPWAVE_UPLOAD = Object.freeze({
  /** App route: `POST /api/<route>` (multipart `file` + `kind`). */
  route: "upload",
  /** Shopwave path: `PUT {apiUrl}/uploader` (multipart `file`). */
  upstream: "uploader",
  /** Header that carries the upload kind upstream. */
  kindHeader: "contentType",
  /** Multipart field name for the file, on both sides. */
  fileField: "file",
  /** Multipart field name for the kind in the app request. */
  kindField: "kind",
});

export function isUploadKind(value: unknown): value is UploadKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(UPLOAD_KINDS, value);
}

/**
 * Read-only lists that aren't records: the merchant's distinct tags.
 *
 * Like `SHOPWAVE_RESOURCES`, shared by the client functions
 * (`fetchProductTags`, `fetchProductInstanceTags`) and the server route
 * handlers (`shopwave.lookup(kind)`), so the two halves can't drift apart.
 *
 * - productTags: `GET /product/tags` → `{ tags: string[] }`, every distinct tag
 *   on the merchant's products. No parameters. The API reference says
 *   "internal SKU tags are excluded", but the live API includes system tags
 *   written by imports and syncs (`PID-133`, `VID-137`, `#Hash:…`, `upc-…`;
 *   test merchant 5644, 29 Oct 2026). Apps that offer the list as suggestions
 *   filter those themselves. Tags of deleted products drop out of the list.
 * - productInstanceTags: `GET /product/instance/tags` → `{ tags: string[] }`,
 *   the same for price instances (channels such as "Eat In", "Takeout").
 *
 * The app route for instance tags is `products/instance-tags`, one segment
 * under `products`, so it sits beside `products/[id]` without nesting deeper.
 */
export interface LookupDefinition {
  /** App route: `/api/<route>`. */
  route: string;
  /** Key of the list in the response (`{ tags: [...] }`). */
  key: string;
  /** Shopwave API path. */
  upstream: string;
}

export type LookupKind = "productTags" | "productInstanceTags";

export const SHOPWAVE_LOOKUPS: Readonly<Record<LookupKind, LookupDefinition>> = Object.freeze({
  productTags: { route: "products/tags", key: "tags", upstream: "product/tags" },
  productInstanceTags: { route: "products/instance-tags", key: "tags", upstream: "product/instance/tags" },
});
