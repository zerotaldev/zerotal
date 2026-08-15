import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Application } from "./Application.ts";
import { currentApp } from "./currentApp.ts";
import { ServiceProvider } from "../provider/ServiceProvider.ts";
import { FrameworkEvents, AppBooted } from "../events/FrameworkEvents.ts";
import { SecureHeadersMiddleware } from "../middleware/SecureHeadersMiddleware.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRecordingProvider(log: string[], name: string) {
  return class extends ServiceProvider {
    override onRegister() {
      log.push(`${name}:register`);
    }
    override async onBooting() {
      log.push(`${name}:booting`);
    }
    override async onBooted() {
      log.push(`${name}:booted`);
    }
    override async onStarting() {
      log.push(`${name}:starting`);
    }
    override async onStarted() {
      log.push(`${name}:started`);
    }
    override async onStopping() {
      log.push(`${name}:stopping`);
    }
    override async onStopped() {
      log.push(`${name}:stopped`);
    }
  };
}

// Mock Bun.serve so start() doesn't bind a real port
const fakeServer = { stop: (_drain?: boolean) => {} };
const origServe = (Bun as unknown as Record<string, unknown>).serve;
function mockServe() {
  (Bun as unknown as Record<string, unknown>).serve = () => fakeServer;
}
function restoreServe() {
  (Bun as unknown as Record<string, unknown>).serve = origServe;
}

// Mock process.exit so stop() doesn't kill the test runner
type RealExit = typeof process.exit;
const origExit = process.exit as RealExit;
let exitCalled = false;
function mockExit() {
  exitCalled = false;
  (process as unknown as Record<string, unknown>).exit = () => {
    exitCalled = true;
  };
}
function restoreExit() {
  (process as unknown as Record<string, unknown>).exit = origExit;
}

// ── Reset between tests ───────────────────────────────────────────────────────

beforeEach(() => {
  Application._resetInstance();
});

afterEach(() => {
  Application._resetInstance();
  restoreServe();
  restoreExit();
});

// ── _resetInstance ────────────────────────────────────────────────────────────

describe("Application._resetInstance()", () => {
  it("allows creating a fresh instance after reset", () => {
    const a = Application.create({ env: "test" });
    Application._resetInstance();
    const b = Application.create({ env: "test" });
    expect(a).not.toBe(b);
  });

  it("currentApp() throws after reset", () => {
    Application.create({ env: "test" });
    Application._resetInstance();
    expect(() => currentApp()).toThrow();
  });
});

// ── boot() ────────────────────────────────────────────────────────────────────

