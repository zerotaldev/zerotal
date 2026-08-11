import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import {
  coverGeometry,
  cropCentre,
  decodePng,
  encodePng,
  insideGeometry,
  readPngHeader,
  resolveGeometry,
  type RasterImage,
} from "./raster.ts";
import { RasterFormatError } from "../errors.ts";

/** An image whose every pixel encodes its own coordinates, so crops are checkable. */
function coordinateImage(width: number, height: number): RasterImage {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      rgba[at] = x & 0xff;
      rgba[at + 1] = y & 0xff;
      rgba[at + 2] = 0x40;
      rgba[at + 3] = 0xff;
    }
  }
  return { width, height, rgba };
}

/** The RGBA quadruple at (x, y). */
function pixelAt(image: RasterImage, x: number, y: number): number[] {
  const at = (y * image.width + x) * 4;
  return [...image.rgba.subarray(at, at + 4)];
}

describe("readPngHeader", () => {
  test("reads dimensions and format without decoding", () => {
    const header = readPngHeader(encodePng(coordinateImage(37, 11)));
    expect(header).toEqual({
      width: 37,
      height: 11,
      bitDepth: 8,
      colorType: 6,
      interlace: 0,
    });
  });

  test("returns null for bytes that are not a PNG", () => {
    expect(readPngHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]))).toBeNull();
    expect(readPngHeader(new Uint8Array(4))).toBeNull();
  });
});

