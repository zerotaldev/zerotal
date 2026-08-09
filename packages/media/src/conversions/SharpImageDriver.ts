import {
  FORMAT_MIME,
  type ImageDriver,
  type ImageManipulation,
  type ImageMetadata,
  type ImageResult,
} from "./ImageDriver.ts";
import { MediaError } from "../errors.ts";
import type { ConversionFormat } from "../types.ts";

// ── Minimal structural view of sharp ──────────────────────────────────────────
// `sharp` is an optional peer: apps that never crop never install it, so we
// cannot import its types. This is only the slice this driver uses.

interface SharpPipeline {
  rotate(degrees?: number): SharpPipeline;
  resize(options: {
    width?: number;
    height?: number;
    fit?: "cover" | "contain" | "fill" | "inside" | "outside";
    withoutEnlargement?: boolean;
  }): SharpPipeline;
  jpeg(options?: { quality?: number }): SharpPipeline;
  png(options?: { quality?: number }): SharpPipeline;
  webp(options?: { quality?: number }): SharpPipeline;
  avif(options?: { quality?: number }): SharpPipeline;
  heif(options?: { quality?: number; compression?: string }): SharpPipeline;
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
  toBuffer(options: { resolveWithObject: true }): Promise<{
    data: Uint8Array;
    info: { width: number; height: number };
  }>;
}

type SharpFactory = (input: Uint8Array) => SharpPipeline;

let _sharp: SharpFactory | null = null;

/**
 * Load `sharp` once, with an error that says what to install if it is absent.
 *
 * The specifier goes through a variable so the compiler does not try to resolve
 * it: `sharp` is genuinely optional, and a literal `import("sharp")` would fail
 * `tsc` in every app that has not installed it — including all the ones using
 * the default driver, which is most of them.
 */
async function loadSharp(): Promise<SharpFactory> {
  if (_sharp) return _sharp;
  const specifier = "sharp";
  try {
    const module = (await import(specifier)) as {
      default?: SharpFactory;
    } & SharpFactory;
    _sharp = module.default ?? module;
    return _sharp;
  } catch {
    throw new MediaError(
      'config/media.ts sets driver: "sharp" but the sharp package is not installed.\n' +
        "Fix: `bun add sharp`, or switch back to the built-in driver with " +
        'driver: "bun" (which cannot crop — see fit: "cover").',
    );
  }
}

/**
 * Image processing on `sharp`, for apps that need what `Bun.Image` does not do —
 * principally `fit: "cover"`, the centre-crop behind every square thumbnail.
 *
 * Opt in by installing `sharp` and setting `driver: "sharp"` in `config/media.ts`.
 * `sharp` builds against Node-API v9, which Bun implements, so it runs here; it
 * is a native module, so it does add an install step and a platform-specific
 * binary, which is exactly why it is not the default.
 */
export class SharpImageDriver implements ImageDriver {
  readonly name = "SharpImageDriver";
  readonly supportsCrop = true;

  async metadata(bytes: Uint8Array): Promise<ImageMetadata | null> {
    try {
      const sharp = await loadSharp();
      const meta = await sharp(bytes).metadata();
      if (meta.width === undefined || meta.height === undefined) return null;
      return { width: meta.width, height: meta.height, format: meta.format ?? "unknown" };
    } catch {
      return null;
    }
  }

  async convert(bytes: Uint8Array, manipulation: ImageManipulation): Promise<ImageResult> {
    const { width, height, fit = "inside", format, quality, rotate } = manipulation;
    const sharp = await loadSharp();

    let pipeline = sharp(bytes);

    if (rotate !== undefined && rotate !== 0) pipeline = pipeline.rotate(rotate);

    if (width !== undefined || height !== undefined) {
      pipeline = pipeline.resize({
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        fit,
        withoutEnlargement: manipulation.withoutEnlargement ?? true,
      });
    }

    pipeline = _applyFormat(pipeline, format, quality);

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    return {
      bytes: data,
      width: info.width,
      height: info.height,
      format,
      mimeType: FORMAT_MIME[format],
    };
  }

  async placeholder(bytes: Uint8Array): Promise<string | null> {
    try {
      const sharp = await loadSharp();
      // No ThumbHash in sharp, so a tiny blurred WebP stands in. Larger than
      // Bun.Image's placeholder, and still small enough to inline.
      const { data } = await sharp(bytes)
        .resize({ width: 32, fit: "inside" })
        .webp({ quality: 40 })
        .toBuffer({ resolveWithObject: true });
      return `data:image/webp;base64,${Buffer.from(data).toString("base64")}`;
    } catch {
      return null;
    }
  }

  async canEncode(format: ConversionFormat): Promise<boolean> {
    try {
      const sharp = await loadSharp();
      await _applyFormat(sharp(_PROBE_PNG).resize({ width: 2 }), format, 60).toBuffer({
        resolveWithObject: true,
      });
      return true;
    } catch {
      return false;
    }
  }
}

function _applyFormat(
  pipeline: SharpPipeline,
  format: ConversionFormat,
  quality: number | undefined,
): SharpPipeline {
  const options = quality === undefined ? undefined : { quality };
  switch (format) {
    case "jpeg":
      return pipeline.jpeg(options);
    case "png":
      return pipeline.png(options);
    case "webp":
      return pipeline.webp(options);
    case "avif":
      return pipeline.avif(options);
    case "heic":
      return pipeline.heif({ ...(options ?? {}), compression: "hevc" });
  }
}

/** A valid 2×2 PNG, used to probe which encoders are available. */
const _PROBE_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAD0lEQVR4nGMsY2AoY0AGAA5uAO6e" +
      "5/phAAAAAElFTkSuQmCC",
  ),
  (c) => c.charCodeAt(0),
);
