import { deepMerge } from "@zerotal/core";

export interface InertiaConfigShape {
  /** Path to the HTML template file. Default: './resources/app.html' */
  htmlTemplate: string;
  /** Asset version string for cache-busting. Default: '1' */
  version: string;
  /** Public URL prefix for built assets. Default: '/' */
  assetsUrl: string;
  /**
   * Directory (relative to the project root) where Inertia page components live.
   * Used by the page-registry generator, the SSR handler, and `inertiaStream()`.
   * Default: 'resources/js/pages'
   */
  pagesDir: string;
  /**
   * Enable server-side rendering.
   *
   * When true, InertiaProvider registers POST /__ssr which accepts
   * { component, props, url } and returns { body, head } - the same
   * contract as the Inertia Node SSR server. The Inertia client calls
   * this endpoint when rendering the first page load on the server.
   *
   * Pages are rendered with the framework they're authored in: React `.tsx`
   * via `react-dom/server`, or Vue `.vue` via `@inertiajs/vue3` + `vue/server-renderer`.
   * Install the server renderer for the framework(s) the app uses.
   *
   * Default: false
   */
  ssr: boolean;
  /**
   * Shared secret required to reach `POST /__ssr` from off-box.
   *
   * The endpoint is loopback-only by default, because it takes an arbitrary component name
   * and a props bag and does real rendering work with them — upstream Inertia runs SSR as a
   * separate process on a private port for exactly this reason. Set this (and send it as
   * `X-Inertia-SSR-Secret`) only when the renderer runs on another host.
   *
   * Default: `""` — loopback only.
   */
  ssrSecret: string;
  /**
   * Encrypt browser history state by default for every page. Individual pages can still opt in/out
   * per request via `Inertia.encryptHistory()` / `clearHistory()`. Default: false.
   */
  encryptHistory: boolean;
}

/** Default directory (relative to the project root) for Inertia page components. */
export const DEFAULT_PAGES_DIR = "resources/js/pages";

const defaults: InertiaConfigShape = {
  htmlTemplate: "./resources/app.html",
  version: "1",
  assetsUrl: "/",
  pagesDir: DEFAULT_PAGES_DIR,
  ssr: false,
  ssrSecret: "",
  encryptHistory: false,
};

/**
 * Create a typed Inertia configuration object with defaults.
 *
 * @example
 * import { InertiaConfig } from '@zerotal/inertia';
 * export default InertiaConfig({
 *   htmlTemplate: './resources/app.html',
 *   version:      Bun.env['ASSET_VERSION'] ?? '1',
 *   ssr:          true,   // enable SSR endpoint at POST /__ssr
 * });
 */
export function InertiaConfig(options: Partial<InertiaConfigShape> = {}): InertiaConfigShape {
  return deepMerge(defaults, options);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    inertia: InertiaConfigShape;
  }
}