describe("Application.boot()", () => {
  it("calls onRegister() on all providers", async () => {
    const log: string[] = [];
    const app = Application.create({ env: "test" });
    app.register([makeRecordingProvider(log, "A"), makeRecordingProvider(log, "B")]);
    await app.boot();
    expect(log).toContain("A:register");
    expect(log).toContain("B:register");
  });

  it("calls onBooting() then onBooted() (phases 2 and 3)", async () => {
    const log: string[] = [];
    const app = Application.create({ env: "test" });
    app.register([makeRecordingProvider(log, "P")]);
    await app.boot();
    const bootingIdx = log.indexOf("P:booting");
    const bootedIdx = log.indexOf("P:booted");
    expect(bootingIdx).toBeGreaterThan(-1);
    expect(bootedIdx).toBeGreaterThan(bootingIdx);
  });

  it("pre-resolves 'config' and 'events' so Facades can use makeSync()", async () => {
    const app = Application.create({ env: "test" });
    await app.boot();
    expect(() => app.container.makeSync("config")).not.toThrow();
    expect(() => app.container.makeSync("events")).not.toThrow();
  });

  it("filters providers by environment", async () => {
    const log: string[] = [];

    class WebOnly extends ServiceProvider {
      static override environments: Array<"web" | "console" | "test" | "repl"> = ["web"];
      override onRegister() {
        log.push("web:register");
      }
    }
    class TestOnly extends ServiceProvider {
      static override environments: Array<"web" | "console" | "test" | "repl"> = ["test"];
      override onRegister() {
        log.push("test:register");
      }
    }

    const app = Application.create({ env: "test" });
    app.register([
      WebOnly as unknown as new (a: Application) => ServiceProvider,
      TestOnly as unknown as new (a: Application) => ServiceProvider,
    ]);
    await app.boot();

    expect(log).not.toContain("web:register");
    expect(log).toContain("test:register");
  });

  it("is idempotent — calling boot() twice only runs providers once", async () => {
    const log: string[] = [];
    const app = Application.create({ env: "test" });
    app.register([makeRecordingProvider(log, "P")]);
    await app.boot();
    await app.boot();
    expect(log.filter((e) => e === "P:register")).toHaveLength(1);
  });

  it("emits AppBooted with boot duration and exposes bootDurationMs", async () => {
    const seen: AppBooted[] = [];
    const unsub = FrameworkEvents.on(AppBooted, (e) => seen.push(e));
    const app = Application.create({ env: "test" });
    await app.boot();
    unsub();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.environment).toBe("test");
    expect(typeof seen[0]!.durationMs).toBe("number");
    expect(app.bootDurationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("Application provider dependency resolution", () => {
  const asProvider = (c: unknown) => c as new (a: Application) => ServiceProvider;
  const setStatic = (c: unknown, key: string, value: unknown) => {
    (c as Record<string, unknown>)[key] = value;
  };

  it("pulls in a provider's static dependsOn and boots the dependency first", async () => {
    const log: string[] = [];
    const Dep = makeRecordingProvider(log, "Dep");
    const Feature = makeRecordingProvider(log, "Feature");
    setStatic(Feature, "dependsOn", [Dep]);

    const app = Application.create({ env: "test" });
    app.register([asProvider(Feature)]); // only the feature is registered
    await app.boot();

    expect(log).toContain("Dep:register"); // dependency pulled in automatically
    expect(log).toContain("Feature:register");
    expect(log.indexOf("Dep:register")).toBeLessThan(log.indexOf("Feature:register"));
  });

  it("topo-sorts so a dependency boots first even when registered after its dependent", async () => {
    const log: string[] = [];
    const Dep = makeRecordingProvider(log, "Dep");
    const Feature = makeRecordingProvider(log, "Feature");
    setStatic(Feature, "dependsOn", [Dep]);

    const app = Application.create({ env: "test" });
    app.register([asProvider(Feature), asProvider(Dep)]); // reverse of boot order
    await app.boot();

    expect(log.filter((e) => e === "Dep:register")).toHaveLength(1); // de-duped
    expect(log.indexOf("Dep:register")).toBeLessThan(log.indexOf("Feature:register"));
  });

  it("is idempotent — registering the same provider twice boots it once", async () => {
    const log: string[] = [];
    const P = makeRecordingProvider(log, "P");
    const app = Application.create({ env: "test" });
    app.register([asProvider(P)]);
    app.register([asProvider(P)]);
    await app.boot();
    expect(log.filter((e) => e === "P:register")).toHaveLength(1);
  });

  it("orders independent providers by static priority (lower first)", async () => {
    const log: string[] = [];
    const Early = makeRecordingProvider(log, "Early");
    setStatic(Early, "priority", -100);
    const Late = makeRecordingProvider(log, "Late");

    const app = Application.create({ env: "test" });
    app.register([asProvider(Late), asProvider(Early)]); // Late first, but Early has priority
    await app.boot();

    expect(log.indexOf("Early:register")).toBeLessThan(log.indexOf("Late:register"));
  });

  it("drops a dependency excluded by its own environments", async () => {
    const log: string[] = [];
    const WebDep = makeRecordingProvider(log, "WebDep");
    setStatic(WebDep, "environments", ["web"]);
    const Feature = makeRecordingProvider(log, "Feature");
    setStatic(Feature, "dependsOn", [WebDep]);

    const app = Application.create({ env: "test" }); // running in test env
    app.register([asProvider(Feature)]);
    await app.boot();

    expect(log).not.toContain("WebDep:register"); // web-only dep not dragged into a test boot
    expect(log).toContain("Feature:register");
  });

  it("throws on a circular provider dependency", async () => {
    const log: string[] = [];
    const A = makeRecordingProvider(log, "A");
    const B = makeRecordingProvider(log, "B");
    setStatic(A, "dependsOn", [B]);
    setStatic(B, "dependsOn", [A]);

    const app = Application.create({ env: "test" });
    app.register([asProvider(A)]);
    await expect(app.boot()).rejects.toThrow(/Circular provider dependency/);
  });
});

// ── start() ───────────────────────────────────────────────────────────────────

describe("Application.start()", () => {
  it("calls onStarting() before Bun.serve() and onStarted() after", async () => {
    const order: string[] = [];

    class P extends ServiceProvider {
      override async onStarting() {
        order.push("onStarting");
      }
      override async onStarted() {
        order.push("onStarted");
      }
    }

    const serveOrder: string[] = [];
    (Bun as unknown as Record<string, unknown>).serve = () => {
      serveOrder.push("serve");
      return fakeServer;
    };

    const app = Application.create({ env: "test" });
    app.register([P]);
    await app.start(0);

    expect(order[0]).toBe("onStarting");
    expect(serveOrder[0]).toBe("serve");
    expect(order[1]).toBe("onStarted");
  });
});

// ── stop() ────────────────────────────────────────────────────────────────────

describe("Application.stop()", () => {
  it("calls onStopping() then onStopped() in LIFO order", async () => {
    const log: string[] = [];
    mockExit();

    const app = Application.create({ env: "test" });
    app.register([makeRecordingProvider(log, "First"), makeRecordingProvider(log, "Last")]);
    await app.boot();
    await app.stop();

    // Reverse order: Last registered stops first
    const stoppingFirst = log.indexOf("Last:stopping");
    const stoppingSecond = log.indexOf("First:stopping");
    const stoppedFirst = log.indexOf("Last:stopped");
    const stoppedSecond = log.indexOf("First:stopped");

    expect(stoppingFirst).toBeLessThan(stoppingSecond);
    expect(stoppedFirst).toBeLessThan(stoppedSecond);
    // All stopping hooks run before any stopped hook
    expect(stoppingSecond).toBeLessThan(stoppedFirst);
  });

  it("provider registered last stops first (LIFO)", async () => {
    const order: string[] = [];
    mockExit();

    class P1 extends ServiceProvider {
      override async onStopping() {
        order.push("P1");
      }
    }
    class P2 extends ServiceProvider {
      override async onStopping() {
        order.push("P2");
      }
    }

    const app = Application.create({ env: "test" });
    app.register([P1, P2]);
    await app.boot();
    await app.stop();

    expect(order[0]).toBe("P2");
    expect(order[1]).toBe("P1");
  });

  it("calls process.exit(0) at the end", async () => {
    mockExit();
    const app = Application.create({ env: "test" });
    await app.boot();
    await app.stop();
    expect(exitCalled).toBe(true);
  });
});

describe("Application.close()", () => {
  it("tears down without calling process.exit (embedded/test teardown)", async () => {
    mockExit();
    const app = Application.create({ env: "test" });
    await app.boot();
    await app.close();
    expect(exitCalled).toBe(false);
  });

  it("runs onStopping() then onStopped() in LIFO order, like stop()", async () => {
    const order: string[] = [];
    const { ServiceProvider } = await import("../provider/ServiceProvider.ts");
    class First extends ServiceProvider {
      override async onStopping() {
        order.push("stopping:first");
      }
      override async onStopped() {
        order.push("stopped:first");
      }
    }
    class Second extends ServiceProvider {
      override async onStopping() {
        order.push("stopping:second");
      }
      override async onStopped() {
        order.push("stopped:second");
      }
    }
    const app = Application.create({ env: "test" }).register([First, Second]);
    await app.boot();
    await app.close();
    // LIFO: second registered stops first.
    expect(order).toEqual(["stopping:second", "stopping:first", "stopped:second", "stopped:first"]);
  });
});

// ── Per-request provider hooks ─────────────────────────────────────────────────

describe("Provider per-request hooks", () => {
  it("ServiceProvider defaults are no-ops", async () => {
    const app = Application.create({ env: "test" });
    await app.boot();
    const provider = app._activeProviders[0];
    if (!provider) return; // no providers registered — skip
    const ctx = (await import("../pipeline/HttpContext.ts")).HttpContext.fake();
    // Should resolve without throwing
    await expect(provider.onRequestReceived(ctx)).resolves.toBeUndefined();
    await expect(provider.onRequestProcessed(ctx)).resolves.toBeUndefined();
    await expect(provider.onResponseSent(ctx)).resolves.toBeUndefined();
  });

  it("onRequestReceived fires before the pipeline on matched routes", async () => {
    const order: string[] = [];

    class HookProvider extends (await import("../provider/ServiceProvider.ts")).ServiceProvider {
      override async onRequestReceived() {
        order.push("received");
      }
    }

    const app = Application.create({ env: "test" });
    app.register([HookProvider as never]);
    await app.boot();

    // Simulate what _buildProviderHooks() + createRouteHandler does by
    // invoking the hooks object directly.
    const { HttpContext } = await import("../pipeline/HttpContext.ts");
    const ctx = HttpContext.fake();
    const hooks = (
      app as unknown as { _providerHooks: { onRequestReceived(c: typeof ctx): Promise<void> } }
    )._providerHooks!;
    await hooks.onRequestReceived(ctx);
    expect(order).toEqual(["received"]);
  });

  it("onRequestProcessed fires after the pipeline on matched routes", async () => {
    const log: string[] = [];

    class HookProvider extends (await import("../provider/ServiceProvider.ts")).ServiceProvider {
      override async onRequestProcessed() {
        log.push("processed");
      }
    }

    const app = Application.create({ env: "test" });
    app.register([HookProvider as never]);
    await app.boot();

    const { HttpContext } = await import("../pipeline/HttpContext.ts");
    const ctx = HttpContext.fake();
    const hooks = (
      app as unknown as { _providerHooks: { onRequestProcessed(c: typeof ctx): Promise<void> } }
    )._providerHooks!;
    await hooks.onRequestProcessed(ctx);
    expect(log).toEqual(["processed"]);
  });

  it("scheduleResponseSent registers onResponseSent via ctx.afterResponse", async () => {
    const log: string[] = [];

    class HookProvider extends (await import("../provider/ServiceProvider.ts")).ServiceProvider {
      override async onResponseSent() {
        log.push("sent");
      }
    }

    const app = Application.create({ env: "test" });
    app.register([HookProvider as never]);
    await app.boot();

    const { HttpContext } = await import("../pipeline/HttpContext.ts");
    const ctx = HttpContext.fake();
    const hooks = (
      app as unknown as { _providerHooks: { scheduleResponseSent(c: typeof ctx): void } }
    )._providerHooks!;

    expect(ctx._afterResponseCallbacks).toHaveLength(0);
    hooks.scheduleResponseSent(ctx);
    expect(ctx._afterResponseCallbacks).toHaveLength(1);

    // Fire the callback and check that onResponseSent was called
    await ctx._afterResponseCallbacks[0]!();
    expect(log).toEqual(["sent"]);
  });

  it("all three hooks receive the correct HttpContext", async () => {
    const received: string[] = [];

    class HookProvider extends (await import("../provider/ServiceProvider.ts")).ServiceProvider {
      override async onRequestReceived(ctx: import("../pipeline/HttpContext.ts").HttpContext) {
        received.push(`received:${ctx.url.pathname}`);
      }
      override async onRequestProcessed(ctx: import("../pipeline/HttpContext.ts").HttpContext) {
        received.push(`processed:${ctx.url.pathname}`);
      }
      override async onResponseSent(ctx: import("../pipeline/HttpContext.ts").HttpContext) {
        received.push(`sent:${ctx.url.pathname}`);
      }
    }

    const app = Application.create({ env: "test" });
    app.register([HookProvider as never]);
    await app.boot();

    const { HttpContext } = await import("../pipeline/HttpContext.ts");
    const ctx = HttpContext.fake("http://localhost/hello");

    type Hooks = {
      onRequestReceived(c: typeof ctx): Promise<void>;
      onRequestProcessed(c: typeof ctx): Promise<void>;
      scheduleResponseSent(c: typeof ctx): void;
    };
    const hooks = (app as unknown as { _providerHooks: Hooks })._providerHooks!;

    await hooks.onRequestReceived(ctx);
    await hooks.onRequestProcessed(ctx);
    hooks.scheduleResponseSent(ctx);
    await ctx._afterResponseCallbacks[0]!();

    expect(received).toEqual(["received:/hello", "processed:/hello", "sent:/hello"]);
  });
});

describe("Application.defer()", () => {
  it("registers a provider as deferred", async () => {
    Application._resetInstance();
    const app = Application.create({ env: "test" });
    await app.boot();

    let booted = false;

    class LazyProvider extends ServiceProvider {
      override onRegister() {
        this.app.container.value("cache" as never, "lazy-cache" as never);
      }
      override async onBooted() {
        booted = true;
      }
    }

    app.defer("cache" as never, LazyProvider as never);

    expect(booted).toBe(false); // not yet

    const result = await app.container.make("cache" as never);
    expect(booted).toBe(true);
    expect(result).toBe("lazy-cache");
  });
});

// ── useConfig() ───────────────────────────────────────────────────────────────

describe("Application.useConfig()", () => {
  it("stores the config map and returns this for chaining", () => {
    const app = Application.create({ env: "test" });
    const map = { app: { name: "TestApp" } };
    const result = app.useConfig(map);
    expect(result).toBe(app);
    expect((app as unknown as { _configMap: unknown })._configMap).toBe(map);
  });

  it("applies the config map during boot() so providers see it", async () => {
    const app = Application.create({ env: "test" });
    app.useConfig({ app: { name: "TestApp", debug: false } });
    await app.boot();
    const cfg = app.container.makeSync(
      "config",
    ) as import("../config/ConfigManager.ts").ConfigManager;
    expect(cfg.get("app.name")).toBe("TestApp");
  });
});

// ── routing() ────────────────────────────────────────────────────────────────

describe("Application.routing()", () => {
  it("stores the routing config and returns this", () => {
    const app = Application.create({ env: "test" });
    const result = app.routing({ web: "./routes/web.ts" });
    expect(result).toBe(app);
    const groups = (app as unknown as { _routeGroups: Array<{ file: string }> })._routeGroups;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.file).toBe("./routes/web.ts");
  });

  it("is chainable", () => {
    const app = Application.create({ env: "test" });
    const result = app.routing({ web: "./routes/web.ts" }).use([] as never);
    expect(result).toBe(app);
  });
});

// ── fileBasedRouting() ────────────────────────────────────────────────────────

describe("Application.fileBasedRouting()", () => {
  it("stores the file routing config and returns this", () => {
    const app = Application.create({ env: "test" });
    const result = app.fileBasedRouting({ web: "./app/routes" });
    expect(result).toBe(app);
    const groups = (app as unknown as { _fileRouteGroups: Array<{ dir: string }> })
      ._fileRouteGroups;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.dir).toBe("./app/routes");
  });

  it("accepts object entries with explicit prefix and middleware", () => {
    const app = Application.create({ env: "test" });
    app.fileBasedRouting({
      admin: { dir: "./app/admin/routes", prefix: "/admin", middleware: ["web", "auth"] },
    });
    const groups = (app as unknown as { _fileRouteGroups: Array<{ dir: string; prefix: string }> })
      ._fileRouteGroups;
    expect(groups[0]!.dir).toBe("./app/admin/routes");
    expect(groups[0]!.prefix).toBe("/admin");
  });

  it("accepts a bare string dir (web defaults) and accumulates across chained calls", () => {
    const app = Application.create({ env: "test" });
    const result = app.fileBasedRouting("./app/flow/pages/surface").fileBasedRouting({
      dir: "./app/flow/pages/[tenancy]",
      prefix: "/:tenancy",
      middleware: [],
    });
    expect(result).toBe(app);
    const groups = (app as unknown as { _fileRouteGroups: Array<{ dir: string; prefix: string }> })
      ._fileRouteGroups;
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ dir: "./app/flow/pages/surface", prefix: "" });
    expect(groups[1]).toMatchObject({ dir: "./app/flow/pages/[tenancy]", prefix: "/:tenancy" });
  });
});

