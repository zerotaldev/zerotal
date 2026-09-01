import { config, RequestContext } from "@zerotal/core";
import type { HttpContext } from "@zerotal/core";
import { assetVersion as coreAssetVersion } from "@zerotal/core/assets";
import { statSync } from "node:fs";
import { InertiaTemplateNotLoadedError, InvalidComponentError } from "./errors.ts";
import { DEFAULT_PAGES_DIR } from "./config.ts";
import { sharedProps } from "./SharedProps.ts";
import { assetVersion } from "./version.ts";
import { resolveProps } from "./props/resolveProps.ts";
import { checkPropBoundary } from "./props/propBoundary.ts";
import { readHistoryFlags } from "./historyState.ts";
import { allSharedKeys } from "./share.ts";
import { recordPage } from "./devtools/recorder.ts";
import { resolvePageModule, renderInertiaPage, _prepareReactRender } from "./ssr/renderPage.ts";
import { injectHead } from "./ssr/head.ts";
import { pageScript, rootOpen, ROOT_CLOSE } from "./pageScript.ts";
import type { PageObject } from "./types.ts";
import type { PageTarget, RenderArgs } from "./pages.ts";

/**
 * A page-render helper — {@link inertia} and {@link inertiaStream} — with the
 * `dynamic` escape hatch beside its checked call signature.
 */
export interface PageRenderer {
  /**
   * Render page `component` with props checked against that page's component.
   *
   * @param component - Page component name/path relative to the pages dir, without extension.
   * @param args - Props for the page; omit when the page requires none.
   */
  <N extends PageTarget>(component: N, ...args: RenderArgs<N>): Promise<void>;

  /**
   * Render a page whose name isn't known at compile time — an error page chosen
   * by status code, a component name from config or the database.
   *
   * A separate function rather than a `string` overload: an overload that
   * accepts every string is matched by every string, which would make the
   * checked signature decorative. This one is greppable and says what it is
   * giving up.
   *
   * @param component - Page component name, resolved at runtime.
   * @param props - Props for the page, unchecked.
   */
  dynamic(component: string, props?: Record<string, unknown>): Promise<void>;
}

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

  // The only point that sees the raw wrappers and the resolved values together;
  // a no-op unless the DevTools recorder opened a recording for this request.
  recordPage(component, merged, resolved.props, resolved.rescuedProps);

  // Everything below this line is page source. Last chance to say so — and the
  // only place that sees the props as they will actually be serialised, after
  // partial reloads and lazy wrappers have decided what is really going out.
  // Development only; a no-op on a served request.
  checkPropBoundary(resolved.props);

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
  // The busted copy was derived from the previous template. Keeping it would
  // serve the old markup for as long as the asset token happened to match.
  _resetBustedTemplate();
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

