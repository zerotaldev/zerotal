/**
 * Raw-pixel helpers that give {@link BunImageDriver} a centre-crop.
 *
 * `Bun.Image` exposes no crop, extract or composite primitive, and its
 * `resize()` accepts only `fit: "fill" | "inside"` — so a cover-fit thumbnail
 * cannot be expressed through its API alone. What it does expose is `.png()`,
 * a *lossless* way out of the pipeline, and the PNG it emits is always the same
 * narrow shape: 8-bit, colour type 6 (RGBA), non-interlaced, no palette.
 *
 * That is enough. The scaling stays with Bun (native, and the same resampling
 * every other conversion gets); this module only decodes the scaled result,
 * copies out the centre window, and re-encodes. The pixel work therefore happens
 * on an already-downscaled image — a thumbnail-sized buffer, not the original.
 *
 * Nothing here is exported from the package. It is an implementation detail of
 * one driver, and a hand-rolled PNG codec is not an API worth supporting.
 *
 * @module
 * @internal
 */
import { deflateSync, inflateSync } from "node:zlib";
import { RasterFormatError } from "../errors.ts";

/** A decoded image: 8-bit RGBA, row-major, no row padding. */
export interface RasterImage {
  width: number;
  height: number;
  /** Exactly `width * height * 4` bytes, in RGBA order. */
  rgba: Uint8Array;
}

/** What a PNG's IHDR declares. */
export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  /** 0 grey, 2 RGB, 3 palette, 4 grey+alpha, 6 RGBA. */
  colorType: number;
  /** 0 none, 1 Adam7. */
  interlace: number;
}

/** The eight bytes every PNG starts with. */
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Bytes per pixel for each colour type this module decodes, at bit depth 8. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * Read a PNG's IHDR without decoding any pixels.
 *
 * Returns `null` when the bytes are not a PNG at all, which callers treat as
 * "not ours to handle" rather than as a failure.
 */
export function readPngHeader(bytes: Uint8Array): PngHeader | null {
  // 8-byte signature + 4 length + 4 "IHDR" + 13 data.
  if (bytes.length < 29) return null;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== SIGNATURE[i]) return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
    bitDepth: view.getUint8(24),
    colorType: view.getUint8(25),
    interlace: view.getUint8(28),
  };
}

/**
 * Decode a PNG to RGBA.
 *
 * Deliberately narrow: 8-bit non-interlaced, colour types 0/2/4/6. That covers
 * everything `Bun.Image.png()` emits with room to spare, and anything outside it
 * throws {@link RasterFormatError} by name rather than producing wrong pixels.
 * Palette and 16-bit inputs never reach here — this only ever decodes PNGs this
 * package just asked Bun to produce.
 *
 * @param maxPixels Refuse images above this pixel count, before allocating.
 */
export function decodePng(bytes: Uint8Array, maxPixels = Number.POSITIVE_INFINITY): RasterImage {
  const header = readPngHeader(bytes);
  if (header === null) throw new RasterFormatError("the bytes are not a PNG");

  const { width, height, bitDepth, colorType, interlace } = header;

  if (bitDepth !== 8) {
    throw new RasterFormatError(`bit depth ${bitDepth} is not supported (expected 8)`);
  }
  if (interlace !== 0) {
    throw new RasterFormatError("interlaced (Adam7) PNGs are not supported");
  }
  const channels = CHANNELS[colorType];
  if (channels === undefined) {
    throw new RasterFormatError(
      `colour type ${colorType} is not supported (expected 0, 2, 4 or 6)`,
    );
  }
  if (width <= 0 || height <= 0) {
    throw new RasterFormatError(`degenerate dimensions ${width}x${height}`);
  }
  if (width * height > maxPixels) {
    throw new RasterFormatError(
      `${width}x${height} exceeds the ${maxPixels}-pixel limit for intermediate buffers`,
    );
  }

  // The spec allows IDAT to be split across any number of chunks. Bun emits one,
  // but concatenating is three lines and removes the assumption.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT") parts.push(bytes.subarray(offset + 8, offset + 8 + length));
    if (type === "IEND") break;
    offset += 12 + length;
  }
  if (parts.length === 0) throw new RasterFormatError("PNG has no IDAT chunk");

  // `inflateSync` here, not `Bun.inflateSync`: the Bun helpers are *raw* deflate
  // and IDAT is a zlib stream. Mixing them yields a file whose header parses and
  // whose pixels do not.
  const inflated = inflateSync(_concat(parts));

  const sourceStride = width * channels;
  const expected = height * (sourceStride + 1);
  if (inflated.length < expected) {
    throw new RasterFormatError(
      `IDAT holds ${inflated.length} bytes, short of the ${expected} needed for ${width}x${height}`,
    );
  }

  const raw = _unfilter(inflated, width, height, channels);
  return { width, height, rgba: channels === 4 ? raw : _toRgba(raw, width, height, channels) };
}

