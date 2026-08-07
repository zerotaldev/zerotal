export interface PutOptions {
  contentType?: string;
  visibility?: "public" | "private";
}

export interface StorageDriver {
  put(path: string, content: string | Uint8Array | Blob, options?: PutOptions): Promise<void>;
  get(path: string): Promise<string | null>;
  getBuffer(path: string): Promise<Uint8Array | null>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  /** Return a public URL for the given path. */
  url(path: string): string;

  /** Copy a file within the same disk. */
  copy(source: string, destination: string): Promise<void>;
  /** Move (rename) a file within the same disk. */
  move(source: string, destination: string): Promise<void>;
  /** Return the file size in bytes, or null if not found. */
  size(path: string): Promise<number | null>;
  /** Return the last-modified timestamp (ms since epoch), or null if not found. */
  lastModified(path: string): Promise<number | null>;
  /**
   * Return a temporary URL valid for `expiresInSeconds` seconds.
   * For local driver this is a signed token URL; for S3 it is a presigned URL.
   */
  temporaryUrl(path: string, expiresInSeconds: number): Promise<string>;
  /**
   * Append to the end of a file, creating it when absent.
   *
   * Only a filesystem can do this. An object store rewrites the whole object on
   * every write, so emulating an append there would quietly turn one line of a
   * log into a full download-and-upload of the day's file — {@link S3Driver}
   * throws {@link UnsupportedOperationError} rather than pretend. Use it for
   * things that are genuinely local and line-oriented, like the log trail.
   */
  append(path: string, content: string | Uint8Array): Promise<void>;
  /**
   * A lazy handle for `path`, or `null` when absent.
   *
   * Optional. When a backend can hand back something streamable, serving a file
   * does not have to read it into memory first — which is the difference
   * between serving a 2 GB video and falling over. {@link StorageFilesMiddleware}
   * uses it when present and falls back to {@link getBuffer} when not.
   */
  stream?(path: string): Promise<Blob | null>;
}

/**
 * How a disk is exposed over HTTP by {@link StorageFilesMiddleware}.
 *
 * Omit it and the disk is not reachable over the network at all — which is the
 * right default for anything holding private uploads.
 */
export interface DiskServeConfig {
  /** URL prefix the disk is served under, e.g. `/storage`. */
  path: string;
  /**
   * Require a valid `?expires=&signature=` on every request, as produced by
   * `temporaryUrl()`. Use it to expose a private disk without making it public:
   * only someone holding a link you signed can read a file, and only until it
   * expires.
   */
  signed?: boolean;
  /**
   * How long a signed link stays valid, in seconds. Only meaningful with
   * `signed`. Defaults to 900 (15 minutes).
   */
  expiresIn?: number;
  /** Extra response headers, e.g. `Cache-Control`. */
  headers?: Record<string, string>;
}

export interface LocalDiskConfig {
  driver: "local";
  /** Absolute or relative root directory for file storage. */
  root: string;
  /** Optional base URL for url() — e.g. '/storage' or 'https://cdn.example.com'. */
  url?: string;
  /** Expose this disk over HTTP. Omit to keep it unreachable. */
  serve?: DiskServeConfig;
}

export interface S3DiskConfig {
  driver: "s3";
  key: string;
  secret: string;
  region: string;
  bucket: string;
  /** Override endpoint for R2, MinIO, etc. E.g. 'https://<account>.r2.cloudflarestorage.com' */
  endpoint?: string;
  /** Custom public URL base (e.g. CDN or R2 public domain). */
  url?: string;
  /** Expose this disk over HTTP, proxied through the app. Omit to keep it unreachable. */
  serve?: DiskServeConfig;
}

export type DiskConfig = LocalDiskConfig | S3DiskConfig;

export interface StorageConfigShape {
  /** Name of the default disk. */
  default: string;
  disks: Record<string, DiskConfig>;
}
