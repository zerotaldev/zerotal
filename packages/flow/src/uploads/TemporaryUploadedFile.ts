import { currentUserId } from "@zerotal/core/auth";
import { sign, verify } from "./sign.ts";

/**
 * How long an upload reference stays good: as long as the temporary file it names is kept (the
 * upload endpoint deletes abandoned temp files after the same six hours).
 */
export const UPLOAD_REF_MAX_AGE_SECONDS = 6 * 60 * 60;

/**
 * The plain metadata describing a pending upload on the temp disk — the fields
 * that travel in an {@link UploadRef} and round-trip through the snapshot.
 *
 * @remarks
 * Every field here is included in the signed payload because each one steers later
 * I/O: `tmpPath`/`size`/`mime` identify the bytes, `originalName` derives the
 * stored file's extension, and `tempDisk` selects the disk reads/writes resolve
 * against.
 */
export interface TufData {
  /** Path of the uploaded bytes on the temp disk. */
  tmpPath: string;
  /** The client-supplied original filename (used to derive the stored extension). */
  originalName: string;
  /** The upload's MIME type. */
  mime: string;
  /** Size of the upload in bytes. */
  size: number;
  /** Name of the temp disk the bytes live on (default disk when omitted). */
  tempDisk?: string | undefined;
}

/**
 * What the `/__flow/upload` endpoint returns and the client `$set`s onto a
 * component property — {@link TufData} plus a self-describing marker and its own
 * HMAC signature.
 *
 * @remarks
 * The signature lets the server trust a client-supplied ref: on `$set` it is
 * verified (see {@link TemporaryUploadedFile.fromSignedRef}) before wrapping into
 * a {@link TemporaryUploadedFile}. A forged or altered ref fails verification and
 * is discarded, and so is one issued to another user or one past its expiry.
 */
export interface UploadRef extends TufData {
  /** Discriminator marking this object as a flow upload reference. */
  __flow_upload: true;
  /** The id of the user who uploaded the file. Signed: another user's `$set` is refused. */
  sub: string;
  /** When the reference stops being accepted, in seconds since the epoch. Signed. */
  exp: number;
  /** HMAC signature over the signed payload of {@link TufData} fields, `sub` and `exp`. */
  sig: string;
}

function payload(d: TufData & { sub: string; exp: number }): string {
  // Every field that steers later I/O MUST be signed:
  //  - originalName → store() derives the permanent file's extension from it, so
  //    an unsigned name lets a client swap a validated .png ref for an .html/.svg
  //    one (stored-XSS / content-type confusion on a public disk).
  //  - tempDisk → bytes()/store()/temporaryUrl() resolve against it, so an
  //    unsigned value lets a client redirect reads/writes to a different disk.
  //  - sub / exp → a reference is the uploader's, and only until its file is swept.
  // JSON, not a joined string: the browser chooses `originalName`, and a separator inside it
  // could otherwise shift the fields after it.
  return JSON.stringify([
    "flow-upload:2",
    d.tmpPath,
    d.size,
    d.mime,
    d.originalName,
    d.tempDisk ?? "",
    d.sub,
    d.exp,
  ]);
}

/**
 * Build a signed reference (server side, in the upload endpoint), issued to the signed-in user
 * and good for {@link UPLOAD_REF_MAX_AGE_SECONDS}.
 *
 * @param d - The upload's metadata.
 * @param opts - The user to issue it to and its lifetime; the current user and the default.
 * @throws When there is no user to issue it to.
 */
export function makeSignedRef(
  d: TufData,
  opts: { sub?: string | undefined; ttlSeconds?: number | undefined } = {},
): UploadRef {
  const sub = opts.sub ?? currentUserId();
  if (sub === undefined) throw new Error("[Flow] An upload reference needs a signed-in user.");
  const exp = Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? UPLOAD_REF_MAX_AGE_SECONDS);
  const signed = { ...d, sub, exp };
  return { __flow_upload: true, ...signed, sig: sign(payload(signed)) };
}