/** Local `href="/…"` / `src="/…"` JS and CSS URLs that carry no query already. */
const _LOCAL_ASSET_URL = /((?:href|src)=")(\/[^"?]+\.(?:js|css))(")/g;

/**
 * Append a cache-busting `?v=…` to the template's local JS/CSS URLs.
 *
 * **The entry point is not content-hashed and the chunks are**, which is the
 * whole reason this exists. `app.tsx` builds to `/assets/app.js` under that name
 * every time, while `splitting: true` names each chunk after its content — so a
 * rebuild rewrites `app.js` to import `chunk-NEW.js` and prunes `chunk-OLD.js`.
 * A browser holding a cached `app.js` then asks for a chunk that is no longer on
 * disk and gets a 404, from a page that renders fine and a server that is
 * perfectly healthy. The stack says `GET /assets/chunk-….js 404` and names
 * nothing that would lead you here.
 *
 * The template hardcodes `/assets/app.js` rather than calling `asset()`, so the
 * version token the rest of the framework appends never reached it. Two token
 * sources, because the two runtimes invalidate at different moments:
 *
 * - **Dev (`--dev-worker`)**: the file's mtime, read per request. A rebuild
 *   happens without a restart, so a token fixed at boot would be stale exactly
 *   when it matters.
 * - **Everywhere else**: the boot-derived asset version, memoised. A deploy
 *   restarts the process — the pipeline says so in as many words — so the token
 *   is computed once and reused, rather than stat-ing files on every render.
 *
 * Unchanged assets keep a stable URL and stay cached; that is the point of a
 * derived token rather than a random one.
 *
 * @internal
 */
export function _bustAssets(html: string): string {
  if (process.argv.includes("--dev-worker")) {
    const root = `${process.cwd()}/public`;
    return html.replace(_LOCAL_ASSET_URL, (match, pre: string, url: string, post: string) => {
      try {
        const mtime = Math.floor(statSync(`${root}${url}`).mtimeMs);
        return `${pre}${url}?v=${mtime}${post}`;
      } catch {
        return match; // asset not found under public/ — leave the URL untouched
      }
    });
  }

  const token = coreAssetVersion();
  // No token means nothing derived one — an app serving no built assets, or a
  // boot order that has not reached the conventions phase. Leave the URLs alone
  // rather than stamping `?v=` and inventing a second URL for the same file.
  if (!token) return html;
  if (_bustedFor === token) return _bustedHtml;

  _bustedHtml = html.replace(_LOCAL_ASSET_URL, `$1$2?v=${token}$3`);
  _bustedFor = token;
  return _bustedHtml;
}

/** Memoised output of {@link _bustAssets}, keyed on the token it was built with. */
let _bustedHtml = "";
let _bustedFor = "";

/** Drop the memoised template. Tests, and any caller that replaces the template. @internal */
export function _resetBustedTemplate(): void {
  _bustedHtml = "";
  _bustedFor = "";
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
 * @param args - Props passed to the page; may include prop wrappers (`optional`/`defer`/`merge`/…). Checked against the page component's own props, like {@link inertia}.
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
export const inertiaStream: PageRenderer = Object.assign(
  <N extends PageTarget>(component: N, ...args: RenderArgs<N>): Promise<void> =>
    _inertiaStream(component, (args[0] ?? {}) as Record<string, unknown>),
  {
    dynamic: (component: string, props: Record<string, unknown> = {}): Promise<void> =>
      _inertiaStream(component, props),
  },
);

async function _inertiaStream(component: string, props: Record<string, unknown>): Promise<void> {
  const ctx = RequestContext.get();

  if (!_htmlTemplate) {
    throw new InertiaTemplateNotLoadedError();
  }

  if (component.includes("..") || component.startsWith("/")) {
    throw new InvalidComponentError(component, "contains an unsafe path");
  }

  const pageObject = await buildPageObject(component, props);

  // A running Inertia client asks for a page object, not a document — server
  // rendering is about the *first* arrival. Answering an `X-Inertia` XHR with HTML
  // broke client-side navigation to any route that used this: the cold load looked
  // right and the next click did nothing, silently, for someone already in the app.
  if (ctx.request.headers.get("X-Inertia") === "true") {
    _writeInertiaJson(ctx, pageObject);
    return;
  }

  const [prefix = "", suffix = ""] = _bustAssets(_htmlTemplate).split("<!-- @inertia -->");

  const { modPath, framework } = await resolvePageModule(_getPagesDir(), component);
  const encoder = new TextEncoder();
  const responseInit = {
    headers: { "Content-Type": "text/html; charset=utf-8", Vary: "X-Inertia" },
  };

  if (framework === "react") {
    // React's stream is just the component's inner HTML, so Zerotal writes the SSR
    // root around it — the `<script data-page>` first, so the client's boot payload
    // is in the browser's hands before the component finishes arriving.
    //
    // The head tags cost nothing to wait for. `renderToReadableStream` already
    // resolves only once the shell is ready, which this branch already awaited, and
    // `<Head>` reports to the head manager synchronously during that render. So by
    // the time there is a first byte to send, the page's title and meta are known
    // and can go into the `<head>` that is about to be flushed.
    const { element, head } = await _prepareReactRender(pageObject, modPath);

    // Specifier via a variable, not a literal. `react-dom/server` is an *optional*
    // peer — a Vue app never installs it — but a literal `import()` is still
    // resolved by TypeScript, so type-checking a Vue project failed on a module it
    // will never have. The result is cast below; this branch only runs on React.
    const reactServerSpecifier = "react-dom/server";
    const serverMod = (await import(reactServerSpecifier)) as {
      renderToReadableStream(el: unknown): Promise<ReadableStream<Uint8Array>>;
    };

    const reactStream = await serverMod.renderToReadableStream(element);
    const openBlock = injectHead(prefix, head()) + pageScript(pageObject) + rootOpen(true);

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(openBlock));
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
        controller.enqueue(encoder.encode(ROOT_CLOSE + suffix));
        controller.close();
      },
    });

    ctx.response = new Response(readable, responseInit);
    return;
  }

  // Vue: @inertiajs/vue3's SSR mode already emits the full Inertia root — the
  // `<script data-page>` and the `<div id="app">` around the rendered component —
  // so inject it directly in place of the placeholder. Any <Head> tags are spliced
  // into <head>, replacing the template's own title and meta rather than being
  // appended after them (a second <title> is a <title> the browser ignores).
  const { body, head } = await renderInertiaPage(pageObject, modPath, framework);

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(injectHead(prefix, head) + body + suffix));
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
 * @remarks
 * Both arguments are type-checked against the generated page registry
 * (`resources/js/pages.generated.ts`): the component name must be a page that
 * exists, and the props are checked against the props that page's component
 * declares, with `optional`/`defer`/`merge` wrappers unwrapped. Shared props
 * are optional — the framework merges them in. Until the registry is rebuilt,
 * any name and any props compile, as before.
 *
 * @param component - Page component name/path relative to the pages dir, without extension (e.g. `"Users/Index"`).
 * @param args - Props for the page. Values may be plain data, a factory, or prop wrappers (`optional`/`defer`/`merge`/`scroll`/…). Omit when the page needs none.
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
export const inertia: PageRenderer = Object.assign(
  <N extends PageTarget>(component: N, ...args: RenderArgs<N>): Promise<void> =>
    _inertia(component, (args[0] ?? {}) as Record<string, unknown>),
  {
    dynamic: (component: string, props: Record<string, unknown> = {}): Promise<void> =>
      _inertia(component, props),
  },
);

