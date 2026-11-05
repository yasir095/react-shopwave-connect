/**
 * Browser helpers for getting an image to the right size before upload.
 *
 * Shopwave doesn't resize uploads, so images are scaled and centre-cropped in
 * the browser: to an exact size for the merchant image slots
 * ({@link fitImageToSize}), or to a rule (ratio, minimum, maximum) with
 * {@link prepareImage}, which apps use to give each kind of image its own rule.
 */

/** Source rectangle to draw so the image covers `dstWidth × dstHeight` (centre crop, no stretching). */
export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The centred part of a `srcWidth × srcHeight` image with the aspect ratio of
 * `dstWidth × dstHeight` (like CSS `object-fit: cover`).
 */
export function coverCrop(srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number): CropRect {
  if (![srcWidth, srcHeight, dstWidth, dstHeight].every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error("coverCrop: sizes must be positive numbers");
  }
  const srcRatio = srcWidth / srcHeight;
  const dstRatio = dstWidth / dstHeight;
  if (srcRatio > dstRatio) {
    // Too wide: keep the full height, trim the sides.
    const sw = Math.round(srcHeight * dstRatio);
    return { sx: Math.round((srcWidth - sw) / 2), sy: 0, sw, sh: srcHeight };
  }
  // Too tall (or exact): keep the full width, trim top and bottom.
  const sh = Math.round(srcWidth / dstRatio);
  return { sx: 0, sy: Math.round((srcHeight - sh) / 2), sw: srcWidth, sh };
}

export interface ImageSize {
  width: number;
  height: number;
}

function requireBrowserImages(fn: string): void {
  if (typeof createImageBitmap !== "function") {
    throw new Error(`${fn} needs a browser (createImageBitmap is not available)`);
  }
}

/** Reads an image file's pixel size (browser only). */
export async function readImageSize(file: Blob): Promise<ImageSize> {
  requireBrowserImages("readImageSize");
  const bitmap = await createImageBitmap(file);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close?.();
  }
}

export interface FitImageOptions {
  /** Output type. Default `"image/png"`. */
  type?: "image/png" | "image/jpeg" | "image/webp";
  /** 0–1, for JPEG/WebP. */
  quality?: number;
  /** Return the file untouched when it's already the right size and type. Default true. */
  keepIfExact?: boolean;
}

/** Draws `crop` of the bitmap at `width × height` and encodes it (one resample). */
async function drawCrop(
  bitmap: ImageBitmap,
  crop: CropRect,
  width: number,
  height: number,
  type: string,
  quality: number | undefined,
  fn: string
): Promise<Blob> {
  const { sx, sy, sw, sh } = crop;
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(`${fn}: no 2D canvas context`);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
    return canvas.convertToBlob({ type, quality });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(`${fn}: no 2D canvas context`);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`${fn}: encoding failed`))), type, quality)
  );
}

/** The input's name with the output type's extension. */
function outputName(file: Blob, type: string): string {
  const name = (file as File).name || "image";
  const ext = type === "image/jpeg" ? "jpg" : type.split("/")[1];
  return `${name.replace(/\.[^.]+$/, "")}.${ext}`;
}

/**
 * Returns the image at exactly `width × height`: scaled and centre-cropped
 * (never stretched). Browser only. The result is a `File` named like the
 * input, with the output type's extension.
 */
export async function fitImageToSize(file: Blob, width: number, height: number, options: FitImageOptions = {}): Promise<File> {
  requireBrowserImages("fitImageToSize");
  const { type = "image/png", quality, keepIfExact = true } = options;
  const outName = outputName(file, type);

  const bitmap = await createImageBitmap(file);
  try {
    if (keepIfExact && bitmap.width === width && bitmap.height === height && file.type === type) {
      return file instanceof File ? file : new File([file], outName, { type });
    }
    const blob = await drawCrop(bitmap, coverCrop(bitmap.width, bitmap.height, width, height), width, height, type, quality, "fitImageToSize");
    return new File([blob], outName, { type });
  } finally {
    bitmap.close?.();
  }
}

// ---------------------------------------------------------------------------
// Image rules
// ---------------------------------------------------------------------------

/**
 * How an image must end up before upload. Every field is optional; give an
 * exact size (`width` + `height`) or an `aspectRatio`, not both.
 *
 * Images are always scaled down first and then centre-cropped (never
 * stretched): the kept area is the largest one with the right shape.
 *
 * @example
 * // "Cropped to 100:77, at least 600 × 462", at most 2000 px on the long side
 * { aspectRatio: "100:77", minWidth: 600, minHeight: 462, maxLongSide: 2000 }
 * // Exactly 600 × 462
 * { width: 600, height: 462 }
 * // Any shape, scaled down to fit 2000 px
 * { maxLongSide: 2000 }
 */