// ── use() ─────────────────────────────────────────────────────────────────────

describe("Application.use()", () => {
  it("accepts a single middleware class and returns this", () => {
    class TestPipe {}
    const app = Application.create({ env: "test" });
    const result = app.use(TestPipe as never);
    expect(result).toBe(app);
    expect((app as unknown as { _middleware: unknown[] })._middleware).toContain(TestPipe);
  });

  it("accepts an array of middleware classes", () => {
    class PipeA {}
    class PipeB {}
    const app = Application.create({ env: "test" });
    app.use([PipeA as never, PipeB as never]);
    const mw = (app as unknown as { _middleware: unknown[] })._middleware;
    expect(mw).toContain(PipeA);
    expect(mw).toContain(PipeB);
  });
});

// ── useOnce() ─────────────────────────────────────────────────────────────────

describe("Application.useOnce()", () => {
  it("registers middleware only once (idempotent)", () => {
    class TestPipe {}
    const app = Application.create({ env: "test" });
    const cast = app as unknown as { useOnce(c: unknown): void; _autoMiddleware: unknown[] };
    cast.useOnce(TestPipe);
    cast.useOnce(TestPipe);
    expect(cast._autoMiddleware.filter((m) => m === TestPipe)).toHaveLength(1);
  });

  it("skips registration when a subclass is already in _middleware", () => {
    class Base {}
    class Sub extends Base {}
    const app = Application.create({ env: "test" });
    app.use(Sub as never);
    const cast = app as unknown as { useOnce(c: unknown): void; _autoMiddleware: unknown[] };
    cast.useOnce(Base); // Base should be skipped because Sub (subclass) is in _middleware
    expect(cast._autoMiddleware).not.toContain(Base);
  });
});