/**
 * The XHR half of the Inertia protocol: a page object as JSON.
 *
 * Shared by {@link inertia} and {@link inertiaStream} rather than written twice,
 * because having it in only one of them is precisely the bug this exists to close.
 * `stream` used to answer every request with `text/html` — the first load looked
 * perfect, which is what a person checks, and the *second* click did nothing,
 * because the running client got a document where it expected a page object.
 *
 * `Vary: X-Inertia` is critical: without it a browser caches the JSON as the HTML
 * for the same URL and shows a raw page object on Back or Refresh.
 *
 * @internal
 */
function _writeInertiaJson(ctx: HttpContext, pageObject: unknown): void {
  ctx.response = new Response(JSON.stringify(pageObject), {
    headers: {
      "Content-Type": "application/json",
      "X-Inertia": "true",
      Vary: "X-Inertia",
    },
  });
}

/** Whether `inertia.ssr` is on. Read per request, so a config change needs no rebuild. */
function _ssrEnabled(): boolean {
  return config.safe<boolean>("inertia.ssr", false) === true;
}

/**
 * The full document with the component rendered into the root.
 *
 * Buffered rather than streamed, because this is `render()`: the caller asked for a
 * page, not for time-to-first-byte. {@link inertiaStream} is the streaming form and
 * stays a per-route choice, since streaming trades TTFB against a shell that arrives
 * in pieces — a decision that belongs to a route rather than to an application.
 *
 * Falls back to the un-rendered document when a component cannot be rendered. A page
 * that fails to server-render still works in the browser, so taking the route down
 * because an *optimisation* failed would make `ssr: true` a liability rather than an
 * improvement. The failure is logged rather than swallowed.
 */
async function _renderedHtml(component: string, pageObject: PageObject): Promise<string> {
  const [prefix = "", suffix = ""] = _bustAssets(_htmlTemplate).split("<!-- @inertia -->");

  try {
    const { modPath, framework } = await resolvePageModule(_getPagesDir(), component);
    const { body, head } = await renderInertiaPage(pageObject, modPath, framework);

    // `body` is already the whole mount root — `renderInertiaPage` returns
    // `pageScript + rootOpen + html + ROOT_CLOSE` for React, and Vue's SSR result
    // carries its own root too. Wrapping it again emits two `<div id="app">` and
    // two `data-page` scripts, and the client hydrates against the wrong one.
    // Composed exactly as `inertiaStream` composes it, so the two cannot drift.
    return injectHead(prefix, head) + body + suffix;
  } catch (error) {
    console.warn(
      `[Inertia] SSR render failed for "${component}", serving the client-rendered ` +
        `document instead: ${(error as Error).message}`,
    );
    return `${prefix}${rootOpen(false)}${ROOT_CLOSE}
    ${pageScript(pageObject)}${suffix}`;
  }
}

async function _inertia(component: string, props: Record<string, unknown>): Promise<void> {
  const ctx = RequestContext.get();
  const isInertiaRequest = ctx.request.headers.get("X-Inertia") === "true";

  const pageObject = await buildPageObject(component, props);

  if (isInertiaRequest) {
    _writeInertiaJson(ctx, pageObject);
    return;
  }

  if (!_htmlTemplate) {
    throw new InertiaTemplateNotLoadedError();
  }

  // `inertia.ssr` renders the component here, on the first load, for every page.
  //
  // That is what the option is named for and what every Inertia adapter does with
  // it — and until 1.13.4 it did not: the flag registered `POST /__ssr` and nothing
  // in the request path consulted it, so an app that set `ssr: true` and read the
  // documentation got exactly the empty root it had before. Server rendering was
  // reachable only by rewriting each route to `Inertia.stream()`, one call site at
  // a time, which is not what a global switch means.
  const html = _ssrEnabled()
    ? await _renderedHtml(component, pageObject)
    : _bustAssets(_htmlTemplate).replace(
        "<!-- @inertia -->",
        // The root is empty, so it is deliberately *not* marked
        // `data-server-rendered`: that flag tells the client to hydrate, and
        // hydrating an empty div is a mismatch on every page. See the "What a
        // crawler sees" section of the Inertia docs for what this contains.
        `${rootOpen(false)}${ROOT_CLOSE}
    ${pageScript(pageObject)}`,
      );

  ctx.response = new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      Vary: "X-Inertia",
    },
  });
}
