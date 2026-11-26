import type { StorageDriver, PutOptions } from "./types.ts";

/** What {@link FakeDisk} remembers about a stored file. */
export interface FakeStoredFile {
  path: string;
  contents: Uint8Array;
  contentType: string | undefined;
  visibility: "public" | "private" | undefined;
  lastModified: number;
}

/**
 * An in-memory storage disk for tests.
 *
 * Writing real files to test an upload leaves the suite dependent on a
 * filesystem it has to clean up — and a test that forgets to passes the second
 * time for the wrong reason. This keeps everything in a `Map`, so each test
 * starts empty by construction, and adds the assertions that a plain driver has
 * no reason to carry.
 *
 * Install it with `Storage.fake()`, which swaps it in for a named disk and
 * returns it.
 *
 * @example
 * const disk = Storage.fake();
 *
 * await app.multipart('/avatar', { avatar: fakeFile.image('me.png') });
 *
 * disk.assertExists('avatars/me.png');
 * disk.assertCount(1);
 */
export class FakeDisk implements StorageDriver {
  private _files = new Map<string, FakeStoredFile>();

  /**
   * @param baseUrl - Prefix returned by {@link url}, so a test can assert on the
   * URL a controller hands back.
   */
  constructor(private readonly baseUrl: string = "/storage") {}

  /**
   * The real disks the code under test used while this fake was installed, set by
   * `Storage.fake()`. A failed assertion names them: the files are most likely there.
   *
   * @internal
   */
  _realDisksUsed: (() => string[]) | undefined = undefined;

  /**
   * A fake for another disk name that holds this one's files, with its own URL base, so a write
   * through either name is seen by both. `Storage.fake()` uses it to fake `public` beside an
   * unserved default disk.
   *
   * @internal
   */
  _sharingFiles(baseUrl: string): FakeDisk {
    const sibling = new FakeDisk(baseUrl);
    sibling._files = this._files;
    sibling._realDisksUsed = this._realDisksUsed;
    return sibling;
  }

  // ── StorageDriver ─────────────────────────────────────────────────────

  async put(
    path: string,
    content: string | Uint8Array | Blob,
    options: PutOptions = {},
  ): Promise<void> {
    this._files.set(_normalise(path), {
      path: _normalise(path),
      contents: await _bytes(content),
      contentType: options.contentType,
      visibility: options.visibility,
      lastModified: Date.now(),
    });
  }

  async append(path: string, content: string | Uint8Array): Promise<void> {
    const existing = this._files.get(_normalise(path))?.contents ?? new Uint8Array(0);
    const added = await _bytes(content);
    const merged = new Uint8Array(existing.length + added.length);
    merged.set(existing);
    merged.set(added, existing.length);
    await this.put(path, merged);
  }

  async get(path: string): Promise<string | null> {
    const file = this._files.get(_normalise(path));
    return file ? new TextDecoder().decode(file.contents) : null;
  }

  async stream(path: string): Promise<Blob | null> {
    const file = this._files.get(_normalise(path));
    return file ? new Blob([file.contents as BlobPart], { type: file.contentType ?? "" }) : null;
  }

  async getBuffer(path: string): Promise<Uint8Array | null> {
    return this._files.get(_normalise(path))?.contents ?? null;
  }

  async exists(path: string): Promise<boolean> {
    return this._files.has(_normalise(path));
  }

  async delete(path: string): Promise<void> {
    this._files.delete(_normalise(path));
  }

