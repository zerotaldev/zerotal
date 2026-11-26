import type { StorageDriver, StorageConfigShape } from "./types.ts";
import { DiskNotConfiguredError, DiskNotServedError } from "./errors.ts";
import { LocalDriver } from "./drivers/LocalDriver.ts";
import { S3Driver } from "./drivers/S3Driver.ts";
import { FakeDisk } from "./FakeDisk.ts";

/** The built-in served disk, where media with no disk configured writes. */
const PUBLIC_DISK = "public";

export class StorageManager {
  private _config: StorageConfigShape;
  private _drivers: Map<string, StorageDriver> = new Map();
  /** Drivers displaced by {@link fake}, keyed by disk name, for {@link restoreFakes}. */
  private _realDrivers: Map<string, StorageDriver | undefined> = new Map();
  /**
   * Real disks asked for while a fake was installed, so a fake's failed assertion can say
   * where the files went. Cleared by {@link restoreFakes}.
   */
  private _realDisksUsed: Set<string> = new Set();

  constructor(config: StorageConfigShape) {
    this._config = config;
  }

  /**
   * Get the driver for the named disk (or the default disk if omitted).
   *
   * @example
   * Storage.disk('local').put('avatars/alice.jpg', buffer);
   * Storage.disk('s3').get('reports/2025.pdf');
   * Storage.disk().exists('tmp/cache.json');
   */
  disk(name?: string): StorageDriver {
    const diskName = name ?? this._config.default;
    if (this._realDrivers.size > 0 && !this._realDrivers.has(diskName)) {
      this._realDisksUsed.add(diskName);
    }

    const cached = this._drivers.get(diskName);
    if (cached) return cached;

    const cfg = this._config.disks[diskName];
    if (!cfg) throw new DiskNotConfiguredError(diskName);

    let driver: StorageDriver;

    // A served disk's URL base defaults to where it is mounted, so `url()` can
    // never point somewhere nothing answers. An explicit `url` still wins — that
    // is how you put a CDN in front.
    const base = cfg.url ?? cfg.serve?.path;

    if (cfg.driver === "local") {
      driver = new LocalDriver(cfg.root, base);
    } else {
      driver = new S3Driver(cfg.key, cfg.secret, cfg.region, cfg.bucket, cfg.endpoint, base);
    }

    this._drivers.set(diskName, driver);
    return driver;
  }

  /**
   * Swap a disk for an in-memory {@link FakeDisk} and return it, so a test can
   * exercise uploads without writing to the filesystem or reaching S3.
   *
   * The fake stays installed until {@link restoreFakes} — call that in an
   * `afterEach`, or a later test expecting real storage will silently write
   * into memory and find its files gone.
   *
   * With no `name`, the default disk is faked, and so is the built-in `public` disk when the
   * default is not served and `public` is: that is where media with no disk configured, and
   * anything else that needs a served disk, writes. Both names share the one fake's files, each
   * with its own URLs, so the disk handed back sees every write. (A test written for the
   * default disk otherwise found its fake empty while uploads went into the real, served
   * `storage/public`.) A named fake replaces that disk alone.
   *
   * @param name - Disk to replace; defaults to the configured default disk.
   *
   * @example
   * const disk = Storage.fake('s3');
   * await report.export();
   * disk.assertExists('reports/2025.pdf');
   */
  fake(name?: string): FakeDisk {
    const diskName = name ?? this._config.default;
    // The same URL base the real disk uses (an explicit `url`, else where it is served),
    // so a link built in a test is the link the app serves. Falling back to `/storage`
    // alone gave a served disk's fake `/storage/a.png` where the app answers at
    // `/storage/public/a.png`.
    const fake = new FakeDisk(this._urlBase(diskName));
    // A failed assertion on this fake names the real disks the code used instead, for a write
    // that went to a disk no fake replaces.
    fake._realDisksUsed = () => [...this._realDisksUsed].filter((d) => !this._realDrivers.has(d));
    this._install(diskName, fake);

    const served = (disk: string): boolean =>
      this._config.disks[disk] !== undefined && this.isServed(disk);
    if (
      name === undefined &&
      diskName !== PUBLIC_DISK &&
      !served(diskName) &&
      served(PUBLIC_DISK) &&
      !this._realDrivers.has(PUBLIC_DISK)
    ) {
      this._install(PUBLIC_DISK, fake._sharingFiles(this._urlBase(PUBLIC_DISK)));
    }
    return fake;
  }

