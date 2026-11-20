/**
 * The inspector's browser bundles: built when the package is packed, served at
 * URLs named after their content.
 *
 * The panel injected into dev pages and the standalone dashboard used to be
 * bundled by `Bun.build` on the first request to each, from the `*-auto.ts`
 * entries beside this file. That cost the first page a pause, and it could not
 * work at all in a compiled app, whose binary carries no source to bundle — the
 * dashboard on a gated staging binary was a stub comment.
 *
 * Now `scripts/build-client.ts` builds both into `dist/` as `prepack`, and the
 * tarball ships the output instead of the entries. Where the code comes from:
 *
 * - **a checkout of the repository**, which has the entries: built from them,
 *   once per process, so an edit to the panel shows up on the next boot;
 * - **an installed package**: read from `dist/`;
 * - **a compiled app**: read from the copy of `dist/` that `bun build --compile`
 *   embedded, because `dist/assets.js` imports each file in a way the bundler
 *   follows.
 *
 * Each is served from `/__zerotal/devtools/assets/<name>.<hash>.js` with a year-long
 * `immutable` cache, so a page load no longer downloads the panel again. The cache
 * is `private`: everything under the devtools prefix is behind one gate, and a
 * shared cache must not hand a gated response to someone the gate would refuse.
 *
 * @module
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Each bundle by the name it is served under, and the entry beside this file it is built from.
 *
 * @internal
 */
export const _DEVTOOLS_BUNDLES = {
  client: "client-auto.ts",
  dashboard: "dashboard-auto.ts",
} as const;

/** The name of one of the inspector's browser bundles. */
export type DevtoolsBundleName = keyof typeof _DEVTOOLS_BUNDLES;

/**
 * Every bundle name, in a stable order.
 *
 * @internal
 */
export const _DEVTOOLS_BUNDLE_NAMES = Object.keys(_DEVTOOLS_BUNDLES) as DevtoolsBundleName[];

/**
 * Where the hashed bundles are served. Under the devtools prefix, so the gate that
 * covers every other endpoint covers these too.
 *
 * @internal
 */
export const _DEVTOOLS_ASSET_PREFIX = "/__zerotal/devtools/assets/";

/** Browser-only, for a year, without asking again. */
const IMMUTABLE = "private, max-age=31536000, immutable";

/** One bundle, as the asset route serves it. */
export interface DevtoolsAsset {
  readonly name: DevtoolsBundleName;
  /** The bytes served. */
  readonly body: Uint8Array<ArrayBuffer>;
  /** The first sixteen hex digits of the SHA-256 of `body`. */
  readonly hash: string;
  /** Where it is served: `/__zerotal/devtools/assets/<name>.<hash>.js`. */
  readonly path: string;
}

/** A build from source: the code, or what the bundler said instead. */
type BuildResult =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly logs: readonly unknown[] };

function _entryPath(name: DevtoolsBundleName): string {
  return fileURLToPath(new URL(`./${_DEVTOOLS_BUNDLES[name]}`, import.meta.url));
}

/**
 * Whether the bundle's entry is here to build from: a checkout, not an installed package.
 *
 * @internal
 */
export function _hasDevtoolsSource(name: DevtoolsBundleName): boolean {
  try {
    return existsSync(_entryPath(name));
  } catch {
    // Inside a compiled binary there is no file behind the path to stat.
    return false;
  }
}

/**
 * Build one bundle from its entry, minified.
 *
 * Shared by `scripts/build-client.ts` and a checkout's boot, so the published
 * bundle and the one a contributor sees are built the same way.
 *
 * @param name - The bundle to build.
 * @internal
 */
export async function _buildDevtoolsBundle(name: DevtoolsBundleName): Promise<BuildResult> {
  try {
    const result = await Bun.build({
      entrypoints: [_entryPath(name)],
      target: "browser",
      minify: true,
      throw: false,
    });
    const output = result.outputs[0];
    if (result.success && output) return { ok: true, code: await output.text() };
    return { ok: false, logs: result.logs };
  } catch (error) {
    return { ok: false, logs: [error] };
  }
}

/** Whether a dynamic import failed because the module is absent, rather than broken. */
function _isModuleNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND";
}

/**
 * Read one prebuilt bundle from `dist/`, or `null` when there is none.
 *
 * The literal, relative `import()` is what `bun build --compile` follows to embed
 * `dist/assets.js` and the files it imports; the `.catch` on it lets a tree with
 * no `dist/` still compile, and `as string` keeps `tsc` from looking for a file
 * that only exists once the package has been packed.
 *
 * @param name - The bundle to read.
 * @internal
 */