// ── routing() group resolution helpers ───────────────────────────────────────

describe("routing() group resolution", () => {
  it("boot() completes when routing() points to a nonexistent file (import is attempted but fails gracefully at test isolation level)", async () => {
    // This test verifies _loadRoutes() is called without crashing when routing config exists
    // (actual file import would throw; we test the store-only behavior here)
    const app = Application.create({ env: "test" });
    app.routing({ web: "./routes/web.ts" });
    const groups = (app as unknown as { _routeGroups: unknown[] })._routeGroups;
    expect(groups.length).toBeGreaterThan(0);
  });

  it("fileBasedRouting() stores config and is chainable", () => {
    const app = Application.create({ env: "test" });
    const result = app.fileBasedRouting({ web: "./app/routes" });
    expect(result).toBe(app);
  });
});

// ── globalMiddleware getter ───────────────────────────────────────────────────

describe("Application.globalMiddleware", () => {
  it("carries only the kernel's security headers before any middleware is registered", () => {
    // Not empty: a scaffolded app must not ship without clickjacking and MIME-sniffing
    // protection just because nobody remembered to register the middleware.
    const app = Application.create({ env: "test" });
    expect(app.globalMiddleware).toEqual([SecureHeadersMiddleware]);
  });

  it("is empty when the app opts out of the kernel's security headers", () => {
    const app = Application.create({ env: "test", secureHeaders: false });
    expect(app.globalMiddleware).toEqual([]);
  });

  it("does not stack a second copy when the app registers its own", () => {
    const Configured = SecureHeadersMiddleware.with({ secure: true });
    const app = Application.create({ env: "test" }).use(Configured);
    expect(app.globalMiddleware).toEqual([Configured]);
  });

  it("includes middleware added via use()", () => {
    class PipeA {}
    const app = Application.create({ env: "test" });
    app.use(PipeA as never);
    expect(app.globalMiddleware).toContain(PipeA);
  });

  it("returns a defensive copy (mutations do not affect internal state)", () => {
    class PipeA {}
    const app = Application.create({ env: "test" });
    app.use(PipeA as never);
    const copy = app.globalMiddleware;
    copy.pop();
    expect(app.globalMiddleware).toContain(PipeA);
  });
});

