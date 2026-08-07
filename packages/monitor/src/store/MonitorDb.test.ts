import { describe, it, expect } from "bun:test";
import { MonitorDb } from "./MonitorDb.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function req(db: MonitorDb, t: number, path: string): void {
  db.recordRequest({
    t,
    method: "GET",
    path,
    status: 200,
    ms: 10,
    nplus: 0,
    queries: "[]",
    user: null,
    ip: null,
    mem: 0,
    context: "{}",
  });
}

describe("MonitorDb", () => {
  it("buffers writes off the hot path and persists them on flush", () => {
    const db = new MonitorDb(":memory:");
    const now = Date.now();
    req(db, now, "/a");
    req(db, now, "/b");
    // Buffered, not yet written.
    expect(db.requestsWithin(0).length).toBe(0);
    db.flush();
    expect(db.requestsWithin(0).length).toBe(2);
    db.dispose();
  });

  it("auto-flushes when the buffer reaches its size cap", () => {
    const db = new MonitorDb(":memory:");
    const now = Date.now();
    for (let i = 0; i < 2100; i++) req(db, now, `/r${i}`); // cap is 2000
    // The cap flush already persisted the bulk without an explicit flush.
    expect(db.requestsWithin(0).length).toBeGreaterThanOrEqual(2000);
    db.flush();
    expect(db.requestsWithin(0).length).toBe(2100);
    db.dispose();
  });

  it("windowed reads return only rows within the cutoff (range support)", () => {
    const db = new MonitorDb(":memory:");
    const now = Date.now();
    req(db, now, "/a");
    req(db, now - 2 * HOUR, "/b");
    req(db, now - 8 * DAY, "/c");
    db.flush(); // writes are buffered; drain before reading the raw DB layer

    expect(db.requestsWithin(now - HOUR).length).toBe(1); // live/1h → just /a
    expect(db.requestsWithin(now - 24 * HOUR).length).toBe(2); // 24h → /a + /b
    expect(db.requestsWithin(now - 9 * DAY).length).toBe(3); // 7d+ → all
    db.dispose();
  });

  it("requestsBetween bounds both ends (prior-window deltas)", () => {
    const db = new MonitorDb(":memory:");
    const now = Date.now();
    req(db, now, "/a");
    req(db, now - 90 * 60 * 1000, "/b"); // 1.5h ago
    db.flush();
    expect(db.requestsBetween(now - 2 * HOUR, now - HOUR).length).toBe(1); // only /b
    db.dispose();
  });

  it("prune deletes old rows; archive mode moves them aside", () => {
    const now = Date.now();

    const del = new MonitorDb(":memory:");
    del.recordQuery({ t: now, sql: "SELECT 1", ms: 5, location: "x" });
    del.recordQuery({ t: now - 8 * DAY, sql: "SELECT 2", ms: 5, location: "x" });
    expect(del.prune(now - 7 * DAY, "delete")).toBe(1);
    expect(del.info().queries).toBe(1);
    expect(del.info().archived).toBe(0);
    del.dispose();

    const arc = new MonitorDb(":memory:");
    arc.recordQuery({ t: now, sql: "SELECT 1", ms: 5, location: "x" });
    arc.recordQuery({ t: now - 8 * DAY, sql: "SELECT 2", ms: 5, location: "x" });
    expect(arc.prune(now - 7 * DAY, "archive")).toBe(1);
    expect(arc.info().queries).toBe(1);
    expect(arc.info().archived).toBe(1); // moved, not destroyed
    arc.dispose();
  });

  it("wipe clears every table", () => {
    const db = new MonitorDb(":memory:");
    const now = Date.now();
    req(db, now, "/a");
    db.recordCache({ t: now, hit: 1, key: "k" });
    expect(db.info().requests).toBe(1);
    expect(db.wipe()).toBe(2);
    expect(db.info().requests).toBe(0);
    expect(db.info().cacheEvents).toBe(0);
    db.dispose();
  });

  it("info reports the oldest sample", () => {
    const db = new MonitorDb(":memory:");
    const now = Date.now();
    req(db, now, "/a");
    req(db, now - 3 * DAY, "/b");
    expect(db.info().oldestMs).toBe(now - 3 * DAY);
    db.dispose();
  });
});
