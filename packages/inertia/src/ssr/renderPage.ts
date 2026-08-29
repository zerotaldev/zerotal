/**
 * Framework-aware server-side rendering for Inertia pages.
 *
 * Inertia's SSR contract is `{ component, props, url } → { head, body }`. Pages
 * may be authored as React `.tsx` or Vue `.vue` components, so this module
 * detects the framework from the page file on disk and renders with the matching
 * runtime — React via `@inertiajs/react` + `react-dom/server`, Vue via
 * `@inertiajs/vue3` + `vue/server-renderer`.
 *
 * Every framework runtime is resolved from the *app's* node_modules (not
 * @zerotal/inertia's), so an app only needs the libraries for the framework it
 * actually uses. Vue `.vue` files additionally require the `.vue` runtime loader
 * registered by InertiaProvider (see `registerVueRuntimeLoader`).
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
  const cwd = process.cwd();

  // Resolve Vue + the Inertia Vue adapter from the app's install.
  const [inertiaVue, serverRenderer, vue, pageMod] = await Promise.all([
    import(Bun.resolveSync("@inertiajs/vue3", cwd)) as Promise<{
      createInertiaApp: (options: Record<string, unknown>) => Promise<SsrResult>;
    }>,
    import(Bun.resolveSync("vue/server-renderer", cwd)) as Promise<{
      renderToString: (app: unknown) => Promise<string>;
    }>,
    import(Bun.resolveSync("vue", cwd)) as Promise<{
      createSSRApp: (options: unknown) => { use: (plugin: unknown) => unknown };
      h: (type: unknown, props: unknown) => unknown;
    }>,
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

/** Minimal shape of the `@inertiajs/react` exports this module uses. */
interface InertiaReactModule {
  App: unknown;
}

/** Minimal shape of the `react` exports this module uses. */
interface ReactModule {
  createElement: (type: unknown, props: unknown) => unknown;
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
 * @throws {@link Error} When the page module has no default export, or the app does
 *   not install `@inertiajs/react`.
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

  // Specifiers via variables so TypeScript does not resolve them: React and its
  // Inertia adapter are *optional* peers, and a Vue app type-checking this package
  // must not be asked for modules it will never install. Both results are cast.
  const reactSpecifier = "react";
  const inertiaReactSpecifier = "@inertiajs/react";

  const [reactMod, inertiaReact] = await Promise.all([
    import(reactSpecifier) as Promise<ReactModule>,
    _importInertiaReact(inertiaReactSpecifier),
  ]);

  let head: string[] = [];

  // `<App>` owns the head manager, the page context and the layout resolution —
  // rendering the page component alone gets the markup and none of the rest.
  // `onHeadUpdate` is called synchronously during render on the server (Inertia's
  // head manager only debounces in a browser), so `head` is populated by the time
  // whichever renderer we were handed to has produced its shell.
  const element = reactMod.createElement(inertiaReact.App, {
    initialPage: page,
    initialComponent: pageMod.default,
    resolveComponent: () => pageMod.default,
    onHeadUpdate: (elements: string[]) => {
      head = elements;
    },
  });

  return { element, head: () => head };
}

/**
 * Import `@inertiajs/react`, turning "not installed" into a sentence that says what
 * to do about it.
 *
 * A bare specifier rather than `Bun.resolveSync(spec, cwd)`, matching how `react`
 * and `react-dom/server` are already loaded here. Node resolution walks up from this
 * module, so a normal flat install finds the app's own copy — and a workspace that
 * keeps the adapter beside the framework instead of at the app root still resolves,
 * which the cwd form does not.
 *
 * The raw failure names a module path and a package, which reads like a bug in the
 * framework rather than a missing dependency in the app — and React SSR did not need
 * this package until `<Head>` started working, so an app upgrading into it meets the
 * error without having changed anything of its own.
 */
async function _importInertiaReact(specifier: string): Promise<InertiaReactModule> {
  try {
    return (await import(specifier)) as InertiaReactModule;
  } catch (err) {
    throw new Error(
      `Inertia SSR needs "@inertiajs/react" installed. Install it with: bun add @inertiajs/react\n` +
        `  Cause: ${(err as Error).message ?? String(err)}`,
    );
  }
}

async function _renderReact(page: SsrPage, modPath: string): Promise<SsrResult> {
  const { element, head } = await _prepareReactRender(page, modPath);

  const reactServerSpecifier = "react-dom/server";
  const serverMod = (await import(reactServerSpecifier)) as {
    renderToString: (element: unknown) => string;
  };

  const html = serverMod.renderToString(element);
  return { head: head(), body: pageScript(page) + rootOpen(true) + html + ROOT_CLOSE };
}
