/**
 * `@zerotal/inertia/testing` — render a page component the way a browser will.
 *
 * ## The gap this fills
 *
 * `assertInertia("home")` proves the *server* named a component and handed it props.
 * It proves nothing about the component. A page can throw on its first paint — a
 * destructured prop that is not there, a layout callback reading `page.props` that
 * the callback never receives — and the route still answers `200` with a correct
 * payload, because the throw happens in a browser that the test never opened.
 *
 * An app shipped a blank `/mail` to production with **614 passing tests**. Every one
 * of them asserted a value or a status code. The console said
 * `Cannot read properties of undefined (reading 'search')`, from a layout callback,
 * on a page whose Inertia payload was perfect.
 *
 * {@link renderPage} proves one thing and one thing only: that the component tree
 * can be built without throwing. That is precisely the thing nothing else checks,
 * and it is about forty lines an app should not have to write.
 *
 * ## What it does not do
 *
 * It is not a DOM. Nothing here clicks, and `useEffect` does not run — this is
 * `renderToString`, so it exercises the render pass. For assertions about behaviour
 * after paint, use the browser harness in `@zerotal/testing/browser`.
 *
 * @example
 * ```ts
 * import { renderPage } from "@zerotal/inertia/testing";
 * import Home from "../resources/js/pages/home.tsx";
 *
 * test("home renders", async () => {
 *   await renderPage(Home, { title: "Hello" });
 * });
 * ```
 *
 * @module
 */
import { _prepareComponentRender } from "./ssr/renderPage.ts";

/** Extras a page render may need beyond its own props. */
export interface RenderPageOptions {
  /**
   * Shared props the app's `Inertia.share()` would have added — `auth`, `flash`,
   * `errors`, and anything else a layout reads. A page that destructures one of
   * these throws without it, which is a real failure but rarely the one you are
   * testing for, so seed the shape your app actually shares.
   */
  shared?: Record<string, unknown> | undefined;
  /** The URL the page believes it is at. Some layouts branch on it. Default `"/"`. */
  url?: string | undefined;
  /** The component name recorded in the page object. Default `"page"`. */
  component?: string | undefined;
}

/**
 * Render an Inertia page component to HTML, throwing whatever it throws.
 *
 * Renders through `@inertiajs/react`'s own `<App>`, so `usePage()`, `<Head>` and a
 * persistent layout all behave as they do in the browser — a layout attached with
 * `Page.layout` is resolved and rendered too, which is the case worth catching.
 *
 * @param component - The page component, imported directly.
 * @param props - The props the server would send. Merged over `options.shared`.
 * @param options - Shared props, URL and component name.
 * @returns The rendered HTML, for a `toContain` if you want one.
 * @throws Whatever the component throws, unchanged — the point is that it surfaces.
 *
 * @example
 * ```ts
 * const html = await renderPage(Profile, { user }, { shared: { auth: { user } } });
 * expect(html).toContain(user.name);
 * ```
 */
export async function renderPage(
  component: unknown,
  props: Record<string, unknown> = {},
  options: RenderPageOptions = {},
): Promise<string> {
  const page = {
    component: options.component ?? "page",
    props: { ...(options.shared ?? {}), ...props },
    url: options.url ?? "/",
    version: "test",
  };

  const { element } = await _prepareComponentRender(page, component);

  // Specifier via a variable: `react-dom/server` is an optional peer, and a Vue app
  // type-checking this package must not be asked for a module it will never install.
  const reactServerSpecifier = "react-dom/server";
  const serverMod = (await import(reactServerSpecifier)) as {
    renderToString: (element: unknown) => string;
  };

  return serverMod.renderToString(element);
}