  /**
   * The URL base a disk's fake builds links with: the same one the real disk uses (an explicit
   * `url`, else where it is served), so a link built in a test is the link the app serves.
   * Falling back to `/storage` alone gave a served disk's fake `/storage/a.png` where the app
   * answers at `/storage/public/a.png`.
   */
  private _urlBase(diskName: string): string {
    const cfg = this._config.disks[diskName];
    return cfg?.url ?? cfg?.serve?.path ?? "/storage";
  }

  /** Put `fake` in place of `diskName`, remembering the real driver for {@link restoreFakes}. */
  private _install(diskName: string, fake: FakeDisk): void {
    if (!this._realDrivers.has(diskName)) {
      this._realDrivers.set(diskName, this._drivers.get(diskName));
    }
    this._drivers.set(diskName, fake);
  }

  /** Restore every disk swapped by {@link fake}. Call in `afterEach`. */
  restoreFakes(): void {
    for (const [name, driver] of this._realDrivers) {
      if (driver) this._drivers.set(name, driver);
      else this._drivers.delete(name);
    }
    this._realDrivers.clear();
    this._realDisksUsed.clear();
  }

  /**
   * A URL a browser can actually fetch — the one thing a template wants.
   *
   * The disk's own config decides which kind, so the caller does not have to
   * know whether the file is public:
   *
   * - **Served, unsigned** → a permanent URL under the disk's mount.
   * - **Served with `signed`** → a time-limited signed URL.
   * - **Not served** → {@link DiskNotServedError}, rather than a plausible
   *   string that 404s.
   *
   * That last case is the point. `url()` on an unserved disk returns a path
   * nothing answers, and a relative one at that — which resolves against
   * whatever page embedded it and produces a broken image somewhere confusing.
   * A URL you cannot fetch is not a URL, so asking for one is an error.
   *
   * @param path - Path on the disk.
   * @param options.disk - Disk name; defaults to the configured default disk.
   * @param options.expiresIn - Seconds a signed link stays valid. Defaults to
   *   the disk's `serve.expiresIn`, then 900.
   * @throws {@link DiskNotConfiguredError} when the disk does not exist.
   * @throws {@link DiskNotServedError} when the disk has no public URL.
   *
   * @example
   * // Public disk → /storage/avatars/alice.jpg
   * await Storage.publicUrl("avatars/alice.jpg", { disk: "public" });
   *
   * // Signed disk → /invoices/q1.pdf?expires=…&signature=…
   * await Storage.publicUrl("q1.pdf", { disk: "invoices" });
   */
  async publicUrl(
    path: string,
    options: { disk?: string; expiresIn?: number } = {},
  ): Promise<string> {
    const diskName = options.disk ?? this._config.default;
    const cfg = this._config.disks[diskName];
    if (!cfg) throw new DiskNotConfiguredError(diskName);

    if (cfg.serve?.signed) {
      const expiresIn = options.expiresIn ?? cfg.serve.expiresIn ?? 900;
      return this.disk(diskName).temporaryUrl(path, expiresIn);
    }

    if (!cfg.serve && !cfg.url) throw new DiskNotServedError(diskName);

    return this.disk(diskName).url(path);
  }

  /**
   * Whether `disk` has a public URL at all — a served disk, or one pointed at a
   * CDN. Use it to branch a template without catching an error.
   */
  isServed(disk?: string): boolean {
    const cfg = this._config.disks[disk ?? this._config.default];
    return Boolean(cfg && (cfg.serve || cfg.url));
  }

  /**
   * Verify a signature produced by a local disk's `temporaryUrl()`. Returns
   * `false` when the link has expired or the signature does not match
   * (constant-time). Wire this into the route that serves protected files:
   *
   * @example
   * Router.get('/files/:path*', ({ params, query, response }) => {
   *   const path = params.path;
   *   if (!Storage.verifyTemporaryUrl(path, Number(query('expires')), query('signature') ?? '')) {
   *     return response.status(403).send('Invalid or expired link');
   *   }
   *   return response.stream(await Storage.disk().getBuffer(path));
   * });
   *
   * S3 presigned URLs are verified by S3 itself and never pass through here.
   */
  verifyTemporaryUrl(path: string, expiresAt: number, signature: string): boolean {
    return LocalDriver.verifyTemporaryUrl(path, expiresAt, signature);
  }

  /**
   * Convenience over {@link verifyTemporaryUrl} that reads `?expires=&signature=`
   * from a full request URL and checks them against `path`.
   */
  verifyTemporaryUrlFor(path: string, url: URL | string): boolean {
    const u = typeof url === "string" ? new URL(url) : url;
    const expires = Number(u.searchParams.get("expires"));
    const signature = u.searchParams.get("signature");
    if (!Number.isFinite(expires) || !signature) return false;
    return LocalDriver.verifyTemporaryUrl(path, expires, signature);
  }
}
