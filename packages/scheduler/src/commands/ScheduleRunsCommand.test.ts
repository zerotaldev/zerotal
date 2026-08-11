import { describe, it, expect } from "bun:test";
import { ScheduleRunsCommand } from "./ScheduleRunsCommand.ts";
import type { ScheduleRunRecord, ScheduleRunStore } from "../runLog.ts";

class Collector {
  out = "";
  write(s: string) {
    this.out += s;
  }
  writeLine(s: string) {
    this.out += s + "\n";
  }
  writeError(s: string) {
    this.out += s + "\n";
  }
}

class MemoryStore implements ScheduleRunStore {
  runs: ScheduleRunRecord[] = [];
  record(run: ScheduleRunRecord) {
    this.runs.push(run);
  }
  recent(limit = 50, name?: string) {
    const filtered = name === undefined ? this.runs : this.runs.filter((r) => r.name === name);
    return filtered.slice(-limit).reverse();
  }
  lastFor(name: string) {
    return this.recent(1, name)[0];
  }
}

function make(store?: ScheduleRunStore, args: Record<string, string> = {}) {
  const c = new ScheduleRunsCommand();
  const col = new Collector();
  (c as unknown as { _writer: Collector })._writer = col;
  c.args = args;
  c.flags = {};
  (c as unknown as { app: unknown }).app = {
    container: { tryMake: (k: string) => (k === "scheduler.runs" ? store : undefined) },
  };
  return { c, col };
}

function run(name: string, ok = true, error?: string): ScheduleRunRecord {
  return {
    name,
    startedAt: "2026-08-10T03:00:00.000Z",
    finishedAt: "2026-08-10T03:00:05.000Z",
    durationMs: 5000,
    ok,
    ...(error !== undefined ? { error } : {}),
  };
}

describe("schedule:runs", () => {
  it("lists recent runs with result and duration", async () => {
    const store = new MemoryStore();
    store.record(run("popia:sweep"));
    store.record(run("billing:invoice", false, "db locked"));
    const { c, col } = make(store);
    await c.run();
    expect(col.out).toContain("popia:sweep");
    expect(col.out).toContain("billing:invoice");
    expect(col.out).toContain("FAILED — db locked");
    expect(col.out).toContain("5000 ms");
  });

  it("filters to one task by name", async () => {
    const store = new MemoryStore();
    store.record(run("a"));
    store.record(run("b"));
    const { c, col } = make(store, { name: "a" });
    await c.run();
    expect(col.out).toContain("Runs of a");
    expect(col.out).not.toContain('"b"');
  });

  it("reports an empty history", async () => {
    const { c, col } = make(new MemoryStore());
    await c.run();
    expect(col.out).toContain("No recorded runs");
  });

  it("errors when the store is not registered", async () => {
    const { c, col } = make(undefined);
    await c.run();
    expect(col.out).toContain("Run store not registered");
  });
});
