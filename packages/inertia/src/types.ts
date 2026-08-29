/**
 * The Inertia "page object" — the serialisable payload that describes a page.
 *
 * On a first load it is embedded into the HTML shell's `data-page` script; on
 * subsequent visits it is the JSON response body. The Inertia client reads it to
 * mount/swap the page component and to drive partial-reload, merge, defer, once, and
 * history behaviour. Built by {@link buildPageObject}; the optional fields are only
 * present when the corresponding prop feature is in use.
 */
export interface PageObject {
  /** Page component name/path (relative to the pages dir, no extension), e.g. `"Users/Index"`. */
  component: string;
  /** The resolved props for the page. */
  props: Record<string, unknown>;
  /** The request URL (pathname + query) this page was rendered for. */
  url: string;
  /** Asset version; a mismatch triggers a full reload so the client picks up new assets. */
  version: string;
  /** Encrypt this page's history state in the browser (only set when true). */
  encryptHistory?: boolean;
  /** Clear any previously encrypted history state (only set when true). */
  clearHistory?: boolean;
  /** Preserve the URL fragment across a redirect. */
  preserveFragment?: boolean;
  /** Prop keys (or `key.path`) the client should append-merge instead of replacing. */
  mergeProps?: string[];
  /** Prop keys (or `key.path`) the client should prepend-merge. */
  prependProps?: string[];
  /** Prop keys (or `key.path`) the client should deep-merge. */
  deepMergeProps?: string[];
  /** `key.path` entries whose last segment is the field used to match items when merging. */
  matchPropsOn?: string[];
  /** Infinite-scroll pagination config, keyed by prop name. */
  scrollProps?: Record<string, unknown>;
  /** Deferred props grouped by request group; the client fetches them after first render. */
  deferredProps?: Record<string, string[]>;
  /** Deferred prop keys that threw and were rescued server-side. */
  rescuedProps?: string[];
  /** Once props, keyed by once-key → { prop, expiresAt }. */
  onceProps?: Record<string, { prop: string; expiresAt: number | null }>;
  /** Top-level shared prop keys, for instant-visit carry-over. */
  sharedProps?: string[];
}

/**
 * Options passed to `InertiaProvider` to configure the adapter at boot.
 *
 * @internal
 */
export interface InertiaProviderOptions {
  /** Path to the HTML template. Default: 'resources/app.html' */
  htmlTemplate?: string | undefined;
  /** Current asset version string. Used for cache-busting (409 responses). */
  version?: string | undefined;
  /** Public URL prefix for built assets. Default: '/assets' */
  assetsUrl?: string | undefined;
}
