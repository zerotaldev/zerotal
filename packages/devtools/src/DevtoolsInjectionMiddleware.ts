import type { NextFn, HttpContext } from "@zerotal/core";
import { BaseMiddleware, tryCurrentApp } from "@zerotal/core";
import { traceStore } from "./TraceStore.ts";
import { traceChannels } from "./tracing.ts";
import { devtoolsAuthorized, devtoolsSettings } from "./enabled.ts";
import { buildFrameworkMap } from "./map.ts";
import { activityFeed } from "./activity.ts";
import {
  _DEVTOOLS_ASSET_PREFIX,
  _devtoolsAssetResponse,
  _loadDevtoolsAssets,
  type DevtoolsBundleName,
} from "./clientAssets.ts";
import { _panelHtml } from "./panel.ts";

// ── Browser bundles ───────────────────────────────────────────────────────────
// The in-page panel and the standalone dashboard ship prebuilt (see clientAssets.ts)
// and are served at hashed URLs under `/__zerotal/devtools/assets/`. The two paths
// below are where they lived before they had a hash, kept for anything that names
// them by hand.

/** Where a bundle is served under a name that never changes. */
const UNHASHED: Record<string, DevtoolsBundleName> = {
  "/__zerotal/devtools/client.js": "client",
  "/__zerotal/devtools/dashboard.js": "dashboard",
};

