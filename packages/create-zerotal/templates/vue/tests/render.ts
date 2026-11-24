/**
 * Build one page component to HTML, the way the browser's first render will — and throw
 * whatever it throws.
 *
 * The same idea as `renderPage()` from `@zerotal/inertia/testing`, which renders React
 * pages: the route tests prove the server named a page and handed it props, and this
 * proves the page can be built from them. It is not a DOM — `onMounted` does not run and
 * nothing clicks — so it catches a template that reads a prop that is not there, not
 * behaviour after paint.
 *
 * Renders through Inertia's own app, so `usePage()`, `<Head>` and a persistent layout
 * (`defineOptions({ layout })`) behave as they do in the browser.
 */
import { createInertiaApp } from "@inertiajs/vue3";
import { createSSRApp, h, type Component } from "vue";
import { renderToString } from "vue/server-renderer";
import { route } from "zerotal/routes";

export async function renderPage(
  component: Component,
  props: Record<string, unknown>,
  options: { shared?: Record<string, unknown>; url?: string } = {},
): Promise<string> {
  const page = {
    component: "page",
    props: { ...options.shared, ...props },
    url: options.url ?? "/",
    version: null,
    clearHistory: false,
    encryptHistory: false,
  };

  let failure: unknown;
  // The options are the server-render form `createInertiaApp` takes; its types describe
  // the browser form first, so they are given as that.
  const appOptions = {
    page,
    render: renderToString,
    resolve: () => component,
    setup({ App, props: appProps, plugin }: { App: Component; props: object; plugin: never }) {
      const app = createSSRApp({ render: () => h(App, appProps) }).use(plugin);
      // Templates call `route()` as a global property — app.tsx installs it the same way.
      app.config.globalProperties.route = route;
      // Vue reports a render error and carries on by default; a test wants it thrown.
      app.config.errorHandler = (error) => {
        failure ??= error;
      };
      return app;
    },
  };
  const result = (await createInertiaApp(
    appOptions as unknown as Parameters<typeof createInertiaApp>[0],
  )) as unknown as { body: string };

  if (failure) throw failure;
  return result.body;
}
