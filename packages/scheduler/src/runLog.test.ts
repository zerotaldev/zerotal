import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FrameworkEvents } from "@zerotal/core";
import type { Application } from "@zerotal/core";
import { TaskRan, TaskFailed } from "./events.ts";
import {
  FileScheduleRunStore,
  installScheduleRunLog,
  resolveRunLogConfig,
  type ScheduleRunRecord,
} from "./runLog.ts";

let dir: string;
let path: string;

beforeEach(() => {
  dir = join(tmpdir(), `zt-runlog-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  path = join(dir, "schedule-runs.jsonl");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(name: string, ok = true, extra: Partial<ScheduleRunRecord> = {}): ScheduleRunRecord {
  return {
    name,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 5,
    ok,
    ...extra,
  };
}

describe("FileScheduleRunStore", () => {
  it("records and reads back, newest first", () => {
    const store = new FileScheduleRunStore(path);
    store.record(run("a"));
    store.record(run("b"));
    store.record(run("c"));
    expect(store.recent().map((r) => r.name)).toEqual(["c", "b", "a"]);
  });

  it("survives a new store instance — the whole point", () => {
    new FileScheduleRunStore(path).record(run("sweep", false, { error: "boom" }));
    const rebooted = new FileScheduleRunStore(path);
    expect(rebooted.lastFor("sweep")?.error).toBe("boom");
  });

  it("filters by name and respects the limit", () => {
    const store = new FileScheduleRunStore(path);
    for (let i = 0; i < 5; i++) store.record(run("a", true, { durationMs: i }));
    store.record(run("b"));
    const runs = store.recent(3, "a");
    expect(runs).toHaveLength(3);
    expect(runs.every((r) => r.name === "a")).toBe(true);
    expect(runs[0]!.durationMs).toBe(4); // newest first
  });

  it("lastFor() returns the most recent run of that task", () => {
    const store = new FileScheduleRunStore(path);
    store.record(run("a", true));
    store.record(run("a", false, { error: "later" }));
    expect(store.lastFor("a")?.error).toBe("later");
    expect(store.lastFor("missing")).toBeUndefined();
  });

  it("compacts at twice the cap, keeping the newest", () => {
    const store = new FileScheduleRunStore(path, 3);
    for (let i = 0; i < 6; i++) store.record(run("t", true, { durationMs: i }));
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(store.recent().map((r) => r.durationMs)).toEqual([5, 4, 3]);
  });

  it("drops a torn line instead of failing the read", () => {
    const store = new FileScheduleRunStore(path);
    store.record(run("ok"));
    writeFileSync(path, readFileSync(path, "utf8") + '{"name":"torn","start');
    expect(store.recent().map((r) => r.name)).toEqual(["ok"]);
    // …and the next append still works.
    store.record(run("after"));
    expect(store.recent()[0]!.name).toBe("after");
  });
});

/** Minimal Application stand-in: a container with config + the run store bound. */
function fakeApp(configValues: Record<string, unknown>, store: FileScheduleRunStore): Application {
  return {
    container: {
      makeSync: (key: string) => {
        if (key === "config") return { get: (k: string) => configValues[k] };
        throw new Error(`unbound: ${key}`);
      },
      tryMake: (key: string) => (key === "scheduler.runs" ? store : undefined),
    },
  } as unknown as Application;
}

describe("installScheduleRunLog", () => {
  it("records TaskRan and TaskFailed, and the disposer unsubscribes", () => {
    const store = new FileScheduleRunStore(path);
    const app = fakeApp({ "scheduler.runLog": { enabled: true } }, store);
    const dispose = installScheduleRunLog(app)!;
    expect(dispose).toBeDefined();

    FrameworkEvents.emit(new TaskRan("sweep", 12, true));
    FrameworkEvents.emit(new TaskFailed("purge", 34, "db locked"));

    const runs = store.recent();
    expect(runs.map((r) => [r.name, r.ok])).toEqual([
      ["purge", false],
      ["sweep", true],
    ]);
    expect(runs[0]!.error).toBe("db locked");
    expect(runs[0]!.durationMs).toBe(34);

    dispose();
    FrameworkEvents.emit(new TaskRan("sweep", 1, true));
    expect(store.recent()).toHaveLength(2);
  });

  it("does nothing when disabled", () => {
    const store = new FileScheduleRunStore(path);
    const app = fakeApp({ "scheduler.runLog": { enabled: false } }, store);
    expect(installScheduleRunLog(app)).toBeUndefined();
  });

  it("defaults to disabled under APP_ENV=test", () => {
    // The test suite itself runs under APP_ENV=test, so the default must be off —
    // a suite that boots createTestApp() should not write run files into the repo.
    const store = new FileScheduleRunStore(path);
    const app = fakeApp({}, store);
    const config = resolveRunLogConfig(app);
    expect(config.enabled).toBe(Bun.env["APP_ENV"] !== "test");
  });
});