export interface ImageRule {
  /** Exact output width (needs `height`). */
  width?: number;
  /** Exact output height (needs `width`). */
  height?: number;
  /** Shape to crop to: `1.3`, `"100:77"`, `"100/77"` or `[100, 77]`. */
  aspectRatio?: number | string | readonly [number, number];
  /** Smallest acceptable output; a smaller image is refused (see `allowUpscale`). */
  minWidth?: number;
  minHeight?: number;
  /** Largest output; a bigger image is scaled down to fit. */
  maxWidth?: number;
  maxHeight?: number;
  /** Largest output on the longer side, whichever it is. */
  maxLongSide?: number;
  /** Enlarge a too-small image instead of refusing it. Default false. */
  allowUpscale?: boolean;
}

/** What {@link prepareImage} will do to an image, worked out without touching it. */
export interface ImageFitPlan {
  /** The area of the source that's kept. */
  crop: CropRect;
  /** Output size. */
  width: number;
  height: number;
  /** True when the source already fits the rule, so it can be uploaded as it is. */
  unchanged: boolean;
}

/** A rule that can't be met by any image (a mistake in the rule, not the image). */
export class ImageRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageRuleError";
  }
}

/** The image is smaller than the rule's minimum (and `allowUpscale` is off). */
export class ImageTooSmallError extends Error {
  /** The smallest size the rule accepts. */
  readonly required: ImageSize;
  /** The largest area of the right shape the image could give. */
  readonly actual: ImageSize;
  constructor(required: ImageSize, actual: ImageSize) {
    super(`The image is too small: it needs to be at least ${required.width} × ${required.height}, and it's ${actual.width} × ${actual.height}`);
    this.name = "ImageTooSmallError";
    this.required = required;
    this.actual = actual;
  }
}

const isPositive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * An aspect ratio as width ÷ height: `"100:77"`, `"100/77"`, `[100, 77]` →
 * 1.2987…; `1.3` → 1.3. Throws {@link ImageRuleError} for anything else.
 */
export function parseAspectRatio(value: number | string | readonly [number, number]): number {
  let parts: [unknown, unknown] | null = null;
  if (typeof value === "number") return isPositive(value) ? value : badRatio(value);
  if (Array.isArray(value)) parts = [value[0], value[1]];
  else if (typeof value === "string") {
    const text = value.trim();
    const match = /^(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)$/i.exec(text);
    if (match) parts = [Number(match[1]), Number(match[2])];
    else if (/^\d+(?:\.\d+)?$/.test(text)) return isPositive(Number(text)) ? Number(text) : badRatio(value);
  }
  if (parts && isPositive(parts[0]) && isPositive(parts[1])) return parts[0] / parts[1];
  return badRatio(value);
}

function badRatio(value: unknown): never {
  throw new ImageRuleError(`Not an aspect ratio: ${JSON.stringify(value)} (use e.g. "100:77", [100, 77] or 1.3)`);
}

/** Throws {@link ImageRuleError} when the rule contradicts itself. */
export function checkImageRule(rule: ImageRule): void {
  if (!rule || typeof rule !== "object") throw new ImageRuleError("An image rule must be an object");
  const sizes = ["width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight", "maxLongSide"] as const;
  for (const key of sizes) {
    if (rule[key] != null && !isPositive(rule[key])) throw new ImageRuleError(`${key} must be a positive number`);
  }
  const exact = rule.width != null || rule.height != null;
  if (exact) {
    if (rule.width == null || rule.height == null) throw new ImageRuleError("An exact size needs both width and height");
    if (rule.aspectRatio != null) throw new ImageRuleError("Give an exact size or an aspectRatio, not both (the size sets the ratio)");
    const limits = ["minWidth", "minHeight", "maxWidth", "maxHeight", "maxLongSide"] as const;
    const extra = limits.filter((key) => rule[key] != null);
    if (extra.length > 0) throw new ImageRuleError(`An exact size is already the minimum and the maximum; remove ${extra.join(", ")}`);
    return;
  }
  if (rule.aspectRatio != null) parseAspectRatio(rule.aspectRatio);
  if (rule.minWidth != null && rule.maxWidth != null && rule.minWidth > rule.maxWidth) {
    throw new ImageRuleError("minWidth is larger than maxWidth");
  }
  if (rule.minHeight != null && rule.maxHeight != null && rule.minHeight > rule.maxHeight) {
    throw new ImageRuleError("minHeight is larger than maxHeight");
  }
  if (rule.maxLongSide != null && Math.max(rule.minWidth ?? 0, rule.minHeight ?? 0) > rule.maxLongSide) {
    throw new ImageRuleError("The minimum size is larger than maxLongSide");
  }
}

