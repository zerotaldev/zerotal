/**
 * Inertia v3 prop wrappers.
 *
 * A page prop can be a plain value, a function (lazy — evaluated only when included), or one of the
 * wrapper classes below. The {@link resolveProps} pipeline inspects these to decide whether a prop
 * is included on a given visit, when its value is evaluated, and how the client should merge it.
 *
 * Optional/Always/Defer/Merge prop wrappers, adapted to TypeScript.
 */

/** A prop value: a concrete value, or a (possibly async) factory evaluated on demand. */
export type PropFactory = () => unknown | Promise<unknown>;

/** Resolved merge configuration contributed by a mergeable prop. */
export interface MergeConfig {
  deep: boolean;
  /** Nested paths to append (relative to the prop key). Empty = append at root. */
  appendPaths: string[];
  /** Nested paths to prepend (relative to the prop key). */
  prependPaths: string[];
  /** Paths (relative to the prop key) whose last segment is the match field. */
  matchOn: string[];
  /** Prepend at the root level instead of appending. */
  prependRoot: boolean;
}

/**
 * Base class for all prop wrappers. Carries the shared `once()` modifier and the mergeable
 * capability (so both {@link MergeProp} and {@link DeferProp} can be merged on the client).
 *
 * @category Props
 */
export abstract class InertiaProp {
  protected _once = false;
  protected _onceExpiresAt: number | null = null;

  protected _merge = false;
  protected _deep = false;
  protected _appendPaths: string[] = [];
  protected _prependPaths: string[] = [];
  protected _matchOn: string[] = [];
  protected _prependRoot = false;

  /** When true, the prop is skipped on full/initial visits and only resolved on partial reloads. */
  readonly ignoreFirstLoad: boolean = false;

  /** Produce the prop's value (may be async). */
  abstract resolve(): unknown | Promise<unknown>;

  // ── once() ──────────────────────────────────────────────────────────────────

  /** Resolve only once; the client remembers the value across subsequent navigations. */
  once(expiresAt: number | null = null): this {
    this._once = true;
    this._onceExpiresAt = expiresAt;
    return this;
  }
  get isOnce(): boolean {
    return this._once;
  }
  get onceExpiresAt(): number | null {
    return this._onceExpiresAt;
  }

  // ── mergeable ────────────────────────────────────────────────────────────────

  /** Append new items to the existing array at the root level on partial reloads. */
  merge(): this {
    this._merge = true;
    return this;
  }
  /** Deep-merge the whole structure into the existing prop value on partial reloads. */
  deepMerge(): this {
    this._merge = true;
    this._deep = true;
    return this;
  }
  /** Append to specific nested path(s) of the prop, replacing the rest. */
  append(paths?: string | string[]): this {
    this._merge = true;
    this._push(this._appendPaths, paths);
    return this;
  }
  /** Prepend at the root (no args) or to specific nested path(s). */
  prepend(paths?: string | string[]): this {
    this._merge = true;
    if (paths === undefined) this._prependRoot = true;
    else this._push(this._prependPaths, paths);
    return this;
  }
  /** Match existing items by a field (path's last segment) instead of appending duplicates. */
  matchOn(paths: string | string[]): this {
    this._push(this._matchOn, paths);
    return this;
  }

  get shouldMerge(): boolean {
    return this._merge;
  }
  mergeConfig(): MergeConfig {
    return {
      deep: this._deep,
      appendPaths: this._appendPaths,
      prependPaths: this._prependPaths,
      matchOn: this._matchOn,
      prependRoot: this._prependRoot,
    };
  }

  private _push(target: string[], paths?: string | string[]): void {
    if (paths === undefined) return;
    if (Array.isArray(paths)) target.push(...paths);
    else target.push(paths);
  }
}

/**
 * `optional(fn)` — never included unless explicitly requested via a partial reload's `only`.
 * Also the underlying type returned by `lazy()`.
 *
 * @category Props
 */
export class OptionalProp extends InertiaProp {
  override readonly ignoreFirstLoad = true;
  constructor(private readonly callback: PropFactory) {
    super();
  }
  resolve(): unknown | Promise<unknown> {
    return this.callback();
  }
}

