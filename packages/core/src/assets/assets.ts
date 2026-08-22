/**
 * Front-end asset URL helper and asset versioning.
 *
 * `asset(path)` builds the public URL for a built asset, honouring the
 * configured `app.assets.prefix`. In dev it appends `?v=<version>` so the
 * browser re-fetches a rebuilt file on the next reload: the entry points named
 * here keep the same filename from one build to the next, so nothing in the URL
 * would otherwise change and the query string has to do the busting. (Bundlers
 * content-hash the code-split *chunks* an entry pulls in, but those URLs live
 * inside the bundle and are never passed through this helper.) In production
 * the clean path is returned unchanged.
 *
 * The version is a per-build token, bumped on every dev rebuild (see
 * {@link bumpAssetVersion}) and propagated from the dev orchestrator to the
 * server worker over its reload channel. This mirrors Inertia's asset-version
 * model — one token per build, busting every asset at once.
 *
 * ## Production needs this more than dev does
 *
 * It used to be dev-only, on the reasoning that production assets would be
 * content-hashed by something downstream. Nothing does: `assets:build` writes
 * `public/js/app.js` under that exact name every time, the static handler sends
 * no `Cache-Control`, and so a returning visitor keeps whatever bundle their
 * browser heuristically cached — for the life of that heuristic, across any
 * number of deploys. A shipped fix that reaches nobody who has visited before is
 * the worst kind, because everything on the server says it worked.
 *
 * So the version applies whenever it is set, in any environment. In production
 * it is derived from the built files themselves ({@link deriveAssetVersion}), so
 * it changes when the assets change and a plain restart does not bust a thing.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let _prefix = "/";
let _dev = false;
let _version = "";

/**
 * Configure the asset helper from resolved app config. Called once at boot.
 *
 * @param opts.prefix  URL prefix built assets are served under (`app.assets.prefix`).
 * @param opts.dev     Whether `?v=` cache-busting should be applied (dev only).
 */
export function configureAssets(opts: { prefix?: string; dev?: boolean }): void {
  if (opts.prefix !== undefined) _prefix = opts.prefix;
  if (opts.dev !== undefined) _dev = opts.dev;
}

/** Replace the current asset version (e.g. a build token from the orchestrator). */
export function setAssetVersion(version: string): void {
  _version = version;
}

/**
 * A token derived from the built assets in `dir`, or `""` when there are none.
 *
 * Name, size and mtime of every file, hashed. Content would be stricter and costs
 * a full read of every bundle at boot for a token that only has to *change* when
 * the files do — a rebuild that produces identical bytes keeping its old token is
 * the correct outcome either way.
 *
 * `""` when the directory is missing or empty, which leaves `asset()` emitting
 * clean URLs rather than a token that means nothing.
 */
export function deriveAssetVersion(dir: string): string {
  let entries: string[];
  try {
    entries = readdirSync(dir, { recursive: true }) as string[];
  } catch {
    return "";
  }

  const parts: string[] = [];
  for (const entry of entries.sort()) {
    try {
      const info = statSync(join(dir, entry));
      if (!info.isFile()) continue;
      parts.push(`${entry}:${info.size}:${Math.floor(info.mtimeMs)}`);
    } catch {
      // Raced with a deploy swapping the directory. Skipping the file is fine:
      // whatever lands next boot produces a different token anyway.
    }
  }

  if (parts.length === 0) return "";
  return Bun.hash(parts.join("|")).toString(36).slice(0, 10);
}

/** The current asset version, or `""` when unset. */
export function assetVersion(): string {
  return _version;
}

/**
 * Bump the asset version to a fresh token and return it.
 *
 * Called by the dev orchestrator after each successful rebuild so the next
 * `asset()` URL changes and the browser refetches the file.
 */
export function bumpAssetVersion(): string {
  _version = Date.now().toString(36);
  return _version;
}

/**
 * Build the public URL for a front-end asset.
 *
 * @param path  Asset path relative to the asset prefix (leading slash optional).
 * @returns     `<prefix>/<path>`, with `?v=<version>` appended when a version is set.
 *
 * @example
 *   asset("/app.css")   // → "/app.css?v=lq3k7m"
 *   asset("app.css")    // → "/app.css?v=lq3k7m"
 */
export function asset(path: string): string {
  const url = _joinUrl(_prefix, path);
  if (_version) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}v=${_version}`;
  }
  return url;
}

/** Join a URL prefix and an asset path with exactly one slash between them. */
function _joinUrl(prefix: string, path: string): string {
  const left = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const right = path.startsWith("/") ? path : `/${path}`;
  return `${left}${right}` || "/";
}
