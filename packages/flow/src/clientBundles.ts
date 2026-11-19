/**
 * The browser bundles Flow ships, and the two places each one can come from.
 *
 * Three scripts are the same for every app on a given Zerotal release: the
 * runtime (Alpine, its plugins and the WebSocket bridge), its CSP-safe twin, and
 * the plain-form enhancement. They used to be built from `src/client/` by
 * `Bun.build` in every web process at boot, which meant every Flow app installed
 * Alpine and seven plugins only so its server could bundle them for the browser.
 * A compiled app had it worse: the binary carries no `src/client/` to bundle, so
 * it served pages with no runtime at all and nothing on them responded.
 *
 * Now they are built once, when the package is packed (`scripts/build-client.ts`
 * runs as `prepack`), and the tarball carries the output in `dist/`. Alpine is a
 * devDependency, and its version is the one this release was packed with.
 *
 * Where the code comes from at boot:
 *
 * - **A checkout of the repository** has the entry files, which the tarball
 *   leaves out. The bundle is built from them, as before, so an edit to the
 *   client shows up on the next boot rather than after a rebuild nobody runs.
 * - **An installed package** has no entries and reads `dist/`.
 * - **A compiled app** reads the copy of `dist/` that `bun build --compile`
 *   embedded. It can, because `dist/assets.js` names each file in an import the
 *   bundler follows; reading `dist/` by path would find nothing in a binary.
 *
 * @module
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Each bundle Flow serves, by the name it is served under, and its entry in `src/client/`.
 *
 * @internal
 */
export const _CLIENT_BUNDLES = {
  runtime: "index.ts",
  "runtime.csp": "index.csp.ts",
  enhance: "enhance.ts",
} as const;

/** The name of one of Flow's browser bundles. */
export type ClientBundleName = keyof typeof _CLIENT_BUNDLES;

/**
 * Every bundle name, in a stable order.
 *
 * @internal
 */
export const _CLIENT_BUNDLE_NAMES = Object.keys(_CLIENT_BUNDLES) as ClientBundleName[];

/** What loading a bundle came to. */
export type ClientBundleOutcome =
  /** The code, and where it was found: `source` in a checkout, `prebuilt` everywhere else. */
  | { readonly ok: true; readonly code: string; readonly from: "source" | "prebuilt" }
  /** The entry is there and did not build. `logs` is what the bundler said. */
  | { readonly ok: false; readonly reason: "build-failed"; readonly logs: readonly unknown[] }
  /** Neither an entry to build nor a `dist/` to read. */
  | { readonly ok: false; readonly reason: "missing" };

/** A source build: the code, or what the bundler said instead. */
type BuildResult =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly logs: readonly unknown[] };

/** The entry file a bundle is built from. Absent from an installed package. */
function _entryPath(name: ClientBundleName): string {
  return fileURLToPath(new URL(`./client/${_CLIENT_BUNDLES[name]}`, import.meta.url));
}

/**
 * Whether this is a checkout, where the bundle's entry file is there to build from.
 *
 * @internal
 */
export function _hasClientSource(name: ClientBundleName): boolean {
  try {
    return existsSync(_entryPath(name));
  } catch {
    // A path the platform cannot stat — inside a compiled binary — has no source behind it.
    return false;
  }
}

/**
 * Build one bundle from `src/client/`.
 *
 * The same call produces the published `dist/` (`scripts/build-client.ts`, always
 * minified) and the bundle a checkout serves at boot (minified only where the
 * deployment is production-like), so the two cannot drift apart in how they are
 * built.
 *
 * @param name - The bundle to build.
 * @param minify - Whether to minify.
 * @returns The bundle's code, or the bundler's log when it failed.
 * @internal
 */
