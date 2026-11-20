/**
 * The app's own files, as the framework reads them at runtime.
 *
 * The framework finds an app's config, routes, pages, migrations and the rest by scanning
 * directories under the project root and importing what it finds. That works while the files are
 * on disk beside an installed `node_modules`. A binary built by `bun zt compile` has neither: its
 * files have to be inside it, and an `import()` of a path on disk would load a second copy of the
 * framework from a `node_modules` beside the binary, if one were there at all.
 *
 * So `bun zt compile` builds through a generated entry that lists every app file with a literal
 * `import()`, which bundles each one into the binary. That entry hands the list to
 * {@link _embedAppFiles} before the app starts. Every place the framework scans or imports an app
 * file goes through {@link _scanAppFiles}, {@link _importAppFile} and {@link _appFileExists}, which
 * answer from that list when there is one and from the disk when there is not. Outside a compiled
 * binary nothing is registered, and each of them behaves exactly as the disk call it replaces.
 *
 * Paths are matched relative to the working directory, which is the project root everywhere the
 * framework reads app files. A binary is run from the directory that holds its `.env` and
 * `storage/`, so the same holds there. A path outside the root is never embedded and is read from
 * disk.
 *
 * @module
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Loads one embedded app file: a literal `import()` the bundler followed. */
export type AppFileLoader = () => Promise<Record<string, unknown>>;

let _embedded: Map<string, AppFileLoader> | null = null;

/** Embedded files already loaded by {@link _preloadAppFiles}: the module, or why it failed. */
const _preloaded = new Map<string, { module: Record<string, unknown> } | { error: unknown }>();

/**
 * Register the files a compiled binary carries, keyed by their path from the project root with
 * forward slashes (`config/app.ts`, `app/flow/pages/index.tsx`).
 *
 * Called by the entry `bun zt compile` generates, before the app's own entry runs. Calling it again
 * replaces the set; `null` clears it, which tests use to get back to the disk.
 *
 * @param files - Loader per root-relative path, or `null` to read from disk again.
 * @internal
 */
export function _embedAppFiles(files: Record<string, AppFileLoader> | null): void {
  _embedded = files ? new Map(Object.entries(files)) : null;
  _preloaded.clear();
}

/**
 * Load every embedded file under the given root-relative directories now, so that
 * {@link _importAppFileSync} can hand them to code that cannot await.
 *
 * The config loader is that code. It runs synchronously, first thing, and on disk it `require`s
 * each file. The generated entry preloads `config/` before the app's own entry runs, which is the
 * same point at which the loader would have read it. A file that throws is held, and the throw is
 * repeated to whoever asks for it, as `require` would have done.
 *
 * @param directories - Root-relative directories, such as `config`.
 * @internal
 */
export async function _preloadAppFiles(directories: readonly string[]): Promise<void> {
  if (!_embedded) return;
  for (const [key, load] of _embedded) {
    if (!directories.some((directory) => key.startsWith(`${directory}/`))) continue;
    try {
      _preloaded.set(key, { module: await load() });
    } catch (error) {
      _preloaded.set(key, { error });
    }
  }
}

/**
 * A preloaded embedded file, synchronously: its module, a throw of the error it failed with, or
 * `undefined` when it was not preloaded and has to be read from disk.
 *
 * @internal
 */
export function _importAppFileSync(path: string): Record<string, unknown> | undefined {
  if (!_embedded) return undefined;
  const key = _keyFor(path);
  const entry = key === undefined ? undefined : _preloaded.get(key);
  if (!entry) return undefined;
  if ("error" in entry) throw entry.error;
  return entry.module;
}

/**
 * Whether this process is a compiled binary carrying its app files.
 *
 * @internal
 */
export function _appFilesEmbedded(): boolean {
  return _embedded !== null;
}

/**
 * The root-relative key for a path, URL or `file://` specifier, or `undefined` when it is outside
 * the project root. A `?query` (the hot-reload cache buster) is dropped.
 */
function _keyFor(pathOrUrl: string): string | undefined {
  let path = pathOrUrl;
  if (path.startsWith("file:")) {
    try {
      path = fileURLToPath(new URL(path));
    } catch {
      return undefined;
    }
  } else {
    const query = path.indexOf("?");
    if (query !== -1) path = path.slice(0, query);
  }
  const fromRoot = relative(process.cwd(), resolve(path));
  if (fromRoot === "" || fromRoot.startsWith("..") || isAbsolute(fromRoot)) return undefined;
  return sep === "/" ? fromRoot : fromRoot.split(sep).join("/");
}

