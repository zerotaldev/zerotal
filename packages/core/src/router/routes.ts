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
 * Re-exported so a browser bundle can write its own typed wrappers.
 *
 * These live in `registry.ts`, which is reachable from the `@zerotal/core` root
 * — and that root drags the CLI command modules into any bundle that imports it.
 * A component building a helper around `route()` needs the types without the
 * server, so they surface here, on the entry that is already browser-safe.
 */
export type { RouteArgs, RouteParamValues, RouteQuery, RouteTarget } from "./registry.ts";

/**
 * `route()` without an import.
 *
 * {@link defineRoutes} puts the builder on `globalThis`, and this is the
 * declaration that lets a call site use it: a page writes `route("posts.show")`
 * with no import line, typed exactly as the named export is — the same
 * `RouteBuilder`, so an unknown name or a missing `:param` still fails the build.
 *
 * `var` rather than `const`, because only `var` in a `declare global` block
 * creates a matching property on `globalThis` for the assignment to satisfy.
 */
declare global {
  var route: RouteBuilder;
}

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
  _installGlobal();
}

/**
 * Put `route()` on `globalThis`, so nothing has to import it.
 *
 * This is the one function both processes already call — the server from
 * `Application._installRouteTable()` at boot, a browser entry beside its
 * generated `ROUTES` — which makes it the only place that can install the global
 * for both without an app remembering to do it in two files.
 *
 * The table is installed first, deliberately: a global that exists but throws
 * "no route table" is worse than one that appears at the same moment it works.
 *
 * `route` stays a named export. Removing it would break every existing import
 * for no gain, and a test that wants a clean global can still reach for it.
 */
function _installGlobal(): void {
  (globalThis as { route?: typeof route }).route = route;
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

// ── Verb-aware routes ─────────────────────────────────────────────────────────

/**
 * Augmented by `types/routes.generated.ts` with the HTTP method of every named
 * route, exactly as {@link RouteRegistry} is augmented with their patterns.
 *
 * @internal The generator writes the augmentation; an app never names this.
 */
export interface RouteMethodRegistry {}

/**
 * A name the generated table knows a verb for.
 *
 * @internal Derived from {@link RouteMethodRegistry}, which the generator owns.
 */
export type MethodedRouteName = Extract<keyof RouteMethodRegistry, string>;

const methodTable = new Map<string, string>();

/**
 * Register the generated `METHODS` table.
 *
 * Called once at boot beside {@link defineRoutes}. Kept separate because the two
 * tables have different audiences: a page that only builds links needs the
 * patterns and never the verbs, and a bundler can then drop the verbs entirely.
 */
export function defineRouteMethods(table: Readonly<Record<string, string>>): void {
  methodTable.clear();
  for (const [name, method] of Object.entries(table)) methodTable.set(name, method);
}

/**
 * The verb a named route answers on, or undefined when it was never registered.
 *
 * @internal The read side of {@link defineRouteMethods}; apps call `action()`.
 */
export function routeMethod(name: string): string | undefined {
  return methodTable.get(name);
}

/** A resolved endpoint: where to send a request, and how. */
export interface RouteAction {
  url: string;
  method: string;
}

/**
 * Resolve a named route to both its URL and its HTTP method.
 *
 * The pair is the point. A form that hardcodes a URL can still send the wrong
 * verb, and the failure — a 404 or a 405 on submit — looks nothing like its
 * cause. Taking both from one generated record means a route that changes verb
 * changes it everywhere at once.
 *
 * Throws when the name has no registered verb. An earlier version defaulted to
 * `GET`, and that default cost a real bug: a regenerated table came back empty,
 * every `action()` reported `GET`, and a file upload submitted as a GET to its
 * own store route and 404'd. The point of resolving a verb from a table is that
 * a wrong verb becomes impossible — a silent fallback gives that away for a
 * failure mode nobody reads, so this is loud instead.
 *
 * Use {@link route} for links, which need no verb.
 *
 * @example
 * const submit = action("projects.issues.comments.store", { project: "apollo", issue: 4 });
 * // → { url: "/projects/apollo/issues/4/comments", method: "POST" }
 */
export function action<N extends RouteTarget>(name: N, ...args: RouteArgs<N>): RouteAction {
  const method = methodTable.get(name as string);
  if (method === undefined) {
    throw new Error(
      `action("${String(name)}"): no HTTP method registered for this route. ` +
        `On the server this is installed at boot, so an empty table means the route ` +
        `is not registered. In a browser bundle, call defineRouteMethods(METHODS) ` +
        `from types/routes.generated.ts at your entry point. ` +
        `Use route() instead for links, which need no verb.`,
    );
  }
  return { url: route(name, ...args), method };
}