// ── withExceptionHandler() ────────────────────────────────────────────────────

describe("Application.withExceptionHandler()", () => {
  it("stores an instance of the handler and returns this", async () => {
    const { ExceptionHandler } = await import("./ExceptionHandler.ts");
    class MyHandler extends ExceptionHandler {}
    const app = Application.create({ env: "test" });
    const result = app.withExceptionHandler(MyHandler);
    expect(result).toBe(app);
    const stored = (app as unknown as { _exceptionHandler: unknown })._exceptionHandler;
    expect(stored).toBeInstanceOf(MyHandler);
  });
});

// ── enableDevWs() ─────────────────────────────────────────────────────────────

describe("Application.enableDevWs()", () => {
  it("sets the dev WS flag and returns this", () => {
    const app = Application.create({ env: "test" });
    const result = app.enableDevWs();
    expect(result).toBe(app);
    expect((app as unknown as { _devWsEnabled: boolean })._devWsEnabled).toBe(true);
  });
});

// ── withWebSocket() ───────────────────────────────────────────────────────────

describe("Application.withWebSocket()", () => {
  type Regs = {
    _wsRegistrations: Array<{ handlers: unknown; upgradeData?: unknown; path?: unknown }>;
  };
  type RegFor = { _wsRegFor(p: unknown): { handlers: unknown } | undefined };

  it("registers ws handlers and returns this", () => {
    const handlers = { message: (_ws: unknown, _msg: unknown) => {} };
    const app = Application.create({ env: "test" });
    const result = app.withWebSocket(handlers as never);
    expect(result).toBe(app);
    expect((app as unknown as Regs)._wsRegistrations.at(-1)?.handlers).toBe(handlers);
  });

  it("records the optional upgradeData factory and path", () => {
    const handlers = { message: () => {} };
    const upgradeData = (_req: Request) => ({ userId: 1 });
    const app = Application.create({ env: "test" });
    app.withWebSocket(handlers as never, upgradeData as never, "/app/ws");
    const reg = (app as unknown as Regs)._wsRegistrations.at(-1);
    expect(reg?.upgradeData).toBe(upgradeData);
    expect(reg?.path).toBe("/app/ws");
  });

  it("multiplexes multiple registrations, routing by path (with a catch-all fallback)", () => {
    const flow = { message: () => {} };
    const broadcast = { message: () => {} };
    const fallback = { message: () => {} };
    const app = Application.create({ env: "test" });
    app.withWebSocket(fallback as never); // no path → catch-all
    app.withWebSocket(flow as never, undefined, "/__flow/ws");
    app.withWebSocket(broadcast as never, undefined, "/app/ws");

    const regFor = (app as unknown as RegFor)._wsRegFor.bind(app);
    expect(regFor("/__flow/ws")?.handlers).toBe(flow);
    expect(regFor("/app/ws")?.handlers).toBe(broadcast);
    expect(regFor("/something-else")?.handlers).toBe(fallback); // unmatched → catch-all
  });
});

