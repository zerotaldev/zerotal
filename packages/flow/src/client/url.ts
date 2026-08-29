/**
 * Pure URL helpers for SPA navigation. No Alpine / DOM imports so this stays
 * unit-testable in isolation — the `$flow.currentUrl` / `$flow.navigateCurrent`
 * helpers in bridge.ts feed it `window.location.href`.
 */

/** Options for {@link buildUrlWithQuery}: query params to merge and an optional hash. */
export interface CurrentUrlOptions {
  /**
   * Query params to add/update/remove on top of the base URL. A value of
   * `null`, `undefined`, or `""` removes the param; anything else is stringified
   * and set. Params not listed here are preserved.
   */
  query?: Record<string, unknown> | undefined;
  /** Replace the URL hash. `""` clears it; omit to leave the hash untouched. */
  hash?: string | undefined;
}

/**
 * Build a URL from `baseHref`, merging the given query-param changes.
 *
 * Mirrors the ergonomics of filter UIs: pass only the params you want to change,
 * clear one by passing an empty/nullish value, and keep everything else.
 *
 * @example
 *   // base: /users?search=john&status=active&page=2
 *   buildUrlWithQuery(location.href, { query: { page: 3 } })
 *   // → /users?search=john&status=active&page=3
 *
 *   buildUrlWithQuery(location.href, { query: { status: null, page: 1 } })
 *   // → /users?search=john&page=1   (status removed)
 */
export function buildUrlWithQuery(baseHref: string, options: CurrentUrlOptions = {}): string {
  const url = new URL(baseHref);

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === null || value === undefined || value === "") {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, String(value));
      }
    }
  }

  if (options.hash !== undefined) {
    url.hash = options.hash;
  }

  return url.toString();
}
