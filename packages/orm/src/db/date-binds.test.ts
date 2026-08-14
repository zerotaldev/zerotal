/**
 * A `Date` reaching the driver as a bind parameter.
 *
 * `model.save()` applies casts and serialises dates, so
 * `n.readAt = new Date(); await n.save()` works. The same value through the
 * query builder did not: `update({ read_at: new Date() })` bound the `Date`
 * object straight through, SQLite discarded it, and **the statement reported no
 * error**. A "mark all as read" feature shipped as a latent no-op, and the code
 * read correctly.
 *
 * The where path already learned this lesson — a `Date` comparison against
 * `created_at` used to match zero rows, so it is serialised there. These tests
 * hold the write path to the same rule, on the builder every app reaches for.
 */
import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { DB } from "./DB.ts";
import { _setDbConnection } from "../index.ts";
import { Carbon } from "@zerotal/core/carbon";

beforeAll(async () => {
  _setDbConnection(new SQL(":memory:") as never);
  await DB.raw(
    `CREATE TABLE notifications (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       type TEXT,
       read_at TEXT,
       created_at TEXT
     )`,
  );
});

beforeEach(async () => {
  await DB.raw(`DELETE FROM notifications`);
  await DB.table("notifications").insert({ type: "bill.due", read_at: null });
});

describe("QueryBuilder.update with a Date", () => {
  it("writes the date instead of silently doing nothing", async () => {
    const when = new Date("2026-08-14T10:49:27.000Z");

    await DB.table("notifications").whereNull("read_at").update({ read_at: when });

    const row = await DB.table("notifications").first<{ read_at: string | null }>();
    expect(row?.read_at).not.toBeNull();
    expect(String(row?.read_at)).toContain("2026-08-14");
  });

  it("round-trips to the same instant", async () => {
    const when = new Date("2026-08-14T10:49:27.000Z");
    await DB.table("notifications").update({ read_at: when });

    const row = await DB.table("notifications").first<{ read_at: string }>();
    expect(new Date(row!.read_at).getTime()).toBe(when.getTime());
  });

  it("handles a Carbon the same way", async () => {
    const when = Carbon.create("2026-08-14T10:49:27.000Z");
    await DB.table("notifications").update({ read_at: when });

    const row = await DB.table("notifications").first<{ read_at: string | null }>();
    expect(row?.read_at).not.toBeNull();
    expect(String(row?.read_at)).toContain("2026-08-14");
  });

  it("leaves an explicit ISO string alone", async () => {
    await DB.table("notifications").update({ read_at: "2026-08-14 10:49:27" });

    const row = await DB.table("notifications").first<{ read_at: string }>();
    expect(row!.read_at).toBe("2026-08-14 10:49:27");
  });

  it("still writes null", async () => {
    await DB.table("notifications").update({ read_at: new Date() });
    await DB.table("notifications").update({ read_at: null });

    const row = await DB.table("notifications").first<{ read_at: string | null }>();
    expect(row?.read_at).toBeNull();
  });
});

describe("QueryBuilder.insert with a Date", () => {
  it("writes the date rather than dropping the column", async () => {
    const when = new Date("2026-01-02T03:04:05.000Z");
    await DB.table("notifications").insert({ type: "welcome", created_at: when });

    const row = await DB.table("notifications")
      .where("type", "welcome")
      .first<{ created_at: string | null }>();
    expect(row?.created_at).not.toBeNull();
    expect(new Date(row!.created_at!).getTime()).toBe(when.getTime());
  });
});
