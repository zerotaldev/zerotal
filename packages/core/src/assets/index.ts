/**
 * Front-end asset URL helper and asset versioning (the `@zerotal/core/assets`
 * subpath). {@link asset} builds the public URL for a built asset and appends a
 * `?v=<version>` cache-buster — in every environment, not only in dev.
 *
 * Production needs it more: `assets:build` writes `app.js` under that name on
 * every deploy and the static handler sends no `Cache-Control`, so an unbusted
 * URL leaves a returning visitor on whatever bundle their browser cached. The
 * production token is derived from the built files, so it moves when they do and
 * a plain restart busts nothing.
 *
 * @example
 * ```ts
 * import { asset } from "@zerotal/core/assets";
 *
 * asset("/app.css"); // → "/app.css?v=lq3k7m"
 * ```
 *
 * @packageDocumentation
 */
export { asset, assetVersion, setAssetVersion } from "./assets.ts";