/**
 * `always(value)` — always included, even when a partial reload's `only`/`except` would exclude it.
 * Used internally to share `errors`.
 *
 * @category Props
 */
export class AlwaysProp extends InertiaProp {
  constructor(private readonly value: unknown | PropFactory) {
    super();
  }
  resolve(): unknown | Promise<unknown> {
    return typeof this.value === "function" ? (this.value as PropFactory)() : this.value;
  }
}

/**
 * `defer(fn, group?, { rescue })` — excluded from the initial render and listed under
 * `deferredProps[group]`; the client fetches it in a follow-up partial reload. With `rescue: true`,
 * a thrown error is swallowed and the key is reported in `rescuedProps`.
 *
 * @category Props
 */
export class DeferProp extends InertiaProp {
  override readonly ignoreFirstLoad = true;
  constructor(
    private readonly callback: PropFactory,
    readonly group: string = "default",
    readonly rescue: boolean = false,
  ) {
    super();
  }
  resolve(): unknown | Promise<unknown> {
    return this.callback();
  }
}

/**
 * `merge(value)` / `deepMerge(value)` — the client merges (rather than replaces) the prop on
 * partial reloads. Chain `.append()`, `.prepend()`, `.matchOn()`, `.deepMerge()`.
 *
 * @category Props
 */
export class MergeProp extends InertiaProp {
  constructor(private readonly value: unknown | PropFactory) {
    super();
    this._merge = true;
  }
  resolve(): unknown | Promise<unknown> {
    return typeof this.value === "function" ? (this.value as PropFactory)() : this.value;
  }
}

/** Minimal paginator shape `scroll()` reads to compute scroll metadata. */
export interface PaginatorLike {
  data: unknown[];
  /** Current page — read from `currentPage` or `page`. */
  currentPage?: number;
  page?: number;
  /** Last page number — read from `lastPage` (or derived from total/perPage). */
  lastPage?: number;
  perPage?: number;
  total?: number;
}

/** The `scrollProps` config emitted per infinite-scroll prop. */
export interface ScrollConfig {
  pageName: string;
  previousPage: number | null;
  nextPage: number | null;
  currentPage: number | null;
}

/**
 * `scroll(paginator)` — an infinite-scroll prop. The page's paginated data is merged (the client
 * appends/prepends new pages) and the page object carries a `scrollProps` entry describing the
 * current/next/previous page so the `<InfiniteScroll>` component knows when to load more.
 *
 * @category Props
 */
export class InfiniteScrollProp extends InertiaProp {
  constructor(
    private readonly value: PaginatorLike | PropFactory,
    readonly pageName: string = "page",
    readonly dataPath: string = "data",
  ) {
    super();
    this._merge = true;
    this._appendPaths = [dataPath];
  }

  resolve(): unknown | Promise<unknown> {
    return typeof this.value === "function" ? (this.value as PropFactory)() : this.value;
  }

  /** Compute the `scrollProps` entry from the resolved paginator value. */
  scrollConfig(resolved: unknown): ScrollConfig {
    const p = (resolved ?? {}) as PaginatorLike;
    const current = p.currentPage ?? p.page ?? null;
    const last =
      p.lastPage ??
      (p.total != null && p.perPage ? Math.max(1, Math.ceil(p.total / p.perPage)) : null);
    const nextPage = current != null && last != null && current < last ? current + 1 : null;
    const previousPage = current != null && current > 1 ? current - 1 : null;
    return { pageName: this.pageName, previousPage, nextPage, currentPage: current };
  }
}

// ── factory helpers ────────────────────────────────────────────────────────────

/**
 * Never include this prop on a full visit; the callback runs (and the value is sent)
 * only when a partial reload names the key in its `only` set. Use for expensive data
 * a page fetches on demand.
 *
 * @param callback - Factory producing the prop value (may be async); evaluated only when included.
 * @returns An {@link OptionalProp} wrapper for the resolver.
 * @category Props
 * @example
 * ```ts
 * return inertia('Users/Index', {
 *   users,
 *   // Only fetched when the client does `router.reload({ only: ['stats'] })`.
 *   stats: optional(() => computeExpensiveStats()),
 * });
 * ```
 */
