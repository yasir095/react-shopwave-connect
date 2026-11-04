import { UPLOAD_PREFIXES, type UploadPrefix } from "./resources";
import { imageFileName } from "./merchantImages";

/**
 * Product images, as the live API stores them (merchant 5644, 4 Nov 2026):
 * - A product's `images` is a list. **Reads return full URLs**
 *   (`http://static.merchantstack.com/images/merchant/<id>/product/<file>`);
 *   **writes take the uploader's file names** ({@link toStoredProductImages};
 *   `saveProduct` does this for you).
 * - The uploader takes one file per request. With a `prefix` (see
 *   `UploadPrefix`) it names the file `<prefix>_<hash>.<ext>`
 *   (`product_thumbnail_1bdd…41090b.png`); without one, `<hash>.<ext>`. So an
 *   image's role can be read back from its name ({@link productImageRole}).
 */

/**
 * The role in an image's file name or URL, from the uploader's `prefix`:
 * `"…/product_thumbnail_1bdd.png"` → `"product_thumbnail"`. `null` for a name
 * without one (images uploaded without a prefix, e.g. before prefixes existed).
 */
export function productImageRole(value: unknown): UploadPrefix | null {
  const name = imageFileName(value);
  if (!name) return null;
  // Longest first, so `product_thumbnail_…` isn't taken for `product`.
  return UPLOAD_PREFIXES.find((prefix) => name.startsWith(`${prefix}_`)) ?? null;
}

/**
 * A product's `images` as the API takes them on a save: file names, not the
 * URLs a read returns. Non-strings, blanks and duplicates are dropped; the
 * order is kept.
 */
export function toStoredProductImages(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  const names = images.map(imageFileName).filter((name): name is string => Boolean(name));
  return Array.from(new Set(names));
}
