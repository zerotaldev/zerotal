import { describe, it, expect } from "bun:test";
import {
  QueryExecuted,
  NPlusOneDetected,
  TransactionStarted,
  TransactionCommitted,
  TransactionRolledBack,
  MigrationRan,
  ModelChanged,
} from "./events.ts";

describe("ORM framework events carry their fields", () => {
  it("QueryExecuted", () => {
    const e = new QueryExecuted("SELECT 1", [1], 1000, 2, 1, undefined);
    expect(e.sql).toBe("SELECT 1");
    expect(e.rowCount).toBe(1);
    expect(e.durationMs).toBe(2);
  });

  it("NPlusOneDetected", () => {
    const e = new NPlusOneDetected("SELECT * FROM x WHERE id = \x00", 6, undefined);
    expect(e.count).toBe(6);
  });

  it("transaction lifecycle events", () => {
    expect(new TransactionStarted("tx1", undefined).txId).toBe("tx1");
    expect(new TransactionCommitted("tx1", 7, undefined).durationMs).toBe(7);
    expect(new TransactionRolledBack("tx1", 7, "deadlock", undefined).reason).toBe("deadlock");
  });

  it("MigrationRan", () => {
    const e = new MigrationRan("2026_create_users", "up", 40, true);
    expect(e.direction).toBe("up");
    expect(e.ok).toBe(true);
  });

  it("ModelChanged", () => {
    const e = new ModelChanged("User", "users", "created");
    expect(e.model).toBe("User");
    expect(e.operation).toBe("created");
  });
});
