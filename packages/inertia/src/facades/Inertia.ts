import { inertia, inertiaStream } from "../inertia.ts";
import { optional, lazy, always, defer, merge, deepMerge, scroll } from "../props/PropTypes.ts";
import { share } from "../share.ts";
import { encryptHistory, clearHistory } from "../historyState.ts";
import { location } from "../location.ts";

/**
 * Unified Inertia facade.
 *
 * @example
 * import { Inertia } from "@zerotal/inertia";
 *
 * async index(http: HttpContext) {
 *   return Inertia.render("Users/Index", {
 *     users: Inertia.optional(() => User.all()),       // only on partial reload
 *     stats: Inertia.defer(() => computeStats()),      // loaded after first paint
 *     feed:  Inertia.merge(() => Post.paginate()),     // append on "load more"
 *   });
 * }
 *
 * Standalone helpers (`optional`, `always`, `defer`, `merge`, `deepMerge`, `lazy`) are also exported
 * for direct import if you prefer not to go through the facade.
 */
export const Inertia = {
  /** Render an Inertia page (= the `inertia()` helper). */
  render: inertia,
  /** Render an Inertia page using React streaming SSR. */
  stream: inertiaStream,

  /** Prop only included when explicitly requested via a partial reload's `only`. */
  optional,
  /** Alias of {@link optional}. */
  lazy,
  /** Prop always included, even on partial reloads that would otherwise exclude it. */
  always,
  /** Prop deferred to a follow-up request after the initial render. */
  defer,
  /** Prop the client appends (merges) into existing data on partial reloads. */
  merge,
  /** Prop the client deep-merges into existing data on partial reloads. */
  deepMerge,
  /** Infinite-scroll prop: merges paginated data and emits scroll metadata. */
  scroll,

  /** Register shared props included on every page. */
  share,

  /** Encrypt the current page's browser history state. */
  encryptHistory,
  /** Clear any encrypted history state (e.g. on logout). */
  clearHistory,

  /** External redirect (full-page visit). */
  location,
} as const;