describe("encodePng / decodePng", () => {
  test("round-trips pixels exactly", () => {
    const source = coordinateImage(64, 48);
    const decoded = decodePng(encodePng(source));

    expect(decoded.width).toBe(64);
    expect(decoded.height).toBe(48);
    expect(decoded.rgba).toEqual(source.rgba);
  });

  test("round-trips a single pixel", () => {
    const decoded = decodePng(encodePng(coordinateImage(1, 1)));
    expect([decoded.width, decoded.height]).toEqual([1, 1]);
  });

  test("preserves alpha rather than flattening it", () => {
    const source = coordinateImage(4, 4);
    source.rgba[3] = 0x00;
    source.rgba[7] = 0x7f;

    const decoded = decodePng(encodePng(source));
    expect(decoded.rgba[3]).toBe(0x00);
    expect(decoded.rgba[7]).toBe(0x7f);
  });

  test("decodes what Bun.Image itself emits", async () => {
    const original = encodePng(coordinateImage(20, 12));
    const viaBun = await new Bun.Image(original).png().bytes();

    const decoded = decodePng(viaBun);
    expect([decoded.width, decoded.height]).toEqual([20, 12]);
    // Bun re-encodes losslessly, so the pixels must survive unchanged.
    expect(decoded.rgba).toEqual(coordinateImage(20, 12).rgba);
  });

  test("handles IDAT split across several chunks", () => {
    // Rebuild a valid PNG with the IDAT payload cut in two, which the spec
    // permits and Bun never does.
    const whole = encodePng(coordinateImage(8, 8));
    const view = new DataView(whole.buffer, whole.byteOffset, whole.byteLength);
    let offset = 8;
    let idat: Uint8Array | null = null;
    const chunks: Array<{ type: string; data: Uint8Array }> = [];
    while (offset + 8 <= whole.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...whole.subarray(offset + 4, offset + 8));
      const data = whole.subarray(offset + 8, offset + 8 + length);
      if (type === "IDAT") idat = data;
      else chunks.push({ type, data });
      offset += 12 + length;
    }
    expect(idat).not.toBeNull();

    const half = Math.floor(idat!.length / 2);
    const rebuilt = _assemble([
      chunks[0]!,
      { type: "IDAT", data: idat!.subarray(0, half) },
      { type: "IDAT", data: idat!.subarray(half) },
      { type: "IEND", data: new Uint8Array(0) },
    ]);

    expect(decodePng(rebuilt).rgba).toEqual(coordinateImage(8, 8).rgba);
  });

  test("decodes every scanline filter type", () => {
    // Hand-build a 4x5 RGBA image using a different filter on each row, so the
    // Sub/Up/Average/Paeth branches are all exercised against known output.
    const width = 4;
    const height = 5;
    const stride = width * 4;
    const expected = coordinateImage(width, height);

    const raw = new Uint8Array(height * (stride + 1));
    for (let y = 0; y < height; y++) {
      const filter = y; // 0..4
      raw[y * (stride + 1)] = filter;
      for (let x = 0; x < stride; x++) {
        const current = expected.rgba[y * stride + x]!;
        const a = x >= 4 ? expected.rgba[y * stride + x - 4]! : 0;
        const b = y > 0 ? expected.rgba[(y - 1) * stride + x]! : 0;
        const c = y > 0 && x >= 4 ? expected.rgba[(y - 1) * stride + x - 4]! : 0;
        let encoded: number;
        switch (filter) {
          case 1:
            encoded = current - a;
            break;
          case 2:
            encoded = current - b;
            break;
          case 3:
            encoded = current - ((a + b) >> 1);
            break;
          case 4: {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            encoded = current - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
            break;
          }
          default:
            encoded = current;
        }
        raw[y * (stride + 1) + 1 + x] = encoded & 0xff;
      }
    }

    const ihdr = new Uint8Array(13);
    const header = new DataView(ihdr.buffer);
    header.setUint32(0, width);
    header.setUint32(4, height);
    ihdr[8] = 8;
    ihdr[9] = 6;

    const png = _assemble([
      { type: "IHDR", data: ihdr },
      { type: "IDAT", data: deflateSync(raw) },
      { type: "IEND", data: new Uint8Array(0) },
    ]);

    expect(decodePng(png).rgba).toEqual(expected.rgba);
  });

  test("rejects shapes it cannot read, by name", () => {
    const png = encodePng(coordinateImage(4, 4));

    const bitDepth = new Uint8Array(png);
    bitDepth[24] = 16;
    expect(() => decodePng(bitDepth)).toThrow(RasterFormatError);
    expect(() => decodePng(bitDepth)).toThrow(/bit depth 16/);

    const palette = new Uint8Array(png);
    palette[25] = 3;
    expect(() => decodePng(palette)).toThrow(/colour type 3/);

    const interlaced = new Uint8Array(png);
    interlaced[28] = 1;
    expect(() => decodePng(interlaced)).toThrow(/interlaced/);

    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow(/not a PNG/);
  });

  test("refuses an intermediate above the pixel cap before allocating", () => {
    const png = encodePng(coordinateImage(50, 50));
    expect(() => decodePng(png, 100)).toThrow(RasterFormatError);
    expect(() => decodePng(png, 100)).toThrow(/exceeds the 100-pixel limit/);
    // Exactly at the cap is fine.
    expect(() => decodePng(png, 2500)).not.toThrow();
  });
});

describe("cropCentre", () => {
  test("takes the middle of an even difference", () => {
    const cropped = cropCentre(coordinateImage(10, 10), 4, 4);
    expect([cropped.width, cropped.height]).toEqual([4, 4]);
    // left = top = (10-4)/2 = 3
    expect(pixelAt(cropped, 0, 0)).toEqual([3, 3, 0x40, 0xff]);
    expect(pixelAt(cropped, 3, 3)).toEqual([6, 6, 0x40, 0xff]);
  });

  test("rounds a half-pixel offset up, as sharp does", () => {
    // 5 wide, keep 2: (5-2)/2 = 1.5 -> column 2, so x = 2 and 3.
    const cropped = cropCentre(coordinateImage(5, 1), 2, 1);
    expect(pixelAt(cropped, 0, 0)[0]).toBe(2);
    expect(pixelAt(cropped, 1, 0)[0]).toBe(3);
  });

  test("clamps a window larger than the image", () => {
    const cropped = cropCentre(coordinateImage(6, 4), 100, 100);
    expect([cropped.width, cropped.height]).toEqual([6, 4]);
    expect(cropped.rgba).toEqual(coordinateImage(6, 4).rgba);
  });

  test("crops one axis while leaving the other whole", () => {
    const cropped = cropCentre(coordinateImage(10, 4), 4, 4);
    expect([cropped.width, cropped.height]).toEqual([4, 4]);
    expect(pixelAt(cropped, 0, 0)).toEqual([3, 0, 0x40, 0xff]);
  });
});

