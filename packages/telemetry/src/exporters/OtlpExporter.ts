import type { SpanExporter } from "./SpanExporter.ts";
import type { SpanData, SpanKind } from "../Span.ts";

export interface OtlpExporterOptions {
  /** OTLP HTTP/JSON endpoint. Default: `'http://localhost:4318/v1/traces'`. */
  endpoint?: string;
  /** Extra headers (e.g. `{ 'x-honeycomb-team': '<api-key>' }`). */
  headers?: Record<string, string>;
  /** Service name sent as a resource attribute. */
  serviceName?: string;
  /** Service version sent as a resource attribute. */
  serviceVersion?: string;
}

const SPAN_KIND: Record<SpanKind, number> = {
  internal: 1,
  server: 2,
  client: 3,
  producer: 4,
  consumer: 5,
};

const STATUS_CODE: Record<string, number> = {
  unset: 0,
  ok: 1,
  error: 2,
};

/**
 * Sends completed spans to an OTLP-compatible backend over HTTP/JSON.
 *
 * Compatible with OpenTelemetry Collector, Jaeger, Honeycomb, Grafana Tempo,
 * and any service that accepts the OTLP trace JSON format.
 *
 * @example
 * new OtlpExporter({
 *   endpoint:    'https://api.honeycomb.io/v1/traces',
 *   headers:     { 'x-honeycomb-team': env('HONEYCOMB_API_KEY') },
 *   serviceName: 'my-api',
 * })
 */
export class OtlpExporter implements SpanExporter {
  private readonly _endpoint: string;
  private readonly _headers: Record<string, string>;
  private readonly _serviceName: string;
  private readonly _serviceVer: string;

  constructor(options: OtlpExporterOptions = {}) {
    this._endpoint = options.endpoint ?? "http://localhost:4318/v1/traces";
    this._headers = options.headers ?? {};
    this._serviceName = options.serviceName ?? "zerotal-app";
    this._serviceVer = options.serviceVersion ?? "0.0.0";
  }

  async export(span: SpanData): Promise<void> {
    const body = this._buildPayload(span);
    try {
      await fetch(this._endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this._headers,
        },
        body: JSON.stringify(body),
      });
    } catch {
      // Silently drop — telemetry failures must not affect the application
    }
  }

  private _buildPayload(span: SpanData): object {
    const toNanoStr = (ms: number) => (BigInt(ms) * 1_000_000n).toString();

    const otlpAttrs = (attrs: Record<string, string | number | boolean>) =>
      Object.entries(attrs).map(([key, value]) => ({
        key,
        value:
          typeof value === "string"
            ? { stringValue: value }
            : typeof value === "number"
              ? Number.isInteger(value)
                ? { intValue: value }
                : { doubleValue: value }
              : { boolValue: value },
      }));

    return {
      resourceSpans: [
        {
          resource: {
            attributes: otlpAttrs({
              "service.name": this._serviceName,
              "service.version": this._serviceVer,
            }),
          },
          scopeSpans: [
            {
              scope: { name: "@zerotal/telemetry" },
              spans: [
                {
                  traceId: span.traceId,
                  spanId: span.spanId,
                  parentSpanId: span.parentId ?? "",
                  name: span.name,
                  kind: SPAN_KIND[span.kind] ?? 1,
                  startTimeUnixNano: toNanoStr(span.startMs),
                  endTimeUnixNano: toNanoStr(span.endMs ?? span.startMs),
                  attributes: otlpAttrs(span.attributes),
                  status: {
                    code: STATUS_CODE[span.status.code] ?? 0,
                    message: span.status.message ?? "",
                  },
                  events: span.events.map((e) => ({
                    name: e.name,
                    timeUnixNano: toNanoStr(e.timeMs),
                    attributes: otlpAttrs(
                      (e.attributes ?? {}) as Record<string, string | number | boolean>,
                    ),
                  })),
                },
              ],
            },
          ],
        },
      ],
    };
  }
}
