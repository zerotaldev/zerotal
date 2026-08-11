import {
  FORMAT_MIME,
  type ImageDriver,
  type ImageManipulation,
  type ImageMetadata,
  type ImageResult,
} from "./ImageDriver.ts";
import { RasterFormatError, UnsupportedFormatError } from "../errors.ts";
import { cropCentre, decodePng, encodePng, readPngHeader, resolveGeometry } from "./raster.ts";
import type { ResolvedGeometry } from "./raster.ts";
import type { ConversionFormat } from "../types.ts";

/**
 * Image processing on `Bun.Image` — no native modules, no `sharp`, nothing to
 * install. JPEG, PNG and WebP are statically linked into Bun itself.
 *
 * ## How cropping works
 *
 * `Bun.Image.resize()` takes only `fit: "fill" | "inside"` and the class exposes
 * no crop, extract or composite primitive, so `fit: "cover"` is not expressible
 * through its API alone. It is instead assembled here: scale so the image
 * overflows the target box in at most one axis, then take the centre window out
 * of the result through a lossless PNG round-trip (see `raster.ts`). Scaling
 * stays native; only the window copy is ours, and it runs on the already-scaled
 * image rather than the original.
 *
 * The upshot is that this driver crops, and `sharp` is no longer required for a
 * cover-fit thumbnail. `SharpImageDriver` remains worth choosing for throughput
 * on large batches and for formats Bun's `system` backend lacks.
 *
 * ## Host-dependent formats
 *
 * `Bun.Image.backend` is `"system"` by default, so AVIF and HEIC encode through
 * OS codecs that are absent on most Linux hosts. {@link canEncode} probes for
 * real rather than assuming, and `MediaProvider` runs that probe once at boot.
 */
export class BunImageDriver implements ImageDriver {
  readonly name = "BunImageDriver";
  readonly supportsCrop = true;

  /** Memoised results of {@link canEncode}, which costs a real encode. */
  readonly #encodable = new Map<ConversionFormat, boolean>();

  constructor(
    /**
     * Cap on input pixels, guarding against decompression bombs: a few-KB file
     * declaring a 50000×50000 canvas would otherwise allocate gigabytes. Checked
     * against the header before any pixel buffer is allocated.
     */
    private readonly maxPixels: number = 0x3fff * 0x3fff,
    /**
     * Cap on the intermediate buffer the crop path decodes, in pixels.
     *
     * Separate from {@link maxPixels}, and much lower, because this one bounds an
     * allocation *we* make rather than one Bun makes: the intermediate is
     * uncompressed RGBA, so the default 40 MP is already ~160 MB. Conversions
     * are thumbnail-sized in practice, so this only ever catches a conversion
     * defined with implausible dimensions.
     */
    private readonly maxCropPixels: number = 40_000_000,
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
    const { format, quality, rotate } = manipulation;

    // Rotation changes which dimension is which, so the geometry has to be
    // computed against the post-rotation shape. Rotating first — into a PNG, so
    // nothing is lost — lets the dimensions simply be read back, rather than
    // re-deriving Bun's canvas expansion for non-right angles.
    const rotated = rotate !== undefined && rotate !== 0;
    let source = bytes;
    let sourceWidth: number;
    let sourceHeight: number;

    if (rotated) {
      source = await new Bun.Image(bytes, { maxPixels: this.maxPixels })
        .rotate(rotate)
        .png()
        .bytes();
      const header = readPngHeader(source);
      if (header === null) throw new RasterFormatError("Bun.Image.rotate() did not return a PNG");
      sourceWidth = header.width;
      sourceHeight = header.height;
    } else {
      const meta = await this.metadata(bytes);
      if (meta === null) throw new RasterFormatError("the source image could not be read");
      sourceWidth = meta.width;
      sourceHeight = meta.height;
    }

    const geometry = resolveGeometry({
      sourceWidth,
      sourceHeight,
      targetWidth: manipulation.width,
      targetHeight: manipulation.height,
      fit: manipulation.fit ?? "inside",
      // Upscaling a 200px source to fill a 1920px slot produces a blurry file
      // larger than the original. Never worth it by default.
      withoutEnlargement: manipulation.withoutEnlargement ?? true,
    });

    const needsCrop =
      geometry.cropWidth !== undefined &&
      geometry.cropHeight !== undefined &&
      (geometry.cropWidth !== geometry.resizeWidth ||
        geometry.cropHeight !== geometry.resizeHeight);

    // Without a crop the whole thing stays inside Bun: one pipeline, no
    // round-trip. This is the overwhelmingly common path.
    if (!needsCrop) {
      let pipeline = new Bun.Image(source, { maxPixels: this.maxPixels });
      if (!geometry.resizeIsNoop) {
        pipeline = pipeline.resize(geometry.resizeWidth, geometry.resizeHeight, {
          // Exact dimensions are already resolved, so `fill` is what we want:
          // it asks Bun for precisely these numbers instead of letting it
          // re-derive (and re-round) them from the caller's box.
          fit: "fill",
          withoutEnlargement: false,
        });
      }
      pipeline = _applyFormat(pipeline, format, quality);

      return {
        bytes: await this.#encode(pipeline, format),
        width: geometry.resizeWidth,
        height: geometry.resizeHeight,
        format,
        mimeType: FORMAT_MIME[format],
      };
    }

    return await this.#convertCropped(source, geometry, rotated, format, quality);
  }