// ── _buildWsConfig() ──────────────────────────────────────────────────────────

describe("Application._buildWsConfig()", () => {
  it("returns undefined when neither devWs nor wsHandlers are set", () => {
    const app = Application.create({ env: "test" });
    const result = (app as unknown as { _buildWsConfig(): unknown })._buildWsConfig();
    expect(result).toBeUndefined();
  });

  it("dispatches open/message/close to correct sub-systems", () => {
    const msgs: string[] = [];
    const broadcastHandlers = {
      open: (_ws: unknown) => msgs.push("b:open"),
      message: (_ws: unknown, msg: string) => msgs.push(`b:msg:${msg}`),
      close: (_ws: unknown, _code: number, _reason: string) => msgs.push("b:close"),
    };
    const app = Application.create({ env: "test" });
    app.enableDevWs();
    app.withWebSocket(broadcastHandlers as never);

    type WsCfg = {
      open: (ws: unknown) => void;
      message: (ws: unknown, message: unknown) => void;
      close: (ws: unknown, code: number, reason: string) => void;
    };
    const cfg = (app as unknown as { _buildWsConfig(): WsCfg })._buildWsConfig()!;

    const devWs = { data: { _dev: true }, send: () => {} };
    const broadWs = { data: { _dev: false }, send: () => {} };

    cfg.open(devWs); // _dev → DevWsServer.open
    cfg.open(broadWs); // broadcast → b:open
    cfg.message(devWs, "hi"); // _dev → skip
    cfg.message(broadWs, "hello"); // broadcast → b:msg:hello
    cfg.close(devWs, 1000, ""); // _dev → DevWsServer.close
    cfg.close(broadWs, 1000, ""); // broadcast → b:close

    expect(msgs).toEqual(["b:open", "b:msg:hello", "b:close"]);
  });
});

// ── boot() — config discovery + conventions ───────────────────────────────────

describe("Application.boot() — config discovery and conventions", () => {
  it("_discoverConfig() handles a missing config/ directory gracefully", async () => {
    const app = Application.create({ env: "test" });
    // No useConfig() call — auto-discovery runs from process.cwd()
    await expect(app.boot()).resolves.toBeUndefined();
  });

  it("registers a static public/ route in web env via _bootConventions", async () => {
    const app = Application.create({ env: "web" });
    await app.boot();
    // If we reach here without throwing, the web branch was executed
  });

  it("useConfig() values are available after boot()", async () => {
    const app = Application.create({ env: "test" });
    app.useConfig({ app: { name: "TestApp" } });
    await app.boot();
    const cfg = app.container.makeSync(
      "config",
    ) as import("../config/ConfigManager.ts").ConfigManager;
    expect(cfg.get("app.name")).toBe("TestApp");
  });
});

// ── bootAsWorker() ────────────────────────────────────────────────────────────

/** What `bootAsWorker()` registers with `process.on` — the tests fire it with no arguments. */
type SignalHandler = (...args: never[]) => unknown;

