import { apiGet, apiRequest, type RequestOptions } from "./request";
import { ShopwaveApiError, assertNoApiErrors } from "./errors";
import type { apiResponse } from "./types";
import { SHOPWAVE_RESOURCES } from "./resources";
import { toStoredImageIds, type MerchantImageIds } from "./merchantImages";

const MERCHANT_PATH = `/api/${SHOPWAVE_RESOURCES.merchant.route}`;

/** A colour set: hex strings (`"#1a2b3c"`). */
export interface MerchantColourSet {
  main?: string | null;
  highlight?: string | null;
  contrast?: string | null;
  [key: string]: string | null | undefined;
}

/**
 * Brand colours, as adminV1 saves them and adminV2 reads them
 * (`colours.primary.main` is the logo background): `{ primary: { main,
 * highlight, contrast } }`. `{}` when unset. Confirmed live, 30 Sep 2026.
 */
export interface MerchantColours {
  primary?: MerchantColourSet | null;
  [key: string]: MerchantColourSet | null | undefined;
}

/** Colour keys inside `colours.primary`, in display order. */
export const MERCHANT_COLOUR_KEYS = ["main", "highlight", "contrast"] as const;
export type MerchantColourKey = (typeof MERCHANT_COLOUR_KEYS)[number];

/**
 * Web and social links, as adminV1 saves them:
 * `{ website: { home }, social: { twitter, facebook, instagram } }`.
 * `{}` when empty (confirmed live, 30 Sep 2026). Use {@link normalizeMerchantLinks} to read older shapes and
 * {@link merchantLinksToForm} / {@link merchantLinksFromForm} for flat forms.
 */
export interface MerchantLinks {
  website?: { home?: string | null; [key: string]: string | null | undefined } | null;
  social?: {
    twitter?: string | null;
    facebook?: string | null;
    instagram?: string | null;
    [key: string]: string | null | undefined;
  } | null;
  [key: string]: unknown;
}

/** Flat link fields a form edits, in display order. */
export const MERCHANT_LINK_KEYS = ["website", "twitter", "facebook", "instagram"] as const;
export type MerchantLinkKey = (typeof MERCHANT_LINK_KEYS)[number];

/** Where each flat link field lives in `merchant.links`. */
export const MERCHANT_LINK_PATHS: Readonly<Record<MerchantLinkKey, readonly [string, string]>> = Object.freeze({
  website: ["website", "home"],
  twitter: ["social", "twitter"],
  facebook: ["social", "facebook"],
  instagram: ["social", "instagram"],
});

function trimmed(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Reads `merchant.links` as flat fields (`{ website, twitter, facebook,
 * instagram }`), whatever shape it was saved in:
 * - the nested shape adminV1 saves (`{ website: { home }, social: { … } }`);
 * - flat keys (`{ website: "…" }`, what SDK 0.4.0 pre-releases sent);
 * - an array in {@link MERCHANT_LINK_KEYS} order (older AdminUI versions).
 * Empty values are dropped.
 */
export function merchantLinksToForm(links: unknown): Partial<Record<MerchantLinkKey, string>> {
  const out: Partial<Record<MerchantLinkKey, string>> = {};
  if (Array.isArray(links)) {
    links.forEach((value, i) => {
      const key = MERCHANT_LINK_KEYS[i];
      const v = trimmed(value);
      if (key && v) out[key] = v;
    });
    return out;
  }
  if (!links || typeof links !== "object") return out;
  const obj = links as Record<string, unknown>;
  for (const key of MERCHANT_LINK_KEYS) {
    const [group, field] = MERCHANT_LINK_PATHS[key];
    const nested = obj[group];
    const v =
      nested && typeof nested === "object" && !Array.isArray(nested)
        ? trimmed((nested as Record<string, unknown>)[field])
        : trimmed(obj[key]);
    if (v) out[key] = v;
  }
  return out;
}

/**
 * Builds the stored `links` object from flat fields. Empty values are left
 * out, and so is a group with nothing in it; no links gives `{}`.
 */
export function merchantLinksFromForm(form: Partial<Record<MerchantLinkKey, string | null | undefined>>): MerchantLinks {
  const out: Record<string, Record<string, string>> = {};
  for (const key of MERCHANT_LINK_KEYS) {
    const v = trimmed(form[key]);
    if (!v) continue;
    const [group, field] = MERCHANT_LINK_PATHS[key];
    (out[group] ??= {})[field] = v;
  }
  return out as MerchantLinks;
}

/** Reads any stored or older `links` value into the nested shape adminV1 saves. */
export function normalizeMerchantLinks(links: unknown): MerchantLinks {
  return merchantLinksFromForm(merchantLinksToForm(links));
}

export interface Merchant {
  id: number;
  name: string;
  description?: string | null;
  /** Company registration number. */
  companyNumber?: string | null;
  vatNumber?: string | null;
  categoryId?: number | null;
  estAnnualRevenue?: number | string | null;
  note?: string | null;
  links?: MerchantLinks | null;
  colours?: MerchantColours | null;
  imageIds?: MerchantImageIds | null;
  createdDate?: string;
  modifiedDate?: string;
  /** Other fields the API returns are kept as-is. */
  [field: string]: unknown;
}

export interface MerchantResponse {
  merchant: Merchant;
  api: apiResponse;
}

/** What `updateMerchant` accepts: any subset of the merchant's fields. */
export type MerchantPatch = Partial<Merchant> & { [field: string]: unknown };

/**
 * Object fields of the merchant. The API keeps one you leave out, and
 * replaces it as a whole when you send it.
 */
export const MERCHANT_OBJECT_FIELDS: ReadonlyArray<string> = ["colours", "links", "imageIds"];

/** Fields the API sets itself; `updateMerchant` never sends them back. */
export const MERCHANT_READ_ONLY_FIELDS: ReadonlyArray<string> = ["createdDate", "modifiedDate"];

/**
 * Longest values the API stores. Longer values are cut off silently
 * (live API, Sep 2026), so `updateMerchant` rejects them instead.
 * `vatNumber` fits a UK VAT number without the `GB` prefix.
 */
export const MERCHANT_FIELD_MAX_LENGTH: Readonly<Record<string, number>> = Object.freeze({
  companyNumber: 11,
  vatNumber: 9,
});

/** Returns `"<field> is longer than <n> characters"` messages for over-long fields. */
export function validateMerchant(merchant: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [field, max] of Object.entries(MERCHANT_FIELD_MAX_LENGTH)) {
    const value = merchant[field];
    if (typeof value === "string" && value.length > max) problems.push(`${field} is longer than ${max} characters`);
  }
  return problems;
}

