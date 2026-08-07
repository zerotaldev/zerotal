import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TraceStore, traceStore, _setTraceStore } from "./TraceStore.ts";
import type { RequestTrace } from "./RequestTrace.ts";

function trace(overrides: Partial<RequestTrace> = {}): RequestTrace {
  return {
    id: crypto.randomUUID().slice(0, 12),
    requestId: "req",
    method: "GET",
    path: "/",
    statusCode: 200,
    startMs: Date.now(),
    durationMs: 1,
    queries: [],
    warnings: [],
    memory: 0,
    queryParams: {},
    headers: {},
    route: null,
    auth: null,
    logs: [],
    mail: [],
    cache: [],
    jobs: [],
    channels: {},
    ...overrides,
  };
}

const _dirs: string[] = [];
function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "zerotal-devtools-"));
  _dirs.push(dir);
  return join(dir, "traces.sqlite");
}

afterEach(() => {
  _setTraceStore(null);
  for (const dir of _dirs.splice(0)) {
    // Best-effort: Windows can hold a just-closed SQLite file briefly, and a
    // leftover directory under the OS temp dir is not worth failing a test over.
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* the OS will reclaim it */
    }
  }
});

describe("TraceStore — memory only", () => {
  it("keeps traces newest first and caps at capacity", () => {
    const store = new TraceStore({ dbPath: null, capacity: 2 });

    store.push(trace({ path: "/a" }));
    store.push(trace({ path: "/b" }));
    store.push(trace({ path: "/c" }));

    expect(store.all().map((t) => t.path)).toEqual(["/c", "/b"]);
    store.dispose();
  });

  it("never touches the disk when dbPath is null", () => {
    const store = new TraceStore({ dbPath: null });
    store.push(trace());

    expect(store.persisting).toBe(false);
    store.dispose();
  });

  it("notifies subscribers on push and on clear", () => {
    const store = new TraceStore({ dbPath: null });
    const seen: Array<string | null> = [];
    const off = store.subscribe((t) => seen.push(t?.path ?? null));

    store.push(trace({ path: "/one" }));
    store.clear();

    expect(seen).toEqual(["/one", null]);
    off();
    store.push(trace({ path: "/after" }));
    expect(seen).toHaveLength(2);
    store.dispose();
  });
});

describe("TraceStore — persistence", () => {
  it("does not open the database until it is used", () => {
    const path = tempDb();
    const store = new TraceStore({ dbPath: path });

    // Opening from the constructor is what made a bare import of this package
    // write a file into the working directory of every process, production
    // included.
    expect(existsSync(path)).toBe(false);

    store.push(trace());
    expect(existsSync(path)).toBe(true);
    store.dispose();
  });

  it("reloads history into a new store", () => {
    const path = tempDb();

    const first = new TraceStore({ dbPath: path });
    first.push(trace({ path: "/persisted" }));
    first.dispose(); // flushes the pending batch

    const second = new TraceStore({ dbPath: path });
    expect(second.all().map((t) => t.path)).toEqual(["/persisted"]);
    second.dispose();
  });

  it("clear() empties the persisted history too", () => {
    const path = tempDb();

    const first = new TraceStore({ dbPath: path });
    first.push(trace({ path: "/gone" }));
    first.clear();
    first.dispose();

    const second = new TraceStore({ dbPath: path });
    expect(second.all()).toEqual([]);
    second.dispose();
  });

  it("keeps two stores independent", () => {
    // The persistence state used to live at module scope, so a second store
    // reassigned the first one's handle and shared its pending batch.
    const a = new TraceStore({ dbPath: tempDb() });
    const b = new TraceStore({ dbPath: tempDb() });

    a.push(trace({ path: "/a" }));
    b.push(trace({ path: "/b" }));

    expect(a.all().map((t) => t.path)).toEqual(["/a"]);
    expect(b.all().map((t) => t.path)).toEqual(["/b"]);

    a.dispose();
    b.dispose();
  });

  it("prunes entries older than the retention window", () => {
    const path = tempDb();

    const first = new TraceStore({ dbPath: path, pruneHours: 1 });
    first.push(trace({ path: "/old", startMs: Date.now() - 7_200_000 }));
    first.push(trace({ path: "/fresh" }));
    first.dispose();

    // The next store prunes on open.
    const second = new TraceStore({ dbPath: path, pruneHours: 1 });
    expect(second.all().map((t) => t.path)).toEqual(["/fresh"]);
    second.dispose();
  });

  it("degrades to memory when the path cannot be opened", () => {
    // A directory is not a database file.
    const store = new TraceStore({ dbPath: tmpdir() });
    store.push(trace({ path: "/still-works" }));

    expect(store.persisting).toBe(false);
    expect(store.all().map((t) => t.path)).toEqual(["/still-works"]);
    store.dispose();
  });
});

describe("the process-wide store", () => {
  it("creates one on first call and returns the same instance after", () => {
    expect(traceStore()).toBe(traceStore());
  });

  it("_setTraceStore installs a replacement and disposes the old one", () => {
    const first = new TraceStore({ dbPath: null });
    _setTraceStore(first);
    first.push(trace({ path: "/first" }));

    const second = new TraceStore({ dbPath: null });
    _setTraceStore(second);

    expect(traceStore()).toBe(second);
    expect(traceStore().all()).toEqual([]);
  });

  it("_setTraceStore(null) drops the store so the next call builds a fresh one", () => {
    const installed = new TraceStore({ dbPath: null });
    _setTraceStore(installed);
    _setTraceStore(null);

    expect(traceStore()).not.toBe(installed);
  });
});