export async function _readPrebuiltDevtoolsBundle(
  name: DevtoolsBundleName,
): Promise<string | null> {
  const loaded: unknown = await import("../dist/assets.js" as string).catch((error: unknown) => {
    if (_isModuleNotFound(error)) return null;
    throw error;
  });
  const index: unknown =
    loaded !== null && typeof loaded === "object" ? Reflect.get(loaded, "default") : null;
  const file: unknown =
    index !== null && typeof index === "object" ? Reflect.get(index, name) : null;
  if (typeof file !== "string") return null;
  const handle = Bun.file(file);
  return (await handle.exists()) ? await handle.text() : null;
}

/**
 * Describe a bundle by its content: identical bytes give the identical URL.
 *
 * @internal
 */
export function _devtoolsAsset(name: DevtoolsBundleName, code: string): DevtoolsAsset {
  const body = new TextEncoder().encode(code);
  const hash = new Bun.CryptoHasher("sha256").update(body).digest("hex").slice(0, 16);
  return { name, body, hash, path: `${_DEVTOOLS_ASSET_PREFIX}${name}.${hash}.js` };
}

/** The bundles this process serves, by name; a name is absent when it could not be loaded. */
export type DevtoolsAssets = Partial<Record<DevtoolsBundleName, DevtoolsAsset>>;

/** The load in flight or finished, shared by the provider's boot and the endpoints. */
let _loading: Promise<DevtoolsAssets> | null = null;
let _loaded: DevtoolsAssets | null = null;

async function _load(): Promise<DevtoolsAssets> {
  const assets: DevtoolsAssets = {};
  for (const name of _DEVTOOLS_BUNDLE_NAMES) {
    if (_hasDevtoolsSource(name)) {
      // A checkout builds from source and never reads dist/: one left by an earlier
      // pack is older than the source, and would hide the edit being checked.
      const built = await _buildDevtoolsBundle(name);
      if (built.ok) assets[name] = _devtoolsAsset(name, built.code);
      else console.error(`[Zerotal DevTools] the ${name} bundle did not build:`, ...built.logs);
      continue;
    }
    const code = await _readPrebuiltDevtoolsBundle(name);
    if (code !== null) assets[name] = _devtoolsAsset(name, code);
    else {
      console.error(
        `[Zerotal DevTools] the ${name} bundle is missing: this copy of @zerotal/devtools has ` +
          `neither its prebuilt dist/ nor the source to build it. Reinstall the package.`,
      );
    }
  }
  _loaded = assets;
  return assets;
}

/**
 * Load the bundles, once per process — a failure included, as the bundle built on
 * first request always was, so a broken build is reported once rather than on
 * every page.
 *
 * The provider awaits this at boot, so the tag it injects can name the client by
 * its hash. The endpoints await it too, which covers the middleware running
 * without the provider.
 *
 * @internal
 */
export function _loadDevtoolsAssets(): Promise<DevtoolsAssets> {
  _loading ??= _load();
  return _loading;
}

/**
 * A bundle already loaded, or `null` — for the HTML snippet, which cannot wait.
 *
 * @internal
 */
export function _loadedDevtoolsAsset(name: DevtoolsBundleName): DevtoolsAsset | null {
  return _loaded?.[name] ?? null;
}

/**
 * Answer a request under `/__zerotal/devtools/assets/`. The caller has already
 * checked the gate.
 *
 * A bundle this process serves comes back cacheable for a year. A known bundle
 * under a hash it does not have — a tab left open across an upgrade — is sent to
 * the current one, with the redirect itself uncached. Anything else is a 404.
 *
 * @param request - The request.
 * @internal
 */
export async function _devtoolsAssetResponse(request: Request): Promise<Response> {
  const assets = await _loadDevtoolsAssets();
  const pathname = new URL(request.url).pathname;
  const file = pathname.slice(_DEVTOOLS_ASSET_PREFIX.length);
  const all = _DEVTOOLS_BUNDLE_NAMES
    .map((name) => assets[name])
    .filter((asset): asset is DevtoolsAsset => asset !== undefined);

  const asset = all.find((candidate) => candidate.path === pathname);
  if (asset) {
    const etag = `"${asset.hash}"`;
    const headers = {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": IMMUTABLE,
      ETag: etag,
    };
    const held = request.headers.get("if-none-match");
    if (held !== null && held.split(",").some((tag) => tag.trim() === etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(asset.body, { status: 200, headers });
  }

  const name = /^(.+)\.[0-9a-f]{16}\.js$/.exec(file)?.[1];
  const current = all.find((candidate) => candidate.name === name);
  if (current) {
    return new Response(null, {
      status: 302,
      headers: { Location: current.path, "Cache-Control": "no-store" },
    });
  }
  return new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });
}
