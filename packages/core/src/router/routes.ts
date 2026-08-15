/**
 * `route()` for the browser — the `@zerotal/core/routes` entry point.
 *
 * The server's `route()` (from `@zerotal/core`) reads the live router, which
 * only exists in the server process. This one reads a table you hand it at
 * boot: the `ROUTES` object that `bun zt route:types` already generates and
 * commits.
 *
 * ```ts
 * // resources/js/app.js — once, before anything renders
 * import { defineRoutes } from "@zerotal/core/routes";
 * import { ROUTES } from "../../types/routes.generated";
 *
 * defineRoutes(ROUTES);
 * ```
 *
 * ```ts
 * // anywhere in a page or component
 * import { route } from "@zerotal/core/routes";
 *
 * route("posts.show", { slug });           // "/posts/hello"
 * route("posts.index", {}, { page: 2 });   // "/posts?page=2"
 * ```
 *
 * The table is a build-time constant, so it costs one static import and
 * tree-shakes to the routes you keep — nothing is shipped per response and
 * nothing has to be fetched before the first link renders.
 *
 * **Types come from the same place as the server's.** The generated file
 * augments `RouteRegistry` in `@zerotal/core`, and both `route()`s are typed as
 * the one `RouteBuilder` interface, so a name that type-checks in a controller
 * type-checks in a component and a missing `:param` fails the build on either
 * side.
 *
 * **This module is isomorphic.** Inertia renders pages twice — once in the SSR
 * process, once in the browser — so a component importing `route` from here
 * runs in both. Call {@link defineRoutes} in each entry (`app.js` and `ssr.js`);
 * it is the same static import, and the same table.
 *
 * @module
 */
import type {
  RouteArgs,
  RouteBuilder,
  RouteParamValues,
  RouteQuery,
  RouteTarget,
} from "./registry.ts";
import { buildRouteUrl, unknownRouteError } from "./buildRoute.ts";

/**
 * The name → pattern map `route()` resolves against. A plain object is what
 * `types/routes.generated.ts` exports; a `Map` is accepted so a server-side
 * caller can pass `Router.namedRoutes` straight through.
 */
export type RouteTable = Readonly<Record<string, string>> | ReadonlyMap<string, string>;

/** `null` until `defineRoutes()` runs — distinct from "defined but empty", which is a valid state. */
let _table: ReadonlyMap<string, string> | null = null;

/**
 * Install the route table `route()` resolves against.
 *
 * Call it once per entry point, before the first render. Calling it again
 * replaces the table, which is what makes the dev server's hot reload work —
 * the entry re-runs and the new table wins.
 *
 * @param table - The generated `ROUTES` object, or any name → pattern map.
 *
 * @example
 * import { ROUTES } from "../../types/routes.generated";
 * defineRoutes(ROUTES);
 */
export function defineRoutes(table: RouteTable): void {
  _table = table instanceof Map ? table : new Map(Object.entries(table));
}

/**
 * Forget the installed table, putting `route()` back into its "not configured"
 * state. For tests that assert on the unconfigured error — application code
 * wants {@link defineRoutes} instead.
 */
export function resetRoutes(): void {
  _table = null;
}

/**
 * Whether `name` is in the installed table.
 *
 * Useful for the conditional links a client bundle cannot resolve by other
 * means: a nav item for a route that only exists when a package is installed,
 * or an admin link a public build never registers. Returns `false` — rather
 * than throwing — when no table has been installed.
 *
 * @param name - The route name to look for.
 *
 * @example
 * {hasRoute("admin.index") && <a href={route("admin.index")}>Admin</a>}
 */
export function hasRoute(name: string): boolean {
  return _table?.has(name) ?? false;
}

/** Resolve a pattern or throw the message that tells the caller what to fix. */
function _pattern(name: string): string {
  if (_table === null) {
    throw new Error(
      `[Zerotal] route("${name}") was called before the route table was installed. ` +
        `Add this to your client entry (and your SSR entry, if you have one):\n` +
        `  import { defineRoutes } from "@zerotal/core/routes";\n` +
        `  import { ROUTES } from "./types/routes.generated";\n` +
        `  defineRoutes(ROUTES);\n` +
        `Generate the table with: bun zt route:types`,
    );
  }
  const pattern = _table.get(name);
  if (pattern === undefined) throw unknownRouteError(name);
  return pattern;
}

/**
 * Generate a URL for a named route, substituting `:param` segments.
 *
 * The browser twin of the server's `route()` — same signature, same encoding,
 * same errors, resolved against the table {@link defineRoutes} installed
 * instead of against the live router.
 *
 * @example
 * route("posts.show", { slug: "hello" })       // "/posts/hello"
 * route("search", {}, { q: "reno", page: 2 })  // "/search?q=reno&page=2"
 * route("docs.show", { "*": "guides/intro" })  // "/docs/guides/intro"
 *
 * @category Naming & URLs
 */
export const route: RouteBuilder = Object.assign(
  <N extends RouteTarget>(name: N, ...args: RouteArgs<N>): string => {
    const [params = {}, query = {}] = args as [RouteParamValues?, RouteQuery?];
    return buildRouteUrl(name, _pattern(name), params, query);
  },
  {
    dynamic: (name: string, params: RouteParamValues = {}, query: RouteQuery = {}): string =>
      buildRouteUrl(name, _pattern(name), params, query),
  },
);

// The route *types* are deliberately not re-exported here. They erase at
// compile time, so `import type { RouteName } from "@zerotal/core"` costs a
// browser bundle nothing — and a second export path for the same names is a
// second entry in every surface report, forever, for no runtime benefit.