/** A bundle at its unhashed path: revalidated on every load, as it always was. */
async function _unhashedBundle(name: DevtoolsBundleName): Promise<Response> {
  const asset = (await _loadDevtoolsAssets())[name];
  return new Response(asset?.body ?? `/* [Zerotal DevTools] ${name} bundle unavailable */`, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

/** @internal */
export interface DevtoolsInjectionOptions {
  // reserved for future use
}

/** Everything the inspector serves lives under here, and is gated as one thing. */
const DEVTOOLS_PREFIX = "/__zerotal/devtools";

// ── SSE subscribers ───────────────────────────────────────────────────────────

const _sseClients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const _enc = new TextEncoder();

function _ssePublishRaw(frame: string): void {
  if (_sseClients.size === 0) return;
  const chunk = _enc.encode(frame);
  for (const ctrl of _sseClients) {
    try {
      ctrl.enqueue(chunk);
    } catch {
      _sseClients.delete(ctrl);
    }
  }
}

function _ssePublish(data: unknown): void {
  _ssePublishRaw(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * End every open stream, in an order the browser recognises as an ending.
 *
 * Dropping the set is not enough: the response body is a chunked stream, so a
 * process that exits with one half-written leaves the browser holding a
 * truncated body and logging `ERR_INCOMPLETE_CHUNKED_ENCODING`. Under
 * `serve --dev` that is every save. Closing the controller writes the
 * terminating chunk, and `EventSource` then reconnects on its own timer without
 * an error in the console.
 */
function _sseCloseAll(): void {
  for (const ctrl of _sseClients) {
    try {
      ctrl.close();
    } catch {
      // Already closed or errored — the stream is over either way.
    }
  }
  _sseClients.clear();
}

/** How often to write a comment frame keeping an idle stream alive. */
const SSE_HEARTBEAT_MS = 25_000;

/**
 * Bridge the trace store to connected panels. Called by {@link DevtoolsProvider}
 * on boot rather than at module scope — subscribing on import would tie the
 * stream to whichever store existed at import time, before the provider has
 * built the one the app's config asks for.
 *
 * @returns A disposer that unsubscribes and closes connected clients.
 *
 * @internal
 */
export function startDevtoolsStream(): () => void {
  const unsubscribe = traceStore().subscribe((trace) => {
    if (trace === null) _ssePublish({ type: "clear" });
    else _ssePublish({ type: "trace", data: trace });
  });

  // A comment frame, which SSE readers ignore. Without it a stream that goes
  // quiet can be dropped by an intermediary with nothing written to notice it
  // by, and the panel keeps reporting a connection it no longer has. Unref'd so
  // it never holds the process open.
  const heartbeat = setInterval(() => {
    _ssePublishRaw(":\n\n");
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref?.();

  return () => {
    unsubscribe();
    clearInterval(heartbeat);
    _sseCloseAll();
  };
}

// ── Middleware — devtools API routes only ─────────────────────────────────────
//
// All request tracing is handled by tracing.ts subscribing to FrameworkEvents.
// This middleware only serves the devtools panel endpoints.

export class DevtoolsInjectionMiddleware extends BaseMiddleware<DevtoolsInjectionOptions> {
  protected options: DevtoolsInjectionOptions = {};

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const { pathname } = http.url;

    // Everything under the prefix is one secret. The stream, the trace JSON, the
    // dashboard, and the panel bundle all expose the same request data, so they
    // are gated together and before anything is read — checking per endpoint is
    // how one of them ends up ungated.
    if (pathname.startsWith(DEVTOOLS_PREFIX)) {
      if (!(await devtoolsAuthorized(http.request))) {
        // 404, not 403: outside development the honest answer to an
        // unauthenticated stranger is that there is nothing here.
        return new Response("Not Found", { status: 404 });
      }
    }

    if (pathname === "/__zerotal/devtools/api/traces") {
      return Response.json(traceStore().all());
    }

    // The framework map: read fresh, never cached. The registries are small and
    // static, and a cached map is one that disagrees with the app the moment a
    // provider registers a route late.
    if (pathname === "/__zerotal/devtools/api/map") {
      const app = tryCurrentApp();
      if (!app) return Response.json({ error: "No application in scope" }, { status: 503 });
      return Response.json({
        ...buildFrameworkMap(app, devtoolsSettings().redact),
        activity: activityFeed(),
      });
    }

    if (pathname === "/__zerotal/devtools/api/channels") {
      return Response.json(traceChannels());
    }

    if (pathname === "/__zerotal/devtools/api/clear" && http.request.method === "POST") {
      traceStore().clear();
      return new Response(null, { status: 204 });
    }

    if (pathname === "/__zerotal/devtools/sse") {
      let ctrl!: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          ctrl = c;
          _sseClients.add(ctrl);
          // The opening frame carries everything the panel needs at first paint
          // rather than making it ask three more times: the channel descriptors,
          // so a package's tab is there before that package's next entry; the
          // store's capacity, so the list trims to the depth the app asked for;
          // and the editor settings, so a `file:line` is a link on the first
          // trace rather than the second.
          const settings = devtoolsSettings();
          ctrl.enqueue(
            _enc.encode(
              `data: ${JSON.stringify({
                type: "history",
                data: traceStore().all(),
                channels: traceChannels(),
                capacity: traceStore().capacity,
                editor: settings.editor,
                editorPathMap: settings.editorPathMap,
              })}\n\n`,
            ),
          );
        },
        cancel() {
          _sseClients.delete(ctrl);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    if (pathname.startsWith(_DEVTOOLS_ASSET_PREFIX)) {
      return await _devtoolsAssetResponse(http.request);
    }

    const unhashed = UNHASHED[pathname];
    if (unhashed) return await _unhashedBundle(unhashed);

    if (pathname === "/__zerotal/devtools" || pathname === "/__zerotal/devtools/") {
      const dashboard = (await _loadDevtoolsAssets()).dashboard;
      return new Response(_panelHtml(dashboard?.path ?? "/__zerotal/devtools/dashboard.js"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Nothing else under the prefix; fall through to the app and mark the page.
    const response = await next();
    return response instanceof Response ? await _markPage(http, response) : response;
  }
}

/**
 * Tell the browser half that a server half exists, by injecting one `<meta>`.
 *
 * The client used to find out by asking — a `GET api/channels` on every page
 * load, treating a 404 as "not here". That failed closed, which was the point,
 * but it meant a production page fetched a URL that was *designed* to 404 and
 * the browser logged it. A reviewer reading that console sees development
 * tooling running on a live site; the honest reading of a deliberate 404 and a
 * leaked debug endpoint look identical from the outside.
 *
 * Inverting it removes the request rather than hiding it. The provider is gated
 * on the environment, so in production this middleware is not in the stack at
 * all: no marker is written, the client finds none, and it makes **zero**
 * requests instead of one per page load. It also saves the round trip in
 * development, where the panel now mounts on the first frame rather than after
 * a fetch resolves.
 *
 * Absence stays the safe default — an app served by something that never runs
 * this middleware gets no panel, which is the same answer the probe gave.
 */
async function _markPage(http: HttpContext, response: Response): Promise<Response> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("text/html")) return response;

  // Same gate as the endpoints: a marker on a page whose viewer could not use
  // the endpoints anyway would only advertise that they are there.
  if (!(await devtoolsAuthorized(http.request))) return response;

  const html = await response.text();
  // The body is written afresh either way, so the original's `Content-Length` no longer
  // describes it: with the marker in, it is short by the marker's length.
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  const init = { status: response.status, statusText: response.statusText, headers };
  const head = html.indexOf("</head>");
  if (head === -1) return new Response(html, init);

  const marker = `<meta name="zerotal-devtools" content="${DEVTOOLS_PREFIX}">`;
  return new Response(html.slice(0, head) + marker + html.slice(head), init);
}
