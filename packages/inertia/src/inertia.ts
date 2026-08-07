import { config, RequestContext } from "@zerotal/core";
import { statSync } from "node:fs";
import { InertiaTemplateNotLoadedError, InvalidComponentError } from "./errors.ts";
import { DEFAULT_PAGES_DIR } from "./config.ts";
import { sharedProps } from "./SharedProps.ts";
import { assetVersion } from "./version.ts";
import { resolveProps } from "./props/resolveProps.ts";
import { readHistoryFlags } from "./historyState.ts";
import { allSharedKeys } from "./share.ts";
import { resolvePageModule, renderInertiaPage } from "./ssr/renderPage.ts";
import type { PageObject } from "./types.ts";

/**
 * Build the full Inertia page object for the current request: merges shared props, runs the v3
 * prop-resolution pipeline (partial reloads, lazy/optional/always, defer, merge, once), and attaches
 * history-encryption flags and the shared-prop key list.
 *
 * @param component - Page component name (path relative to the pages dir, without extension), e.g. `"Users/Index"`.
 * @param props - Raw props from the controller; may include prop wrappers (`optional`/`defer`/`merge`/`scroll`/…) that the resolver evaluates.
 * @returns The serialisable {@link PageObject} embedded into the HTML (first load) or returned as JSON (XHR visits).
 * @internal Shared plumbing behind {@link inertia} and {@link inertiaStream}; app authors call those instead.
 */
export async function buildPageObject(
  component: string,
  props: Record<string, unknown>,
): Promise<PageObject> {
  const ctx = RequestContext.get();
  const merged = { ...sharedProps(), ...props };
  const resolved = await resolveProps(merged, ctx.request.headers, component);

  const page: PageObject = {
    component,
    props: resolved.props,
    url: ctx.url.pathname + (ctx.url.search || ""),
    version: assetVersion(),
  };

  if (resolved.deferredProps) page.deferredProps = resolved.deferredProps;
  if (resolved.mergeProps) page.mergeProps = resolved.mergeProps;
  if (resolved.prependProps) page.prependProps = resolved.prependProps;
  if (resolved.deepMergeProps) page.deepMergeProps = resolved.deepMergeProps;
  if (resolved.matchPropsOn) page.matchPropsOn = resolved.matchPropsOn;
  if (resolved.scrollProps) page.scrollProps = resolved.scrollProps;
  if (resolved.onceProps) page.onceProps = resolved.onceProps;
  if (resolved.rescuedProps) page.rescuedProps = resolved.rescuedProps;

  const sharedPresent = allSharedKeys().filter((k) => k in resolved.props);
  if (sharedPresent.length) page.sharedProps = sharedPresent;

  const history = readHistoryFlags();
  if (history.encryptHistory) page.encryptHistory = true;
  if (history.clearHistory) page.clearHistory = true;

  return page;
}

// Loaded once at boot by InertiaProvider.onBooting()
// Never read from disk per-request
let _htmlTemplate = "";
let _pagesDir = "";

/**
 * Cache the root HTML template (the `resources/app.html` shell containing the
 * `<!-- @inertia -->` placeholder). Called once by `InertiaProvider` during boot
 * so `inertia()` / `inertiaStream()` never touch disk per request.
 *
 * @param html - The full HTML document read from the configured `htmlTemplate`.
 * @internal
 */
export function _setHtmlTemplate(html: string): void {
  _htmlTemplate = html;
}

/**
 * The cached HTML template (empty string until `InertiaProvider` boots).
 *
 * @returns The template string, or `""` if not yet loaded.
 * @internal
 */
export function _getHtmlTemplate(): string {
  return _htmlTemplate;
}

/**
 * Override the pages directory (absolute path) used to resolve page modules for
 * SSR / streaming. Normally derived from `inertia.pagesDir` config; set explicitly
 * by `InertiaProvider` at boot.
 *
 * @internal
 */
export function _setPagesDir(dir: string): void {
  _pagesDir = dir;
}

/**
 * The absolute pages directory used to locate page components, falling back to
 * `<cwd>/<inertia.pagesDir>` (default `resources/js/pages`).
 *
 * @internal
 */
export function _getPagesDir(): string {
  return _pagesDir || `${process.cwd()}/${config.safe("inertia.pagesDir", DEFAULT_PAGES_DIR)}`;
}

/**
 * In dev (`--dev-worker`) append a cache-busting `?v=<mtime>` to local JS/CSS
 * asset URLs in the served HTML, so the browser fetches a freshly-rebuilt
 * bundle instead of a stale cached copy.
 *
 * The token is the asset file's modification time: unchanged assets keep a
 * stable URL (and stay cached), while a rebuild changes the URL and forces a
 * re-fetch. No-op in production, where assets are served as-is.
 *
 * @internal
 */