/**
 * Works out what to do to a `source`-sized image to meet `rule`: the centred
 * crop of the right shape (the largest one), then the output size (scaled
 * down to the maximum, never below the minimum). Pure: no browser needed.
 *
 * Throws {@link ImageTooSmallError} when the crop is below the minimum (or
 * the exact size) and `allowUpscale` is off, and {@link ImageRuleError} for a
 * contradictory rule.
 *
 * @example
 * planImageFit({ width: 6000, height: 4000 }, { aspectRatio: "100:77", minWidth: 600, minHeight: 462, maxLongSide: 2000 })
 * // → crop { sx: 403, sy: 0, sw: 5194, sh: 4000 }, 2000 × 1540
 */
export function planImageFit(source: ImageSize, rule: ImageRule): ImageFitPlan {
  checkImageRule(rule);
  const { width: W, height: H } = source ?? ({} as ImageSize);
  if (!isPositive(W) || !isPositive(H)) throw new Error("planImageFit: the image has no size");

  const exact = rule.width != null && rule.height != null;
  const ratio = exact ? (rule.width as number) / (rule.height as number) : rule.aspectRatio != null ? parseAspectRatio(rule.aspectRatio) : null;
  const crop: CropRect = ratio == null ? { sx: 0, sy: 0, sw: W, sh: H } : coverCrop(W, H, ratio, 1);
  const { sw, sh } = crop;
  const kept = { width: sw, height: sh };

  let width: number;
  let height: number;
  if (exact) {
    width = rule.width as number;
    height = rule.height as number;
    if ((sw < width || sh < height) && !rule.allowUpscale) throw new ImageTooSmallError({ width, height }, kept);
  } else {
    const minW = rule.minWidth ?? 0;
    const minH = rule.minHeight ?? 0;
    if ((sw < minW || sh < minH) && !rule.allowUpscale) {
      throw new ImageTooSmallError(requiredSize(minW, minH, ratio), kept);
    }
    let scale = 1;
    if (rule.maxWidth != null) scale = Math.min(scale, rule.maxWidth / sw);
    if (rule.maxHeight != null) scale = Math.min(scale, rule.maxHeight / sh);
    if (rule.maxLongSide != null) scale = Math.min(scale, rule.maxLongSide / Math.max(sw, sh));
    // The minimum wins over the maximum (and enlarges a small image when allowed).
    scale = Math.max(scale, minW / sw, minH / sh);
    width = Math.max(1, Math.round(sw * scale));
    height = Math.max(1, Math.round(sh * scale));
  }

  const unchanged = crop.sx === 0 && crop.sy === 0 && sw === W && sh === H && width === W && height === H;
  return { crop, width, height, unchanged };
}

/** The minimum as a full size: a ratio rule with only one minimum implies the other. */
function requiredSize(minW: number, minH: number, ratio: number | null): ImageSize {
  if (ratio == null) return { width: minW, height: minH };
  return {
    width: Math.max(minW, Math.ceil(minH * ratio)),
    height: Math.max(minH, Math.ceil(minW / ratio)),
  };
}

export interface PrepareImageOptions {
  /** Output type. Default: the source's type when it's PNG, JPEG or WebP, else PNG. */
  type?: "image/png" | "image/jpeg" | "image/webp";
  /** 0–1, for JPEG and WebP. Default 0.9. */
  quality?: number;
}

const OUTPUT_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Returns the image meeting `rule` ({@link planImageFit}): centre-cropped to
 * the right shape and scaled in a single draw. An image that already fits is
 * returned untouched (same bytes). Browser only.
 *
 * Throws {@link ImageTooSmallError} (show `required` and `actual` to the
 * person) or {@link ImageRuleError}; an unreadable file rejects with the
 * browser's decoding error.
 *
 * @example
 * const ready = await prepareImage(file, { aspectRatio: "100:77", minWidth: 600, minHeight: 462, maxLongSide: 2000 });
 * await uploadImage(ready, { kind: "product", prefix: "product" });
 */
export async function prepareImage(file: Blob, rule: ImageRule, options: PrepareImageOptions = {}): Promise<File> {
  checkImageRule(rule);
  requireBrowserImages("prepareImage");
  const sourceType = file.type && OUTPUT_TYPES.includes(file.type) ? file.type : "image/png";
  const type = options.type ?? sourceType;
  const quality = options.quality ?? (type === "image/png" ? undefined : 0.9);

  const bitmap = await createImageBitmap(file);
  try {
    const plan = planImageFit({ width: bitmap.width, height: bitmap.height }, rule);
    if (plan.unchanged && type === file.type) {
      return file instanceof File ? file : new File([file], outputName(file, type), { type });
    }
    const blob = await drawCrop(bitmap, plan.crop, plan.width, plan.height, type, quality, "prepareImage");
    return new File([blob], outputName(file, type), { type });
  } finally {
    bitmap.close?.();
  }
}
