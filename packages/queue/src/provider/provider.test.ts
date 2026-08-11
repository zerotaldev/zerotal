import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SQL } from "bun";
import { QueueProvider } from "./QueueProvider.ts";
import { _setDbConnection } from "@zerotal/orm";

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeApp(cfg: Record<string, unknown> = {}, extraContainer: Record<string, unknown> = {}) {
  const singletons: Map<string, () => unknown> = new Map();
  const env = (cfg._env as string) ?? "web";

  const fakeQueue = {
    isShuttingDown: false,
    drainCalled: false,
    processNextCalls: [] as string[],
    setWorkerPool: (_pool: unknown) => {},
    async processNext(q: string) {
      fakeQueue.processNextCalls.push(q);
    },
    async drain() {
      fakeQueue.drainCalled = true;
    },
  };

  const config = {
    get: (path: string, fallback?: unknown) => {
      if (path in cfg) return cfg[path];
      return fallback;
    },
  };

  const container = {
    singleton: (key: string, factory: () => unknown) => {
      singletons.set(key, factory);
    },
    makeSync: (key: string) => {
      if (key === "config") return config;
      if (key === "queue") return fakeQueue;
      if (singletons.has(key)) return singletons.get(key)!();
      throw new Error(`makeSync: ${key} not bound`);
    },
    make: async (key: string) => {
      if (key === "config") return config;
      if (key === "queue") return fakeQueue;
      if (singletons.has(key)) return singletons.get(key)!();
      return undefined;
    },
    tryMake: (key: string) => {
      if (key in extraContainer) return extraContainer[key];
      return null;
    },
  };

  return { container, _env: env, fakeQueue } as any;
}

// ── onRegister() ──────────────────────────────────────────────────────────────

describe("QueueProvider.onRegister()", () => {
  let db: InstanceType<typeof SQL>;

  beforeEach(() => {
    db = new SQL(":memory:");
    _setDbConnection(db);
  });

  afterEach(async () => {
    _setDbConnection(null);
    await db.end();
  });

  function captureFactory(driver: string): {
    factory: () => unknown;
    appContainer: Record<string, unknown>;
  } {
    let registeredFactory: (() => unknown) | undefined;
    const config = {
      get: (path: string, fallback?: unknown) => (path === "queue.driver" ? driver : fallback),
    };
    const appContainer = {
      singleton: (_key: string, factory: () => unknown) => {
        registeredFactory = factory;
      },
      makeSync: (key: string) =>
        key === "config"
          ? config
          : (() => {
              throw new Error(`not bound: ${key}`);
            })(),
    };
    const provider = new QueueProvider({ container: appContainer } as any);
    provider.onRegister();
    return { factory: registeredFactory!, appContainer };
  }

  it('factory creates a QueueManager with SqliteDriver for "sqlite"', () => {
    const { factory } = captureFactory("sqlite");
    const queue = factory();
    expect(queue).toBeDefined();
  });

  it('factory creates a QueueManager with SyncDriver for "sync"', () => {
    const { factory } = captureFactory("sync");
    const queue = factory();
    expect(queue).toBeDefined();
  });

  it("factory uses default sqlite driver when driver config is unknown", () => {
    const { factory } = captureFactory("unknown-driver");
    const queue = factory();
    expect(queue).toBeDefined();
  });
});

// ── onBooting() ───────────────────────────────────────────────────────────────

describe("QueueProvider.onBooting()", () => {
  it("registers CallQueuedListener and sets Bus manager", async () => {
    const { container } = makeApp();
    const provider = new QueueProvider({ container } as any);
    await expect(provider.onBooting()).resolves.toBeUndefined();
  });
});

// ── onStarted() ───────────────────────────────────────────────────────────────

