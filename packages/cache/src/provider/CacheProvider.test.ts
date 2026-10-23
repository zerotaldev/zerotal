import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "@zerotal/core";
import type { AppEnvironment } from "@zerotal/core";
import { Heartbeat } from "@zerotal/core/heartbeat";
import { CacheProvider } from "./CacheProvider.ts";

/**
 * The scheduler runs in the worker and writes its heartbeat to the cache; `zt doctor` reads it.
 * The cache provider was not registered in the worker, so the heartbeat resolved no cache and
 * did nothing ("never throws" is the right rule for a heartbeat), and doctor reported a worker
 * that was running every schedule as one that had never checked in.
 */
let dir: string;

beforeEach(async () => {
  Application._resetInstance();
  dir = await mkdtemp(join(tmpdir(), "zt-cache-provider-"));
});

afterEach(async () => {
  Application._resetInstance();
  // The cache keeps its SQLite handle for the life of the process (there is no close() to call),
  // and Windows will not delete a file that is open. The directory is in the OS temp folder.
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

async function boot(env: AppEnvironment): Promise<Application> {
  const app = Application.create({
    env,
    providers: [CacheProvider],
    config: { cache: { driver: "sqlite", sqlite: { path: join(dir, "cache.sqlite") } } },
  });
  await app.boot();
  return app;
}

describe("CacheProvider environments", () => {
  it.each(["web", "console", "worker", "test", "repl"] as const)(
    "binds the cache in %s",
    async (env) => {
      const app = await boot(env);

      // tryMake() answers undefined for a binding that is not there, not null.
      expect(app.container.tryMake("cache") ?? null).not.toBeNull();
    },
  );
});

describe("the worker's heartbeat", () => {
  it("is written to the cache and read back by another reader", async () => {
    await boot("worker");

    await Heartbeat.beat("scheduler", { detail: "8 schedules" });

    const seen = await Heartbeat.lastSeen("scheduler");
    expect(seen.status).toBe("seen");
  });

  it("is reported as never seen, not lost, when nothing has beaten", async () => {
    await boot("console");

    expect((await Heartbeat.lastSeen("scheduler")).status).toBe("never");
  });
});
