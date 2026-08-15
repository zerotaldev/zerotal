/**
 * The URL-building half of `route()`: pattern in, URL out. No table, no router,
 * no request — which is the point.
 *
 * `route()` exists twice, once against the server's live `Router.namedRoutes`
 * and once against the generated `ROUTES` table in the browser bundle. Only the
 * *lookup* differs; everything a caller can actually observe — how a `:param` is
 * encoded, what a catch-all accepts, which mistakes throw and what they say —
 * lives here so the two cannot drift. A client `route()` that encoded params
 * differently from the server's would be worse than no client `route()` at all:
 * the links would be wrong only for the values nobody tests with.
 *
 * Nothing in this file may import anything that touches `Bun`, `process`, the
 * container, or request state. It is bundled into browsers.
 */
import type { RouteParamValue, RouteParamValues, RouteQuery } from "./registry.ts";

/** Encode one catch-all value: `'guides/intro'` and `['guides','intro']` both give `guides/intro`. */
function encodeWildcard(value: RouteParamValue | readonly RouteParamValue[]): string {
  const segments = Array.isArray(value) ? value : String(value).split("/");
  return (segments as readonly RouteParamValue[])
    .map((segment) => encodeURIComponent(String(segment)))
    .filter((segment) => segment.length > 0)
    .join("/");
}

/** Serialise the query bag: `null`/`undefined` drop out, arrays repeat the key. */
export function encodeRouteQuery(query: RouteQuery): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values as readonly (string | number | boolean)[]) {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(entry))}`);
    }
  }
  return pairs.join("&");
}

/**
 * The error both `route()` implementations throw for a name that isn't registered.
 *
 * Shared so the server and the browser report an unknown name identically — a
 * name that resolves in one and throws in the other is the exact confusion this
 * module exists to prevent.
 *
 * @param name - The name that was looked up.
 * @returns The error to throw; the caller throws it so the stack starts at the call site.
 */
export function unknownRouteError(name: string): Error {
  return new Error(`[Zerotal] Named route not found: "${name}"`);
}

/**
 * Substitute `params` into a URL pattern and append `query`.
 *
 * Params are **exact**: a key the pattern has no segment for throws rather than
 * quietly becoming a query-string entry. That rule is the reason the typed
 * signature is worth having — a typo'd param name that silently became
 * `?slugg=hello` is the bug the whole feature exists to catch — so it is
 * enforced at runtime too, for callers on the untyped path (`route.dynamic`, or
 * an app that has never run `zt route:types`).
 *
 * @param name - The route name, used only in error messages.
 * @param pattern - The URL pattern the name resolved to, e.g. `/posts/:slug`.
 * @param params - One value per `:param`; a catch-all takes the `"*"` key.
 * @param query - Query-string values, appended after the path.
 * @returns The built URL path (with query string when there is one).
 * @throws {Error} when a required `:param` is missing or a param key matches no segment.
 */
export function buildRouteUrl(
  name: string,
  pattern: string,
  params: RouteParamValues,
  query: RouteQuery,
): string {
  const usedKeys = new Set<string>();
  let url = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) {
      throw new Error(`[Zerotal] Missing parameter "${key}" for route "${name}"`);
    }
    usedKeys.add(key);
    // Encode path params so values containing `/ ? #` cannot mangle the URL.
    return encodeURIComponent(String(value));
  });

  // A catch-all segment reaches the router as `*` — the `[...slug]` name is gone
  // by then — so the wildcard is its own param key.
  if (url.includes("*")) {
    const value = params["*"];
    if (value === undefined) {
      throw new Error(`[Zerotal] Missing catch-all parameter "*" for route "${name}"`);
    }
    usedKeys.add("*");
    url = url.replace("*", encodeWildcard(value));
  }

  const unknown = Object.keys(params).filter((key) => !usedKeys.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `[Zerotal] Unknown parameter${unknown.length > 1 ? "s" : ""} ` +
        `${unknown.map((key) => `"${key}"`).join(", ")} for route "${name}" (${pattern}). ` +
        `Query-string values go in the third argument: route(name, params, query).`,
    );
  }

  const search = encodeRouteQuery(query);
  return search ? `${url}?${search}` : url;
}
