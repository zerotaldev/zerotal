/**
 * Creating the queue tables is retried after a failure, not cached as one.
 *
 * On a fresh PostgreSQL database two processes create the tables at the same time,
 * and PostgreSQL can refuse one of the concurrent `CREATE … IF NOT EXISTS`. The
 * driver used to keep that rejected promise, so every dispatch in the process failed
 * until it restarted. Reproduced here on SQLite with a connection whose first
 * statement fails.
 */
import { describe, it, expect } from "bun:test";
import { SQL } from "bun";
import type { SQLInstance } from "@zerotal/orm";
import { DatabaseDriver } from "./DatabaseDriver.ts";

/** A SQLite connection whose first `unsafe()` statement throws. */
function flakyOnce(): SQLInstance {
  const sql = new SQL(":memory:");
  let failed = false;
  const unsafe = sql.unsafe.bind(sql);
  (sql as unknown as { unsafe: (query: string) => unknown }).unsafe = (query: string) => {
    if (!failed) {
      failed = true;
      return Promise.reject(new Error("duplicate key value violates unique constraint"));
    }
    return unsafe(query);
  };
  return sql as unknown as SQLInstance;
}

describe("DatabaseDriver table setup", () => {
  it("retries after a failed attempt instead of failing every later call", async () => {
    const driver = new DatabaseDriver(flakyOnce(), { dialect: "sqlite" });
    // The constructor's eager attempt hit the failure; let it settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    await driver.push({
      queue: "default",
      className: "GreetJob",
      payload: "{}",
      attempts: 0,
      maxAttempts: 3,
      retryDelay: 1000,
      availableAt: Math.floor(Date.now() / 1000),
    });
    expect(await driver.size("default")).toBe(1);
  });
});
