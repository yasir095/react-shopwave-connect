/**
 * Browser helpers for getting an image to an exact pixel size before upload.
 *
 * Shopwave doesn't resize uploads, and the merchant image slots have fixed
 * sizes (adminV1 refuses any other size), so the SDK scales and centre-crops
 * the image in the browser instead.
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

/**
 * Returns the image at exactly `width × height`: scaled and centre-cropped
 * (never stretched). Browser only. The result is a `File` named like the
 * input, with the output type's extension.
 */
export async function fitImageToSize(file: Blob, width: number, height: number, options: FitImageOptions = {}): Promise<File> {
  requireBrowserImages("fitImageToSize");
  const { type = "image/png", quality, keepIfExact = true } = options;
  const name = (file as File).name || "image";
  const ext = type === "image/jpeg" ? "jpg" : type.split("/")[1];
  const outName = `${name.replace(/\.[^.]+$/, "")}.${ext}`;

  const bitmap = await createImageBitmap(file);
  try {
    if (keepIfExact && bitmap.width === width && bitmap.height === height && file.type === type) {
      return file instanceof File ? file : new File([file], outName, { type });
    }
    const { sx, sy, sw, sh } = coverCrop(bitmap.width, bitmap.height, width, height);

    let blob: Blob;
    if (typeof OffscreenCanvas === "function") {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("fitImageToSize: no 2D canvas context");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
      blob = await canvas.convertToBlob({ type, quality });
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("fitImageToSize: no 2D canvas context");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("fitImageToSize: encoding failed"))), type, quality)
      );
    }
    return new File([blob], outName, { type });
  } finally {
    bitmap.close?.();
  }
}
