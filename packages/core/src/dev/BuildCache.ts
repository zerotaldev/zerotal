/**
 * Skip a bundle whose inputs have not changed since the last successful build.
 *
 * `serve --dev` rebuilds every bundle on boot, including the common case where
 * the project has not been touched since the last run. Bun's bundler has no
 * incremental API to drive, so the granularity available is all-or-nothing per
 * bundle: work out what went in, and if none of it moved, leave the output alone.
 *
 * ## What counts as an input
 *
 * Two sources, because one is not enough:
 *
 *   - **The module graph**, read back from the external sourcemaps the dev build
 *     already emits. Their `sources` arrays are the real list of files the
 *     bundler pulled in, lazily-imported chunks included.
 *   - **Scanned trees**, passed in by the caller. Tailwind v4 discovers utility
 *     classes by reading `@source` globs across `app/` and `resources/`, and
 *     none of that appears in any sourcemap — a stylesheet's true input set is
 *     "the source tree". Stat-only, so it costs ~10 ms for a small app.
 *
 * ## Failing safe
 *
 * Every uncertainty resolves to *build*. A missing cache file, a corrupt one, an
 * unreadable input, a Bun upgrade, an output someone deleted — all of them mean
 * rebuild. The cache is only ever allowed to cause an unnecessary build, never
 * to skip a necessary one.
 *
 * @internal
 */
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

/** Where cache entries live, alongside the prune manifests. */
const CACHE_DIR = ".zerotal/build";

/** Set to `1` to make every build unconditional. */
const DISABLE_ENV_VAR = "ZT_NO_BUILD_CACHE";

/** What a previous successful build consumed and produced. */
interface CacheEntry {
  /** Fingerprint of the build's configuration. */
  key: string;
  /** Bun version that produced the output. */
  bun: string;
  /** Absolute input path → `"<mtimeMs>:<size>"`. */
  inputs: Record<string, string>;
  /** Absolute paths this build wrote. */
  outputs: string[];
}

/** The subset of a `Bun.build()` artifact this module reads. */
export interface BuildArtifactLike {
  path: string;
  kind?: string;
  text?: () => Promise<string>;
}

/** Everything that should invalidate a cached build when it changes. */
export interface BuildCacheKey {
  entrypoints: string[];
  outdir: string;
  minify: boolean;
  /** Per-extension loader overrides. */
  loader?: Record<string, string> | undefined;
  /** Plugin identities — a different Tailwind plugin must rebuild. */
  plugins?: readonly string[] | undefined;
  /** Anything else the caller considers part of the build's identity. */
  extra?: Record<string, unknown> | undefined;
}

/**
 * A cache entry for one bundle, scoped to one build configuration.
 *
 * @example
 * const cache = BuildCache.for({ entrypoints, outdir, minify });
 * if (await cache.isFresh()) return { success: true, logs: [] };
 *
 * const result = await Bun.build({ entrypoints, outdir, sourcemap: "external" });
 * if (result.success) {
 *   await pruneBuildOutput(outdir, result.outputs);
 *   await cache.record(result.outputs, { scanRoots: [`${cwd}/app`] });
 * }
 */
export class BuildCache {
  private constructor(
    private readonly path: string,
    private readonly key: string,
    private readonly entrypoints: string[],
  ) {}

  /** Open the cache for one build configuration. */
  static for(key: BuildCacheKey, cwd: string = process.cwd()): BuildCache {
    const outdir = resolve(cwd, key.outdir);
    const entrypoints = key.entrypoints.map((entry) => resolve(cwd, entry));

    // The identity of the *entry*, so two bundles writing to the same directory
    // (Flow's CSS and JS both land in `public/`) do not share one record.
    const identity = JSON.stringify({
      outdir,
      entrypoints: [...entrypoints].sort(),
      minify: key.minify,
      loader: key.loader ?? null,
      plugins: key.plugins ? [...key.plugins].sort() : null,
      extra: key.extra ?? null,
    });

    const slug = (relative(cwd, outdir) || "out").replace(/[^a-z0-9]+/gi, "-");
    const hash = Bun.hash(identity).toString(36);

    return new BuildCache(
      join(cwd, CACHE_DIR, `cache-${slug}-${hash}.json`),
      Bun.hash(identity).toString(36),
      entrypoints,
    );
  }

  /** Whether the cache is consulted at all. */
  static get enabled(): boolean {
    return Bun.env[DISABLE_ENV_VAR] !== "1";
  }

  /**
   * Whether the last build's output is still good.
   *
   * False whenever anything is uncertain — see the module note on failing safe.
   */
  async isFresh(): Promise<boolean> {
    if (!BuildCache.enabled) return false;

    const entry = await this.#read();
    if (entry === null) return false;

    // A different build configuration, or a different Bun. Bun's output changes
    // between versions, and serving a stale bundle after `bun upgrade` is a
    // memorably bad afternoon.
    if (entry.key !== this.key) return false;
    if (entry.bun !== Bun.version) return false;

    // An empty input set would make every future build "fresh" forever.
    if (Object.keys(entry.inputs).length === 0) return false;

    for (const [path, stamp] of Object.entries(entry.inputs)) {
      if ((await _stamp(path)) !== stamp) return false;
    }

    // Cheap, and it means `rm -rf public/` always recovers.
    for (const path of entry.outputs) {
      if (!(await Bun.file(path).exists())) return false;
    }

    return true;
  }