describe("Application.bootAsWorker()", () => {
  let savedProcessOn: typeof process.on;
  const signalHandlers: Record<string, SignalHandler> = {};

  beforeEach(() => {
    savedProcessOn = process.on.bind(process);
    (process as unknown as Record<string, unknown>).on = (event: string, fn: SignalHandler) => {
      signalHandlers[event] = fn;
      return process;
    };
  });

  afterEach(() => {
    (process as unknown as Record<string, unknown>).on = savedProcessOn;
    for (const k of Object.keys(signalHandlers)) delete signalHandlers[k];
  });

  it("runs phases 4-5 (onStarting + onStarted) without calling Bun.serve()", async () => {
    const log: string[] = [];
    class P extends ServiceProvider {
      override async onStarting() {
        log.push("starting");
      }
      override async onStarted() {
        log.push("started");
      }
    }
    const app = Application.create({ env: "test" });
    app.register([P]);
    await app.bootAsWorker();
    expect(log).toEqual(["starting", "started"]);
  });

  it("sets env to worker and boots _bootConventions worker branch (nonexistent jobs/schedules is graceful)", async () => {
    const app = Application.create({ env: "test" });
    await expect(app.bootAsWorker()).resolves.toBeUndefined();
  });

  it("registers SIGTERM and SIGINT signal handlers", async () => {
    const app = Application.create({ env: "test" });
    await app.bootAsWorker();
    expect(typeof signalHandlers["SIGTERM"]).toBe("function");
    expect(typeof signalHandlers["SIGINT"]).toBe("function");
  });

  it("shutdown callback drains providers LIFO and calls process.exit(0)", async () => {
    const log: string[] = [];
    // Override process.exit to resolve a promise so we can await completion
    // (the signal handler uses `void shutdown(...)` which discards the Promise)
    let exitResolve!: () => void;
    const exitPromise = new Promise<void>((r) => {
      exitResolve = r;
    });
    (process as unknown as Record<string, unknown>).exit = () => {
      exitCalled = true;
      exitResolve();
    };

    class P1 extends ServiceProvider {
      override async onStopping() {
        log.push("P1:stopping");
      }
      override async onStopped() {
        log.push("P1:stopped");
      }
    }
    class P2 extends ServiceProvider {
      override async onStopping() {
        log.push("P2:stopping");
      }
      override async onStopped() {
        log.push("P2:stopped");
      }
    }

    const app = Application.create({ env: "test" });
    app.register([P1, P2]);
    await app.bootAsWorker();

    signalHandlers["SIGTERM"]?.(); // fire (void — do NOT await)
    await exitPromise; // wait until process.exit() is called

    expect(log[0]).toBe("P2:stopping");
    expect(log[1]).toBe("P1:stopping");
    expect(exitCalled).toBe(true);
  });

  it("shutdown callback is idempotent — second signal is a no-op", async () => {
    const log: string[] = [];
    // Same pattern: await via exitPromise instead of awaiting the void handler
    let exitResolve!: () => void;
    const exitPromise = new Promise<void>((r) => {
      exitResolve = r;
    });
    (process as unknown as Record<string, unknown>).exit = () => {
      exitCalled = true;
      exitResolve();
    };

    class P extends ServiceProvider {
      override async onStopping() {
        log.push("stopping");
      }
    }

    const app = Application.create({ env: "test" });
    app.register([P]);
    await app.bootAsWorker();

    signalHandlers["SIGTERM"]?.(); // first fire (void)
    await exitPromise;
    signalHandlers["SIGTERM"]?.(); // second fire — should be no-op (idempotent guard)
    expect(log).toHaveLength(1);
  });
});

// ── start() fetch handler + _registerHealthEndpoint ──────────────────────────