  url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, "")}/${_normalise(path)}`;
  }

  async copy(source: string, destination: string): Promise<void> {
    const file = this._files.get(_normalise(source));
    if (!file) throw new Error(`[Zerotal/storage] Cannot copy missing file "${source}".`);
    this._files.set(_normalise(destination), {
      ...file,
      path: _normalise(destination),
      lastModified: Date.now(),
    });
  }

  async move(source: string, destination: string): Promise<void> {
    await this.copy(source, destination);
    await this.delete(source);
  }

  async size(path: string): Promise<number | null> {
    return this._files.get(_normalise(path))?.contents.length ?? null;
  }

  async lastModified(path: string): Promise<number | null> {
    return this._files.get(_normalise(path))?.lastModified ?? null;
  }

  async temporaryUrl(path: string, expiresInSeconds: number): Promise<string> {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    return `${this.url(path)}?expires=${expires}&signature=fake`;
  }

  // ── Inspection ────────────────────────────────────────────────────────

  /** Every stored path, in insertion order. */
  paths(): string[] {
    return [...this._files.keys()];
  }

  /** The full record for a stored file, or `undefined`. */
  file(path: string): FakeStoredFile | undefined {
    return this._files.get(_normalise(path));
  }

  /** Number of files currently stored. */
  get count(): number {
    return this._files.size;
  }

  /** Forget everything stored so far. */
  clear(): void {
    this._files.clear();
  }

  // ── Assertions ────────────────────────────────────────────────────────

  /** Assert a file exists at `path`, optionally matching its exact contents. */
  assertExists(path: string, contents?: string | Uint8Array): this {
    const file = this._files.get(_normalise(path));
    if (!file) {
      throw new Error(
        `assertExists: expected "${path}" on the disk, but it holds ${this._listing()}`,
      );
    }
    if (contents !== undefined) {
      const expected = typeof contents === "string" ? contents : new TextDecoder().decode(contents);
      const actual = new TextDecoder().decode(file.contents);
      if (actual !== expected) {
        throw new Error(
          `assertExists: "${path}" exists but its contents differ.\n` +
            `  expected: ${JSON.stringify(expected.slice(0, 120))}\n` +
            `  actual:   ${JSON.stringify(actual.slice(0, 120))}`,
        );
      }
    }
    return this;
  }

  /** Assert nothing is stored at `path`. */
  assertMissing(path: string): this {
    if (this._files.has(_normalise(path))) {
      throw new Error(`assertMissing: expected "${path}" to be absent, but it is stored.`);
    }
    return this;
  }

  /**
   * Assert a file exists whose path matches `pattern` — the way to assert on an
   * upload stored under a generated name.
   *
   * @example
   * disk.assertExistsMatching(/^avatars\/[0-9a-f-]+\.png$/);
   */
  assertExistsMatching(pattern: RegExp): this {
    if (!this.paths().some((p) => pattern.test(p))) {
      throw new Error(
        `assertExistsMatching: no stored path matched ${pattern}. The disk holds ${this._listing()}`,
      );
    }
    return this;
  }

  /** Assert the file at `path` was stored with the given content type. */
  assertContentType(path: string, contentType: string): this {
    this.assertExists(path);
    const actual = this._files.get(_normalise(path))!.contentType;
    if (actual !== contentType) {
      throw new Error(
        `assertContentType: expected "${path}" to be stored as "${contentType}" but it was ` +
          `"${actual ?? "unset"}".`,
      );
    }
    return this;
  }

  /** Assert exactly `expected` files are stored. */
  assertCount(expected: number): this {
    if (this._files.size !== expected) {
      throw new Error(
        `assertCount: expected ${expected} file(s) but the disk holds ${this._listing()}`,
      );
    }
    return this;
  }

  /** Assert nothing at all was stored. */
  assertNothingStored(): this {
    return this.assertCount(0);
  }

  private _listing(): string {
    const paths = this.paths();
    const listing = paths.length === 0 ? "no files." : `${paths.length}: [${paths.join(", ")}].`;
    const elsewhere = this._realDisksUsed?.() ?? [];
    if (elsewhere.length === 0) return listing;
    const names = elsewhere.map((d) => `"${d}"`).join(", ");
    return (
      `${listing} While this fake was installed, the code under test used the real ${names} ` +
      `disk${elsewhere.length === 1 ? "" : "s"}, which it does not replace, so files may have ` +
      `been written there. Fake that disk instead: Storage.fake("${elsewhere[0]}").`
    );
  }
}

/** Drop a leading slash so `avatars/a.png` and `/avatars/a.png` are one file. */
function _normalise(path: string): string {
  return path.replace(/^\/+/, "");
}

async function _bytes(content: string | Uint8Array | Blob): Promise<Uint8Array> {
  if (typeof content === "string") return new TextEncoder().encode(content);
  if (content instanceof Uint8Array) return content;
  return new Uint8Array(await content.arrayBuffer());
}
