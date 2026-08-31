/**
 * The heartbeat, and the distinction the whole thing turns on.
 *
 * "Nobody has checked in" and "I cannot tell whether anybody has" are different
 * findings, and a check that conflates them is worse than no check: it reports a
 * missing worker on every app using the memory cache driver, and a check that is
 * usually wrong is one people learn to skip.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Application } from "../application/Application.ts";
import { withApp } from "../application/currentApp.ts";
import { Heartbeat } from "./Heartbeat.ts";
import { workerLivenessCheck, describeBeat } from "./doctor.ts";

/** A cache stand-in with the two methods the heartbeat needs. */
function store(): {
  get<T>(k: string): Promise<T | null>;
  set(k: string, v: unknown, ttl?: number): Promise<void>;
  map: Map<string, unknown>;
} {
  const map = new Map<string, unknown>();
  return {
    map,
    async get<T>(k: string): Promise<T | null> {
      return (map.get(k) as T | undefined) ?? null;
    },
    async set(k: string, v: unknown): Promise<void> {
      map.set(k, v);
    },
  };
}

/**
 * An app with a cache bound and a driver name readable from config.
 *
 * `config` is bound directly rather than passed to `create()`: the manager is only
 * resolvable on a *booted* app, and `zt doctor` boots one. Binding it keeps these
 * about the heartbeat's logic instead of about the boot sequence.
 */
function appWith(driver: string, cache: unknown = store()): Application {
  const app = Application.create({ env: "test" });
  app.container.value(
    "config" as never,
    {
      get: <T>(key: string, fallback: T): T =>
        key === "cache.driver" ? (driver as unknown as T) : fallback,
    } as never,
  );
  app.container.value("cache" as never, cache as never);
  return app;
}

let app: Application | undefined;

// One application per process, so each case gets a clean one.
beforeEach(() => Application._resetInstance());
afterEach(() => {
  app = undefined;
  Application._resetInstance();
});

describe("Heartbeat.beat / lastSeen", () => {
  it("records a check-in and reads it back with an age", async () => {
    const cache = store();
    app = appWith("sqlite", cache);

    await withApp(app, async () => {
      await Heartbeat.beat("scheduler", { detail: "3 task(s)" });
      const seen = await Heartbeat.lastSeen("scheduler");

      expect(seen.status).toBe("seen");
      if (seen.status !== "seen") return;
      expect(seen.beat.detail).toBe("3 task(s)");
      expect(seen.beat.pid).toBe(process.pid);
      expect(seen.ageSeconds).toBeLessThan(5);
    });
  });

  it("reports `never` when nothing has checked in", async () => {
    app = appWith("sqlite");
    await withApp(app, async () => {
      expect((await Heartbeat.lastSeen("scheduler")).status).toBe("never");
    });
  });

  it("reports `unknown` on the memory driver, not `never`", async () => {
    // The distinction the design turns on. A per-process cache cannot show one
    // process another's check-in, so "no beat here" is not evidence of anything.
    app = appWith("memory");
    await withApp(app, async () => {
      const seen = await Heartbeat.lastSeen("scheduler");
      expect(seen.status).toBe("unknown");
      if (seen.status !== "unknown") return;
      expect(seen.reason).toContain("memory");
    });
  });

  it("reports `unknown` when there is no cache at all", async () => {
    const bare = Application.create({ env: "test" });
    bare.container.value(
      "config" as never,
      {
        get: <T>(key: string, fallback: T): T =>
          key === "cache.driver" ? ("sqlite" as unknown as T) : fallback,
      } as never,
    );
    await withApp(bare, async () => {
      expect((await Heartbeat.lastSeen("scheduler")).status).toBe("unknown");
    });
  });

  it("never throws when the store fails", async () => {
    // A heartbeat that can take a worker down is worse than no heartbeat.
    const broken = {
      get: () => Promise.reject(new Error("cache is gone")),
      set: () => Promise.reject(new Error("cache is gone")),
    };
    app = appWith("redis", broken);

    await withApp(app, async () => {
      await expect(Heartbeat.beat("scheduler")).resolves.toBeUndefined();
      expect((await Heartbeat.lastSeen("scheduler")).status).toBe("unknown");
    });
  });
});

describe("Heartbeat.start", () => {
  it("beats immediately and returns a stopper", async () => {
    const cache = store();
    app = appWith("sqlite", cache);

    await withApp(app, async () => {
      const stop = Heartbeat.start("queue", {}, 60_000);
      await Bun.sleep(5);
      expect((await Heartbeat.lastSeen("queue")).status).toBe("seen");
      stop();
    });
  });
});

describe("workerLivenessCheck", () => {
  const check = (opts: Partial<Parameters<typeof workerLivenessCheck>[0]> = {}) =>
    workerLivenessCheck({
      id: "x",
      label: "Worker",
      name: "scheduler",
      hasWork: () => ({ has: true, summary: "3 schedule(s) registered" }),
      staleAfter: 900,
      command: "bun zt worker",
      ...opts,
    });

  it("says nothing when there is no work registered", async () => {
    app = appWith("sqlite");
    await withApp(app, async () => {
      const result = await check({ hasWork: () => ({ has: false, summary: "" }) }).run(app!);
      expect(result.status).toBe("ok");
    });
  });

  it("fails when work is registered and nothing has ever run it", async () => {
    // The reported production case: weeks of no scheduled task executing.
    app = appWith("sqlite");
    await withApp(app, async () => {
      const result = await check().run(app!);
      expect(result.status).toBe("fail");
      expect(result.message).toContain("no worker has ever checked in");
      expect(result.fix).toContain("bun zt worker");
    });
  });

  it("passes when a worker checked in recently", async () => {
    const cache = store();
    app = appWith("sqlite", cache);
    await withApp(app, async () => {
      await Heartbeat.beat("scheduler");
      expect((await check().run(app!)).status).toBe("ok");
    });
  });

  it("warns rather than fails on a stale check-in", async () => {
    // A worker mid-restart is not a missing worker.
    const cache = store();
    app = appWith("sqlite", cache);
    await withApp(app, async () => {
      await Heartbeat.beat("scheduler");
      cache.map.set("zerotal:heartbeat:scheduler", {
        at: new Date(Date.now() - 3600_000).toISOString(),
      });
      const result = await check().run(app!);
      expect(result.status).toBe("warn");
    });
  });

  it("stays ok — never a finding — when it cannot tell", async () => {
    // The rule that keeps the check worth reading.
    app = appWith("memory");
    await withApp(app, async () => {
      const result = await check().run(app!);
      expect(result.status).toBe("ok");
      expect(result.message).toContain("cannot verify");
    });
  });
});

describe("describeBeat", () => {
  it("reads as prose at each scale", () => {
    expect(describeBeat({ status: "never" })).toBe("has never checked in");
    expect(describeBeat({ status: "seen", beat: { at: "" }, ageSeconds: 10 })).toBe(
      "checked in just now",
    );
    expect(describeBeat({ status: "seen", beat: { at: "" }, ageSeconds: 600 })).toContain(
      "10 minutes ago",
    );
    expect(describeBeat({ status: "seen", beat: { at: "" }, ageSeconds: 7200 })).toContain(
      "2 hours ago",
    );
  });
});
