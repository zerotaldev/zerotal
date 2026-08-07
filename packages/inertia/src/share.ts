/**
 * App-registered shared props (`Inertia.share(...)`).
 *
 * Registered once (typically in a provider's boot or middleware) and merged into every page's
 * props by {@link sharedProps}. Values may be plain values, factory functions (evaluated lazily per
 * request), or prop wrappers — the resolver handles each.
 */
const _shared = new Map<string, unknown>();

/** The always-present built-in shared keys. */
const BUILTIN_SHARED_KEYS = ["auth", "flash", "errors", "old"] as const;

/**
 * Register shared prop(s) that Zerotal includes on **every** Inertia page, so page
 * components can read them without each controller passing them explicitly.
 *
 * @remarks
 * Call once at boot (typically in a service provider) — a later `share()` of the
 * same key overwrites the previous value. Values may be plain data, a factory
 * function (re-evaluated lazily per request, e.g. to read the current user), or a
 * prop wrapper. The built-in shared keys (`auth`, `flash`, `errors`, `old`) are
 * always present in addition to whatever you register here; see {@link sharedProps}.
 *
 * Two call styles: a single `key`/`value` pair, or an object of many at once.
 *
 * @param key - The shared prop name (single-key overload) — or, in the object overload, the map of names to values.
 * @param value - The value for `key` (single-key overload only); a plain value, a per-request factory, or a prop wrapper.
 *
 * @example
 * ```ts
 * // In a service provider's boot() — available on every page (auth/flash/errors/old
 * // are already built in; register your own extras here).
 * Inertia.share({
 *   appName: 'Acme',
 *   permissions: () => Auth.user()?.permissions ?? [],  // factory re-runs each request
 * });
 *
 * // Or a single key:
 * Inertia.share('year', () => new Date().getFullYear());
 * ```
 */
export function share(key: string, value: unknown): void;
export function share(values: Record<string, unknown>): void;
export function share(keyOrValues: string | Record<string, unknown>, value?: unknown): void {
  if (typeof keyOrValues === "string") {
    _shared.set(keyOrValues, value);
  } else {
    for (const [k, v] of Object.entries(keyOrValues)) _shared.set(k, v);
  }
}

/** @internal The raw registered shared map (factories/wrappers left unresolved for the resolver). */
export function registeredShared(): Record<string, unknown> {
  return Object.fromEntries(_shared);
}

/** @internal All shared prop keys (built-ins + registered), for the page object's `sharedProps`. */
export function allSharedKeys(): string[] {
  return [...BUILTIN_SHARED_KEYS, ..._shared.keys()];
}

/** @internal Clear registered shared props (tests). */
export function flushShared(): void {
  _shared.clear();
}
