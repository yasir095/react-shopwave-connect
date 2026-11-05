import { describe, it, expect, afterEach, vi } from "vitest";
import {
  ImageRuleError,
  ImageTooSmallError,
  checkImageRule,
  parseAspectRatio,
  planImageFit,
  prepareImage,
  type ImageRule,
} from "../../src/core";

const PRODUCT: ImageRule = { aspectRatio: "100:77", minWidth: 600, minHeight: 462, maxLongSide: 2000 };
const size = (width: number, height: number) => ({ width, height });

describe("parseAspectRatio", () => {
  it("takes w:h, w/h, w×h, [w, h] and plain numbers", () => {
    expect(parseAspectRatio("100:77")).toBeCloseTo(100 / 77);
    expect(parseAspectRatio(" 16 / 9 ")).toBeCloseTo(16 / 9);
    expect(parseAspectRatio("4x3")).toBeCloseTo(4 / 3);
    expect(parseAspectRatio([100, 77])).toBeCloseTo(100 / 77);
    expect(parseAspectRatio(1.5)).toBe(1.5);
    expect(parseAspectRatio("1.5")).toBe(1.5);
  });

  it("refuses anything else", () => {
    for (const bad of ["abc", "0:1", "1:0", "", -1, 0, Number.NaN, [1, 0]] as const) {
      expect(() => parseAspectRatio(bad as never)).toThrow(ImageRuleError);
    }
  });
});

describe("checkImageRule", () => {
  it("accepts the rule shapes", () => {
    expect(() => checkImageRule(PRODUCT)).not.toThrow();
    expect(() => checkImageRule({ width: 600, height: 462 })).not.toThrow();
    expect(() => checkImageRule({ maxLongSide: 2000 })).not.toThrow();
    expect(() => checkImageRule({})).not.toThrow();
  });

  it("refuses contradictory rules", () => {
    const bad: ImageRule[] = [
      { width: 600 },
      { width: 600, height: 462, aspectRatio: "1:1" },
      { width: 600, height: 462, maxLongSide: 2000 },
      { minWidth: 800, maxWidth: 600 },
      { minHeight: 800, maxHeight: 600 },
      { minWidth: 2500, maxLongSide: 2000 },
      { maxWidth: 0 },
      { minHeight: -1 },
      { aspectRatio: "wide" },
    ];
    for (const rule of bad) expect(() => checkImageRule(rule), JSON.stringify(rule)).toThrow(ImageRuleError);
  });
});

describe("planImageFit with a ratio, minimum and maximum (the product rule)", () => {
  it("crops a large photo to the ratio, then scales it down to the long-side limit", () => {
    const plan = planImageFit(size(6000, 4000), PRODUCT);
    expect(plan.crop).toEqual({ sx: 403, sy: 0, sw: 5195, sh: 4000 });
    expect([plan.width, plan.height]).toEqual([2000, 1540]);
    expect(plan.unchanged).toBe(false);
  });

  it("trims a tall image top and bottom", () => {
    const plan = planImageFit(size(1000, 3000), PRODUCT);
    expect(plan.crop).toEqual({ sx: 0, sy: 1115, sw: 1000, sh: 770 });
    expect([plan.width, plan.height]).toEqual([1000, 770]);
  });

  it("crops a square without scaling when it's under the maximum", () => {
    const plan = planImageFit(size(800, 800), PRODUCT);
    expect(plan.crop).toEqual({ sx: 0, sy: 92, sw: 800, sh: 616 });
    expect([plan.width, plan.height]).toEqual([800, 616]);
  });

  it("leaves an image that already fits untouched", () => {
    expect(planImageFit(size(1200, 924), PRODUCT)).toEqual({
      crop: { sx: 0, sy: 0, sw: 1200, sh: 924 },
      width: 1200,
      height: 924,
      unchanged: true,
    });
    expect(planImageFit(size(600, 462), PRODUCT).unchanged).toBe(true);
  });

  it("refuses an image whose crop is below the minimum, with the sizes", () => {
    try {
      planImageFit(size(500, 400), PRODUCT);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ImageTooSmallError);
      expect((error as ImageTooSmallError).required).toEqual({ width: 600, height: 462 });
      expect((error as ImageTooSmallError).actual).toEqual({ width: 500, height: 385 });
    }
    // Wide enough overall but too short once cropped to the ratio.
    expect(() => planImageFit(size(3000, 400), PRODUCT)).toThrow(ImageTooSmallError);
  });

  it("enlarges a small image to the minimum with allowUpscale", () => {
    const plan = planImageFit(size(500, 400), { ...PRODUCT, allowUpscale: true });
    expect([plan.width, plan.height]).toEqual([600, 462]);
  });

  it("implies the other minimum from the ratio", () => {
    expect(() => planImageFit(size(620, 300), { aspectRatio: "2:1", minWidth: 600 })).not.toThrow();
    try {
      planImageFit(size(500, 300), { aspectRatio: "2:1", minWidth: 600 });
      expect.unreachable();
    } catch (error) {
      expect((error as ImageTooSmallError).required).toEqual({ width: 600, height: 300 });
    }
  });
});

