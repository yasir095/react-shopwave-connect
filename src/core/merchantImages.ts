import type { RequestOptions } from "./request";
import type { UploadKind } from "./resources";
import { fitImageToSize, type FitImageOptions } from "./imageFit";
import { getImageUrl, uploadImage, type UploadedImage } from "./upload";

/**
 * Merchant images, as adminV1 saves them and adminV2 reads them:
 *
 * ```
 * { logo: { receipt: "<file>", square: "<file>" }, feature: ["<file>"] }
 * ```
 *
 * - **Writes** take the uploader's `fileName` (`<hash>.png`), not a URL.
 * - **Reads** return full URLs (`http://static.merchantstack.com/images/…`),
 *   so a value read back must be turned into a file name before it's saved
 *   again ({@link toStoredImageIds}; `updateMerchant` does this for you).
 * - Sending `imageIds` replaces the whole stored object (`{}` clears it);
 *   leaving it out keeps it.
 * - The API builds each URL from the key, not from where the file is:
 *   `logo.*` → `…/merchant/<id>/logo/<file>`, `feature` → `…/feature/<file>`.
 *   So a featured image must be uploaded with kind `merchantFeature` (which
 *   stores it under `feature/`); a `merchant` upload lands under `logo/`.
 *
 * Confirmed on the live API, merchant 5644, 30 Sep 2026.
 */
export interface MerchantImageIds {
  logo?: {
    receipt?: string | null;
    square?: string | null;
    [key: string]: string | null | undefined;
  } | null;
  feature?: string[] | null;
  [key: string]: unknown;
}

/** The three image slots on the merchant settings page. */
export const MERCHANT_IMAGE_SLOT_KEYS = ["receipt", "square", "featured"] as const;
export type MerchantImageSlot = (typeof MERCHANT_IMAGE_SLOT_KEYS)[number];

export interface MerchantImageSlotDefinition {
  /** Where it's stored: `logo.receipt`, `logo.square` or `feature[0]`. */
  field: "logo.receipt" | "logo.square" | "feature[0]";
  /** Uploader `contentType` (the featured image has its own). */
  uploadKind: UploadKind;
  /** Exact size in pixels. adminV1 refuses any other size; the API doesn't resize. */
  width: number;
  height: number;
}

/**
 * Where each slot lives, its upload kind and its exact size (from adminV1's
 * merchant settings page).
 */
export const MERCHANT_IMAGE_SLOTS: Readonly<Record<MerchantImageSlot, MerchantImageSlotDefinition>> = Object.freeze({
  receipt: { field: "logo.receipt", uploadKind: "merchant", width: 576, height: 325 },
  square: { field: "logo.square", uploadKind: "merchant", width: 1000, height: 1000 },
  featured: { field: "feature[0]", uploadKind: "merchantFeature", width: 1200, height: 600 },
});

/**
 * The file name in an image value: `"http://…/logo/abc.png"` → `"abc.png"`,
 * `"abc.png"` → `"abc.png"`. Query strings and fragments are ignored.
 * Returns `null` for empty or non-string values.
 */
export function imageFileName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/[?#].*$/, "");
  const last = clean.split("/").pop() ?? "";
  return last ? decodeURIComponent(last) : null;
}

/** The stored value for a slot (a URL when read from the API; a file name right after an upload). */
export function getMerchantImage(imageIds: MerchantImageIds | null | undefined, slot: MerchantImageSlot): string | null {
  if (!imageIds || typeof imageIds !== "object") return null;
  let value: unknown;
  if (slot === "featured") {
    value = Array.isArray(imageIds.feature) ? imageIds.feature[0] : undefined;
  } else {
    const logo = imageIds.logo;
    value = logo && typeof logo === "object" ? logo[slot] : undefined;
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * An HTTPS URL for a slot's stored image, or `""` when the slot is empty or
 * holds only a file name (a fresh upload not yet saved; use the upload's `url`).
 */
export function getMerchantImageUrl(
  imageIds: MerchantImageIds | null | undefined,
  slot: MerchantImageSlot,
  base?: string
): string {
  const value = getMerchantImage(imageIds, slot);
  if (!value || !value.includes("/")) return "";
  return getImageUrl(value, base);
}

/**
 * Returns a copy of `imageIds` with one slot set to `fileName` (or cleared
 * with `null`). Other slots and unknown keys are kept; an empty `logo` or
 * `feature` is removed.
 */
export function setMerchantImage(
  imageIds: MerchantImageIds | null | undefined,
  slot: MerchantImageSlot,
  fileName: string | null
): MerchantImageIds {
  const next: MerchantImageIds = { ...(imageIds && typeof imageIds === "object" ? imageIds : {}) };
  if (slot === "featured") {
    const rest = Array.isArray(next.feature) ? next.feature.slice(1) : [];
    const feature = fileName ? [fileName, ...rest] : rest;
    if (feature.length > 0) next.feature = feature;
    else delete next.feature;
  } else {
    const logo = { ...(next.logo && typeof next.logo === "object" ? next.logo : {}) };
    if (fileName) logo[slot] = fileName;
    else delete logo[slot];
    if (Object.keys(logo).length > 0) next.logo = logo;
    else delete next.logo;
  }
  return next;
}

function toStored(value: unknown): unknown {
  if (typeof value === "string") return imageFileName(value) ?? undefined;
  if (Array.isArray(value)) {
    const items = value.map(toStored).filter((v) => v !== undefined && v !== null && v !== "");
    return items.length > 0 ? items : undefined;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const stored = toStored(v);
      if (stored !== undefined && stored !== null && stored !== "") out[k] = stored;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

/**
 * The `imageIds` to send on a save: every URL is turned back into its file
 * name (what adminV1 does with images you didn't change) and empty values
 * are dropped. No images gives `{}`.
 */
export function toStoredImageIds(imageIds: unknown): MerchantImageIds {
  return (toStored(imageIds) as MerchantImageIds | undefined) ?? {};
}

export interface UploadMerchantImageOptions extends RequestOptions {
  /**
   * Scale and centre-crop the image to the slot's exact size before upload
   * (browser only). Default true. With `false` the file is sent as-is.
   */
  fit?: boolean;
  /** Output type and quality when fitting. Default PNG. */
  fitOptions?: FitImageOptions;
}

/**
 * Uploads an image for a merchant slot: fits it to the slot's size, uploads
 * it with the slot's kind, and returns `{ id, url, path }`. Put `id` into
 * `imageIds` with {@link setMerchantImage} and save with `updateMerchant`.
 */
export async function uploadMerchantImage(
  file: Blob,
  slot: MerchantImageSlot,
  options: UploadMerchantImageOptions = {}
): Promise<UploadedImage> {
  const def = MERCHANT_IMAGE_SLOTS[slot];
  if (!def) throw new Error(`uploadMerchantImage: unknown slot "${slot}"`);
  const { fit = true, fitOptions, ...requestOptions } = options;
  const body = fit ? await fitImageToSize(file, def.width, def.height, fitOptions) : file;
  return uploadImage(body, { kind: def.uploadKind }, requestOptions);
}
