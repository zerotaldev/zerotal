/**
 * The typed registry of well-known per-request context keys — the context
 * analogue of `ContainerBindings` (services) and `ConfigRegistry` (config).
 *
 * `HttpContext` carries a small per-request key/value store for framework
 * packages to hang request-scoped state on (a rendered island, a resolved
 * tenant, a devtools marker). Packages merge their keys here so the store is
 * typed at every call site: `ctx.getInternal("flow.island")` is inferred, a
 * key collision between two packages is a compile error, and a grep for a key
 * string finds its owner.
 *
 * Keys are flat, namespaced strings (`"<package>.<name>"`) — like
 * `ContainerBindings`, not the dot-path expansion of `ConfigRegistry`.
 *
 * @example
 * ```ts
 * // In @zerotal/flow
 * declare module "@zerotal/core" {
 *   interface ContextRegistry {
 *     "flow.island": IslandState;
 *   }
 * }
 *
 * // Anywhere with an HttpContext — typed, no cast:
 * ctx.setInternal("flow.island", state);
 * const island = ctx.getInternal("flow.island"); // IslandState | undefined
 * ```
 *
 * @remarks
 * An empty (unaugmented) registry leaves every key on the graceful `string`
 * fallback overload, so dynamic access such as `ctx.getInternal("trace-id")`
 * still compiles and returns `unknown`.
 *
 * @category Extension registries
 */
export interface ContextRegistry {}

/** Union of every registered context key. `never` until a package augments {@link ContextRegistry}. */
export type ContextKey = keyof ContextRegistry;

/** The value type stored under a registered context key. */
export type ContextValue<K extends ContextKey> = ContextRegistry[K];
