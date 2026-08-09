import {
  FORMAT_MIME,
  type ImageDriver,
  type ImageManipulation,
  type ImageMetadata,
  type ImageResult,
} from "./ImageDriver.ts";
import { UnsupportedFormatError, UnsupportedManipulationError } from "../errors.ts";
import type { ConversionFormat } from "../types.ts";

/**
 * Image processing on `Bun.Image` — no native modules, no `sharp`, nothing to
 * install. JPEG, PNG and WebP are statically linked into Bun itself.
 *
 * ## What it cannot do
 *
 * `Bun.Image.resize()` takes `fit: "fill" | "inside"` and the class exposes no
 * crop, extract or composite primitive. A centre-cropped thumbnail — a square
 * from a 3:2 photo — is therefore not expressible, and `fit: "cover"` throws
 * {@link UnsupportedManipulationError} naming the fix rather than silently
 * returning a stretched image. Apps that need crop install `sharp` and switch to
 * `SharpImageDriver` via `media.driver`.
 *
 * ## Host-dependent formats
 *
 * `Bun.Image.backend` is `"system"` by default, so AVIF and HEIC encode through
 * OS codecs that are absent on most Linux hosts. {@link canEncode} probes for
 * real rather than assuming, and `MediaProvider` runs that probe once at boot.
 */
export class BunImageDriver implements ImageDriver {
  readonly name = "BunImageDriver";
  readonly supportsCrop = false;

  /** Memoised results of {@link canEncode}, which costs a real encode. */
  readonly #encodable = new Map<ConversionFormat, boolean>();

  constructor(
    /**
     * Cap on input pixels, guarding against decompression bombs: a few-KB file
     * declaring a 50000×50000 canvas would otherwise allocate gigabytes. Checked
     * against the header before any pixel buffer is allocated.
     */
    private readonly maxPixels: number = 0x3fff * 0x3fff,
  ) {}

  async metadata(bytes: Uint8Array): Promise<ImageMetadata | null> {
    try {
      const meta = await new Bun.Image(bytes, { maxPixels: this.maxPixels }).metadata();
      return { width: meta.width, height: meta.height, format: meta.format };
    } catch {
      // Not an image, or a format this host cannot decode. Callers treat null as
      // "not convertible" and keep the original — never a hard failure.
      return null;
    }
  }

  async convert(bytes: Uint8Array, manipulation: ImageManipulation): Promise<ImageResult> {
    const { width, height, fit = "inside", format, quality, rotate } = manipulation;

    if (fit === "cover") {
      throw new UnsupportedManipulationError(
        this.name,
        'centre-crop (fit: "cover") — Bun.Image supports only fit: "fill" | "inside" ' +
          "and exposes no crop primitive",
        'either use fit: "inside" (scale to fit, preserves aspect ratio) or ' +
          'install sharp and set `driver: "sharp"` in config/media.ts.',
      );
    }

    let pipeline = new Bun.Image(bytes, { maxPixels: this.maxPixels });

    if (rotate !== undefined && rotate !== 0) pipeline = pipeline.rotate(rotate);

    if (width !== undefined || height !== undefined) {
      // Bun.Image needs a width; when only a height is given, pass the height
      // through as the bound and let `inside` preserve the aspect ratio.
      const targetWidth = width ?? height!;
      pipeline = pipeline.resize(targetWidth, height, {
        fit,
        // Upscaling a 200px source to fill a 1920px slot produces a blurry file
        // larger than the original. Never worth it by default.
        withoutEnlargement: manipulation.withoutEnlargement ?? true,
      });
    }

    pipeline = _applyFormat(pipeline, format, quality);

    let out: Uint8Array;
    try {
      out = await pipeline.bytes();
    } catch (error) {
      if (_codeOf(error) === "ERR_IMAGE_FORMAT_UNSUPPORTED") {
        throw new UnsupportedFormatError(format, await this.encodableFormats());
      }
      throw error;
    }

    return {
      bytes: out,
      // Populated once a terminal has been awaited; -1 before that.
      width: pipeline.width,
      height: pipeline.height,
      format,
      mimeType: FORMAT_MIME[format],
    };
  }

  async placeholder(bytes: Uint8Array): Promise<string | null> {
    try {
      // ThumbHash-rendered: a ~32px blur carrying the right average colour and
      // aspect ratio, around 400–700 bytes, ready for `<img src>`.
      return await new Bun.Image(bytes, { maxPixels: this.maxPixels }).placeholder("dataurl");
    } catch {
      return null;
    }
  }

  async canEncode(format: ConversionFormat): Promise<boolean> {
    const cached = this.#encodable.get(format);
    if (cached !== undefined) return cached;

    let ok: boolean;
    try {
      await _applyFormat(new Bun.Image(_PROBE_PNG).resize(2, 2), format, 60).bytes();
      ok = true;
    } catch (error) {
      if (_codeOf(error) === "ERR_IMAGE_FORMAT_UNSUPPORTED") ok = false;
      else throw error;
    }

    this.#encodable.set(format, ok);
    return ok;
  }

  /** Every format this host could actually encode, for error messages. */
  async encodableFormats(): Promise<string[]> {
    const all: ConversionFormat[] = ["jpeg", "png", "webp", "avif", "heic"];
    const available: string[] = [];
    for (const format of all) {
      if (await this.canEncode(format)) available.push(format);
    }
    return available;
  }
}

/** Select the output encoder on a pipeline. */
function _applyFormat(
  pipeline: Bun.Image,
  format: ConversionFormat,
  quality: number | undefined,
): Bun.Image {
  switch (format) {
    case "jpeg":
      return quality === undefined ? pipeline.jpeg() : pipeline.jpeg({ quality });
    case "webp":
      return quality === undefined ? pipeline.webp() : pipeline.webp({ quality });
    case "avif":
      return quality === undefined ? pipeline.avif() : pipeline.avif({ quality });
    case "heic":
      return quality === undefined ? pipeline.heic() : pipeline.heic({ quality });
    case "png":
      // PNG is lossless: it takes a zlib level, not a quality. Mapping 1–100
      // onto 0–9 would make `quality: 82` mean something quite different here
      // than it does for JPEG, so the default level is used instead.
      return pipeline.png();
  }
}

/** The stable `error.code` Bun.Image sets, when there is one. */
function _codeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** A valid 2×2 PNG, used to probe which encoders this host actually has. */
const _PROBE_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAD0lEQVR4nGMsY2AoY0AGAA5uAO6e" +
      "5/phAAAAAElFTkSuQmCC",
  ),
  (c) => c.charCodeAt(0),
);
