import { ZerotalError } from "../errors/ZerotalError.ts";

/** Base class for all storage errors. */
export class StorageError extends ZerotalError {
  constructor(
    message: string,
    code = "E_STORAGE",
    status = 500,
    context?: Record<string, unknown>,
  ) {
    super(message, code, status, context);
  }
}

/** Thrown when a disk name is not present in the storage config. */
export class DiskNotConfiguredError extends StorageError {
  constructor(disk: string) {
    super(
      `[Zerotal Storage] Disk "${disk}" is not configured.`,
      "E_STORAGE_DISK_NOT_CONFIGURED",
      500,
      { disk },
    );
  }
}

/** Thrown when a requested path would escape the disk's root directory. */
export class PathTraversalError extends StorageError {
  constructor(path: string) {
    super(
      `[Zerotal Storage] Path "${path}" escapes the disk root. ` +
        `Relative segments that resolve outside the configured root are rejected.`,
      "E_STORAGE_PATH_TRAVERSAL",
      400,
      { path },
    );
  }
}

/** Thrown when a signing operation is attempted without an APP_KEY configured. */
export class StorageKeyMissingError extends StorageError {
  constructor() {
    super(
      "[Zerotal Storage] Signed URLs require APP_KEY. Generate one with `zerotal key:generate`.",
      "E_STORAGE_NO_KEY",
      500,
    );
  }
}

/**
 * Thrown when a driver is asked for something its backend cannot do.
 *
 * The contract is one API over very different backends, and a couple of
 * operations only make sense on some of them — appending to an object in S3
 * means rewriting the whole object. Refusing loudly beats emulating badly.
 */
export class UnsupportedOperationError extends StorageError {
  constructor(operation: string, driver: string) {
    super(
      `[Zerotal Storage] The ${driver} driver does not support ${operation}().`,
      "E_STORAGE_UNSUPPORTED",
      500,
      { operation, driver },
    );
  }
}

/**
 * Thrown when a local disk is rooted outside the storage root.
 *
 * The per-disk traversal guard stops a *path* escaping its disk; this stops the
 * *disk* being pointed somewhere it has no business reading or writing. A
 * misconfigured root is not a runtime edge case to degrade around — it is a
 * config bug, and it fails at construction so it surfaces on boot rather than
 * on the first upload.
 */
export class StorageRootEscapeError extends StorageError {
  constructor(path: string, root: string, what: string) {
    super(
      `[Zerotal Storage] The ${what} root "${path}" is outside the storage root "${root}".\n` +
        `Every local disk must live inside the storage root. Move it under that ` +
        `directory, or set ZT_STORAGE_ROOT if your data volume is mounted elsewhere.`,
      "E_STORAGE_ROOT_ESCAPE",
      500,
      { path, root },
    );
  }
}

/**
 * Thrown when a public URL is asked for a disk that has none.
 *
 * A disk with no `serve` block and no `url` base is not reachable over HTTP.
 * Handing back a path anyway produces the worst kind of failure — a link that
 * looks right, resolves relative to whatever page embedded it, and 404s
 * somewhere unrelated to the disk.
 */
export class DiskNotServedError extends StorageError {
  constructor(disk: string) {
    super(
      `[Zerotal Storage] The "${disk}" disk has no public URL.\n` +
        `Add a \`serve\` block to expose it (\`serve: { path: "/files" }\`, or ` +
        `\`{ path: "/files", signed: true }\` for signed links), or set \`url\` to ` +
        `point at a CDN. Use Storage.isServed("${disk}") to branch instead of catching.`,
      "E_STORAGE_DISK_NOT_SERVED",
      500,
      { disk },
    );
  }
}

/**
 * Thrown when a disk outside the public directory is served without signing.
 *
 * Everything under the storage root is private except `storage/public`. A disk
 * rooted elsewhere can still be exposed — but only behind `signed: true`, where
 * each request carries a signature you issued. Serving it openly would make
 * private files world-readable through a URL prefix, which is the mistake this
 * refuses to let a config express.
 */
export class UnsafePublicMountError extends StorageError {
  constructor(disk: string, root: string, publicRoot: string) {
    super(
      `[Zerotal Storage] The "${disk}" disk is served without \`signed\`, but its root ` +
        `"${root}" is outside the public directory "${publicRoot}".\n` +
        `Everything under the storage root is private except that directory. Either ` +
        `move the disk inside it, or serve it with \`signed: true\` so each request ` +
        `has to carry a signature you issued.`,
      "E_STORAGE_UNSAFE_PUBLIC_MOUNT",
      500,
      { disk, root, publicRoot },
    );
  }
}
