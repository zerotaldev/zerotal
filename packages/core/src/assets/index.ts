/**
 * Front-end asset URL helper and asset versioning (the `@zerotal/core/assets`
 * subpath). {@link asset} builds the public URL for a built asset, appending a
 * `?v=<version>` cache-buster in dev; the versioning helpers let the dev
 * orchestrator bust every asset at once after a rebuild.
 *
 * @example
 * ```ts
 * import { asset } from "@zerotal/core/assets";
 *
 * asset("/app.css"); // prod → "/app.css"; dev → "/app.css?v=lq3k7m"
 * ```
 *
 * @packageDocumentation
 */
export { asset, assetVersion, setAssetVersion } from "./assets.ts";
