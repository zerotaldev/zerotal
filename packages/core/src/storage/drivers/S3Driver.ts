import { S3Client } from "bun";
import type { StorageDriver, PutOptions } from "../types.ts";
import { UnsupportedOperationError } from "../errors.ts";

/** Returns true when err is an S3 "object not found" error. */
function _isNotFound(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Bun throws an error named 'S3Error' with a code property for S3 failures.
  // NoSuchKey / 404 is the only case we treat as "absent" — all others propagate.
  const s3Err = err as { code?: string };
  return (
    err.name === "S3Error" &&
    (s3Err.code === "NoSuchKey" ||
      err.message.includes("does not exist") ||
      err.message.includes("NoSuchKey"))
  );
}

/**
 * S3-compatible storage driver — works with AWS S3, Cloudflare R2, MinIO, etc.
 * Powered by Bun's native `s3()` client: zero npm dependencies, automatic SigV4
 * signing, connection reuse, and built-in retry/backoff.
 *
 * @example
 * StorageConfig({
 *   disks: {
 *     r2: {
 *       driver:   's3',
 *       key:      Bun.env.R2_KEY!,
 *       secret:   Bun.env.R2_SECRET!,
 *       region:   'auto',
 *       bucket:   'my-bucket',
 *       endpoint: `https://${Bun.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
 *     },
 *   },
 * });
 */
export class S3Driver implements StorageDriver {
  private _s3: S3Client;
  private _bucket: string;
  private _region: string;
  private _endpoint: string | undefined;
  private _urlBase: string | undefined;

  constructor(
    key: string,
    secret: string,
    region: string,
    bucket: string,
    endpoint?: string,
    urlBase?: string,
  ) {
    this._bucket = bucket;
    this._region = region;
    this._endpoint = endpoint;
    this._urlBase = urlBase;
    this._s3 = new S3Client({
      accessKeyId: key,
      secretAccessKey: secret,
      region,
      bucket,
      ...(endpoint && { endpoint }),
    });
  }

  async put(
    path: string,
    content: string | Uint8Array | Blob,
    options?: PutOptions,
  ): Promise<void> {
    await this._s3.write(path, content, {
      type: options?.contentType ?? "application/octet-stream",
    });
  }

  async append(_path: string, _content: string | Uint8Array): Promise<void> {
    // An S3 object is immutable: "appending" means downloading, concatenating
    // and re-uploading the whole object. A caller appending a log line per
    // request would not survive that, so this refuses instead.
    throw new UnsupportedOperationError("append", "s3");
  }

  async get(path: string): Promise<string | null> {
    try {
      return await this._s3.file(path).text();
    } catch (err) {
      if (_isNotFound(err)) return null;
      throw err;
    }
  }

  async getBuffer(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await this._s3.file(path).arrayBuffer());
    } catch (err) {
      if (_isNotFound(err)) return null;
      throw err;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this._s3.file(path).stat();
      return true;
    } catch (err) {
      if (_isNotFound(err)) return false;
      throw err;
    }
  }

  async delete(path: string): Promise<void> {
    await this._s3.delete(path);
  }

  url(path: string): string {
    if (this._urlBase) {
      return `${this._urlBase.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
    }
    return this._publicUrl(path);
  }

  async copy(source: string, destination: string): Promise<void> {
    // Pass the S3File (a Blob) directly — Bun streams source → destination
    // without buffering the object locally.
    await this._s3.write(destination, this._s3.file(source));
  }

  async move(source: string, destination: string): Promise<void> {
    await this.copy(source, destination);
    await this.delete(source);
  }

  async size(path: string): Promise<number | null> {
    try {
      const stat = await this._s3.file(path).stat();
      return stat.size;
    } catch (err) {
      if (_isNotFound(err)) return null;
      throw err;
    }
  }

  async lastModified(path: string): Promise<number | null> {
    try {
      const stat = await this._s3.file(path).stat();
      const lm = stat.lastModified;
      return lm instanceof Date ? lm.getTime() : new Date(lm as unknown as string).getTime();
    } catch (err) {
      if (_isNotFound(err)) return null;
      throw err;
    }
  }

  async temporaryUrl(path: string, expiresInSeconds: number): Promise<string> {
    return this._s3.file(path).presign({ expiresIn: expiresInSeconds });
  }

  private _publicUrl(path: string): string {
    const cleanPath = path.replace(/^\//, "");
    if (this._endpoint) {
      const ep = this._endpoint.replace(/\/$/, "");
      if (!ep.includes(`${this._bucket}.s3.`)) {
        return `${ep}/${this._bucket}/${cleanPath}`;
      }
      return `${ep}/${cleanPath}`;
    }
    return `https://${this._bucket}.s3.${this._region}.amazonaws.com/${cleanPath}`;
  }
}
