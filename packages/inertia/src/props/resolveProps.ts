import {
  InertiaProp,
  AlwaysProp,
  DeferProp,
  InfiniteScrollProp,
  type PropFactory,
  type ScrollConfig,
} from "./PropTypes.ts";

/**
 * The resolved props plus the page-object metadata the client needs to merge/defer correctly.
 *
 * @internal
 */
export interface ResolvedPage {
  props: Record<string, unknown>;
  deferredProps?: Record<string, string[]>;
  mergeProps?: string[];
  prependProps?: string[];
  deepMergeProps?: string[];
  matchPropsOn?: string[];
  scrollProps?: Record<string, ScrollConfig>;
  onceProps?: Record<string, { prop: string; expiresAt: number | null }>;
  rescuedProps?: string[];
}

function parseList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function evaluate(value: unknown): Promise<unknown> {
  if (value instanceof InertiaProp) return await value.resolve();
  if (typeof value === "function") return await (value as PropFactory)();
  return value;
}

/**
 * Resolve a raw prop map against the current request into the props payload plus page-object
 * metadata, implementing the Inertia v3 prop protocol:
 *
 * - **Partial reloads**: when `X-Inertia-Partial-Component` matches `component`, only the props in
 *   `X-Inertia-Partial-Data` (`only`) are returned, or everything except `X-Inertia-Partial-Except`
 *   (`except`, which takes precedence).
 * - **Lazy evaluation**: function and wrapper props are only evaluated when actually included.
 * - **optional/defer** (`ignoreFirstLoad`): omitted from full visits; included only when named in a
 *   partial reload's `only`. Deferred props are advertised in `deferredProps[group]` on first load.
 * - **always**: always included, regardless of only/except.
 * - **merge/deepMerge**: included normally, but advertised in `mergeProps`/`deepMergeProps`/
 *   `prependProps`/`matchPropsOn` so the client merges instead of replacing. Suppressed for keys in
 *   `X-Inertia-Reset`.
 * - **once**: advertised in `onceProps`; skipped (not re-resolved) when already loaded on the client
 *   per `X-Inertia-Except-Once-Props`, unless explicitly requested via `only`.
 * - **rescue**: a deferred prop with `rescue: true` that throws is omitted and reported in
 *   `rescuedProps`.
 *
 * @param raw - The merged raw prop map (shared props + controller props), values possibly wrapped.
 * @param headers - The incoming request headers, read for the `X-Inertia-Partial-*` / reset / once / scroll-intent directives.
 * @param component - The page component name, compared against `X-Inertia-Partial-Component` to detect a partial reload.
 * @returns The resolved props plus the merge/defer/scroll/once metadata for the page object.
 * @internal Prop-protocol engine behind {@link buildPageObject}; not part of the app-facing API.
 */