export function isUploadRef(v: unknown): v is UploadRef {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<string, unknown>)["__flow_upload"] === true &&
    typeof (v as Record<string, unknown>)["sig"] === "string" &&
    typeof (v as Record<string, unknown>)["tmpPath"] === "string"
    // `sub` and `exp` are checked by fromSignedRef: a ref without them is still a ref, and
    // is refused there rather than passed through as a plain object.
  );
}

type Disk = {
  getBuffer(path: string): Promise<Uint8Array>;
  put(path: string, data: Uint8Array, opts?: { contentType?: string }): Promise<void>;
  delete(path: string): Promise<void>;
  url(path: string): string;
  temporaryUrl?(path: string, ttlSeconds: number): string;
};

async function disk(name?: string): Promise<Disk> {
  const { Storage } = (await import("@zerotal/core/storage")) as unknown as {
    Storage: { disk(n?: string): Disk };
  };
  return Storage.disk(name);
}

/**
 * A temporary uploaded file — the server-side handle a component
 * receives for a pending upload before it's promoted to permanent storage.
 *
 * @remarks
 * Uploads bypass the WebSocket: the browser POSTs the bytes to `/__flow/upload`
 * over HTTP, the endpoint stores them on a temp disk and returns a signed
 * {@link UploadRef}, and the client `$set`s that ref onto a component property.
 * The base Component verifies the signature and wraps it into a
 * `TemporaryUploadedFile` (see {@link resolveUploadValue}). Component code then
 * inspects it ({@link isImage}, {@link extension}, {@link temporaryUrl}) and calls
 * {@link store} in an action to move it to permanent storage. The value
 * round-trips through the HMAC-signed snapshot via its synth, so it survives
 * across requests until stored.
 *
 * @example
 * ```tsx
 * class Avatar extends Component.using(FileUploads) {
 *   @expose photo: TemporaryUploadedFile | null = null;
 *   @expose path = "";
 *
 *   @expose async save() {
 *     if (this.photo?.isImage()) {
 *       this.path = await this.photo.store("avatars"); // -> "avatars/<uuid>.png"
 *       this.photo = null;
 *     }
 *   }
 * }
 * ```
 */
export class TemporaryUploadedFile {
  /**
   * Path of the uploaded bytes on the temp disk.
   * @category Metadata
   */
  readonly tmpPath: string;
  /**
   * The client-supplied original filename.
   * @category Metadata
   */
  readonly originalName: string;
  /**
   * The upload's MIME type.
   * @category Metadata
   */
  readonly mime: string;
  /**
   * Size of the upload in bytes.
   * @category Metadata
   */
  readonly size: number;
  /**
   * Name of the temp disk the bytes live on (default disk when undefined).
   * @category Metadata
   */
  readonly tempDisk?: string | undefined;

  constructor(d: TufData) {
    this.tmpPath = d.tmpPath;
    this.originalName = d.originalName;
    this.mime = d.mime;
    this.size = d.size;
    this.tempDisk = d.tempDisk;
  }

  /**
   * The original filename (alias of {@link originalName}).
   * @category Metadata
   */
  get name(): string {
    return this.originalName;
  }
  /**
   * Whether the upload's MIME type is an image (`image/*`).
   * @category Metadata
   */
  isImage(): boolean {
    return this.mime.startsWith("image/");
  }
  /**
   * The lowercased file extension derived from the original name, sanitized to
   * `[a-z0-9]` only (so a crafted name can't smuggle path/control characters into
   * the stored filename). Empty string when the name has no extension.
   * @returns The sanitized extension without the leading dot.
   * @category Metadata
   */
  extension(): string {
    const parts = this.originalName.split(".");
    if (parts.length < 2) return "";
    // Strip anything but [a-z0-9] so a crafted name (e.g. "x.php%00", "x./..")
    // cannot smuggle path or control characters into the stored filename.
    return parts
      .pop()!
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }
  /**
   * Extract the plain {@link TufData} for serialization (used by the snapshot synth).
   * @returns The upload's metadata without any signature.
   * @category Storage
   */
  toRef(): TufData {
    return {
      tmpPath: this.tmpPath,
      originalName: this.originalName,
      mime: this.mime,
      size: this.size,
      tempDisk: this.tempDisk,
    };
  }

