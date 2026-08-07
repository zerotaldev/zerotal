import { FrameworkEvents } from "@zerotal/core";
import type { AppBooted, RequestHandled, RequestFailed } from "@zerotal/core";
import type { Tracer } from "./Tracer.ts";

/** Extract the HTTP-readable fields from the opaque HttpContext object. */
function _http(raw: object) {
  return raw as {
    response?: { status?: number };
    request?: { method?: string };
    url?: { pathname?: string };
  };
}

/**
 * Bridge the core lifecycle events (`AppBooted`, `RequestHandled`, `RequestFailed`)
 * into the trace pipeline as completed spans. Telemetry subscribes to core; core
 * never depends on telemetry.
 *
 * Feature packages forward their own signal (DB queries, jobs, scheduled tasks)
 * through their own telemetry bridge, which resolves this tracer from the container
 * when telemetry is installed. Telemetry therefore knows nothing about feature
 * packages, and adding one requires no change here.
 *
 * Returns a function that removes every subscription (call in `onStopping()`).
 */
export function installEventBridge(tracer: Tracer): () => void {
  const unsubs: Array<() => void> = [
    // ── Application lifecycle ──────────────────────────────────────────────────
    FrameworkEvents.on<AppBooted>("AppBooted", (e) => {
      void tracer.recordCompleted("app.boot", e.durationMs, {
        attributes: { "app.environment": e.environment, "app.providers": e.providerCount },
      });
    }),

    // ── HTTP ───────────────────────────────────────────────────────────────────
    FrameworkEvents.on<RequestHandled>("RequestHandled", (e) => {
      const c = _http(e.ctx);
      const status = c.response?.status ?? 0;
      void tracer.recordCompleted("http.request", e.durationMs, {
        kind: "server",
        attributes: {
          "http.method": c.request?.method ?? "?",
          "http.route": c.url?.pathname ?? "?",
          "http.status_code": status,
        },
        status: status >= 500 ? "error" : "ok",
      });
    }),

    FrameworkEvents.on<RequestFailed>("RequestFailed", (e) => {
      const c = _http(e.ctx);
      void tracer.recordCompleted("http.request", e.durationMs, {
        kind: "server",
        attributes: {
          "http.method": c.request?.method ?? "?",
          "http.route": c.url?.pathname ?? "?",
          "http.status_code": e.status,
        },
        status: "error",
        errorMessage: e.error,
      });
    }),
  ];

  return () => {
    for (const unsub of unsubs) unsub();
  };
}
