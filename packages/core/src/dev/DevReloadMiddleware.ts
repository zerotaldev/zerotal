/**
 * Dev-only HTML response injector.
 *
 * Registered globally by `Application.enableDevWs()` (i.e. only under
 * `serve --dev-worker`), it rewrites every `text/html` response to inject:
 *
 *   1. A tiny live-reload client that connects to the `/__dev/ws` WebSocket and
 *      reloads the page whenever the DevOrchestrator rebuilds assets.
 *   2. Any snippets registered via {@link registerDevHtmlSnippet} — this is how
 *      `@zerotal/devtools` auto-injects its in-page panel.
 *
 * This generalises what Inertia previously did in its own HTML template, so the
 * reload client now works for *any* view layer (flow, flow-ui, JSX, plain HTML)
 * with zero app wiring. Pages that already embed a `/__dev/ws` client (e.g. an
 * Inertia template) are detected and not double-injected.
 */
import type { NextFn } from "../pipeline/types.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";
import { BaseMiddleware } from "../middleware/BaseMiddleware.ts";
import { DEV_RELOAD_CLIENT } from "./reloadClient.ts";

/** Produces an HTML fragment to inject before `</body>` for the given request. */
export type DevHtmlSnippet = (ctx: HttpContext) => string;

interface RegisteredSnippet {
  name: string;
  fn: DevHtmlSnippet;
}

const _snippets: RegisteredSnippet[] = [];

/**
 * Register an HTML snippet to inject into dev HTML responses (before `</body>`).
 * Idempotent by `name`, so providers can register on every boot safely. Return
 * an empty string from `fn` to skip injection for a given request (e.g. to avoid
 * injecting into your own tool's pages).
 *
 * @example
 * registerDevHtmlSnippet("devtools", (ctx) =>
 *   ctx.url.pathname.startsWith("/__zerotal") ? "" : `<script src="/__zerotal/devtools/client.js"></script>`,
 * );
 */
export function registerDevHtmlSnippet(name: string, fn: DevHtmlSnippet): void {
  if (_snippets.some((s) => s.name === name)) return;
  _snippets.push({ name, fn });
}

/** @internal — reset the registry (tests only). */
export function _resetDevHtmlSnippets(): void {
  _snippets.length = 0;
}

// The live-reload client is only meaningful when the /__dev/ws endpoint exists
// (i.e. under `serve --dev-worker`). Snippets, by contrast, inject in any dev
// mode — so devtools can share this middleware even under a plain `serve`.
let _reloadClientActive = false;

/** Enable injection of the live-reload client. Called by `Application.enableDevWs()`. */
export function setDevReloadClientActive(active: boolean): void {
  _reloadClientActive = active;
}

export class DevReloadMiddleware extends BaseMiddleware {
  protected options: {} = {};

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const res = await next();
    if (!(res instanceof Response)) return res;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return res;

    let html: string;
    try {
      html = await res.clone().text();
    } catch {
      return res; // unreadable / streaming body — leave it alone
    }

    let injection = "";
    // Inject the reload client only under dev-worker, and not when the page
    // already embeds one (e.g. an Inertia template).
    if (_reloadClientActive && !html.includes("/__dev/ws")) injection += DEV_RELOAD_CLIENT;
    for (const snippet of _snippets) {
      try {
        injection += snippet.fn(http);
      } catch {
        /* a broken snippet must never break the page */
      }
    }
    if (!injection) return res;

    const body = html.includes("</body>")
      ? html.replace("</body>", `${injection}\n</body>`)
      : html + injection;

    const headers = new Headers(res.headers);
    headers.delete("content-length"); // body changed — let the runtime recompute
    return new Response(body, { status: res.status, statusText: res.statusText, headers });
  }
}