  /**
   * Verify a client-supplied signed ref and wrap it. Returns null when the
   * signature is invalid (a forged or tampered ref), when the ref was issued to a
   * different user than the one signed in now, or when it has expired, so callers
   * discard it rather than trusting attacker-controlled paths.
   * @param ref - The signed reference the client `$set`.
   * @param sub - The user expected to own it; the signed-in user by default.
   * @returns A verified file, or `null` if any check fails.
   * @category Storage
   */
  static fromSignedRef(
    ref: UploadRef,
    sub: string | undefined = currentUserId(),
  ): TemporaryUploadedFile | null {
    if (typeof ref.sub !== "string" || typeof ref.exp !== "number") return null;
    if (!verify(payload(ref), ref.sig)) return null;
    if (sub === undefined || ref.sub !== sub) return null;
    if (ref.exp < Math.floor(Date.now() / 1000)) return null;
    return new TemporaryUploadedFile(ref);
  }
  /**
   * Rebuild from snapshot data that is already HMAC-trusted (the whole snapshot is
   * signed), so no per-ref signature check is needed. Used by the snapshot synth.
   * @param data - Trusted upload metadata from the snapshot.
   * @category Storage
   */
  static fromTrustedRef(data: TufData): TemporaryUploadedFile {
    return new TemporaryUploadedFile(data);
  }

  /**
   * Read the temp file's raw bytes from its disk.
   * @returns The upload's contents.
   * @category Storage
   */
  async bytes(): Promise<Uint8Array> {
    return (await disk(this.tempDisk)).getBuffer(this.tmpPath);
  }

  /**
   * Move the temp file to permanent storage and delete the temp copy.
   *
   * @param directory - Destination directory on the target disk (trailing slashes trimmed).
   * @param diskName - Target storage disk; the default disk when omitted.
   * @param filename - Explicit filename; when omitted, a random UUID plus the
   *   sanitized {@link extension} is used.
   * @returns The stored path (`directory/filename`).
   * @category Storage
   */
  async store(directory: string, diskName?: string, filename?: string): Promise<string> {
    const ext = this.extension();
    const name = filename ?? `${crypto.randomUUID()}${ext ? "." + ext : ""}`;
    const dest = `${directory.replace(/\/+$/, "")}/${name}`;
    const temp = await disk(this.tempDisk);
    const target = await disk(diskName);
    const bytes = await temp.getBuffer(this.tmpPath);
    await target.put(dest, bytes, { contentType: this.mime });
    await temp.delete(this.tmpPath).catch(() => {});
    return dest;
  }

  /**
   * A URL for previewing the still-temporary file — signed and expiring on disks
   * that support it, falling back to a plain URL otherwise.
   * @param ttlSeconds - Lifetime of the temporary URL in seconds (default `300`).
   * @returns A URL to the temp file.
   * @category Storage
   */
  async temporaryUrl(ttlSeconds = 300): Promise<string> {
    const d = await disk(this.tempDisk);
    return d.temporaryUrl ? d.temporaryUrl(this.tmpPath, ttlSeconds) : d.url(this.tmpPath);
  }
}

/**
 * Used by Component.$set: convert client-supplied upload refs (single or array) into
 * `TemporaryUploadedFile` instances, verifying signatures, owner and expiry. Non-upload values
 * pass through. A forged, foreign or expired ref resolves to null (clearing the property) rather
 * than trusting it.
 */
export function resolveUploadValue(value: unknown): unknown {
  if (isUploadRef(value)) return TemporaryUploadedFile.fromSignedRef(value);
  if (Array.isArray(value) && value.some(isUploadRef)) {
    return value
      .map((v) => (isUploadRef(v) ? TemporaryUploadedFile.fromSignedRef(v) : v))
      .filter((v) => v !== null);
  }
  return value;
}