export async function _buildClientBundle(
  name: ClientBundleName,
  minify: boolean,
): Promise<BuildResult> {
  try {
    const result = await Bun.build({
      entrypoints: [_entryPath(name)],
      target: "browser",
      // ESM output, loaded as a classic script: none of the entries exports anything,
      // and a trailing `export` would be a syntax error in a classic script.
      format: "esm",
      minify,
      throw: false,
    });
    const output = result.outputs[0];
    if (result.success && output) return { ok: true, code: await output.text() };
    return { ok: false, logs: result.logs };
  } catch (error) {
    return { ok: false, logs: [error] };
  }
}

/** Builds in flight or finished, by bundle and minification, so a process bundles each once. */
const _sourceBuilds = new Map<string, Promise<BuildResult>>();

/**
 * Build a bundle from source once per process.
 *
 * The client cannot change under a running process: `zt dev` restarts the worker
 * on a change. A suite that boots the provider in every file, though, would
 * otherwise bundle Alpine once per boot. A failed build is forgotten, so the next
 * boot tries again.
 */
function _sourceBuild(name: ClientBundleName, minify: boolean): Promise<BuildResult> {
  const key = `${name}:${minify}`;
  let build = _sourceBuilds.get(key);
  if (!build) {
    build = _buildClientBundle(name, minify);
    _sourceBuilds.set(key, build);
    void build.then((result) => {
      if (!result.ok) _sourceBuilds.delete(key);
    });
  }
  return build;
}

/** Whether a dynamic import failed because the module is not there, rather than broken. */
function _isModuleNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

/**
 * The file each prebuilt bundle is in, or `null` when this install has no `dist/`.
 *
 * The specifier is written out, relative, so `bun build --compile` follows it and
 * embeds `dist/assets.js` together with the bundles it imports as files. `.catch`
 * sits on the `import()` itself, which is what lets a tree without `dist/` — a
 * checkout — still compile. `as string` keeps `tsc` from looking for a file that
 * only exists once the package has been packed.
 */
async function _prebuiltFiles(): Promise<Partial<Record<ClientBundleName, string>> | null> {
  const loaded: unknown = await import("../dist/assets.js" as string).catch((error: unknown) => {
    if (_isModuleNotFound(error)) return null;
    throw error;
  });
  const index: unknown =
    loaded !== null && typeof loaded === "object" ? Reflect.get(loaded, "default") : null;
  if (index === null || typeof index !== "object") return null;
  const files: Partial<Record<ClientBundleName, string>> = {};
  for (const name of _CLIENT_BUNDLE_NAMES) {
    const file: unknown = Reflect.get(index, name);
    if (typeof file === "string") files[name] = file;
  }
  return files;
}

/**
 * Read one prebuilt bundle, or `null` when `dist/` does not have it.
 *
 * @param name - The bundle to read.
 * @internal
 */
export async function _readPrebuiltBundle(name: ClientBundleName): Promise<string | null> {
  const file = (await _prebuiltFiles())?.[name];
  if (!file) return null;
  const handle = Bun.file(file);
  return (await handle.exists()) ? await handle.text() : null;
}

/**
 * One bundle, from wherever this install keeps it.
 *
 * A checkout builds from source and never falls back to `dist/`: a `dist/` left
 * behind by an earlier pack is older than the source, and serving it would hide
 * the very edit the developer is checking, along with any error in it.
 *
 * @param name - The bundle wanted.
 * @param minify - Whether a bundle built from source is minified. Prebuilt bundles always are.
 * @internal
 */
export async function _loadClientBundle(
  name: ClientBundleName,
  minify: boolean,
): Promise<ClientBundleOutcome> {
  if (_hasClientSource(name)) {
    const built = await _sourceBuild(name, minify);
    return built.ok
      ? { ok: true, code: built.code, from: "source" }
      : { ok: false, reason: "build-failed", logs: built.logs };
  }
  const code = await _readPrebuiltBundle(name);
  return code === null ? { ok: false, reason: "missing" } : { ok: true, code, from: "prebuilt" };
}
