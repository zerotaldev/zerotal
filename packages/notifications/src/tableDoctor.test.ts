/**
 * `notifications` is a very ordinary name for a table an app already owns.
 *
 * The framework's default `database.table` is exactly that name, and one app's own
 * `notifications` was a completely different shape — `household_id`, `title`, `body`,
 * `action_url`, with an in-app inbox reading it. The only thing between the
 * framework's channel and a wrong-shaped insert into that inbox was that no
 * notification's `channels()` happened to return `"database"`.
 */
import { describe, it, expect } from "bun:test";
import { SQL } from "bun";
import { notificationsTableCheck } from "./tableDoctor.ts";

function appWith(sql: unknown, table = "notifications") {
  return {
    container: {
      makeSync: (key: string) =>
        key === "db"
          ? sql
          : {
              get: <T>(k: string, d: T): T =>
                k === "notifications" ? ({ database: { table } } as T) : d,
            },
    },
  } as never;
}

/** An app-owned inbox that happens to be called `notifications`. */
async function appsOwnTable(): Promise<SQL> {
  const sql = new SQL(":memory:");
  await sql`CREATE TABLE notifications (
    id INTEGER PRIMARY KEY, household_id INTEGER, user_id INTEGER,
    title TEXT, body TEXT, action_url TEXT
  )`;
  return sql;
}

/** The shape `DatabaseChannel` actually writes. */
async function frameworksTable(): Promise<SQL> {
  const sql = new SQL(":memory:");
  await sql`CREATE TABLE notifications (
    id TEXT PRIMARY KEY, notifiable_type TEXT, notifiable_id TEXT,
    type TEXT, data TEXT, read_at TEXT, created_at TEXT
  )`;
  return sql;
}

describe("notificationsTableCheck", () => {
  it("fails on a table of the same name and a different shape", async () => {
    const result = await notificationsTableCheck.run(appWith(await appsOwnTable()));

    expect(result.status).toBe("fail");
    expect(result.message).toContain("notifiable_type");
    expect(result.fix).toContain("database.table");
  });

  it("passes on the table the channel actually writes", async () => {
    expect((await notificationsTableCheck.run(appWith(await frameworksTable()))).status).toBe("ok");
  });

  it("says nothing before the migration has run", async () => {
    // A fresh checkout has no table, and warning about that would fire for everyone.
    const sql = new SQL(":memory:");
    expect((await notificationsTableCheck.run(appWith(sql))).status).toBe("ok");
  });

  it("checks the configured name, not the default", async () => {
    const sql = await appsOwnTable();
    // Pointed elsewhere, the app's own table is none of the framework's business.
    expect(
      (await notificationsTableCheck.run(appWith(sql, "framework_notifications"))).status,
    ).toBe("ok");
  });
});