/**
 * Encode RGBA as a PNG.
 *
 * Every scanline uses filter 0 (None) and compression level 1. This is a
 * throwaway intermediate handed straight back to `Bun.Image` in memory, never a
 * stored artifact, so time spent choosing filters or squeezing bytes would buy
 * nothing — the file is decoded and discarded microseconds later.
 */
export function encodePng(image: RasterImage): Uint8Array {
  const { width, height, rgba } = image;
  const stride = width * 4;

  // One leading filter-type byte per scanline; 0 means "store the row as-is".
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, width);
  header.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  return _concat([
    Uint8Array.from(SIGNATURE),
    _chunk("IHDR", ihdr),
    _chunk("IDAT", deflateSync(raw, { level: 1 })),
    _chunk("IEND", new Uint8Array(0)),
  ]);
}

/**
 * Copy the centre `cropWidth` × `cropHeight` window out of `image`.
 *
 * The offset rounds *up* on a half-pixel, matching sharp: cropping 2 columns
 * from 5 keeps columns 2–3, not 1–2. Sub-pixel, but it is the difference between
 * two drivers producing identical thumbnails and merely similar ones.
 */
export function cropCentre(image: RasterImage, cropWidth: number, cropHeight: number): RasterImage {
  const width = Math.min(cropWidth, image.width);
  const height = Math.min(cropHeight, image.height);
  const left = Math.round((image.width - width) / 2);
  const top = Math.round((image.height - height) / 2);

  const stride = width * 4;
  const rgba = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const from = ((top + y) * image.width + left) * 4;
    rgba.set(image.rgba.subarray(from, from + stride), y * stride);
  }

  return { width, height, rgba };
}

/** The resize-then-crop plan that turns a source into a cover-fit target. */
export interface CoverGeometry {
  /** What to hand `Bun.Image.resize()`, with `fit: "fill"`. */
  resizeWidth: number;
  resizeHeight: number;
  /** The window to take from that result. */
  cropWidth: number;
  cropHeight: number;
  /** True when the resize is a no-op and the source can be cropped directly. */
  resizeIsNoop: boolean;
}

/**
 * The exact output dimensions for one manipulation, and whether a crop follows.
 *
 * Every driver resolves geometry through here and then asks its backend for
 * *those exact numbers*, rather than passing the user's box down and trusting
 * the backend's own rounding. That is what makes `media.driver` safe to flip:
 * the two backends round differently — `Bun.Image` floors, and can return a
 * width a pixel short of the one requested — so agreement has to be built
 * rather than assumed.
 */
export interface ResolvedGeometry {
  /** Scale the (already-rotated) source to exactly this, ignoring aspect ratio. */
  resizeWidth: number;
  resizeHeight: number;
  /** When set, take this centre window out of the scaled result. */
  cropWidth?: number;
  cropHeight?: number;
  /** True when the resize would change nothing. */
  resizeIsNoop: boolean;
}