function _devBustAssets(html: string): string {
  if (!process.argv.includes("--dev-worker")) return html;
  const root = `${process.cwd()}/public`;
  return html.replace(
    /((?:href|src)=")(\/[^"?]+\.(?:js|css))(")/g,
    (match, pre: string, url: string, post: string) => {
      try {
        const mtime = Math.floor(statSync(`${root}${url}`).mtimeMs);
        return `${pre}${url}?v=${mtime}${post}`;
      } catch {
        return match; // asset not found under public/ — leave the URL untouched
      }
    },
  );
}

/**
 * Render an Inertia page server-side and return a streaming HTML Response.
 *
 * Splits the HTML template at `<!-- @inertia -->` and writes the server-rendered
 * component between the prefix and suffix, improving TTFB over `inertia()` since
 * the browser can start parsing the `<head>` before the component is sent.
 *
 * Framework-aware: React pages (`.tsx`) stream chunk-by-chunk via
 * `react-dom/server`'s `renderToReadableStream`; Vue pages (`.vue`) are rendered
 * to a string via `@inertiajs/vue3`'s SSR mode (head tags injected into
 * `<head>`) and flushed after the prefix. The component is resolved from
 * `<cwd>/<inertia.pagesDir>/<component>.{vue,tsx}` (defaults to `resources/js/pages`).
 *
 * Like {@link inertia}, this reads the current request from `RequestContext` and
 * writes the streaming `Response` onto `ctx.response` as a side effect (returns `void`).
 * Reach it from a controller via `Inertia.stream(...)`.
 *
 * @param component - Page component name (path relative to the pages dir, no extension), e.g. `"Posts/Show"`.
 * @param props - Props passed to the page; may include prop wrappers (`optional`/`defer`/`merge`/…).
 * @throws {@link InertiaTemplateNotLoadedError} When the HTML template has not been loaded (InertiaProvider not registered).
 * @throws {@link InvalidComponentError} When the component name contains path-traversal sequences.
 *
 * @example
 * ```ts
 * async show(http: HttpContext): Promise<void> {
 *   const post = await Post.findOrFail(http.params.id);
 *   return Inertia.stream('Posts/Show', { post });
 * }
 * ```
 */
export async function inertiaStream(
  component: string,
  props: Record<string, unknown> = {},
): Promise<void> {
  const ctx = RequestContext.get();

  if (!_htmlTemplate) {
    throw new InertiaTemplateNotLoadedError();
  }

  if (component.includes("..") || component.startsWith("/")) {
    throw new InvalidComponentError(component, "contains an unsafe path");
  }

  const pageObject = await buildPageObject(component, props);

  const [prefix = "", suffix = ""] = _devBustAssets(_htmlTemplate).split("<!-- @inertia -->");

  const { modPath, framework } = await resolvePageModule(_getPagesDir(), component);
  const encoder = new TextEncoder();
  const responseInit = {
    headers: { "Content-Type": "text/html; charset=utf-8", Vary: "X-Inertia" },
  };

  if (framework === "react") {
    // React's stream is just the component's inner HTML, so Zerotal wraps it in
    // the app root and serialises the pageObject into the data-page script.
    const safeJson = JSON.stringify(pageObject)
      .replace(/</g, "\\u003c")
      .replace(/>/g, "\\u003e")
      .replace(/&/g, "\\u0026")
      .replace(/\//g, "\\/");
    const openTag = `<div id="app">`;
    const closeBlock = `</div>\n    <script type="application/json" data-page="app">${safeJson}</script>`;

    // Specifiers via variables, not literals. React is an *optional* peer — a Vue
    // app never installs it — but a literal `import("react")` is still resolved by
    // TypeScript, so type-checking a Vue project failed on modules it will never
    // have. Both results are cast below, so nothing is lost by hiding the
    // specifier from the resolver; this branch only runs when the app is React.
    const reactSpecifier = "react";
    const reactServerSpecifier = "react-dom/server";

    const [reactMod, serverMod, pageMod] = await Promise.all([
      import(reactSpecifier) as Promise<{ createElement(type: unknown, props: unknown): unknown }>,
      import(reactServerSpecifier) as Promise<{
        renderToReadableStream(el: unknown): Promise<ReadableStream<Uint8Array>>;
      }>,
      import(modPath) as Promise<{ default: unknown }>,
    ]);

    const element = reactMod.createElement(pageMod.default, pageObject.props);
    const reactStream = await serverMod.renderToReadableStream(element);

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(prefix + openTag));
        const reader = reactStream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
        } finally {
          reader.releaseLock();
        }
        controller.enqueue(encoder.encode(closeBlock + suffix));
        controller.close();
      },
    });

    ctx.response = new Response(readable, responseInit);
    return;
  }

  // Vue: @inertiajs/vue3's SSR mode already emits the full
  // `<div id="app" data-page="…">…</div>` root (the complete pageObject is
  // serialised into data-page), so inject it directly in place of the
  // placeholder — no extra app-div wrapper or data-page script. Any <Head>
  // tags are injected into <head>.
  const { body, head } = await renderInertiaPage(pageObject, modPath, framework);
  const prefixWithHead =
    head.length > 0 ? prefix.replace("</head>", `${head.join("")}</head>`) : prefix;

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(prefixWithHead + body + suffix));
      controller.close();
    },
  });

  ctx.response = new Response(readable, responseInit);
}

