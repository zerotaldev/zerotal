import { UploadedFile } from "@zerotal/core/http";
import { MediaError } from "./errors.ts";
import { diskFor } from "./support/disks.ts";

/** A file's bytes plus the name it arrived under. */
export interface ResolvedSource {
  bytes: Uint8Array;
  /** Original filename, used to derive the default media name. */
  originalName: string;
}

/** Anything that can be resolved to bytes on demand. */
export type SourceResolver = () => Promise<ResolvedSource>;

/** Things `addMedia()` accepts directly. */
export type MediaSource = UploadedFile | File | Blob | Uint8Array | ArrayBuffer;

/**
 * Turn an in-memory source into a lazy resolver.
 *
 * Resolution is deferred so a rule that can reject on metadata alone — a
 * collection that accepts only PDFs, say — does not have to buffer the file
 * first.
 */
export function fromValue(source: MediaSource, fileName?: string): SourceResolver {
  if (source instanceof UploadedFile) {
    return async () => ({
      bytes: await source.bytes(),
      originalName: fileName ?? source.originalName,
    });
  }

  if (source instanceof File) {
    return async () => ({
      bytes: new Uint8Array(await source.arrayBuffer()),
      originalName: fileName ?? source.name,
    });
  }

  if (source instanceof Blob) {
    return async () => ({
      bytes: new Uint8Array(await source.arrayBuffer()),
      originalName: fileName ?? "file",
    });
  }

  if (source instanceof ArrayBuffer) {
    return async () => ({ bytes: new Uint8Array(source), originalName: fileName ?? "file" });
  }

  if (source instanceof Uint8Array) {
    return async () => ({ bytes: source, originalName: fileName ?? "file" });
  }

  throw new MediaError(
    "addMedia() takes an UploadedFile, File, Blob, Uint8Array or ArrayBuffer. " +
      "For a URL use addMediaFromUrl(), for a stored file addMediaFromDisk(), " +
      "for a local path addMediaFromPath().",
  );
}

/**
 * Fetch a remote file.
 *
 * @param maxBytes - Refuse a response larger than this. A URL is attacker-supplied
 *   often enough that downloading whatever arrives is how one request exhausts the
 *   heap; the limit is checked against `Content-Length` first and again against
 *   what actually arrived, since the header is a claim.
 */
export function fromUrl(url: string, maxBytes: number): SourceResolver {
  return async () => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new MediaError(`addMediaFromUrl() needs an absolute URL; got "${url}".`);
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new MediaError(
        `addMediaFromUrl() supports http and https; got "${parsed.protocol}".\n` +
          "Fix: use addMediaFromPath() for a local file, addMediaFromDisk() for a stored one.",
      );
    }

    const response = await fetch(parsed);
    if (!response.ok) {
      throw new MediaError(`Could not fetch ${url} — the server answered ${response.status}.`);
    }

    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      throw new MediaError(
        `${url} declares ${declared} bytes, over the ${maxBytes}-byte limit. ` +
          "Fix: raise media.maxConversionInputSize, or fetch and store it yourself.",
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new MediaError(
        `${url} returned ${bytes.byteLength} bytes, over the ${maxBytes}-byte limit.`,
      );
    }

    return { bytes, originalName: _nameFromUrl(parsed) };
  };
}

/** Read a file already sitting on one of the app's storage disks. */
export function fromDisk(path: string, disk?: string): SourceResolver {
  return async () => {
    const bytes = await diskFor(disk).getBuffer(path);
    if (bytes === null) {
      throw new MediaError(`No file at "${path}" on disk "${disk ?? "default"}".`);
    }
    return { bytes, originalName: path.split("/").pop() ?? "file" };
  };
}

/** Read a file from the local filesystem. */
export function fromPath(path: string): SourceResolver {
  return async () => {
    const file = Bun.file(path);
    if (!(await file.exists())) throw new MediaError(`No file at "${path}".`);
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      originalName: path.split(/[/\\]/).pop() ?? "file",
    };
  };
}

/** The filename a URL implies, ignoring query and fragment. */
function _nameFromUrl(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).pop();
  return last !== undefined && last !== "" ? decodeURIComponent(last) : "file";
}
