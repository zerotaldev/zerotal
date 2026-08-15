/**
 * The typed route registry and the param types derived from it. `RouteRegistry`
 * is the routing analogue of `ConfigRegistry`: an empty interface filled by
 * declaration merging, so `route("posts.show", { slug })` is checked against the
 * routes the application actually registered.
 *
 * Nothing here is hand-written by an app. `bun zt route:types` boots the app,
 * reads `Router.namedRoutes`, and writes `types/routes.generated.ts`:
 *
 * ```ts
 * export const ROUTES = {
 *   "home":       "/",
 *   "posts.show": "/posts/:slug",
 * } as const;
 *
 * declare module "@zerotal/core" {
 *   interface RouteRegistry extends Routes {}
 * }
 * ```
 *
 * Params are *derived* from the pattern rather than generated, so adding a
 * segment to a route changes one string in that file and every call site
 * updates with it.
 */

/** A value that can be substituted into a `:param` segment. */
export type RouteParamValue = string | number;

/** The loose param bag accepted by the untyped `route()` overload. */
export type RouteParamValues = Record<string, RouteParamValue | readonly RouteParamValue[]>;

/**
 * Query-string values accepted as `route()`'s third argument. `null` and
 * `undefined` entries are dropped; an array repeats the key
 * (`{ tag: ['a','b'] }` → `?tag=a&tag=b`).
 */
export type RouteQuery = Record<
  string,
  string | number | boolean | null | undefined | readonly (string | number | boolean)[]
>;

/**
 * Maps each registered route name to its URL pattern. Augmented by the
 * generated `types/routes.generated.ts`; empty until that file exists, which is
 * why `route()` keeps an untyped overload — an app that never runs the
 * generator (or registers routes behind a config flag) still compiles.
 *
 * @category Extension registries
 */
export interface RouteRegistry {}

/** Flatten an intersection so editors show `{ slug: string | number }`, not `A & B`. */
type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** Every route name known to the augmented {@link RouteRegistry}. */
export type RouteName = Extract<keyof RouteRegistry, string>;

/**
 * What `route()` accepts as a name: the registered names once the registry is
 * augmented, any string before that.
 *
 * There is deliberately **no** `route(name: string)` overload alongside the
 * typed one. An overload that accepts every string is matched by every string,
 * so `route("nope")` would compile and the types would be decorative — the
 * failure mode this whole feature exists to remove. A name that genuinely is
 * not known until runtime goes through `route.dynamic()`, which says so at the
 * call site.
 */
export type RouteTarget = [RouteName] extends [never] ? string : RouteName;

/** The URL pattern registered for route `N`, or plain `string` when it isn't a known name. */
export type RoutePattern<N extends string> = N extends RouteName
  ? RouteRegistry[N] extends string
    ? RouteRegistry[N]
    : string
  : string;

/**
 * The params a URL pattern requires, read straight off the pattern string.
 *
 * - `/posts/:slug` → `{ slug: string | number }`
 * - `/a/:x/b/:y` → `{ x: …; y: … }`
 * - `/docs/*` → `{ "*": … }` — a catch-all (`[...slug]`) compiles to `*` in the
 *   URL pattern, so the segment name is gone by the time routing sees it. The
 *   key is the wildcard itself, and it accepts an array of segments.
 * - `/about` → `{}`
 */
export type ParamsOf<P extends string> = P extends `${string}:${infer Name}/${infer Rest}`
  ? { [K in Name]: RouteParamValue } & ParamsOf<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? { [K in Name]: RouteParamValue }
    : P extends `${string}*${string}`
      ? { "*": RouteParamValue | readonly RouteParamValue[] }
      : Record<never, never>;

/** The params required by route `N`. */
export type RouteParams<N extends string> = Prettify<ParamsOf<RoutePattern<N>>>;

/**
 * The param bag a route helper accepts for `N`: exact once the registry is
 * generated, loose before that. Used by the helpers that take params without
 * being able to take `route()`'s rest-tuple — `redirect().to(name, params,
 * status)` and Flow's `redirectRoute`.
 */
export type RouteParamsArg<N extends string> = [RouteName] extends [never]
  ? RouteParamValues
  : RouteParams<N>;

/**
 * `route()`'s arguments after the name: params are required only when the
 * pattern has a `:param` (or a wildcard), and the query bag is always optional.
 *
 * Before the registry is generated there is no pattern to read, so params stay
 * loose — an app that has never run `zt route:types` compiles exactly as it did
 * before, it just isn't checked.
 */
export type RouteArgs<N extends string> = [RouteName] extends [never]
  ? [params?: RouteParamValues, query?: RouteQuery]
  : [keyof RouteParams<N>] extends [never]
    ? // `Record<string, never>` rather than `{}`: an empty object type accepts
      // any literal, so a static route would quietly swallow `{ page: 2 }`.
      [params?: Record<string, never>, query?: RouteQuery]
    : [params: RouteParams<N>, query?: RouteQuery];

/**
 * The `route()` helper: a checked call signature plus its `dynamic` escape hatch.
 *
 * Declared here, next to the types it is built from, because `route()` is
 * implemented twice — once on the server against `Router.namedRoutes`, once in
 * the browser against the generated `ROUTES` table. Both are typed as this
 * interface, so the two call sites cannot drift apart in what they accept: a
 * component that renders on the server and hydrates in the browser sees one
 * signature either way.
 *
 * @category Naming & URLs
 */
export interface RouteBuilder {
  /**
   * Generate a URL for a named route, substituting `:param` segments.
   *
   * @param name - The registered route name, e.g. `'posts.show'`.
   * @param args - `params` (one value per `:param`; a catch-all takes the `"*"` key and accepts an array of segments) then optional `query` values.
   * @throws {Error} when the route name is unknown, a required `:param` is missing, or a param key matches no segment.
   */
  <N extends RouteTarget>(name: N, ...args: RouteArgs<N>): string;

  /**
   * Build a URL for a route name that isn't known at compile time — a name from
   * config, a database row, or a package that registers routes conditionally.
   *
   * The escape hatch is a separate function rather than an overload on purpose:
   * an overload taking `string` is matched by every string, which would let
   * every typo through the front door. This one is greppable, and reads as the
   * exception it is.
   *
   * @param name - The route name, resolved at runtime.
   * @param params - One value per `:param` in the pattern.
   * @param query - Optional query-string values.
   * @throws {Error} on the same conditions as `route()` — an unknown name still throws.
   *
   * @example
   * route.dynamic(config('app.home_route'), { id })
   */
  dynamic(name: string, params?: RouteParamValues, query?: RouteQuery): string;
}
