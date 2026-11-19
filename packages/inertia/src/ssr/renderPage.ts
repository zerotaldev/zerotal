/**
 * Framework-aware server-side rendering for Inertia pages.
 *
 * Inertia's SSR contract is `{ component, props, url } → { head, body }`. Pages
 * may be authored as React `.tsx` or Vue `.vue` components, so this module
 * detects the framework from the page file on disk and renders with the matching
 * runtime — React via `@inertiajs/react` + `react-dom/server`, Vue via
 * `@inertiajs/vue3` + `vue/server-renderer`.
 *
 * Every framework runtime is an optional peer, loaded through `peers.ts`, so an app
 * only installs the libraries for the framework it actually uses, and one without
 * them is told what to install. Vue `.vue` files additionally need the `.vue` runtime
 * loader (see `registerVueRuntimeLoader`).
 *
 * ## Why React goes through `<App>` rather than the page component
 *
 * The obvious React render is `createElement(PageComponent, props)`, and it was
 * what this module did. It produces correct-looking body HTML and silently drops
 * every `<Head>` tag on the page, because `<Head>` renders nothing — it reports
 * its children to a head manager it reads from context, and nothing had put one
 * there. A page that set a title, a description and an og: card contributed all
 * three to a manager that did not exist, and the server sent the template's
 * `<head>` exactly as written. Nothing failed and nothing logged; the page was
 * perfect in a browser, where React had run, and a link pasted into a chat was a
 * grey rectangle with a domain in it.
 *
 * `@inertiajs/react`'s `<App>` is what installs the head manager, and
 * `onHeadUpdate` is the public prop it reports through. So React renders the same
 * component tree the browser will, and the tags come back.
 *
 * @module
 */
import { pageScript, rootOpen, ROOT_CLOSE } from "../pageScript.ts";
import {
  _loadInertiaReact,
  _loadInertiaVue,
  _loadReact,
  _loadReactDomServer,
  _loadVue,
  _loadVueServerRenderer,
} from "../peers.ts";
import type { InertiaReactModule, ReactModule } from "../peers.ts";
import { _requireVueRuntimeLoader } from "../vuePlugin.ts";

export type Framework = "vue" | "react";

export interface SsrPage {
  component: string;
  props: Record<string, unknown>;
  url: string;
}

export interface SsrResult {
  head: string[];
  body: string;
}

/**
 * A React page rendered far enough to hand to a renderer, but not yet rendered.
 *
 * The head tags are only known *after* the element has been through
 * `react-dom/server`, because `<Head>` reports them during render. Callers render
 * `element`, then read `head()`. Reading it earlier is not an error, it is just
 * empty — which is exactly the failure this shape exists to make impossible to
 * write by accident.
 */
export interface PreparedReactRender {
  /** The `<App>` element, ready for any `react-dom/server` entry point. */
  element: unknown;
  /** The head tags collected during the render. Empty until `element` has been rendered. */
  head: () => string[];
}

/**
 * Resolve a page component's module path and which frontend framework it targets,
 * preferring a `.vue` SFC when present and falling back to `.tsx`.
 *
 * @param pagesDir - Absolute path to the pages directory.
 * @param component - Page component name/path (no extension).
 * @returns The absolute module path and its detected {@link Framework}.
 * @internal
 */
export async function resolvePageModule(
  pagesDir: string,
  component: string,
): Promise<{ modPath: string; framework: Framework }> {
  const vuePath = `${pagesDir}/${component}.vue`;
  if (await Bun.file(vuePath).exists()) {
    return { modPath: vuePath, framework: "vue" };
  }
  return { modPath: `${pagesDir}/${component}.tsx`, framework: "react" };
}

/**
 * Render an Inertia page to an HTML body string + head tags on the server.
 * `modPath` is an absolute path to the page module; `framework` selects the
 * rendering runtime (use {@link resolvePageModule} to derive both).
 *
 * The `body` is the complete Inertia SSR root — the `<script data-page>` tag and
 * the `<div id="app">` around the rendered component — for both frameworks. That
 * is the shape the Inertia SSR contract specifies and the shape a template drops
 * in whole; React used to return the bare component HTML instead, which is why
 * the two branches had to be spliced differently by every caller.
 *
 * @param page - The `{ component, props, url }` page to render.
 * @param modPath - Absolute path to the page component module.
 * @param framework - Which runtime to render with (`"vue"` or `"react"`).
 * @returns The rendered `{ head, body }` HTML.
 * @internal
 */
