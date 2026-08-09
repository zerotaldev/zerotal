import { ZerotalError } from "@zerotal/core";

/** Base class for every error this package throws. */
export class MediaError extends ZerotalError {
  constructor(message: string, code = "E_MEDIA", status = 500, context?: Record<string, unknown>) {
    super(message, code, status, context);
  }
}

/** A collection was referenced that the model never declared. */
export class UnknownCollectionError extends MediaError {
  constructor(model: string, collection: string, known: string[]) {
    const list = known.length > 0 ? known.map((c) => `"${c}"`).join(", ") : "none declared";
    super(
      `[Zerotal Media] ${model} has no media collection "${collection}". Declared: ${list}.\n` +
        `Fix: add it to the static mediaCollections field on ${model}.`,
      "E_MEDIA_UNKNOWN_COLLECTION",
      500,
      { model, collection, known },
    );
  }
}

/**
 * The file's sniffed type is not in the collection's `accepts` list.
 *
 * A 422 rather than a 500: the upload was understood and refused, which is the
 * client's problem to fix.
 */
export class DisallowedMimeTypeError extends MediaError {
  constructor(collection: string, actual: string, allowed: string[]) {
    super(
      `[Zerotal Media] Collection "${collection}" does not accept ${actual}. ` +
        `Allowed: ${allowed.join(", ")}.\n` +
        "Note: the type is read from the file's own bytes, not from the upload's " +
        "Content-Type header, so a renamed file is still rejected.",
      "E_MEDIA_DISALLOWED_MIME_TYPE",
      422,
      { collection, actual, allowed },
    );
  }
}

/** The file is larger than the collection's `maxSize`. */
export class FileTooLargeError extends MediaError {
  constructor(collection: string, actual: number, max: number) {
    super(
      `[Zerotal Media] File is ${actual} bytes; collection "${collection}" allows at most ${max}.\n` +
        "Fix: raise maxSize on the collection, or compress before uploading.",
      "E_MEDIA_FILE_TOO_LARGE",
      413,
      { collection, actual, max },
    );
  }
}

/**
 * A conversion asked for something the active image driver cannot do.
 *
 * Overwhelmingly this is `fit: "cover"` on the default `BunImageDriver`:
 * `Bun.Image.resize()` accepts only `fit: 'fill' | 'inside'` and the class
 * exposes no crop primitive, so a centre-cropped thumbnail is not expressible.
 */
export class UnsupportedManipulationError extends MediaError {
  constructor(driver: string, what: string, fix: string) {
    super(
      `[Zerotal Media] ${driver} cannot ${what}.\nFix: ${fix}`,
      "E_MEDIA_UNSUPPORTED_MANIPULATION",
      500,
      { driver },
    );
  }
}

/** The requested output format is not encodable on this host. */
export class UnsupportedFormatError extends MediaError {
  constructor(format: string, available: string[]) {
    super(
      `[Zerotal Media] This host cannot encode ${format}. Available: ${available.join(", ")}.\n` +
        "Bun.Image encodes AVIF/HEIC/TIFF through OS codecs, which are absent here. " +
        "Fix: use jpeg, png, or webp — or run on a host with the codec installed.",
      "E_MEDIA_UNSUPPORTED_FORMAT",
      500,
      { format, available },
    );
  }
}

/** A file could not be read back from the disk it was recorded on. */
export class MediaFileMissingError extends MediaError {
  constructor(path: string, disk: string) {
    super(
      `[Zerotal Media] No file at "${path}" on disk "${disk}", but a media row points at it.\n` +
        "Fix: run `bun zt media:clean` to reconcile rows against disks.",
      "E_MEDIA_FILE_MISSING",
      404,
      { path, disk },
    );
  }
}

/** Media was added to a model that has not been saved yet. */
export class UnsavedOwnerError extends MediaError {
  constructor(model: string) {
    super(
      `[Zerotal Media] Cannot attach media to an unsaved ${model} — it has no id yet ` +
        "to record in model_id.\n" +
        `Fix: await ${model.toLowerCase()}.save() (or use .create()) before adding media.`,
      "E_MEDIA_UNSAVED_OWNER",
      500,
      { model },
    );
  }
}
