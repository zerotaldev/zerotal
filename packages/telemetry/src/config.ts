import { deepMerge } from "@zerotal/core";

export interface TelemetryConfigShape {
  /**
   * Exporter backend.
   * - `'noop'`    - discards all spans (default when telemetry is not configured)
   * - `'console'` - prints to stdout, useful in development
   * - `'otlp'`    - sends to an OTLP HTTP endpoint
   */
  exporter?: "noop" | "console" | "otlp";

  /** Only relevant when `exporter` is `'otlp'`. */
  otlp?: {
    endpoint?: string;
    headers?: Record<string, string>;
  };

  /** Service name sent as a resource attribute. Defaults to `APP_NAME` env var or `'zerotal-app'`. */
  serviceName?: string;

  /** Service version. Defaults to `APP_VERSION` env var or `'0.0.0'`. */
  serviceVersion?: string;

  /** Drop spans shorter than this many milliseconds. Default: 0 (keep all). */
  minDurationMs?: number;
}

const defaults: TelemetryConfigShape = {
  exporter: "noop",
  serviceName: "zerotal-app",
};

export function TelemetryConfig(options: Partial<TelemetryConfigShape> = {}): TelemetryConfigShape {
  return deepMerge(defaults, options);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    telemetry: TelemetryConfigShape;
  }
}
