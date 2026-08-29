import { sniffContentType, type SniffedType } from "./sniffContentType.ts";
import type { StorageDriver } from "../storage/types.ts";

/**
 * The part of a storage disk `UploadedFile.store()` needs: somewhere to put
 * bytes, and a URL for what was put.
 *
 * Narrower than {@link StorageDriver} on purpose — `store()` has no business
 * with `delete` or `temporaryUrl` — but it is now a view of the real contract
 * rather than a look-alike, so the two cannot drift.
 */
export type StorageDisk = Pick<StorageDriver, "url"> & {
  put(path: string, content: Uint8Array, options?: { contentType?: string }): Promise<void>;
};

/**
 * Rules for {@link UploadedFile.isValid}. Omit a field to skip that check; an
 * empty options object only verifies that a non-empty file was received.
 */
export interface FileValidationOptions {
  /** Maximum allowed size in bytes. */
  maxSize?: number | undefined;
  /** Allowed MIME types — e.g. `['image/jpeg', 'image/png', 'application/pdf']`. */
  mimes?: string[] | undefined;
}

/**
 * Wraps a browser `File` from a multipart form upload and adds Zerotal-native
 * validation and one-line storage.
 *
 * Instances are created by `HttpContext.file()` / `HttpContext.files()`.
 *
 * @example
 * async updateAvatar(ctx: HttpContext): HttpResponse {
 *   const avatar = await ctx.file('avatar');
 *
 *   if (!avatar?.isValid({ maxSize: 2 * 1024 * 1024, mimes: ['image/jpeg', 'image/png'] })) {
 *     return redirect().back().withErrors({ avatar: 'Must be a JPEG or PNG under 2 MB.' });
 *   }
 *
 *   const path = await avatar.store('avatars', Storage.disk());
 *   await ctx.user!.update({ avatarPath: path });
 *   return redirect('/profile').withSuccess('Avatar updated!');
 * }
 */
export class UploadedFile {
  readonly #file: File;

  constructor(file: File) {
    this.#file = file;
  }

  /** Original filename as sent by the browser (may be untrusted — sanitise before display). */
  get originalName(): string {
    return this.#file.name;
  }

  /** MIME type as reported by the browser (e.g. `'image/jpeg'`). */
  get mimeType(): string {
    return this.#file.type;
  }

  /** File size in bytes. */
  get size(): number {
    return this.#file.size;
  }

