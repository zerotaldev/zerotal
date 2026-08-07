import { describe, it, expect, afterEach } from "bun:test";
import { FrameworkEvents, AppBooted, RequestHandled } from "@zerotal/core";
import { Tracer } from "./Tracer.ts";

// The bridge subscribes to "QueryExecuted" by kind; a same-named local class stands
// in so telemetry needs no dependency on @zerotal/orm.
class QueryExecuted {
  constructor(
    readonly sql: string,
    readonly bindings: unknown[],
    readonly startMs: number,
    readonly durationMs: number,
    readonly rowCount: number,
    readonly ctx: object | undefined,
  ) {}
}
import { installEventBridge } from "./bridge.ts";
import type { SpanExporter } from "./exporters/SpanExporter.ts";
import type { SpanData } from "./Span.ts";

class CapturingExporter implements SpanExporter {
  spans: SpanData[] = [];
  async export(span: SpanData): Promise<void> {
    this.spans.push(span);
  }
}

describe("telemetry event bridge", () => {
  afterEach(() => FrameworkEvents.clear());

  it("records AppBooted as a completed span with the right duration and attributes", async () => {
    const exporter = new CapturingExporter();
    const dispose = installEventBridge(new Tracer({ exporter }));

    FrameworkEvents.emit(new AppBooted(42, "web", 5));
    await Bun.sleep(1); // let the async export flush

    expect(exporter.spans).toHaveLength(1);
    const span = exporter.spans[0]!;
    expect(span.name).toBe("app.boot");
    expect(span.attributes["app.environment"]).toBe("web");
    expect(span.attributes["app.providers"]).toBe(5);
    expect((span.endMs ?? 0) - span.startMs).toBe(42);
    dispose();
  });

  it("maps a 5xx RequestHandled to an error span", async () => {
    const exporter = new CapturingExporter();
    const dispose = installEventBridge(new Tracer({ exporter }));

    const ctx = {
      request: { method: "GET" },
      url: { pathname: "/boom" },
      response: { status: 500 },
    };
    FrameworkEvents.emit(new RequestHandled(ctx, 0, 12));
    await Bun.sleep(1);

    expect(exporter.spans).toHaveLength(1);
    expect(exporter.spans[0]!.name).toBe("http.request");
    expect(exporter.spans[0]!.kind).toBe("server");
    expect(exporter.spans[0]!.status.code).toBe("error");
    dispose();
  });

  it("stops recording after dispose()", async () => {
    const exporter = new CapturingExporter();
    const dispose = installEventBridge(new Tracer({ exporter }));
    dispose();

    FrameworkEvents.emit(new QueryExecuted("SELECT 1", [], 0, 5, 1, undefined));
    await Bun.sleep(1);

    expect(exporter.spans).toHaveLength(0);
  });
});
