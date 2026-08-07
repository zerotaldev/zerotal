import { ServiceProvider } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import type { ConfigManager } from "@zerotal/core/config";
import { Tracer } from "../Tracer.ts";
import { installEventBridge } from "../bridge.ts";
import { _setGlobalTracer, _getGlobalTracer } from "../withSpan.ts";
import { NoopExporter } from "../exporters/NoopExporter.ts";
import { ConsoleExporter } from "../exporters/ConsoleExporter.ts";
import { OtlpExporter } from "../exporters/OtlpExporter.ts";
import type { SpanExporter } from "../exporters/SpanExporter.ts";
import type { TelemetryConfigShape } from "../config.ts";

declare module "@zerotal/core" {
  interface ContainerBindings {
    telemetry: Tracer;
  }
}

export class TelemetryProvider extends ServiceProvider {
  static override provides = ["telemetry"] as const;
  static override environments: AppEnvironment[] = ["web", "console", "test", "repl"];

  private _disposeBridge: (() => void) | undefined = undefined;

  override onRegister(): void {
    this.app.container.singleton("telemetry", () => {
      const config = this.app.container.makeSync("config") as ConfigManager;
      const telConfig = config.get<TelemetryConfigShape>("telemetry", {});

      const exporterType = telConfig.exporter ?? "noop";
      const serviceName = telConfig.serviceName ?? "zerotal-app";
      const serviceVersion = telConfig.serviceVersion ?? "0.0.0";

      let exporter: SpanExporter;
      switch (exporterType) {
        case "console":
          exporter = new ConsoleExporter();
          break;
        case "otlp": {
          const otlpOpts: import("../exporters/OtlpExporter.ts").OtlpExporterOptions = {
            serviceName,
            serviceVersion,
          };
          if (telConfig.otlp?.endpoint) otlpOpts.endpoint = telConfig.otlp.endpoint;
          if (telConfig.otlp?.headers) otlpOpts.headers = telConfig.otlp.headers;
          exporter = new OtlpExporter(otlpOpts);
          break;
        }
        case "noop":
        default:
          exporter = new NoopExporter();
      }

      const tracerOpts: import("../Tracer.ts").TracerOptions = { exporter };
      if (telConfig.minDurationMs !== undefined) tracerOpts.minDurationMs = telConfig.minDurationMs;
      return new Tracer(tracerOpts);
    });
  }

  override async onBooted(): Promise<void> {
    const tracer = (await this.app.container.make("telemetry")) as Tracer;
    _setGlobalTracer(tracer);
    // Forward framework events (HTTP, DB, queue, scheduler, boot) into the trace
    // pipeline so an OTLP backend sees the same signal the devtools panel does.
    this._disposeBridge = installEventBridge(tracer);
  }

  override async onStopping(): Promise<void> {
    this._disposeBridge?.();
    this._disposeBridge = undefined;
    await _getGlobalTracer()?.shutdown();
    _setGlobalTracer(undefined);
  }
}