export function optional(callback: PropFactory): OptionalProp {
  return new OptionalProp(callback);
}

/**
 * Alias of {@link optional}, matching Inertia's historical `lazy()` name.
 *
 * @param callback - Factory producing the prop value (may be async); evaluated only when included.
 * @returns An {@link OptionalProp} wrapper.
 * @category Props
 */
export function lazy(callback: PropFactory): OptionalProp {
  return new OptionalProp(callback);
}

/**
 * Always include this prop, even when a partial reload's `only`/`except` would
 * otherwise exclude it. Used internally to keep the `errors` bag present on every visit.
 *
 * @param value - The value, or a factory producing it (evaluated when included).
 * @returns An {@link AlwaysProp} wrapper.
 * @category Props
 */
export function always(value: unknown | PropFactory): AlwaysProp {
  return new AlwaysProp(value);
}

/**
 * Exclude this prop from the initial render and load it in an automatic follow-up
 * request, so the page paints immediately and heavier data streams in after. Props
 * sharing a `group` are fetched together in one request.
 *
 * @param callback - Factory producing the prop value (may be async); runs on the deferred request.
 * @param group - Request group name; props with the same group load in one follow-up request. Default `"default"`.
 * @param options - `rescue: true` swallows a thrown error and reports the key in `rescuedProps` instead of failing the request.
 * @returns A {@link DeferProp} wrapper.
 * @category Props
 * @example
 * ```ts
 * return inertia('Dashboard', {
 *   user,
 *   stats:    defer(() => computeStats()),                 // group "default"
 *   activity: defer(() => recentActivity(), 'secondary'),  // separate request
 * });
 * ```
 */
export function defer(
  callback: PropFactory,
  group = "default",
  options: { rescue?: boolean } = {},
): DeferProp {
  return new DeferProp(callback, group, options.rescue ?? false);
}

/**
 * Mark this prop so the client appends (merges) it into the existing value on partial
 * reloads instead of replacing it — the basis for "load more" lists. Chain
 * `.append()` / `.prepend()` / `.matchOn()` on the returned wrapper for finer control.
 *
 * @param value - The value, or a factory producing it.
 * @returns A {@link MergeProp} wrapper.
 * @category Props
 * @example
 * ```ts
 * return inertia('Feed', { posts: merge(() => Post.paginate(15, page)) });
 * ```
 */
export function merge(value: unknown | PropFactory): MergeProp {
  return new MergeProp(value);
}

/**
 * Like {@link merge}, but the client deep-merges the structure into the existing prop
 * value on partial reloads rather than appending at the root.
 *
 * @param value - The value, or a factory producing it.
 * @returns A {@link MergeProp} wrapper configured for deep merging.
 * @category Props
 */
export function deepMerge(value: unknown | PropFactory): MergeProp {
  return new MergeProp(value).deepMerge();
}

/**
 * Infinite-scroll prop: merges paginated data and emits `scrollProps` so the client
 * `<InfiniteScroll>` component knows when to load the next/previous page.
 *
 * @param value - A paginator (or factory producing one) with `data` plus page metadata.
 * @param options - `pageName` (query param driving pagination, default `"page"`) and `dataPath` (path to the array to merge, default `"data"`).
 * @returns An {@link InfiniteScrollProp} wrapper.
 * @category Props
 * @example
 * ```ts
 * return inertia('Posts/Index', { posts: scroll(() => Post.paginate(15, page)) });
 * // custom page-query name:
 * return inertia('Items', { items: scroll(() => Item.paginate(15, page), { pageName: 'p' }) });
 * ```
 */
export function scroll(
  value: PaginatorLike | PropFactory,
  options: { pageName?: string; dataPath?: string } = {},
): InfiniteScrollProp {
  return new InfiniteScrollProp(value, options.pageName ?? "page", options.dataPath ?? "data");
}