/**
 * Dimensions for `fit: "inside"` — scale to fit within the box, aspect
 * preserved.
 *
 * `round`, not `floor`, on both axes: verified against sharp 0.34 across
 * exact, half-pixel and long-tail ratios.
 */
export function insideGeometry(params: {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth?: number | undefined;
  targetHeight?: number | undefined;
  withoutEnlargement: boolean;
}): { width: number; height: number } {
  const { sourceWidth, sourceHeight, targetWidth, targetHeight, withoutEnlargement } = params;

  const byWidth = targetWidth === undefined ? Number.POSITIVE_INFINITY : targetWidth / sourceWidth;
  const byHeight =
    targetHeight === undefined ? Number.POSITIVE_INFINITY : targetHeight / sourceHeight;

  let scale = Math.min(byWidth, byHeight);
  if (!Number.isFinite(scale)) scale = 1;
  if (withoutEnlargement && scale > 1) scale = 1;

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

/**
 * Resolve any manipulation into exact dimensions plus an optional centre crop.
 *
 * The awkward corners, all matched to sharp:
 *
 * - `cover` needs a box. Given one dimension there is nothing to crop away, so
 *   it degrades to `inside` rather than inventing a second meaning.
 * - `fill` also needs a box: with one dimension sharp stretches that axis alone
 *   and leaves the other at source size, which is almost never what a caller
 *   meant. Treated as `inside`, and documented as such.
 * - `fill` under `withoutEnlargement` clamps per axis to `min(target, source)`,
 *   which can change the aspect ratio the caller asked to stretch to.
 */
export function resolveGeometry(params: {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth?: number | undefined;
  targetHeight?: number | undefined;
  fit: "inside" | "fill" | "cover";
  withoutEnlargement: boolean;
}): ResolvedGeometry {
  const { sourceWidth, sourceHeight, targetWidth, targetHeight, fit, withoutEnlargement } = params;

  const noop: ResolvedGeometry = {
    resizeWidth: sourceWidth,
    resizeHeight: sourceHeight,
    resizeIsNoop: true,
  };

  // Nothing asked for: re-encode at source size.
  if (targetWidth === undefined && targetHeight === undefined) return noop;

  const hasBox = targetWidth !== undefined && targetHeight !== undefined;

  if (fit === "cover" && hasBox) {
    const cover = coverGeometry({
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      withoutEnlargement,
    });
    return {
      resizeWidth: cover.resizeWidth,
      resizeHeight: cover.resizeHeight,
      cropWidth: cover.cropWidth,
      cropHeight: cover.cropHeight,
      resizeIsNoop: cover.resizeIsNoop,
    };
  }

  if (fit === "fill" && hasBox) {
    const width = withoutEnlargement ? Math.min(targetWidth, sourceWidth) : targetWidth;
    const height = withoutEnlargement ? Math.min(targetHeight, sourceHeight) : targetHeight;
    return {
      resizeWidth: width,
      resizeHeight: height,
      resizeIsNoop: width === sourceWidth && height === sourceHeight,
    };
  }

  const inside = insideGeometry({
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    withoutEnlargement,
  });
  return {
    resizeWidth: inside.width,
    resizeHeight: inside.height,
    resizeIsNoop: inside.width === sourceWidth && inside.height === sourceHeight,
  };
}

/**
 * Work out how to cover-fit `source` into `target`.
 *
 * Scaling by `max(tw/sw, th/sh)` makes the result overflow the box in at most
 * one axis, and the overflow is what gets cropped away. Because both dimensions
 * are scaled by the same factor, passing them to `fit: "fill"` — which would
 * otherwise stretch — distorts nothing; it just sidesteps `inside`'s refusal to
 * overflow the box, which is the only reason `fill` is used here.
 *
 * `withoutEnlargement` follows sharp exactly, including the part that is not
 * obvious: when the source is too small, the output is `min(tw, sw) × min(th, sh)`
 * and the requested *aspect ratio is not preserved*. A 300×500 source asked to
 * cover 400×400 yields 300×400, not 300×300.
 */
export function coverGeometry(params: {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  withoutEnlargement: boolean;
}): CoverGeometry {
  const { sourceWidth, sourceHeight, targetWidth, targetHeight, withoutEnlargement } = params;

  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);

  // Clamped: no scaling at all, just a crop of whatever the source can supply.
  if (withoutEnlargement && scale > 1) {
    return {
      resizeWidth: sourceWidth,
      resizeHeight: sourceHeight,
      cropWidth: Math.min(targetWidth, sourceWidth),
      cropHeight: Math.min(targetHeight, sourceHeight),
      resizeIsNoop: true,
    };
  }

  // Round, then floor the box to what the scaled image can actually supply: a
  // half-pixel rounding down would otherwise ask for a window one pixel wider
  // than the image it is cut from.
  const resizeWidth = Math.max(1, Math.round(sourceWidth * scale));
  const resizeHeight = Math.max(1, Math.round(sourceHeight * scale));

  return {
    resizeWidth,
    resizeHeight,
    cropWidth: Math.min(targetWidth, resizeWidth),
    cropHeight: Math.min(targetHeight, resizeHeight),
    resizeIsNoop: resizeWidth === sourceWidth && resizeHeight === sourceHeight,
  };
}

