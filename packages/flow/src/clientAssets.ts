/**
 * Serving Flow's browser scripts at URLs named after their content.
 *
 * Every script a Flow page loads is served from `/__flow/assets/<name>.<hash>.js`,
 * where the hash is taken from the bytes served. A URL therefore names exactly
 * one version of a script, so the response can be cached for a year and never
 * revalidated: a browser fetches the runtime once per Zerotal upgrade, not once
 * per page load. Before this the runtime was `/__flow/runtime.js`, sent
 * `no-store`, and every full page load downloaded all of it again.
 *
 * The runtime was `no-store` for one reason: the app's named-route table was
 * prepended to it per request, and the table is per app and can grow after boot.
 * The table is now a script of its own, hashed the same way, so the runtime is
 * the same bytes for every app on a release and the table changes only when the
 * routes do.
 *
 * Both are same-origin files, so a policy of `script-src 'self'` allows them,
 * with no nonce, no `'unsafe-inline'`, and, under `cspSafe`, no `'unsafe-eval'`.
 *
 * @module
 */
import { Router } from "@zerotal/core";
import type { ClientBundleName } from "./clientBundles.ts";

/**
 * Where Flow serves its scripts. Under `/__flow/`, which deployments already keep
 * outside any proxy gate, because the WebSocket lives there too.
 *
 * @internal
 */
export const _FLOW_ASSET_PREFIX = "/__flow/assets/";

/** How long a browser may keep a hashed script: a year, without asking again. */
const IMMUTABLE = "public, max-age=31536000, immutable";

const JAVASCRIPT = "text/javascript; charset=utf-8";

/** How many route tables are kept answering after the routes change under a running app. */
const ROUTE_TABLES_KEPT = 8;

/** One script, as the asset route serves it. */
export interface ClientAsset {
  /** What it is: a bundle name, or `routes`. */
  readonly name: string;
  /** The bytes served. */
  readonly body: Uint8Array<ArrayBuffer>;
  /** The first sixteen hex digits of the SHA-256 of `body`. */
  readonly hash: string;
  /** Where it is served: `/__flow/assets/<name>.<hash>.js`. */
  readonly path: string;
}

/**
 * Describe a script by its content.
 *
 * Identical bytes give the identical URL, in any process, on any machine, which
 * is what makes a cached copy safe to keep; a single changed byte gives another.
 *
 * @param name - The script's name, the first part of its file name.
 * @param content - Its code.
 * @internal
 */
export function _clientAsset(name: string, content: string | Uint8Array<ArrayBuffer>): ClientAsset {
  const body = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const hash = new Bun.CryptoHasher("sha256").update(body).digest("hex").slice(0, 16);
  return { name, body, hash, path: `${_FLOW_ASSET_PREFIX}${name}.${hash}.js` };
}

/** The bundles the asset route answers for, by file name (`runtime.<hash>.js`). */
const _bundles = new Map<string, ClientAsset>();

/** The route tables it answers for, by file name, the most recent last. */
const _routeTables = new Map<string, ClientAsset>();

/** The runtime this process serves (one of the two variants), and the enhancement. */
let _runtime: ClientAsset | null = null;
let _enhance: ClientAsset | null = null;

/** The route table last served, and the text it was made from. */
let _routes: { asset: ClientAsset; source: string } | null = null;

function _fileOf(asset: ClientAsset): string {
  return asset.path.slice(_FLOW_ASSET_PREFIX.length);
}

/**
 * Put the bundles this process serves on the asset route.
 *
 * Called once per boot. A bundle that is `null` could not be loaded; its tags are
 * then left off the page, as they always were when the runtime failed to build.
 *
 * @param runtime - The runtime variant this process serves, or `null`.
 * @param enhance - The plain-form enhancement, or `null`.
 * @internal
 */
export function _installClientAssets(
  runtime: { name: ClientBundleName; code: string } | null,
  enhance: { name: ClientBundleName; code: string } | null,
): void {
  _bundles.clear();
  _routeTables.clear();
  _routes = null;
  _runtime = runtime ? _clientAsset(runtime.name, runtime.code) : null;
  _enhance = enhance ? _clientAsset(enhance.name, enhance.code) : null;
  for (const asset of [_runtime, _enhance]) if (asset) _bundles.set(_fileOf(asset), asset);
}

/**
 * The runtime this process serves, or `null` when none could be loaded.
 *
 * @internal
 */
