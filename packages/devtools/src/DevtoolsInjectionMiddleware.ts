import { fileURLToPath } from "node:url";
import type { NextFn, HttpContext } from "@zerotal/core";
import { BaseMiddleware, tryCurrentApp } from "@zerotal/core";
import { traceStore } from "./TraceStore.ts";
import { traceChannels } from "./tracing.ts";
import { devtoolsAuthorized, devtoolsSettings } from "./enabled.ts";
import { buildFrameworkMap } from "./map.ts";
import { activityFeed } from "./activity.ts";

// ── Injected browser client bundle ────────────────────────────────────────────
// The in-page devtools panel is bundled for the browser on first request and
// cached for the process lifetime (dev only — the provider is a no-op in prod).
let _clientJs: string | null = null;

async function _buildClientJs(): Promise<string> {
  if (_clientJs !== null) return _clientJs;
  try {
    const entry = fileURLToPath(new URL("./client-auto.ts", import.meta.url));
    const result = await Bun.build({ entrypoints: [entry], target: "browser", minify: true });
    const out = result.outputs[0];
    _clientJs =
      result.success && out ? await out.text() : "/* [Zerotal DevTools] client build failed */";
  } catch (error) {
    _clientJs = `/* [Zerotal DevTools] client build error: ${String(error)} */`;
  }
  return _clientJs;
}

/** The standalone dashboard bundle — the same panel, mounted full-window. */
let _dashboardJs: string | null = null;

async function _buildDashboardJs(): Promise<string> {
  if (_dashboardJs !== null) return _dashboardJs;
  try {
    const entry = fileURLToPath(new URL("./dashboard-auto.ts", import.meta.url));
    const result = await Bun.build({ entrypoints: [entry], target: "browser", minify: true });
    const out = result.outputs[0];
    _dashboardJs =
      result.success && out ? await out.text() : "/* [Zerotal DevTools] dashboard build failed */";
  } catch (error) {
    _dashboardJs = `/* [Zerotal DevTools] dashboard build error: ${String(error)} */`;
  }
  return _dashboardJs;
}

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

    if (pathname === "/__zerotal/devtools/client.js") {
      return new Response(await _buildClientJs(), {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    if (pathname === "/__zerotal/devtools/dashboard.js") {
      return new Response(await _buildDashboardJs(), {
        headers: {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    if (pathname === "/__zerotal/devtools" || pathname === "/__zerotal/devtools/") {
      const html = await Bun.file(new URL("./panel.html", import.meta.url)).text();
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return next();
  }
}
