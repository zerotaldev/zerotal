/**
 * The satellite → devtools handshake, tested against a real container rather
 * than a stub.
 *
 * Every bridge detects devtools with a synchronous `tryMake('devtools.trace')`.
 * While the binding was registered as an unresolved singleton, that call
 * returned `undefined` in a real app and every bridge silently skipped its
 * devtools branch — the whole contribution path was dead, and the suites that
 * covered it handed the sink to the bridge directly so they never noticed.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { Application, HttpContext, RequestContext, FrameworkEvents } from "@zerotal/core";
import { DevtoolsProvider } from "./provider/DevtoolsProvider.ts";
import { traceChannels } from "./tracing.ts";
import { _setTraceStore } from "./TraceStore.ts";
import type { TraceSink } from "./tracing.ts";

const ORIGINAL_ENV = Bun.env["APP_ENV"];

async function bootDev(): Promise<Application> {
  Bun.env["APP_ENV"] = "development";
  Application._resetInstance();
  const app = Application.create({ env: "web" })
    .register([DevtoolsProvider as never])
    .useConfig({ devtools: { dbPath: null } } as never);
  await app.boot();
  return app;
}

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete Bun.env["APP_ENV"];
  else Bun.env["APP_ENV"] = ORIGINAL_ENV;
  Application._resetInstance();
  _setTraceStore(null);
  FrameworkEvents.clear();
});

describe("devtools.trace binding", () => {
  it("is visible to the synchronous lookup every bridge uses", async () => {
    const app = await bootDev();

    const sink = app.container.tryMake("devtools.trace" as never) as TraceSink | undefined;

    expect(sink).toBeDefined();
    expect(typeof sink!.record).toBe("function");
    expect(typeof sink!.channel).toBe("function");
    await app.stop({ exit: false });
  });

  it("lets a package declare a channel and record against a request", async () => {
    const app = await bootDev();
    const sink = app.container.tryMake("devtools.trace" as never) as TraceSink;

    // Exactly what a bridge does: declare on install, record on each event.
    sink.channel({ id: "widgets", label: "Widgets", badge: "kind" });
    const ctx = HttpContext.fake("http://localhost/widgets");
    await RequestContext.run(ctx, async () => {
      sink.record(ctx, "widgets", { kind: "created" });
    });

    expect(traceChannels().map((c) => c.id)).toContain("widgets");
    await app.stop({ exit: false });
  });

  it("is absent in production, so a bridge skips its devtools branch", async () => {
    Bun.env["APP_ENV"] = "production";
    Application._resetInstance();
    const app = Application.create({ env: "web" }).register([DevtoolsProvider as never]);
    await app.boot();

    expect(app.container.tryMake("devtools.trace" as never)).toBeUndefined();
    await app.stop({ exit: false });
  });
});