  /**
   * Lowercase extension derived from the original filename, without the dot, stripped to
   * `[a-z0-9]`.
   *
   * The filename is client-supplied, so anything outside that set — a null byte, a slash,
   * a `%00` — is a smuggling attempt rather than an extension. This is what the *client
   * called* the file; {@link store} does not trust it when naming what it writes.
   */
  extension(): string {
    const parts = this.#file.name.split(".");
    if (parts.length < 2) return "";
    return parts[parts.length - 1]!.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  /**
   * Returns `true` when the file satisfies all given rules.
   * Pass no options to simply confirm a file was received.
   *
   * @example
   * avatar.isValid({ maxSize: 5 * 1024 * 1024, mimes: ['image/jpeg', 'image/png'] })
   */
  isValid(options: FileValidationOptions = {}): boolean {
    if (this.#file.size === 0) return false;
    if (options.maxSize !== undefined && this.#file.size > options.maxSize) return false;
    if (options.mimes && options.mimes.length > 0) {
      if (!options.mimes.includes(this.#file.type)) return false;
    }
    return true;
  }

  /** Read the file as raw bytes. */
  async bytes(): Promise<Uint8Array> {
    return new Uint8Array(await this.#file.arrayBuffer());
  }

  /** Read the file as a UTF-8 string. */
  async text(): Promise<string> {
    return this.#file.text();
  }

  /**
   * Write the file to a disk and return the stored path.
   *
   * The filename defaults to `<uuid>.<ext>` — predictable, safe, and collision-free.
   * Pass `filename` to override it.
   *
   * **Both the extension and the stored `Content-Type` come from the file's own bytes,
   * not from the client.** The multipart part's `Content-Type` and the filename's suffix
   * are claims the uploader controls: `avatar` sent as `x.html` with `text/html` would
   * otherwise be written as `avatars/<uuid>.html` and served as HTML, which is stored XSS
   * on whatever origin serves the disk. Bytes that match no known format are stored as
   * `application/octet-stream` with a `.bin` extension, which downloads rather than
   * executes. See {@link sniffContentType}.
   *
   * An explicit `filename` is taken at face value — you chose it, so it is yours to get
   * right — but the sniffed content type still applies.
   *
   * @param directory  Target directory, e.g. `'avatars'` or `'uploads/docs'`
   * @param disk       Any `StorageDisk` — typically `Storage.disk()` or `Storage.disk('s3')`
   * @param filename   Optional override; defaults to `<uuid>.<sniffed-ext>`
   * @returns          The stored path, e.g. `'avatars/f47ac10b.jpg'`
   *
   * @example
   * const path = await avatar.store('avatars', Storage.disk());
   * const path = await avatar.store('docs', Storage.disk('s3'), 'terms-v2.pdf');
   */
  async store(directory: string, disk: StorageDisk, filename?: string): Promise<string> {
    const bytes = await this.bytes();
    const sniffed = sniffContentType(bytes);
    const name = filename ?? `${crypto.randomUUID()}.${sniffed.extension}`;
    const path = `${directory.replace(/\/+$/, "")}/${name}`;

    await disk.put(path, bytes, { contentType: sniffed.contentType });

    return path;
  }

  /**
   * What the file's own bytes say it is, ignoring both client-supplied claims.
   *
   * Use it to reject an upload whose contents disagree with its declared type — a `.jpg`
   * whose bytes are a ZIP, say — before storing it.
   *
   * @returns The detected content type, canonical extension, and whether detection succeeded.
   * @example
   * const { contentType, recognised } = await avatar.detectType();
   * if (!recognised || !contentType.startsWith('image/')) return badRequest('Not an image.');
   */
  async detectType(): Promise<SniffedType> {
    return sniffContentType(await this.bytes());
  }

  /**
   * Store the file and immediately return its public URL.
   *
   * @example
   * const url = await avatar.storeAndGetUrl('avatars', Storage.disk('s3'));
   * await user.update({ avatarUrl: url });
   */
  async storeAndGetUrl(directory: string, disk: StorageDisk, filename?: string): Promise<string> {
    return disk.url(await this.store(directory, disk, filename));
  }

  /**
   * Build an `UploadedFile` from scratch, for unit-testing the code that
   * receives one without going through a multipart request.
   *
   * The contents are arbitrary bytes, so the type this reports is the type you
   * declare — which is the point for a size or extension check, but means
   * {@link detectType} and {@link store} will see unrecognised bytes and fall
   * back to `application/octet-stream`. When the test turns on what the bytes
   * actually are, build a real one with `fakeFile` from `@zerotal/testing` and
   * pass it here.
   *
   * @param name - Filename the "client" sent.
   * @param options.type - MIME type to report from {@link mimeType}.
   * @param options.size - Size in bytes; the file is padded to it.
   * @param options.content - Exact contents, overriding `size`.
   *
   * @example
   * const file = UploadedFile.fake('avatar.png', { type: 'image/png', size: 1024 });
   * expect(file.isValid({ maxSize: 2048, mimes: ['image/png'] })).toBe(true);
   */
  static fake(
    name = "file.txt",
    options: {
      type?: string;
      size?: number;
      content?: string | Uint8Array<ArrayBuffer> | File;
    } = {},
  ): UploadedFile {
    const { type = "application/octet-stream", size = 1024, content } = options;
    if (content instanceof File) return new UploadedFile(content);
    const parts: BlobPart[] = content === undefined ? [new Uint8Array(size)] : [content];
    return new UploadedFile(new File(parts, name, { type }));
  }
}
