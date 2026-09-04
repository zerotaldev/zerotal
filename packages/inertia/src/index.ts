/**
 * The Inertia.js adapter for Zerotal — build React or Vue single-page apps with
 * no separate API layer.
 *
 * Controllers return {@link inertia | `inertia('PageName', props)`} instead of
 * JSON or HTML: on a full page load the adapter renders the HTML shell, and on
 * subsequent visits it returns a JSON page object that the Inertia client swaps
 * into the current page component. {@link share | Shared props} expose global
 * data (the authenticated user, flash messages) to every page, the
 * {@link optional}/{@link lazy}/{@link defer} prop helpers control what is sent
 * on partial reloads, and {@link SsrHandler | SSR} renders the first paint on
 * the server.
 *
 * @example Return an Inertia page from a controller
 * ```ts
 * import { inertia } from "@zerotal/inertia";
 *
 * export async function index(ctx) {
 *   const users = await User.query().get();
 *   return inertia("Users/Index", { users });
 * }
 * ```
 *
 * @example Share global props at boot
 * ```ts
 * import { share } from "@zerotal/inertia";
 *
 * share("appName", () => config("app.name"));
 * ```
 *
 * @remarks
 * Register `InertiaProvider`. React consumers need `react`/`react-dom`; Vue
 * consumers need `vue`/`@inertiajs/vue3` (declare whichever you use). Requires
 * **Bun ≥ 1.1**.
 *
 * @packageDocumentation
 */

// @zerotal/inertia — public API

// Side-effect import: augments @zerotal/core RouterMacros so Router.inertia() is typed.
import "./augment.ts";

export { inertiaRoute } from "./route.ts";

// `route()` for pages — the browser/SSR helper from `@zerotal/core/routes`,
// re-exported so a page component imports it from the package it already uses.
// Note the two are different things: `inertiaRoute()` above *registers* a page
// route on the server, `route()` *generates a URL* for one.
export { route, defineRoutes, hasRoute, resetRoutes } from "@zerotal/core/routes";
export type { RouteTable } from "@zerotal/core/routes";

export {
  inertia,
  inertiaStream,
  buildPageObject,
  _setHtmlTemplate,
  _getHtmlTemplate,
} from "./inertia.ts";
export type { PageRenderer } from "./inertia.ts";
export { InertiaProvider } from "./provider/InertiaProvider.ts";
export { InertiaMiddleware } from "./middleware/InertiaMiddleware.ts";
export { PrecognitionMiddleware } from "./middleware/PrecognitionMiddleware.ts";
export { sharedProps } from "./SharedProps.ts";
export { assetVersion, setAssetVersion } from "./version.ts";
export { generatePageRegistry } from "./PageRegistry.ts";
export type { PageRegistryResult } from "./PageRegistry.ts";
// The typed page registry: `InertiaPageRegistry` is what `pages.generated.ts`
// augments, `SharedProps` is what the app declares for `Inertia.share()`.
export type {
  InertiaPageRegistry,
  SharedProps,
  PageName,
  PageTarget,
  PropsOf,
  PropInput,
  RenderProps,
  RenderArgs,
} from "./pages.ts";
export { detectVuePlugin } from "./vuePlugin.ts";
export type { PageObject, InertiaProviderOptions } from "./types.ts";

// Unified facade
export { Inertia } from "./facades/Inertia.ts";

// Prop wrappers + factories (v3 data props)
export {
  InertiaProp,
  OptionalProp,
  AlwaysProp,
  DeferProp,
  MergeProp,
  InfiniteScrollProp,
  optional,
  lazy,
  always,
  defer,
  merge,
  deepMerge,
  scroll,
} from "./props/PropTypes.ts";
export type { PropFactory, MergeConfig, PaginatorLike, ScrollConfig } from "./props/PropTypes.ts";
export { resolveProps } from "./props/resolveProps.ts";
export type { ResolvedPage } from "./props/resolveProps.ts";

// Shared props registry
export { share } from "./share.ts";

// History encryption
export { encryptHistory, clearHistory, setHistoryEncryptionDefault } from "./historyState.ts";

// External / fragment redirects
export { location } from "./location.ts";

// Config factory
export { InertiaConfig } from "./config.ts";
export type { InertiaConfigShape, InertiaDevtoolsConfig } from "./config.ts";

// ── DevTools ─────────────────────────────────────────────────────────────────
// Server-side recorder for the Inertia DevTools browser extension. InertiaProvider
// wires all of this up when the recorder is enabled; an app needs none of it
// unless it is registering the recorder itself.
export { InertiaDevtoolsMiddleware } from "./devtools/middleware.ts";
export { devtoolsEnabled } from "./devtools/enabled.ts";
export { DEVTOOLS_API_PREFIX } from "./devtools/types.ts";
export type { DevtoolsEntry } from "./devtools/types.ts";

// SSR handler (for direct use or testing)
export { SsrHandler } from "./SsrHandler.ts";

// Typed errors
export { InertiaError, InertiaTemplateNotLoadedError, InvalidComponentError } from "./errors.ts";