export function _runtimeAsset(): ClientAsset | null {
  return _runtime;
}

/**
 * The plain-form enhancement, or `null` when it could not be loaded.
 *
 * @internal
 */
export function _enhanceAsset(): ClientAsset | null {
  return _enhance;
}

/**
 * The `window.__zerotalRoutes = {...}` script that hands the client the app's
 * named routes, which `installClientRoutes()` reads back on load.
 *
 * Served as JavaScript, not embedded in HTML, so the `</script>` hazard the state
 * island guards against does not apply here — this response is never parsed as
 * markup. Plain `JSON.stringify` is enough.
 *
 * @internal exported for tests.
 */
export function _routeTablePrelude(): string {
  const table = Object.fromEntries(Router.namedRoutes);
  return `window.__zerotalRoutes=${JSON.stringify(table)};\n`;
}

/**
 * The route-table script as it stands now.
 *
 * Read when a page renders rather than at boot: providers registered after Flow,
 * and the app's own route files, add routes after Flow has booted, and a table
 * taken at boot would be missing them. The text is compared with the last one,
 * so the hash is only recomputed when a route was added or moved.
 *
 * @internal
 */
export function _routesAsset(): ClientAsset {
  const source = _routeTablePrelude();
  if (_routes?.source === source) return _routes.asset;

  const asset = _clientAsset("routes", source);
  _routes = { asset, source };
  // Deleted first so a table that comes back (routes changed, then changed back)
  // moves to the end, and the current table is never the one evicted.
  const file = _fileOf(asset);
  _routeTables.delete(file);
  _routeTables.set(file, asset);

  // A page rendered just before the change still asks for its table, so the last
  // few stay answerable; past that, they are dropped rather than kept forever.
  for (const stale of [..._routeTables.keys()].slice(0, -ROUTE_TABLES_KEPT)) {
    _routeTables.delete(stale);
  }
  return asset;
}

/**
 * The tags a Flow page ends with: the route table, then the runtime.
 *
 * Both `defer`, so they run in this order once the document is parsed — the
 * table is in place before the runtime reads it. Empty when there is no runtime
 * to load, which leaves the page as plain HTML rather than linking a script that
 * would answer 404.
 *
 * @internal
 */
export function _clientScriptTags(): string {
  if (!_runtime) return "";
  return (
    `<script src="${_routesAsset().path}" defer></script>` +
    `<script src="${_runtime.path}" defer></script>`
  );
}

/** The `name` part of `<name>.<16 hex digits>.js`, or `null` for anything else. */
function _nameOf(file: string): string | null {
  return /^(.+)\.[0-9a-f]{16}\.js$/.exec(file)?.[1] ?? null;
}

/** Whether the request already holds this exact version. */
function _alreadyHeld(request: Request, etag: string): boolean {
  const held = request.headers.get("if-none-match");
  return held !== null && (held.trim() === "*" || held.split(",").some((t) => t.trim() === etag));
}

/**
 * Answer a request under `/__flow/assets/`.
 *
 * - A file this process serves: the bytes, cacheable for a year. The URL can only
 *   ever name these bytes, so there is nothing to revalidate.
 * - A known script under a hash this process does not have: a page rendered by an
 *   earlier deploy, or before the routes changed. It is sent to the current
 *   version rather than left with a 404, as it would have been given the current
 *   runtime when the URL did not carry a hash; the redirect itself is `no-store`,
 *   so no cache remembers a URL standing for bytes it does not name.
 * - Anything else: 404.
 *
 * @param request - The request.
 * @internal
 */
export function _clientAssetResponse(request: Request): Response {
  const file = new URL(request.url).pathname.slice(_FLOW_ASSET_PREFIX.length);
  const asset = _bundles.get(file) ?? _routeTables.get(file);
  if (asset) {
    const etag = `"${asset.hash}"`;
    const headers = { "Content-Type": JAVASCRIPT, "Cache-Control": IMMUTABLE, ETag: etag };
    if (_alreadyHeld(request, etag)) return new Response(null, { status: 304, headers });
    return new Response(asset.body, { status: 200, headers });
  }

  const name = _nameOf(file);
  const current =
    name === "routes"
      ? _routesAsset()
      : [_runtime, _enhance].find((candidate) => candidate?.name === name);
  if (current) {
    return new Response(null, {
      status: 302,
      headers: { Location: current.path, "Cache-Control": "no-store" },
    });
  }
  return new Response("Not Found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