describe("planImageFit with an exact size", () => {
  it("scales down and crops to exactly the size", () => {
    const plan = planImageFit(size(6000, 4000), { width: 600, height: 462 });
    expect(plan.crop).toEqual({ sx: 403, sy: 0, sw: 5195, sh: 4000 });
    expect([plan.width, plan.height]).toEqual([600, 462]);
  });

  it("refuses an image smaller than the size unless upscaling is allowed", () => {
    expect(() => planImageFit(size(590, 600), { width: 600, height: 462 })).toThrow(ImageTooSmallError);
    expect(planImageFit(size(590, 600), { width: 600, height: 462, allowUpscale: true })).toMatchObject({ width: 600, height: 462 });
  });

  it("leaves an image of exactly that size untouched", () => {
    expect(planImageFit(size(600, 462), { width: 600, height: 462 }).unchanged).toBe(true);
  });
});

describe("planImageFit with only limits", () => {
  it("keeps the shape and scales down to the maximum", () => {
    const plan = planImageFit(size(4000, 1000), { maxLongSide: 2000 });
    expect(plan.crop).toEqual({ sx: 0, sy: 0, sw: 4000, sh: 1000 });
    expect([plan.width, plan.height]).toEqual([2000, 500]);
    expect(planImageFit(size(3000, 3000), { maxWidth: 1000, maxHeight: 500 })).toMatchObject({ width: 500, height: 500 });
  });

  it("does nothing to an image within the limits, or with an empty rule", () => {
    expect(planImageFit(size(800, 300), { maxLongSide: 2000, minWidth: 100 }).unchanged).toBe(true);
    expect(planImageFit(size(800, 300), {}).unchanged).toBe(true);
  });

  it("refuses an image below a minimum", () => {
    expect(() => planImageFit(size(500, 300), { minWidth: 600 })).toThrow(ImageTooSmallError);
  });

  it("rejects an image with no size", () => {
    expect(() => planImageFit(size(0, 10), {})).toThrow(/no size/);
  });
});

// ---------------------------------------------------------------------------
// prepareImage, with a fake bitmap and canvas (the unit tests run in Node)
// ---------------------------------------------------------------------------

describe("prepareImage", () => {
  let draws: unknown[][];
  let encoded: Array<{ type?: string; quality?: number; width: number; height: number }>;
  let closed: number;

  function fakeBrowser(width: number, height: number) {
    draws = [];
    encoded = [];
    closed = 0;
    vi.stubGlobal("createImageBitmap", async () => ({ width, height, close: () => (closed += 1) }));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number
        ) {}
        getContext() {
          return { imageSmoothingQuality: "", drawImage: (...args: unknown[]) => draws.push(args) };
        }
        async convertToBlob(opts: { type?: string; quality?: number }) {
          encoded.push({ ...opts, width: this.width, height: this.height });
          return new Blob(["x"], { type: opts.type });
        }
      }
    );
  }
  afterEach(() => vi.unstubAllGlobals());

  const jpeg = () => new File([new Uint8Array([255, 216, 255])], "shoe.photo.jpeg", { type: "image/jpeg" });

  it("crops and scales in one draw, keeping the source type", async () => {
    fakeBrowser(6000, 4000);
    const out = await prepareImage(jpeg(), PRODUCT);
    expect(draws).toEqual([[expect.anything(), 403, 0, 5195, 4000, 0, 0, 2000, 1540]]);
    expect(encoded).toEqual([{ type: "image/jpeg", quality: 0.9, width: 2000, height: 1540 }]);
    expect(out.name).toBe("shoe.photo.jpg");
    expect(out.type).toBe("image/jpeg");
    expect(closed).toBe(1);
  });

  it("returns the same file when it already fits", async () => {
    fakeBrowser(1200, 924);
    const file = jpeg();
    expect(await prepareImage(file, PRODUCT)).toBe(file);
    expect(draws).toEqual([]);
  });

  it("re-encodes as PNG when the source type can't be written, and on request", async () => {
    fakeBrowser(1200, 924);
    const gif = new File(["g"], "anim.gif", { type: "image/gif" });
    const out = await prepareImage(gif, PRODUCT);
    expect(out.name).toBe("anim.png");
    expect(encoded[0]).toMatchObject({ type: "image/png", quality: undefined });

    fakeBrowser(1200, 924);
    await prepareImage(jpeg(), PRODUCT, { type: "image/webp", quality: 0.7 });
    expect(encoded[0]).toMatchObject({ type: "image/webp", quality: 0.7 });
  });

  it("rejects a too-small image and frees the bitmap", async () => {
    fakeBrowser(500, 400);
    await expect(prepareImage(jpeg(), PRODUCT)).rejects.toBeInstanceOf(ImageTooSmallError);
    expect(closed).toBe(1);
    expect(draws).toEqual([]);
  });

  it("checks the rule before reading the file", async () => {
    fakeBrowser(1000, 1000);
    const spy = vi.fn();
    vi.stubGlobal("createImageBitmap", spy);
    await expect(prepareImage(jpeg(), { width: 10 })).rejects.toBeInstanceOf(ImageRuleError);
    expect(spy).not.toHaveBeenCalled();
  });
});
