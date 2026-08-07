/**
 * Server-side JSX views: the secure-by-default JSX runtime (`SafeHtml`), the
 * page/layout authoring helpers, and the optional file-route resolver that
 * renders `.tsx` pages automatically. All of this lives in core (the
 * `@zerotal/core/view` subpath) so `ctx.view()` and the components it renders
 * come from a single package. JSX children are auto-escaped by default; use
 * {@link safe}/{@link Raw} to opt specific HTML out of escaping.
 *
 * @example
 * ```tsx
 * import { defineLayout } from "@zerotal/core/view";
 *
 * const wrap = defineLayout(AppLayout);
 * export const Home = wrap<{ name: string }>(({ name }) => (
 *   <main><h1>Hello {name}</h1></main>
 * ));
 * ```
 *
 * @packageDocumentation
 */
import { SafeHtml, Fragment, markViewComponent } from "./jsx-runtime.ts";
export { SafeHtml, Fragment };
export type { FC, Children } from "./jsx-runtime.ts";

export { VIEW_COMPONENT_SYMBOL, VIEW_COMPONENT_PROP } from "./jsx-runtime.ts";
// Tested opt-in feature (see router/ViewLayout.test.ts) awaiting docs — kept public.
export { registerViewFileRouteResolver } from "./FileRouteResolver.ts";

import type { HttpContext } from "../pipeline/HttpContext.ts";

/**
 * Declare a page handler: a function of `(ctx, params)` returning HTML (or a
 * string / promise thereof), tagged via {@link markViewComponent} so the router
 * treats it as a view component. Returns the same function with its type intact.
 *
 * @example
 * ```tsx
 * import { definePage } from '@zerotal/core/view';
 *
 * export const Show = definePage<{ id: string }>((ctx, { id }) => (
 *   <article><h1>Post {id}</h1></article>
 * ));
 * ```
 */
export function definePage<P extends Record<string, unknown> = Record<string, unknown>>(
  component: (ctx: HttpContext, params: P) => SafeHtml | string | Promise<SafeHtml | string>,
): typeof component {
  return markViewComponent(component);
}

/**
 * Wrap a pre-rendered HTML string as SafeHtml so it passes through
 * renderChildren() without being escaped again.
 *
 * Use when you have HTML that was produced outside JSX (e.g. a Markdown
 * renderer) and you want to embed it safely into a JSX tree.
 *
 * @example
 * import { safe } from '@zerotal/core';
 * <article>{safe(markdownToHtml(post.body))}</article>
 */
export function safe(html: string): SafeHtml {
  return new SafeHtml(html);
}

/**
 * Escape a raw value for safe use in a context where SafeHtml is not
 * available — e.g. template-literal fallbacks or attribute values built
 * outside JSX. Not needed for normal JSX children (auto-escaped by default).
 *
 * @example
 * const attr = esc(user.name);  // safe inside a raw string template
 */
export function esc(val: unknown): string {
  // Native, SIMD-optimized escaping (same set as the JSX runtime's escHtml).
  return Bun.escapeHTML(String(val ?? ""));
}

/**
 * Component that injects a raw HTML string without escaping.
 * Prefer dangerouslySetInnerHTML on intrinsic elements for single-element
 * cases; use Raw when you need it as a composable component.
 *
 * @example
 * import { Raw } from '@zerotal/core';
 * <div><Raw html={markdownToHtml(post.body)} /></div>
 */
export function Raw({ html }: { html: string }): SafeHtml {
  return new SafeHtml(html);
}

// Re-export SafeHtml type for use in controller return-type annotations.
export type { SafeHtml as Html };

/**
 * Bind a shared layout component to page components, eliminating the need
 * to wrap every page in `<Layout>...</Layout>` manually.
 *
 * Returns a `wrap` factory.  Call `wrap(PageComponent)` to produce a new
 * component that renders `PageComponent` inside the layout.  All props from
 * both the layout (except `children`) and the page are merged — TypeScript
 * enforces that callers supply every required field.
 *
 * @example
 * // resources/views/layouts/AppLayout.tsx
 * export function AppLayout({ children, title }: { children: unknown; title: string }) {
 *   return (
 *     <html>
 *       <head><title>{title} — My App</title></head>
 *       <body>{children}</body>
 *     </html>
 *   );
 * }
 *
 * // resources/views/About.tsx
 * import { defineLayout } from '@zerotal/core';
 * import { AppLayout }    from './layouts/AppLayout.tsx';
 *
 * const wrap = defineLayout(AppLayout);
 *
 * export const AboutPage = wrap<{ title: string }>(({ title }) => (
 *   <main>
 *     <h1>{title}</h1>
 *     <p>We build things.</p>
 *   </main>
 * ));
 *
 * // In routes/index.ts:
 * Router.view('/about', AboutPage, { title: 'About Us' });
 */
export function defineLayout<LP extends Record<string, unknown>>(
  Layout: (props: LP & { children?: unknown }) => SafeHtml,
): <PP extends Record<string, unknown> = Record<string, never>>(
  Page: (props: PP & { children?: unknown }) => SafeHtml,
) => (props: LP & PP) => SafeHtml {
  return function wrap<PP extends Record<string, unknown>>(
    Page: (props: PP & { children?: unknown }) => SafeHtml,
  ): (props: LP & PP) => SafeHtml {
    return (props: LP & PP): SafeHtml => {
      const children = Page(props as PP);
      return Layout({ ...(props as unknown as LP), children });
    };
  };
}