  /**
   * The `fit: "cover"` path: scale so the image overflows the box in at most one
   * axis, then keep the centre.
   *
   * `Bun.Image` has no crop primitive, so the centre window is taken here —
   * through a lossless PNG round-trip, on the already-scaled image. The scaling
   * itself never leaves Bun.
   */
  async #convertCropped(
    source: Uint8Array,
    geometry: ResolvedGeometry,
    sourceIsPng: boolean,
    format: ConversionFormat,
    quality: number | undefined,
  ): Promise<ImageResult> {
    // A no-op resize on a source that is already PNG has nothing to do.
    const scaled =
      geometry.resizeIsNoop && sourceIsPng
        ? source
        : await this.#toPng(source, geometry.resizeIsNoop ? null : geometry);

    const cropped = cropCentre(
      decodePng(scaled, this.maxCropPixels),
      geometry.cropWidth!,
      geometry.cropHeight!,
    );

    const pipeline = _applyFormat(
      new Bun.Image(encodePng(cropped), { maxPixels: this.maxPixels }),
      format,
      quality,
    );

    return {
      bytes: await this.#encode(pipeline, format),
      // Known exactly from the crop — no need to ask the pipeline.
      width: cropped.width,
      height: cropped.height,
      format,
      mimeType: FORMAT_MIME[format],
    };
  }

  /** Re-encode as PNG, optionally resizing on the way through. */
  async #toPng(bytes: Uint8Array, geometry: ResolvedGeometry | null): Promise<Uint8Array> {
    const image = new Bun.Image(bytes, { maxPixels: this.maxPixels });
    const pipeline =
      geometry === null
        ? image
        : image.resize(geometry.resizeWidth, geometry.resizeHeight, {
            // Safe despite the name: both dimensions were scaled by one factor,
            // so this fills a box that already has the source's aspect ratio.
            fit: "fill",
            withoutEnlargement: false,
          });
    return await pipeline.png().bytes();
  }

  /** Await a pipeline, translating a missing codec into a named error. */
  async #encode(pipeline: Bun.Image, format: ConversionFormat): Promise<Uint8Array> {
    try {
      return await pipeline.bytes();
    } catch (error) {
      if (_codeOf(error) === "ERR_IMAGE_FORMAT_UNSUPPORTED") {
        throw new UnsupportedFormatError(format, await this.encodableFormats());
      }
      throw error;
    }
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