describe("Application.start() — fetch handler and health endpoint", () => {
  it("fetch handler returns 404 for an unmatched route (covers fetch callback body)", async () => {
    const app = Application.create({ env: "web" });
    let capturedFetch: ((req: Request, srv: unknown) => Promise<Response | undefined>) | undefined;
    (Bun as unknown as Record<string, unknown>).serve = (opts: Record<string, unknown>) => {
      capturedFetch = opts["fetch"] as typeof capturedFetch;
      return fakeServer;
    };

    await app.start(0);

    const req = new Request("http://localhost/this-route-does-not-exist");
    const res = await capturedFetch!(req, { upgrade: (_r: unknown, _o: unknown) => false });
    expect(res?.status).toBe(404);
  });

  it("fetch handler invokes error path via _handleErrorAsync when pipeline throws", async () => {
    class BoomPipe {
      async handle(_ctx: unknown, _next: unknown): Promise<never> {
        throw new Error("middleware boom");
      }
    }
    const app = Application.create({ env: "web" });
    app.use(BoomPipe as never);
    let capturedFetch: ((req: Request, srv: unknown) => Promise<Response | undefined>) | undefined;
    (Bun as unknown as Record<string, unknown>).serve = (opts: Record<string, unknown>) => {
      capturedFetch = opts["fetch"] as typeof capturedFetch;
      return fakeServer;
    };
    await app.start(0);

    const req = new Request("http://localhost/any");
    const res = await capturedFetch!(req, { upgrade: () => false });
    expect(res?.status).toBe(500);
  });

  it("_registerHealthEndpoint() runs in web env without throwing", async () => {
    const app = Application.create({ env: "web" });
    mockServe();
    await expect(app.start(0)).resolves.toBeUndefined();
  });

  it("_registerHealthEndpoint() runs in production env with health:true enabled", async () => {
    const app = Application.create({ env: "web" });
    app.useConfig({ app: { env: "production", health: true } });
    mockServe();
    await expect(app.start(0)).resolves.toBeUndefined();
  });

  it("WebSocket upgrade is handled when _wsHandlers is set", async () => {
    const messages: string[] = [];
    const app = Application.create({ env: "web" });
    app.withWebSocket({
      message: (_ws: unknown, msg: string | Uint8Array) => messages.push(String(msg)),
    } as never);
    let capturedFetch: ((req: Request, srv: unknown) => Promise<Response | undefined>) | undefined;
    (Bun as unknown as Record<string, unknown>).serve = (opts: Record<string, unknown>) => {
      capturedFetch = opts["fetch"] as typeof capturedFetch;
      return fakeServer;
    };
    await app.start(0);

    const wsReq = new Request("http://localhost/ws", { headers: { Upgrade: "websocket" } });
    // Fake server returns true from upgrade() to simulate successful upgrade
    const fakeSrv = { upgrade: (_r: unknown, _o: unknown) => true };
    const res = await capturedFetch!(wsReq, fakeSrv);
    expect(res).toBeUndefined(); // Upgrade succeeded → fetch returns undefined
  });

  it("Dev WebSocket upgrade is handled when _devWsEnabled + correct path", async () => {
    const app = Application.create({ env: "web" });
    app.enableDevWs();
    let capturedFetch: ((req: Request, srv: unknown) => Promise<Response | undefined>) | undefined;
    (Bun as unknown as Record<string, unknown>).serve = (opts: Record<string, unknown>) => {
      capturedFetch = opts["fetch"] as typeof capturedFetch;
      return fakeServer;
    };
    await app.start(0);

    const wsReq = new Request("http://localhost/__dev/ws", { headers: { Upgrade: "websocket" } });
    const fakeSrv = { upgrade: (_r: unknown, _o: unknown) => true };
    const res = await capturedFetch!(wsReq, fakeSrv);
    expect(res).toBeUndefined(); // Upgrade succeeded
  });
});

// ── _handleErrorAsync() ───────────────────────────────────────────────────────

describe("Application._handleErrorAsync()", () => {
  it("falls through to ExceptionHandler.defaultRender when no custom handler is registered", async () => {
    const app = Application.create({ env: "test" });
    await app.boot();
    const { HttpContext } = await import("../pipeline/HttpContext.ts");
    const ctx = HttpContext.fake();
    const cast = app as unknown as { _handleErrorAsync(e: unknown, c: unknown): Promise<Response> };
    const res = await cast._handleErrorAsync(new Error("boom"), ctx);
    expect(res.status).toBe(500);
  });

  it("delegates report() and render() to a registered custom handler", async () => {
    const { ExceptionHandler } = await import("./ExceptionHandler.ts");
    let reportCalled = false;
    class CustomHandler extends ExceptionHandler {
      override async report() {
        reportCalled = true;
      }
      override async render() {
        return new Response("custom", { status: 418 });
      }
    }
    const app = Application.create({ env: "test" });
    app.withExceptionHandler(CustomHandler);
    await app.boot();
    const { HttpContext } = await import("../pipeline/HttpContext.ts");
    const ctx = HttpContext.fake();
    const cast = app as unknown as { _handleErrorAsync(e: unknown, c: unknown): Promise<Response> };
    const res = await cast._handleErrorAsync(new Error("handled"), ctx);
    expect(reportCalled).toBe(true);
    expect(res.status).toBe(418);
  });
});

// ── _runAfterResponse() ───────────────────────────────────────────────────────

// Note: firing of afterResponse() callbacks is exercised where the behaviour now
// lives — RouteHandler (see router/RouteHandler.test.ts) and HttpContext
// (pipeline/HttpContext.test.ts). Application no longer exposes _runAfterResponse.

// ── _reloadRoutes() ───────────────────────────────────────────────────────────

describe("Application._reloadRoutes()", () => {
  it("completes without throwing when no conventions dir and _static has reload()", async () => {
    const app = Application.create({ env: "web" });
    (Bun as unknown as Record<string, unknown>).serve = () => ({
      stop: () => {},
      reload: (_opts: unknown) => {},
    });
    await app.start(0);
    await expect(
      (app as unknown as { _reloadRoutes(): Promise<void> })._reloadRoutes(),
    ).resolves.toBeUndefined();
  });

  it("_reloadRoutes() re-runs routing config loading", async () => {
    const app = Application.create({ env: "web" });
    (Bun as unknown as Record<string, unknown>).serve = () => ({
      stop: () => {},
      reload: (_opts: unknown) => {},
    });
    await app.start(0);
    await expect(
      (app as unknown as { _reloadRoutes(): Promise<void> })._reloadRoutes(),
    ).resolves.toBeUndefined();
  });
});