/**
 * Render an Inertia page from a controller action — the primary way to return a
 * page from Zerotal's Inertia adapter.
 *
 * You name a client-side page component and hand it a bag of props; Inertia takes
 * care of showing that component with those props, so you build a React/Vue SPA
 * without writing a separate JSON API. The component name is a path (relative to
 * the configured pages dir, without extension) resolving to a page under
 * `resources/js/pages`, e.g. `"Users/Index"` → `resources/js/pages/Users/Index.tsx`.
 *
 * @remarks
 * Reads the current request from `RequestContext` (AsyncLocalStorage) — no `ctx`
 * argument needed — and assigns the outgoing `Response` to `ctx.response` as a side
 * effect, hence the `Promise<void>` return. The two response shapes it produces are
 * what "Inertia" means on the wire:
 *
 * - **First / full-page load** (no `X-Inertia` header): the full HTML shell from
 *   the app template with the page object serialised into a `<script data-page>`
 *   tag (HTML-escaped so it can't break out of the script). The client-side
 *   Inertia runtime boots from it.
 * - **Subsequent visits** (`X-Inertia: true` XHR): a JSON body containing only the
 *   page object, carrying `X-Inertia: true` and `Vary: X-Inertia` (the latter stops
 *   the browser from caching JSON as HTML and rendering raw JSON on Back/Refresh).
 *
 * Before responding, props are run through the Inertia v3 resolution pipeline (see
 * {@link buildPageObject} / `resolveProps`): the app's shared props (auth, flash,
 * errors, plus anything from {@link share}) are merged in; **partial reloads** honour
 * the client's `only`/`except` headers so a visit can refetch just a few props; and
 * prop wrappers control evaluation — plain values are sent as-is, functions and
 * `optional`/`lazy`/`defer` props are evaluated only when actually included (deferred
 * ones load in a follow-up request), while `always`, `merge`/`deepMerge`, `scroll`,
 * and `once` props are advertised so the client merges rather than replaces.
 *
 * For streaming SSR (better TTFB) use {@link inertiaStream} instead; to force a
 * full-page/external redirect use {@link location}.
 *
 * @param component - Page component name/path relative to the pages dir, without extension (e.g. `"Users/Index"`).
 * @param props - Props for the page. Values may be plain data or prop wrappers (`optional`/`defer`/`merge`/`scroll`/…). Defaults to `{}`.
 * @returns A promise that resolves once `ctx.response` has been set (no value).
 * @throws {@link InertiaTemplateNotLoadedError} On a full-page load when the HTML template has not been loaded (InertiaProvider not registered).
 *
 * @example
 * ```ts
 * // app/controllers/UserController.ts
 * async index(http: HttpContext): Promise<void> {
 *   const users = await User.query().orderBy('name').get();
 *   return inertia('Users/Index', { users });
 * }
 * ```
 */
export async function inertia(
  component: string,
  props: Record<string, unknown> = {},
): Promise<void> {
  const ctx = RequestContext.get();
  const isInertiaRequest = ctx.request.headers.get("X-Inertia") === "true";

  const pageObject = await buildPageObject(component, props);

  if (isInertiaRequest) {
    // Subsequent XHR navigation — JSON only
    // Vary: X-Inertia is CRITICAL — prevents browser from caching
    // JSON as HTML, which would show raw JSON on browser Back/Refresh
    ctx.response = new Response(JSON.stringify(pageObject), {
      headers: {
        "Content-Type": "application/json",
        "X-Inertia": "true",
        Vary: "X-Inertia",
      },
    });
    return;
  }

  if (!_htmlTemplate) {
    throw new InertiaTemplateNotLoadedError();
  }

  // Inject pageObject into the HTML template.
  // Escape characters that would break HTML parsing inside a script tag.
  // </script> → <\/script>, < → <, > → >
  const safeJson = JSON.stringify(pageObject)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\//g, "\\/");

  const html = _devBustAssets(_htmlTemplate).replace(
    "<!-- @inertia -->",
    `<div id="app"></div>\n    ` +
      `<script type="application/json" data-page="app">${safeJson}</script>`,
  );

  ctx.response = new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      Vary: "X-Inertia",
    },
  });
}
