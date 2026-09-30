import { apiRequest, type RequestOptions } from "./request";
import { ShopwaveApiError, assertNoApiErrors } from "./errors";
import { SHOPWAVE_UPLOAD, isUploadKind, type UploadKind } from "./resources";

export interface UploadImageParams {
  /** What the image is for (sent to Shopwave as the uploader's `contentType`). */
  kind: UploadKind;
  /** File name to send when `file` is a Blob without one. Defaults to `File.name`, else `"upload"`. */
  fileName?: string;
}

export interface UploadedImage {
  /** The generated file name (products store it in `images`). */
  id: string;
  /** Public HTTPS URL of the file (see {@link getImageUrl}). */
  url: string;
  /** The URL exactly as the API returned it (`http://static.merchantstack.com/images/…`). */
  path: string;
}

/**
 * HTTPS host that serves the Shopwave CDN's images. The API returns
 * `http://static.merchantstack.com/images/…`, which has no HTTPS endpoint
 * (checked Sep 2026), so pages served over HTTPS can't show it.
 */
export const SHOPWAVE_IMAGE_BASE_URL = "https://s3-eu-west-1.amazonaws.com/static.merchantstack.com/images";

const STATIC_HOST = /^https?:\/\/static\.merchantstack\.com\/images\//i;

/**
 * Turns an image path from the API into a URL a page can load over HTTPS:
 * `http://static.merchantstack.com/images/x.png` → `<base>/x.png`, and a
 * relative path (`merchant/5644/logo/x.png`) → `<base>/merchant/5644/logo/x.png`.
 * Other absolute URLs are returned unchanged; empty input gives `""`.
 */
export function getImageUrl(path: string | null | undefined, base: string = SHOPWAVE_IMAGE_BASE_URL): string {
  if (!path) return "";
  const root = base.replace(/\/+$/, "");
  if (STATIC_HOST.test(path)) return `${root}/${path.replace(STATIC_HOST, "")}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) return path;
  return `${root}/${path.replace(/^\/+/, "")}`;
}

/**
 * Uploads one image to the Shopwave CDN through the app's `/api/upload` route
 * (`createShopwaveApi(...).upload()`), and returns its id and URL.
 *
 * The file only lands on the CDN (under `…/images/<kind>/<merchantId>/…`); a
 * record has to point at it to use it. Live API (Sep 2026): the upload answers
 * 201 `{ fileName, path }`.
 */
export async function uploadImage(
  file: Blob,
  params: UploadImageParams,
  options: RequestOptions = {}
): Promise<UploadedImage> {
  if (!file || typeof (file as Blob).size !== "number") throw new Error("uploadImage: file must be a File or Blob");
  if (!isUploadKind(params?.kind)) throw new Error(`uploadImage: unknown kind "${params?.kind}"`);

  const name = params.fileName ?? (file as File).name ?? "upload";
  const form = new FormData();
  form.append(SHOPWAVE_UPLOAD.fileField, file, name);
  form.append(SHOPWAVE_UPLOAD.kindField, params.kind);

  // No Content-Type: fetch sets the multipart boundary itself.
  const { status, body: raw } = await apiRequest(`/api/${SHOPWAVE_UPLOAD.route}`, { method: "POST", body: form }, options);
  const body = raw as { fileName?: unknown; path?: unknown } | null;
  assertNoApiErrors(body, status);

  const id = typeof body?.fileName === "string" ? body.fileName : "";
  const path = typeof body?.path === "string" ? body.path : "";
  if (!id) {
    throw new ShopwaveApiError(status, `Shopwave API error (${status}): the upload response has no fileName`, { body });
  }
  return { id, url: getImageUrl(path), path };
}