/**
 * Reads the logged-in user's merchant (a user has exactly one), or `null`
 * when the API returns none.
 */
export async function fetchMerchant(options: RequestOptions = {}): Promise<Merchant | null> {
  const json = await apiGet<MerchantResponse | null>(MERCHANT_PATH, {}, options);
  assertNoApiErrors(json, 200);
  return json?.merchant ?? null;
}

export interface UpdateMerchantOptions extends RequestOptions {
  /**
   * Read the merchant first and send the patch merged over it (the default).
   * Scalar fields are merged over the stored ones. Object fields
   * (`colours`, `links`, `imageIds`) are sent only when the patch has them,
   * and then replace the stored one as a whole.
   *
   * Set to `false` to send only the patch (it must then include `id`). Only
   * do that if you know the API keeps the fields you leave out.
   */
  merge?: boolean;
}

/**
 * Updates the merchant and returns it as stored.
 *
 * Shopwave's `POST /merchant` replaces the whole record: a scalar field you
 * leave out (`companyNumber`, `vatNumber`, `note`, …) is set to null, while
 * an object field you leave out (`colours`, `links`, `imageIds`) is kept and
 * one you send replaces the stored one; sending `{}` clears it (live API,
 * Sep 2026). So by default the
 * current merchant is read first and the patch is merged over it.
 *
 * `imageIds` is always sent as file names ({@link toStoredImageIds}), so you
 * can pass back what you read. See `MerchantImageIds` for the shape.
 *
 * The API answers 205 with an empty body, so the merchant is read again after
 * the save and that is what's returned (it shows exactly what was kept).
 * Throws before sending when a value is longer than the API stores
 * ({@link MERCHANT_FIELD_MAX_LENGTH}).
 */
export async function updateMerchant(
  patch: MerchantPatch,
  options: UpdateMerchantOptions = {}
): Promise<Merchant> {
  const { merge = true, ...requestOptions } = options;

  let merchant: Record<string, unknown> = { ...patch };
  if (merge) {
    const current = await fetchMerchant(requestOptions);
    if (!current) throw new ShopwaveApiError(404, "Shopwave API error (404): no merchant to update");
    if (patch.id != null && String(patch.id) !== String(current.id)) {
      throw new Error(`Merchant id ${patch.id} is not the logged-in merchant (${current.id})`);
    }
    merchant = { ...current, ...patch, id: current.id };
    // Object fields the patch doesn't touch are left out: the API keeps an
    // object that isn't sent, and sending back what was read would turn
    // image file names into URLs.
    for (const field of MERCHANT_OBJECT_FIELDS) {
      if (!(field in patch)) delete merchant[field];
    }
  }
  // Reads return image URLs; the API stores file names.
  if (merchant.imageIds && typeof merchant.imageIds === "object") {
    merchant.imageIds = toStoredImageIds(merchant.imageIds);
  }
  if (merchant.id == null || merchant.id === "") throw new Error("merchant id is missing");
  for (const field of MERCHANT_READ_ONLY_FIELDS) delete merchant[field];
  const problems = validateMerchant(merchant);
  if (problems.length > 0) throw new Error(`Invalid merchant: ${problems.join("; ")}`);

  const { status, body: raw } = await apiRequest(
    MERCHANT_PATH,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ merchant }) },
    requestOptions
  );
  const body = raw as { merchant?: Record<string, unknown> } | null;
  assertNoApiErrors(body, status);

  // An echo, if the API ever sends one, is used as-is (merged over what was sent).
  const echoed = body?.merchant && typeof body.merchant === "object" ? body.merchant : null;
  if (echoed) return { ...merchant, ...echoed, id: Number(echoed.id ?? merchant.id) } as Merchant;

  // Usual case: 205 + empty body. Read back what was actually stored.
  const stored = await fetchMerchant(requestOptions);
  return stored ?? ({ ...merchant, id: Number(merchant.id) } as Merchant);
}