// ── Private ──────────────────────────────────────────────────────────────────

/** Undo PNG's per-scanline filtering (spec §9.2). */
function _unfilter(
  inflated: Uint8Array,
  width: number,
  height: number,
  channels: number,
): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(height * stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = inflated[rowStart]!;
    const line = inflated.subarray(rowStart + 1, rowStart + 1 + stride);
    const row = out.subarray(y * stride, y * stride + stride);
    const prior = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    // Filter 0 is a straight copy — the common case for our own encoder, and
    // worth not walking byte by byte.
    if (filter === 0) {
      row.set(line);
      continue;
    }

    for (let x = 0; x < stride; x++) {
      // a = pixel to the left, b = pixel above, c = pixel above-left.
      const a = x >= channels ? row[x - channels]! : 0;
      const b = prior ? prior[x]! : 0;
      const c = prior && x >= channels ? prior[x - channels]! : 0;
      let value = line[x]!;

      switch (filter) {
        case 1:
          value += a;
          break;
        case 2:
          value += b;
          break;
        case 3:
          value += (a + b) >> 1;
          break;
        case 4: {
          // Paeth: pick whichever neighbour the linear predictor lands nearest.
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default:
          throw new RasterFormatError(`unknown scanline filter ${filter} on row ${y}`);
      }

      row[x] = value & 0xff;
    }
  }

  return out;
}

/** Widen grey / grey+alpha / RGB samples to RGBA. */
function _toRgba(raw: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const count = width * height;
  const rgba = new Uint8Array(count * 4);

  for (let i = 0; i < count; i++) {
    const from = i * channels;
    const to = i * 4;
    if (channels === 1 || channels === 2) {
      const grey = raw[from]!;
      rgba[to] = grey;
      rgba[to + 1] = grey;
      rgba[to + 2] = grey;
      rgba[to + 3] = channels === 2 ? raw[from + 1]! : 0xff;
    } else {
      rgba[to] = raw[from]!;
      rgba[to + 1] = raw[from + 1]!;
      rgba[to + 2] = raw[from + 2]!;
      rgba[to + 3] = 0xff;
    }
  }

  return rgba;
}

/** Wrap `data` in a PNG chunk: length, type, payload, CRC. */
function _chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // The CRC covers the type and the payload, but not the length.
  view.setUint32(8 + data.length, _crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const _CRC_TABLE = /* @__PURE__ */ (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function _crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = _CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function _concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