  /**
   * Record what a successful build consumed and produced.
   *
   * Call only after a build that succeeded. Recording a failed build would
   * cache the inputs of output that was never written.
   *
   * @param outputs     The build's artifacts.
   * @param options.scanRoots Directories whose whole contents count as inputs
   *   (Tailwind's `@source` scan). Missing directories are skipped.
   */
  async record(
    outputs: readonly BuildArtifactLike[],
    options: { scanRoots?: readonly string[] } = {},
  ): Promise<void> {
    if (!BuildCache.enabled) return;

    const inputs: Record<string, string> = {};

    // Entry points always count, even when sourcemaps are off.
    for (const entry of this.entrypoints) {
      const stamp = await _stamp(entry);
      if (stamp !== null) inputs[entry] = stamp;
    }

    for (const path of await _graphInputs(outputs)) {
      if (inputs[path] === undefined) {
        const stamp = await _stamp(path);
        if (stamp !== null) inputs[path] = stamp;
      }
    }

    for (const root of options.scanRoots ?? []) {
      for (const [path, stamp] of Object.entries(await fingerprintTree(root))) {
        inputs[path] ??= stamp;
      }
    }

    await this.#write({
      key: this.key,
      bun: Bun.version,
      inputs,
      outputs: outputs.map((output) => resolve(output.path)),
    });
  }

  /** Forget this entry, forcing the next build to run. */
  async invalidate(): Promise<void> {
    try {
      await writeFile(this.path, "{}");
    } catch {
      // Nothing to invalidate is the same outcome as invalidating.
    }
  }

  async #read(): Promise<CacheEntry | null> {
    try {
      const contents = (await Bun.file(this.path).json()) as unknown;
      if (typeof contents !== "object" || contents === null) return null;

      const entry = contents as Partial<CacheEntry>;
      if (typeof entry.key !== "string" || typeof entry.bun !== "string") return null;
      if (typeof entry.inputs !== "object" || entry.inputs === null) return null;
      if (!Array.isArray(entry.outputs)) return null;

      return entry as CacheEntry;
    } catch {
      // Absent, unreadable, or not JSON — all mean "build".
      return null;
    }
  }

  async #write(entry: CacheEntry): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, JSON.stringify(entry, null, 2));
    } catch {
      // A cache that cannot be written costs a rebuild next time, not correctness.
    }
  }
}

/**
 * Stat every file under `root`, as absolute path → `"<mtimeMs>:<size>"`.
 *
 * Contents are never read: `mtime` plus size is enough to notice an edit, and
 * hashing a whole source tree on every boot would cost more than the build it
 * is trying to avoid. The gap — a same-size edit that preserves mtime — needs
 * deliberate effort to produce, and `ZT_NO_BUILD_CACHE=1` covers it.
 */
export async function fingerprintTree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  let entries: string[];
  try {
    entries = await readdir(root, { recursive: true });
  } catch {
    // A directory that does not exist contributes nothing rather than failing —
    // an app without `app/` is a valid app.
    return out;
  }

  for (const entry of entries) {
    const path = join(root, entry);
    const stamp = await _stamp(path);
    // Directories stat fine but have no meaningful size; `_stamp` returns null
    // for anything that is not a regular file.
    if (stamp !== null) out[path] = stamp;
  }

  return out;
}

// ── Private ──────────────────────────────────────────────────────────────────

/** `"<mtimeMs>:<size>"` for a regular file, or `null` for anything else. */
async function _stamp(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return null;
  }
}

/**
 * Every source file the bundler read, recovered from the emitted sourcemaps.
 *
 * A sourcemap's `sources` are relative to the map itself and use the host's
 * separators, so both need normalising before they name a real file.
 */
async function _graphInputs(outputs: readonly BuildArtifactLike[]): Promise<string[]> {
  const found = new Set<string>();

  for (const output of outputs) {
    const isMap = output.kind === "sourcemap" || output.path.endsWith(".map");
    if (!isMap) continue;

    try {
      const text = output.text ? await output.text() : await Bun.file(output.path).text();
      const map = JSON.parse(text) as { sources?: unknown };
      if (!Array.isArray(map.sources)) continue;

      const base = dirname(resolve(output.path));
      for (const source of map.sources) {
        if (typeof source !== "string" || source === "") continue;
        // Virtual entries a plugin injected have no file behind them.
        if (source.includes("://")) continue;
        found.add(resolve(base, source.split("\\").join("/")));
      }
    } catch {
      // A map we cannot parse just means a smaller input set, and a smaller
      // input set only ever causes extra builds.
      continue;
    }
  }

  return [...found];
}