export async function renderInertiaPage(
  page: SsrPage,
  modPath: string,
  framework: Framework,
): Promise<SsrResult> {
  if (framework === "vue") return _renderVue(page, modPath);
  return _renderReact(page, modPath);
}

async function _renderVue(page: SsrPage, modPath: string): Promise<SsrResult> {
  // The page is a `.vue` file, which Bun's runtime cannot import until the compiler is
  // registered as a loader: without one, Bun imports it as its own file path and the
  // page "renders" as that string. Boot registers the loader when it can; this says
  // what is missing when it could not.
  await _requireVueRuntimeLoader();

  const [inertiaVue, serverRenderer, vue, pageMod] = await Promise.all([
    _loadInertiaVue(),
    _loadVueServerRenderer(),
    _loadVue(),
    import(modPath) as Promise<{ default: unknown }>,
  ]);

  const { createSSRApp, h } = vue;

  const result = await inertiaVue.createInertiaApp({
    page,
    render: (app: unknown) => serverRenderer.renderToString(app),
    resolve: () => pageMod.default,
    setup({ App, props, plugin }: { App: unknown; props: unknown; plugin: unknown }) {
      return createSSRApp({ render: () => h(App, props) }).use(plugin);
    },
  });

  return { head: result.head ?? [], body: result.body };
}

/**
 * Build the `<App>` element for a React page and wire a head collector to it.
 *
 * Exported because streaming SSR needs the element rather than a string: it hands
 * it to `renderToReadableStream` and reads the head back once the shell resolves.
 *
 * @param page - The `{ component, props, url }` page to render.
 * @param modPath - Absolute path to the page component module.
 * @returns The element and a `head()` accessor, valid after the element is rendered.
 * @throws {@link Error} When the page module has no default export.
 * @throws {@link OptionalPeerMissingError} When the app does not install `react` or
 *   `@inertiajs/react`.
 * @internal
 */
export async function _prepareReactRender(
  page: SsrPage,
  modPath: string,
): Promise<PreparedReactRender> {
  const pageMod = (await import(modPath)) as { default: unknown };
  if (pageMod.default === undefined || pageMod.default === null) {
    throw new Error(`SSR component "${page.component}" has no default export`);
  }
  return _prepareComponentRender(page, pageMod.default);
}

/**
 * Wrap an already-resolved page component in Inertia's `<App>`.
 *
 * Split out so a test can render a component it imported directly, without a pages
 * directory or a module path — see `@zerotal/inertia/testing`.
 *
 * @internal
 */
function _elementFor(
  reactMod: ReactModule,
  inertiaReact: InertiaReactModule,
  page: SsrPage,
  component: unknown,
): PreparedReactRender {
  let head: string[] = [];

  // `<App>` owns the head manager, the page context and the layout resolution —
  // rendering the page component alone gets the markup and none of the rest.
  // `onHeadUpdate` is called synchronously during render on the server (Inertia's
  // head manager only debounces in a browser), so `head` is populated by the time
  // whichever renderer we were handed to has produced its shell.
  const element = reactMod.createElement(inertiaReact.App, {
    initialPage: page,
    initialComponent: component,
    resolveComponent: () => component,
    onHeadUpdate: (elements: string[]) => {
      head = elements;
    },
  });

  return { element, head: () => head };
}

/**
 * Build the `<App>` element for a component the caller already has.
 *
 * `@inertiajs/react` is loaded alongside `react` because its `<App>` is what makes
 * `<Head>` work on the server. React SSR did not need it until then, so an app
 * upgrading into it can meet the missing-package error without having changed
 * anything of its own; the error names the package and the command that adds it.
 *
 * @param page - The `{ component, props, url }` page to render.
 * @param component - The page component itself.
 * @throws {@link OptionalPeerMissingError} When the app does not install `react` or
 *   `@inertiajs/react`.
 * @internal
 */
export async function _prepareComponentRender(
  page: SsrPage,
  component: unknown,
): Promise<PreparedReactRender> {
  const [reactMod, inertiaReact] = await Promise.all([_loadReact(), _loadInertiaReact()]);
  return _elementFor(reactMod, inertiaReact, page, component);
}

async function _renderReact(page: SsrPage, modPath: string): Promise<SsrResult> {
  const { element, head } = await _prepareReactRender(page, modPath);
  const serverMod = await _loadReactDomServer();
  const html = serverMod.renderToString(element);
  return { head: head(), body: pageScript(page) + rootOpen(true) + html + ROOT_CLOSE };
}
