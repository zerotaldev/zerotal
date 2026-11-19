/**
 * Every framework package this package loads, in one place.
 *
 * `@zerotal/inertia` renders React and Vue pages, and an app installs the one it
 * uses. So React, Vue, their Inertia adapters and the `.vue` compiler are all
 * optional peers, and this module is the only code that loads them. Each loader is
 * the same expression:
 *
 * ```ts
 * import("react" as string).catch(optionalPeer("react", hint))
 * ```
 *
 * The literal specifier is what lets `bun zt compile` embed the package in a binary,
 * the attached `.catch()` is what lets that build succeed for an app without it, and
 * `as string` keeps an app's `tsc` from resolving a package it never installed. A
 * missing package becomes an `OptionalPeerMissingError` that says what to install;
 * anything else — an installed package that fails to load — arrives unchanged.
 *
 * Every package resolves from here, not from the working directory, so a compiled
 * binary loads the copy it embedded, and an app's flat install finds its own copy by
 * walking up from this file.
 *
 * The types below describe only the parts this package calls. Nothing here imports
 * a peer's types, because an app without the peer would fail to type-check this file.
 *
 * @module
 */
import { optionalPeer } from "@zerotal/core/runtime";
import type { OptionalPeerHint } from "@zerotal/core/runtime";

// ── React ───────────────────────────────────────────────────────────────────

/** The part of `react` the server render calls. */
export interface ReactModule {
  createElement: (type: unknown, props: unknown, ...children: unknown[]) => unknown;
}

/** The part of `react-dom/server` the server render calls. */
export interface ReactDomServerModule {
  renderToString: (element: unknown) => string;
  renderToReadableStream: (element: unknown) => Promise<ReadableStream<Uint8Array>>;
}

/** The part of `@inertiajs/react` the server render calls. */
export interface InertiaReactModule {
  App: unknown;
}

const REACT: OptionalPeerHint = {
  feature: "Rendering a React page on the server",
  install: "bun add react react-dom @inertiajs/react",
};

/**
 * Load `react`.
 *
 * @throws {@link OptionalPeerMissingError} When the app does not install it.
 * @internal
 */
export function _loadReact(): Promise<ReactModule> {
  return import("react" as string).catch(optionalPeer("react", REACT));
}

/**
 * Load `react-dom/server`.
 *
 * @throws {@link OptionalPeerMissingError} When the app does not install `react-dom`.
 * @internal
 */
export function _loadReactDomServer(): Promise<ReactDomServerModule> {
  return import("react-dom/server" as string).catch(optionalPeer("react-dom/server", REACT));
}

/**
 * Load `@inertiajs/react`, whose `<App>` the server renders so `<Head>` tags arrive.
 *
 * @throws {@link OptionalPeerMissingError} When the app does not install it.
 * @internal
 */
export function _loadInertiaReact(): Promise<InertiaReactModule> {
  return import("@inertiajs/react" as string).catch(
    optionalPeer("@inertiajs/react", { ...REACT, install: "bun add @inertiajs/react" }),
  );
}

// ── Vue ─────────────────────────────────────────────────────────────────────

/** The part of `vue` the server render calls. */
export interface VueModule {
  createSSRApp: (options: unknown) => { use: (plugin: unknown) => unknown };
  h: (type: unknown, props?: unknown, children?: unknown) => unknown;
}

/** The part of `vue/server-renderer` the server render calls. */
export interface VueServerRendererModule {
  renderToString: (app: unknown) => Promise<string>;
}

/** The part of `@inertiajs/vue3` the server render calls. */
export interface InertiaVueModule {
  createInertiaApp: (
    options: Record<string, unknown>,
  ) => Promise<{ head?: string[] | undefined; body: string }>;
}

const VUE: OptionalPeerHint = {
  feature: "Rendering a .vue page on the server",
  install: "bun add vue @inertiajs/vue3 @vue/compiler-sfc",
};

/**
 * Load `vue`.
 *
 * @throws {@link OptionalPeerMissingError} When the app does not install it.
 * @internal
 */
export function _loadVue(): Promise<VueModule> {
  return import("vue" as string).catch(optionalPeer("vue", VUE));
}

/**
 * Load `vue/server-renderer`.
 *
 * @throws {@link OptionalPeerMissingError} When the app does not install `vue`.
 * @internal
 */
export function _loadVueServerRenderer(): Promise<VueServerRendererModule> {
  return import("vue/server-renderer" as string).catch(optionalPeer("vue/server-renderer", VUE));
}

/**
 * Load `@inertiajs/vue3`.
 *
 * @throws {@link OptionalPeerMissingError} When the app does not install it.
 * @internal
 */
export function _loadInertiaVue(): Promise<InertiaVueModule> {
  return import("@inertiajs/vue3" as string).catch(
    optionalPeer("@inertiajs/vue3", { ...VUE, install: "bun add @inertiajs/vue3" }),
  );
}

// ── The .vue compiler ───────────────────────────────────────────────────────

/** A `.vue` file split into its blocks, as `parse()` returns it. */
export interface SfcDescriptor {
  scriptSetup: unknown;
  script: unknown;
  template: { content: string } | null;
  styles: { content: string; scoped?: boolean | undefined }[];
  slotted: boolean;
}

/** The part of `@vue/compiler-sfc` the `.vue` plugin calls. */
export interface SfcCompiler {
  parse(
    source: string,
    options: { filename: string },
  ): { descriptor: SfcDescriptor; errors: unknown[] };
  compileScript(
    descriptor: SfcDescriptor,
    options: Record<string, unknown>,
  ): { content: string; bindings?: unknown };
  compileTemplate(options: Record<string, unknown>): { code: string; errors: unknown[] };
  compileStyle(options: Record<string, unknown>): { code: string };
}

/**
 * Load `@vue/compiler-sfc`, which turns `.vue` files into modules for the browser
 * build and for the server.
 *
 * This loads the package's self-contained ES build rather than its entry point. The
 * entry point is a CommonJS build that `require()`s some thirty optional template
 * engines (`pug`, `twing`, …) with nothing around the call, and the bundler refuses
 * an unresolvable `require` that is not handled at the call site — so with that
 * import in this file, `bun zt compile` failed for every Vue app. The ES build has
 * the same compiler with no external imports, and none of what it leaves out is
 * used here: the `.vue` plugin never hands a block to a preprocessor.
 *
 * @throws {@link OptionalPeerMissingError} When the app does not install it.
 * @internal
 */
export function _loadVueCompiler(): Promise<SfcCompiler> {
  return import("@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js" as string).catch(
    optionalPeer("@vue/compiler-sfc/dist/compiler-sfc.esm-browser.js", {
      feature: "Compiling .vue pages",
      install: "bun add @vue/compiler-sfc",
    }),
  );
}