/**
 * The files under `directory` matching `pattern`, relative to `directory` with forward slashes.
 *
 * Reads the embedded set in a compiled binary, the disk otherwise. A directory that does not exist
 * yields nothing; it is not an error.
 *
 * @param directory - Absolute directory, or one relative to the working directory.
 * @param pattern - A `Bun.Glob` pattern, such as `**\/*.{ts,tsx}`.
 * @returns Matching paths, sorted.
 * @internal
 */
export async function _scanAppFiles(directory: string, pattern: string): Promise<string[]> {
  const embedded = _scanEmbedded(directory, pattern);
  if (embedded) return embedded;
  try {
    const found = await Array.fromAsync(
      new Bun.Glob(pattern).scan({ cwd: directory, onlyFiles: true }),
    );
    return _normalised(found);
  } catch {
    return [];
  }
}

/**
 * {@link _scanAppFiles}, synchronously, for the config loader, which runs before anything is
 * awaited.
 *
 * @internal
 */
export function _scanAppFilesSync(directory: string, pattern: string): string[] {
  const embedded = _scanEmbedded(directory, pattern);
  if (embedded) return embedded;
  try {
    return _normalised([...new Bun.Glob(pattern).scanSync({ cwd: directory, onlyFiles: true })]);
  } catch {
    return [];
  }
}

/** Disk scan results with forward slashes, sorted. */
function _normalised(files: string[]): string[] {
  return files.map((file) => (sep === "/" ? file : file.split(sep).join("/"))).sort();
}

/** The embedded files under `directory` matching `pattern`, or `null` to read the disk. */
function _scanEmbedded(directory: string, pattern: string): string[] | null {
  if (!_embedded) return null;
  const base = _keyFor(directory);
  if (base === undefined && resolve(directory) !== process.cwd()) return null;
  const glob = new Bun.Glob(pattern);
  const prefix = base === undefined ? "" : `${base}/`;
  const found: string[] = [];
  for (const key of _embedded.keys()) {
    if (!key.startsWith(prefix)) continue;
    const inner = key.slice(prefix.length);
    if (glob.match(inner)) found.push(inner);
  }
  return found.sort();
}

/**
 * Import an app file: from the binary when it carries the file, from disk otherwise.
 *
 * @param pathOrUrl - Absolute path or `file://` URL, as would be handed to `import()`.
 * @returns The module's namespace.
 * @internal
 */
export async function _importAppFile<T = Record<string, unknown>>(pathOrUrl: string): Promise<T> {
  if (_embedded) {
    const key = _keyFor(pathOrUrl);
    const load = key === undefined ? undefined : _embedded.get(key);
    if (load) return (await load()) as T;
  }
  return (await import(pathOrUrl)) as T;
}

/**
 * Read an app file as text: from the binary when it carries the file, from disk otherwise.
 *
 * A binary carries a text file, such as Inertia's `resources/app.html`, as a module whose default
 * export is its contents.
 *
 * @param path - Absolute path, or one relative to the working directory.
 * @throws When the file is in neither place, as `Bun.file(path).text()` does.
 * @internal
 */
export async function _readAppFileText(path: string): Promise<string> {
  if (_embedded) {
    const key = _keyFor(path);
    const load = key === undefined ? undefined : _embedded.get(key);
    if (load) return String((await load())["default"]);
  }
  return Bun.file(path).text();
}

/**
 * Whether an app file exists: in the binary when it carries the project's files, on disk
 * otherwise.
 *
 * @param path - Absolute path, or one relative to the working directory.
 * @internal
 */
export async function _appFileExists(path: string): Promise<boolean> {
  if (_embedded) {
    const key = _keyFor(path);
    if (key !== undefined) return _embedded.has(key);
  }
  return Bun.file(path).exists();
}

/**
 * Whether any embedded app file sits under `directory`. Without an embedded set, whether the
 * directory exists on disk.
 *
 * @internal
 */
export async function _appDirectoryExists(directory: string): Promise<boolean> {
  if (_embedded) {
    const key = _keyFor(directory);
    if (key !== undefined) {
      for (const file of _embedded.keys()) if (file.startsWith(`${key}/`)) return true;
      return false;
    }
  }
  const { existsSync } = await import("node:fs");
  return existsSync(directory);
}
