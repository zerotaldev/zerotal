import type { NextFn } from "@zerotal/core";
import type { HttpContext } from "@zerotal/core";
import { BaseMiddleware } from "@zerotal/core";
import { _getGlobalTracer } from "../withSpan.ts";

export interface TelemetryOptions {
  /**
   * Custom function to derive a span name from the request.
   * Default: `"${method} ${pathname}"`.
   */
  spanName?: ((ctx: HttpContext) => string) | undefined;
}

/**
 * Creates a server-kind root span for every incoming HTTP request.
 *
 * Standard `http.*` attributes are set automatically:
 *   - `http.method`, `http.url`, `http.route`, `http.status_code`
 *   - `http.request_id`
 *
 * Any child spans created with `withSpan()` inside route handlers or
 * downstream middleware will automatically attach to this root span.
 *
 * Register near the top of the middleware stack, after `LoggerMiddleware`:
 *   `app.use([LoggerMiddleware, TelemetryMiddleware, ...])`
 */
export class TelemetryMiddleware extends BaseMiddleware<TelemetryOptions> {
  protected options: TelemetryOptions = {};

  async handle(http: HttpContext, next: NextFn): Promise<Response | void> {
    const tracer = _getGlobalTracer();
    if (!tracer) return next();

    const method = http.request.method.toUpperCase();
    const path = http.url.pathname;
    const name = this.options.spanName?.(http) ?? `${method} ${path}`;

    await tracer.withSpan(
      name,
      async (span) => {
        span.setAttributes({
          "http.method": method,
          "http.url": http.url.href,
          "http.request_id": http.requestId,
        });

        await next();

        const status = http.response?.status ?? 0;
        span.setAttribute("http.status_code", status);

        if (http.url.pathname !== path) {
          // pathname changed — record the matched route
          span.setAttribute("http.route", http.url.pathname);
        }

        if (status >= 500) span.setStatus("error", `HTTP ${status}`);
        else span.setStatus("ok");
      },
      { kind: "server" },
    );

    return http.response;
  }
}