describe("coverGeometry", () => {
  const geometry = (
    sourceWidth: number,
    sourceHeight: number,
    targetWidth: number,
    targetHeight: number,
    withoutEnlargement = true,
  ) => coverGeometry({ sourceWidth, sourceHeight, targetWidth, targetHeight, withoutEnlargement });

  test("scales down so the box is covered, then crops the overflow", () => {
    // 4:3 source into a square: width binds, height overflows and is cropped.
    const result = geometry(4000, 3000, 400, 400);
    expect(result.resizeWidth).toBe(533);
    expect(result.resizeHeight).toBe(400);
    expect(result.cropWidth).toBe(400);
    expect(result.cropHeight).toBe(400);
  });

  test("fills the box exactly when enlargement is allowed", () => {
    const result = geometry(300, 500, 400, 400, false);
    expect(result.cropWidth).toBe(400);
    expect(result.cropHeight).toBe(400);
    expect(result.resizeWidth).toBeGreaterThanOrEqual(400);
    expect(result.resizeHeight).toBeGreaterThanOrEqual(400);
  });

  test("does not preserve aspect ratio when withoutEnlargement clamps", () => {
    // Matches sharp: min(tw, sw) x min(th, sh) — 300x400, not 300x300.
    const result = geometry(300, 500, 400, 400);
    expect(result.resizeIsNoop).toBe(true);
    expect(result.cropWidth).toBe(300);
    expect(result.cropHeight).toBe(400);
  });

  test("never asks for a window wider than the scaled image", () => {
    for (const [sw, sh, tw, th] of [
      [1, 1, 100, 100],
      [3, 7, 5, 2],
      [1000, 1, 50, 50],
      [999, 501, 250, 250],
    ] as const) {
      for (const withoutEnlargement of [true, false]) {
        const result = geometry(sw, sh, tw, th, withoutEnlargement);
        expect(result.cropWidth).toBeLessThanOrEqual(result.resizeWidth);
        expect(result.cropHeight).toBeLessThanOrEqual(result.resizeHeight);
        expect(result.cropWidth).toBeGreaterThan(0);
        expect(result.cropHeight).toBeGreaterThan(0);
      }
    }
  });

  test("flags a no-op resize so the caller can skip it", () => {
    expect(geometry(400, 400, 400, 400).resizeIsNoop).toBe(true);
    expect(geometry(800, 800, 400, 400).resizeIsNoop).toBe(false);
  });
});

describe("insideGeometry", () => {
  const inside = (
    sourceWidth: number,
    sourceHeight: number,
    targetWidth?: number,
    targetHeight?: number,
    withoutEnlargement = true,
  ) => insideGeometry({ sourceWidth, sourceHeight, targetWidth, targetHeight, withoutEnlargement });

  test("rounds rather than floors, matching sharp", () => {
    // 500 * 100/300 = 166.667. Flooring here is what made the two drivers
    // disagree, so this is the whole point of the function.
    expect(inside(300, 500, 100)).toEqual({ width: 100, height: 167 });
    expect(inside(400, 300, 150)).toEqual({ width: 150, height: 113 });
    expect(inside(123, 457, undefined, 186)).toEqual({ width: 50, height: 186 });
  });

  test("honours the requested bound exactly", () => {
    // Bun.Image returned 100 and 249 for these; a width narrower than the one
    // asked for is what lands wrong numbers in a srcset.
    expect(inside(333, 217, 101).width).toBe(101);
    expect(inside(1000, 333, 250).width).toBe(250);
  });

  test("takes the tighter of two bounds", () => {
    expect(inside(900, 150, 100, 100)).toEqual({ width: 100, height: 17 });
    expect(inside(640, 480, 200, 200)).toEqual({ width: 200, height: 150 });
  });

  test("does not enlarge unless asked", () => {
    expect(inside(50, 50, 500, 500)).toEqual({ width: 50, height: 50 });
    expect(inside(50, 50, 500, 500, false)).toEqual({ width: 500, height: 500 });
  });

  test("never rounds a dimension away to zero", () => {
    expect(inside(1000, 3, 10)).toEqual({ width: 10, height: 1 });
  });
});