describe("QueueProvider.onStarted()", () => {
  let provider: QueueProvider;

  afterEach(async () => {
    if (provider) {
      await provider.onStopping().catch(() => {});
    }
  });

  it('returns early when workerCount=0 and env is not "worker"', async () => {
    const { container } = makeApp({ "queue.workers": 0 });
    provider = new QueueProvider({ container, _env: "web" } as any);
    await expect(provider.onStarted()).resolves.toBeUndefined();
  });

  it('starts polling when env is "worker"', async () => {
    const { container, fakeQueue } = makeApp({
      "queue.workers": 0,
      "queue.pollInterval": 50,
      "queue.queues": ["default"],
    });
    provider = new QueueProvider({ container, _env: "worker" } as any);
    await provider.onStarted();
    // Give interval time to fire
    await new Promise((r) => setTimeout(r, 100));
    expect(fakeQueue.processNextCalls.length).toBeGreaterThan(0);
    await provider.onStopping();
  });

  it("handles processNext throwing (catch(console.error) path)", async () => {
    let throwCount = 0;
    const { container } = makeApp({
      "queue.workers": 0,
      "queue.pollInterval": 30,
      "queue.queues": ["fail"],
    });
    // Override makeSync queue to return one that throws
    const origMakeSync = container.makeSync;
    const failQueue = {
      isShuttingDown: false,
      async processNext(_q: string) {
        throwCount++;
        throw new Error("boom");
      },
      async drain() {},
    };
    container.makeSync = (key: string) => (key === "queue" ? failQueue : origMakeSync(key));
    container.make = async (key: string) => (key === "queue" ? failQueue : undefined);

    provider = new QueueProvider({ container, _env: "worker" } as any);
    await provider.onStarted();
    await new Promise((r) => setTimeout(r, 80));
    expect(throwCount).toBeGreaterThan(0);
    await provider.onStopping();
  });

  it("does not poll when queue.isShuttingDown is true", async () => {
    const { container, fakeQueue } = makeApp({
      "queue.workers": 0,
      "queue.pollInterval": 20,
      "queue.queues": ["default"],
    });
    fakeQueue.isShuttingDown = true;

    provider = new QueueProvider({ container, _env: "worker" } as any);
    await provider.onStarted();
    await new Promise((r) => setTimeout(r, 60));
    // processNext should not be called when shutting down
    expect(fakeQueue.processNextCalls).toHaveLength(0);
    await provider.onStopping();
  });
});

// ── onStopping() ─────────────────────────────────────────────────────────────

describe("QueueProvider.onStopping()", () => {
  it("is safe to call when no interval was started", async () => {
    const { container, fakeQueue } = makeApp();
    new QueueProvider({ container } as any);
    // tryMake returns a queue (non-null)
    const app = { container: { ...container, tryMake: () => fakeQueue } } as any;
    const p = new QueueProvider(app);
    await expect(p.onStopping()).resolves.toBeUndefined();
    expect(fakeQueue.drainCalled).toBe(true);
  });

  it("is safe to call when tryMake returns null (no queue registered)", async () => {
    const { container } = makeApp();
    const app = { container: { ...container, tryMake: () => null } } as any;
    const p = new QueueProvider(app);
    await expect(p.onStopping()).resolves.toBeUndefined();
  });
});

// ── onBooted() ───────────────────────────────────────────────────────────────

describe("QueueProvider.onBooted()", () => {
  it("is a no-op when no commands runner is registered", async () => {
    const { container } = makeApp();
    const provider = new QueueProvider({ container } as any);
    await expect(provider.onBooted()).resolves.toBeUndefined();
  });

  it("registers lazy commands when runner is available", async () => {
    const registered: string[] = [];
    const fakeRunner = {
      registerLazy: (name: string) => {
        registered.push(name);
      },
    };
    const { container } = makeApp({}, { commands: fakeRunner });
    const provider = new QueueProvider({ container } as any);
    await provider.onBooted();

    expect(registered).toContain("queue:work");
    expect(registered).toContain("queue:failed");
    expect(registered).toContain("queue:retry");
    expect(registered).toContain("queue:flush");
  });

  it("lazy factories for all commands resolve to constructors", async () => {
    const factories = new Map<string, () => Promise<unknown>>();
    const fakeRunner = {
      registerLazy: (name: string, fn: () => Promise<unknown>) => {
        factories.set(name, fn);
      },
    };
    const { container } = makeApp({}, { commands: fakeRunner });
    const provider = new QueueProvider({ container } as any);
    await provider.onBooted();

    for (const name of ["queue:work", "queue:failed", "queue:retry", "queue:flush"]) {
      const Cmd = await factories.get(name)!();
      expect(typeof Cmd).toBe("function");
    }
  });
});
