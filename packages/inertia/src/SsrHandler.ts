import { config, safeEqual, type HttpContext } from "@zerotal/core";
import { Log } from "@zerotal/core/logger";
import { DEFAULT_PAGES_DIR } from "./config.ts";
import { resolvePageModule, renderInertiaPage } from "./ssr/renderPage.ts";

/** Header carrying the shared secret when the SSR renderer runs off-box. */
export const SSR_SECRET_HEADER = "x-inertia-ssr-secret";

/**
 * Loopback addresses, in the forms Bun reports them.
 *
 * Upstream Inertia runs SSR as a separate process on a private port precisely because this
 * endpoint takes an arbitrary component name and a props bag and does real rendering work
 * with them. Zerotal serves it from the same process, so the equivalent boundary has to be
 * enforced in the handler.
 */
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

interface SsrRequestBody {
  component: string;
  props: Record<string, unknown>;
  url: string;
}

interface SsrResponseBody {
  body: string;
  head: string[];
}

/**
 * POST /__ssr — Inertia server-side rendering endpoint.
 *
 * Accepts the Inertia SSR wire format: { component, props, url }
 * Returns { body, head } — the rendered HTML string and any head injections.
 *
 * The component is resolved from <cwd>/<pagesDir>/<component>.{vue,tsx}
 * (pagesDir defaults to the configured `inertia.pagesDir`, i.e. resources/js/pages)
 * and rendered with the matching framework runtime — Vue (`@inertiajs/vue3` +
 * `vue/server-renderer`) for `.vue` files, React (`react-dom/server`) for `.tsx`.
 *
 * App authors never instantiate this directly — `InertiaProvider` registers the
 * route when SSR is enabled. Turn it on by setting `ssr: true` in `config/inertia.ts`,
 * and install the server renderer for the framework(s) in use.
 *
 * @example
 * ```ts
 * // config/inertia.ts
 * export default InertiaConfig({ ssr: true }); // registers POST /__ssr
 * ```
 */
export class SsrHandler {
  private readonly _pagesDir: string;

  /**
   * @param options - `pagesDir` overrides where page components are resolved from; defaults to `<cwd>/<inertia.pagesDir>`.
   */
  constructor(options: { pagesDir?: string } = {}) {
    this._pagesDir =
      options.pagesDir ?? `${process.cwd()}/${config.safe("inertia.pagesDir", DEFAULT_PAGES_DIR)}`;
  }

  /**
   * Handle a `POST /__ssr` request: validate the `{ component, props, url }` body,
   * reject path traversal, render the page with the matching framework runtime, and
   * respond with `{ body, head }` (or a `4xx`/`500` JSON error).
   *
   * @param http - The request context; its `response` is set as a side effect.
   * @internal Invoked by the router, not called directly.
   */
  async handle(http: HttpContext): Promise<void> {
    if (!SsrHandler.isAuthorized(http)) {
      http.response = Response.json({ message: "Not found." }, { status: 404 });
      return;
    }

    let body: SsrRequestBody;
    try {
      body = (await http.request.json()) as SsrRequestBody;
    } catch {
      http.response = Response.json({ message: "Invalid JSON body." }, { status: 400 });
      return;
    }

    const { component, props, url } = body;

    if (!component) {
      http.response = Response.json({ message: "component is required." }, { status: 422 });
      return;
    }

    // Reject path traversal
    if (component.includes("..") || component.startsWith("/")) {
      http.response = Response.json({ message: "Invalid component name." }, { status: 422 });
      return;
    }

    try {
      // Detect the framework from the page file (.vue → Vue, .tsx → React) and
      // render with the matching runtime.
      const { modPath, framework } = await resolvePageModule(this._pagesDir, component);
      const { body, head } = await renderInertiaPage({ component, props, url }, modPath, framework);

      const response: SsrResponseBody = { body, head };
      http.response = Response.json(response);
    } catch (err) {
      // The detail goes to the log, not the response. Reflecting it made the endpoint a
      // filesystem-path oracle: a render failure named the absolute module path it tried.
      // Logging is best-effort — an error path that can itself throw is worse than the
      // leak it replaced, and the logger is container-resolved.
      const detail = (err as Error).message ?? String(err);
      try {
        Log.error("[Inertia] SSR render failed", { component, error: detail });
      } catch {
        console.error(`[Inertia] SSR render failed for "${component}": ${detail}`);
      }
      http.response = Response.json({ message: "SSR render failed." }, { status: 500 });
    }
  }

  /**
   * Whether this request may reach the SSR renderer.
   *
   * Two ways in, and nothing else:
   * - the peer is on loopback — the normal case, where the SSR client is the app's own
   *   Node/Bun renderer talking to itself;
   * - the request carries {@link SSR_SECRET_HEADER} matching `inertia.ssrSecret`, for a
   *   renderer running on another host.
   *
   * Everyone else gets a 404 rather than a 403, because whether this route exists is not
   * information a stranger needs. Without the check the endpoint was unauthenticated,
   * unthrottled, and cheap CPU amplification for anyone who found it.
   *
   * @param http - The request context.
   * @returns `true` when the request is permitted.
   */
  static isAuthorized(http: HttpContext): boolean {
    const secret = config.safe("inertia.ssrSecret", "");
    if (secret) {
      const presented = http.request.headers.get(SSR_SECRET_HEADER);
      if (presented && safeEqual(presented, secret)) return true;
    }
    const ip = http.ip();
    return ip !== undefined && ip !== null && LOOPBACK.has(ip);
  }
}