describe("resolveGeometry", () => {
  const resolve = (
    fit: "inside" | "fill" | "cover",
    sourceWidth: number,
    sourceHeight: number,
    targetWidth?: number,
    targetHeight?: number,
    withoutEnlargement = true,
  ) =>
    resolveGeometry({
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      fit,
      withoutEnlargement,
    });

  test("cover asks for a crop; inside and fill do not", () => {
    expect(resolve("cover", 400, 300, 100, 100).cropWidth).toBe(100);
    expect(resolve("inside", 400, 300, 100, 100).cropWidth).toBeUndefined();
    expect(resolve("fill", 400, 300, 100, 100).cropWidth).toBeUndefined();
  });

  test("cover with one dimension degrades to inside", () => {
    expect(resolve("cover", 300, 500, 100)).toEqual(resolve("inside", 300, 500, 100));
  });

  test("fill with one dimension degrades to inside", () => {
    expect(resolve("fill", 400, 200, 100)).toEqual(resolve("inside", 400, 200, 100));
  });

  test("fill clamps per axis under withoutEnlargement", () => {
    const result = resolve("fill", 300, 500, 400, 400);
    expect([result.resizeWidth, result.resizeHeight]).toEqual([300, 400]);
  });

  test("fill stretches exactly when enlargement is allowed", () => {
    const result = resolve("fill", 300, 500, 400, 400, false);
    expect([result.resizeWidth, result.resizeHeight]).toEqual([400, 400]);
  });

  test("no dimensions means re-encode at source size", () => {
    const result = resolve("cover", 640, 480);
    expect([result.resizeWidth, result.resizeHeight]).toEqual([640, 480]);
    expect(result.resizeIsNoop).toBe(true);
    expect(result.cropWidth).toBeUndefined();
  });
});

/**
 * The assumption this whole module rests on: what `Bun.Image.png()` emits.
 *
 * A Bun upgrade that changes the encoder should fail here — loudly, in CI —
 * rather than in someone's thumbnails. If this breaks, widen `decodePng` to
 * cover the new shape; do not simply update the expectation.
 */
describe("Bun.Image PNG output (canary)", () => {
  test("is 8-bit RGBA, non-interlaced", async () => {
    const source = encodePng(coordinateImage(23, 17));

    for (const png of [
      await new Bun.Image(source).png().bytes(),
      await new Bun.Image(source).resize(9, 7, { fit: "fill" }).png().bytes(),
      await new Bun.Image(source).resize(40, 40, { fit: "inside" }).png().bytes(),
      await new Bun.Image(source).rotate(90).png().bytes(),
    ]) {
      const header = readPngHeader(png);
      expect(header).not.toBeNull();
      expect(header!.bitDepth).toBe(8);
      expect(header!.colorType).toBe(6);
      expect(header!.interlace).toBe(0);
    }
  });

  test("still refuses fit: cover, which is why this module exists", () => {
    const source = encodePng(coordinateImage(8, 8));
    // Thrown synchronously by resize(), before any pixel work is scheduled.
    expect(() => new Bun.Image(source).resize(4, 4, { fit: "cover" as never })).toThrow(
      /fit must be one of/,
    );
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a PNG from an explicit chunk list, CRCs included. */
function _assemble(chunks: Array<{ type: string; data: Uint8Array }>): Uint8Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc32 = (bytes: Uint8Array): number => {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };

  const parts: Uint8Array[] = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])];
  for (const { type, data } of chunks) {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    parts.push(out);
  }

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