export async function resolveProps(
  raw: Record<string, unknown>,
  headers: Headers,
  component: string,
): Promise<ResolvedPage> {
  const isPartial = headers.get("X-Inertia-Partial-Component") === component;
  const only = parseList(headers.get("X-Inertia-Partial-Data"));
  const except = parseList(headers.get("X-Inertia-Partial-Except"));
  const reset = new Set(parseList(headers.get("X-Inertia-Reset")));
  const onceLoaded = new Set(parseList(headers.get("X-Inertia-Except-Once-Props")));
  const scrollIntent = headers.get("X-Inertia-Infinite-Scroll-Merge-Intent"); // "prepend" | "append"

  const keys = Object.keys(raw);
  const propOf = (key: string): InertiaProp | undefined => {
    const v = raw[key];
    return v instanceof InertiaProp ? v : undefined;
  };

  // ── 1. Decide which keys are included ────────────────────────────────────────
  const included: string[] = [];
  for (const key of keys) {
    const prop = propOf(key);

    // always() props bypass all filtering.
    if (prop instanceof AlwaysProp) {
      included.push(key);
      continue;
    }

    if (isPartial && (only.length || except.length)) {
      if (except.length) {
        // except takes precedence; exclude listed keys and never auto-include ignoreFirstLoad props.
        if (!except.includes(key) && !prop?.ignoreFirstLoad) included.push(key);
      } else if (only.includes(key)) {
        // only: include exactly these (optional/deferred props become available here).
        included.push(key);
      }
      continue;
    }

    // Full/initial visit (or partial reload with no only/except): everything except
    // ignoreFirstLoad props (optional/deferred), which load on a later request.
    if (!prop?.ignoreFirstLoad) included.push(key);
  }

  // ── 2. Resolve included values + collect once metadata ───────────────────────
  const props: Record<string, unknown> = {};
  const rescuedProps: string[] = [];
  const onceProps: Record<string, { prop: string; expiresAt: number | null }> = {};

  for (const key of included) {
    const prop = propOf(key);

    if (prop?.isOnce) {
      onceProps[key] = { prop: key, expiresAt: prop.onceExpiresAt };
      // Already on the client and not explicitly re-requested → skip resolving, reuse client value.
      if (onceLoaded.has(key) && !only.includes(key)) continue;
    }

    try {
      props[key] = await evaluate(raw[key]);
    } catch (err) {
      if (prop instanceof DeferProp && prop.rescue) {
        rescuedProps.push(key);
        continue;
      }
      throw err;
    }
  }

  // ── 3. Deferred-prop advertisement (initial visit only) ──────────────────────
  const deferredProps: Record<string, string[]> = {};
  if (!isPartial) {
    for (const key of keys) {
      const v = raw[key];
      if (v instanceof DeferProp) (deferredProps[v.group] ??= []).push(key);
    }
  }

  // ── 4. Merge advertisement (for included, non-reset mergeable props) ─────────
  const mergeProps: string[] = [];
  const prependProps: string[] = [];
  const deepMergeProps: string[] = [];
  const matchPropsOn: string[] = [];

  for (const key of included) {
    const prop = propOf(key);
    if (!prop?.shouldMerge || reset.has(key)) continue;
    // Skip merge advertisement for once props that were reused (not in props).
    if (prop.isOnce && !(key in props)) continue;

    const cfg = prop.mergeConfig();
    const target = cfg.deep ? deepMergeProps : mergeProps;
    const hasNested = cfg.appendPaths.length > 0 || cfg.prependPaths.length > 0 || cfg.prependRoot;

    // Infinite-scroll props follow the client's merge intent: append by default, prepend when the
    // user scrolled up (X-Inertia-Infinite-Scroll-Merge-Intent: prepend).
    const appendTarget =
      prop instanceof InfiniteScrollProp && scrollIntent === "prepend" ? prependProps : target;

    if (!hasNested) target.push(key);
    for (const p of cfg.appendPaths) appendTarget.push(`${key}.${p}`);
    for (const p of cfg.prependPaths) prependProps.push(`${key}.${p}`);
    if (cfg.prependRoot) prependProps.push(key);
    for (const p of cfg.matchOn) matchPropsOn.push(`${key}.${p}`);
  }

  // ── 4b. Infinite-scroll metadata ─────────────────────────────────────────────
  const scrollProps: Record<string, ScrollConfig> = {};
  for (const key of included) {
    const prop = propOf(key);
    if (prop instanceof InfiniteScrollProp && key in props) {
      scrollProps[key] = prop.scrollConfig(props[key]);
    }
  }

  // ── 5. Assemble, omitting empty metadata ─────────────────────────────────────
  const out: ResolvedPage = { props };
  if (Object.keys(deferredProps).length) out.deferredProps = deferredProps;
  if (mergeProps.length) out.mergeProps = mergeProps;
  if (prependProps.length) out.prependProps = prependProps;
  if (deepMergeProps.length) out.deepMergeProps = deepMergeProps;
  if (matchPropsOn.length) out.matchPropsOn = matchPropsOn;
  if (Object.keys(scrollProps).length) out.scrollProps = scrollProps;
  if (Object.keys(onceProps).length) out.onceProps = onceProps;
  if (rescuedProps.length) out.rescuedProps = rescuedProps;
  return out;
}
