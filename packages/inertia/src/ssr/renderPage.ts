/**
 * Framework-aware server-side rendering for Inertia pages.
 *
 * Inertia's SSR contract is `{ component, props, url } → { head, body }`. Pages
 * may be authored as React `.tsx` or Vue `.vue` components, so this module
 * detects the framework from the page file on disk and renders with the matching
 * runtime — React via `react-dom/server`, Vue via `@inertiajs/vue3`'s SSR mode +
 * `vue/server-renderer`.
 *
 * Every framework runtime is resolved from the *app's* node_modules (not
 * @zerotal/inertia's), so an app only needs the libraries for the framework it
 * actually uses. Vue `.vue` files additionally require the `.vue` runtime loader
 * registered by InertiaProvider (see `registerVueRuntimeLoader`).
 */

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

async function _renderReact(page: SsrPage, modPath: string): Promise<SsrResult> {
  const pageMod = (await import(modPath)) as { default: unknown };
  if (typeof pageMod.default !== "function") {
    throw new Error(`SSR component "${page.component}" has no default export`);
  }

  // Specifiers via variables so TypeScript does not resolve them: React is an
  // optional peer, and a Vue app type-checking this package must not be asked
  // for modules it will never install. Both results are cast on the next lines.
  const reactSpecifier = "react";
  const reactServerSpecifier = "react-dom/server";

  const [reactMod, serverMod] = await Promise.all([
    import(reactSpecifier) as Promise<{
      createElement: (type: unknown, props: unknown) => unknown;
    }>,
    import(reactServerSpecifier) as Promise<{ renderToString: (element: unknown) => string }>,
  ]);

  const element = reactMod.createElement(pageMod.default, { ...page.props, url: page.url });
  return { head: [], body: serverMod.renderToString(element) };
}
