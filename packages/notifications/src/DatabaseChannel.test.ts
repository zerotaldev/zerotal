import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { DatabaseChannel } from "./DatabaseChannel.ts";
import { Notification } from "./Notification.ts";
import type { Notifiable } from "./types.ts";

function makeSQLiteInstance(dbPath: string): { db: SQLInstance; close(): void } {
  const sqlite = new Database(dbPath);
  const fn = function <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
    const parts = Array.from(strings);
    const sql = parts.reduce((q, part, i) => q + (i > 0 ? "?" : "") + part, "");
    const stmt = sqlite.prepare(sql);
    return Promise.resolve(stmt.all(...(values as Parameters<typeof stmt.all>)) as T[]);
  };
  return { db: fn as unknown as SQLInstance, close: () => sqlite.close() };
}

let adapter: { db: SQLInstance; close(): void };
let db: SQLInstance;
let channel: DatabaseChannel;

class Ping extends Notification {
  constructor(private n: number = 0) {
    super();
  }
  channels() {
    return ["database"];
  }
  toDatabase() {
    return { n: this.n };
  }
}

beforeAll(async () => {
  adapter = makeSQLiteInstance(":memory:");
  db = adapter.db;
  channel = new DatabaseChannel("inbox", db);
  await new Promise<void>((r) => setTimeout(r, 20));
});

afterAll(() => adapter.close());

beforeEach(async () => {
  await db`DELETE FROM inbox`;
});

describe("DatabaseChannel — recipient scoping", () => {
  class User {
    constructor(public id: number) {}
  }
  class Team {
    constructor(public id: number) {}
  }

  it("stores the recipient's own class as notifiable_type", async () => {
    await channel.send(new User(1) as unknown as Notifiable, new Ping(1));
    const rows = await db<{ notifiable_type: string }>`SELECT notifiable_type FROM inbox`;
    expect(rows[0]!.notifiable_type).toBe("User");
  });

  it("does not leak between models that share an id", async () => {
    const user = new User(1) as unknown as Notifiable;
    const team = new Team(1) as unknown as Notifiable;

    await channel.send(user, new Ping(1));
    await channel.send(team, new Ping(2));
    await channel.send(team, new Ping(3));

    expect(await channel.all(user)).toHaveLength(1);
    expect(await channel.all(team)).toHaveLength(2);
    expect(await channel.unreadCount(user)).toBe(1);
    expect(await channel.unreadCount(team)).toBe(2);
  });

  it("marking one model's inbox read leaves the other's alone", async () => {
    const user = new User(1) as unknown as Notifiable;
    const team = new Team(1) as unknown as Notifiable;
    await channel.send(user, new Ping(1));
    await channel.send(team, new Ping(2));

    await channel.markAllAsRead(user);

    expect(await channel.unreadCount(user)).toBe(0);
    expect(await channel.unreadCount(team)).toBe(1);
  });

  it("clear() removes only that recipient's rows", async () => {
    const user = new User(1) as unknown as Notifiable;
    const team = new Team(1) as unknown as Notifiable;
    await channel.send(user, new Ping(1));
    await channel.send(team, new Ping(2));

    await channel.clear(user);

    expect(await channel.all(user)).toHaveLength(0);
    expect(await channel.all(team)).toHaveLength(1);
  });
});

describe("DatabaseChannel — read state", () => {
  const user: Notifiable = { id: 1, __type: "User" } as unknown as Notifiable;

  it("markAsUnread reverses markAsRead", async () => {
    await channel.send(user, new Ping(1));
    const [row] = await channel.unread(user);

    await channel.markAsRead(row!.id);
    expect(await channel.unreadCount(user)).toBe(0);

    await channel.markAsUnread(row!.id);
    expect(await channel.unreadCount(user)).toBe(1);
  });

  it("unreadCount counts without loading rows", async () => {
    for (let i = 0; i < 5; i++) await channel.send(user, new Ping(i));
    expect(await channel.unreadCount(user)).toBe(5);
  });

  it("delete() removes a single notification", async () => {
    await channel.send(user, new Ping(1));
    const [row] = await channel.all(user);
    await channel.delete(row!.id);
    expect(await channel.all(user)).toHaveLength(0);
  });
});

describe("DatabaseChannel — paging", () => {
  const user: Notifiable = { id: 1, __type: "User" } as unknown as Notifiable;

  it("caps results at 100 by default", async () => {
    for (let i = 0; i < 120; i++) await channel.send(user, new Ping(i));
    expect(await channel.all(user)).toHaveLength(100);
  });

  it("honours limit and offset", async () => {
    for (let i = 0; i < 10; i++) await channel.send(user, new Ping(i));

    const firstPage = await channel.all(user, { limit: 3 });
    const secondPage = await channel.all(user, { limit: 3, offset: 3 });

    expect(firstPage).toHaveLength(3);
    expect(secondPage).toHaveLength(3);
    expect(firstPage.map((r) => r.id)).not.toEqual(secondPage.map((r) => r.id));
  });

  it("limit: 0 means no limit", async () => {
    for (let i = 0; i < 105; i++) await channel.send(user, new Ping(i));
    expect(await channel.all(user, { limit: 0 })).toHaveLength(105);
  });

  it("coerces a fractional or negative limit rather than emitting broken SQL", async () => {
    await channel.send(user, new Ping(1));
    await expect(channel.all(user, { limit: 2.7, offset: -5 })).resolves.toHaveLength(1);
  });
});

describe("DatabaseChannel — prune", () => {
  const user: Notifiable = { id: 1, __type: "User" } as unknown as Notifiable;

  /** Write a row directly so its created_at can be backdated. */
  async function seed(daysAgo: number, read: boolean): Promise<void> {
    const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    await db`INSERT INTO inbox (id, notifiable_type, notifiable_id, type, data, read_at, created_at)
             VALUES (${crypto.randomUUID()}, 'User', '1', 'Ping', '{}', ${read ? at : null}, ${at})`;
  }

  it("deletes read notifications older than the threshold", async () => {
    await seed(60, true);
    await seed(60, true);
    await seed(1, true);

    const deleted = await channel.prune(30);

    expect(deleted).toBe(2);
    expect(await channel.all(user)).toHaveLength(1);
  });

  it("leaves unread notifications alone by default", async () => {
    await seed(60, false);
    await seed(60, true);

    const deleted = await channel.prune(30);

    expect(deleted).toBe(1);
    expect(await channel.unreadCount(user)).toBe(1);
  });

  it("prunes unread too when asked", async () => {
    await seed(60, false);
    await seed(60, true);

    const deleted = await channel.prune(30, true);

    expect(deleted).toBe(2);
    expect(await channel.all(user)).toHaveLength(0);
  });
});

describe("DatabaseChannel — schema", () => {
  it("creates indexes for the recipient lookups", async () => {
    const rows = await db<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='inbox'
    `;
    const names = rows.map((r) => r.name);
    expect(names).toContain("inbox_notifiable_idx");
    expect(names).toContain("inbox_unread_idx");
  });

  it("still rejects an unsafe table name", () => {
    expect(() => new DatabaseChannel("bad; DROP TABLE--", db)).toThrow("Invalid table name");
  });

  it("recent() returns rows across every notifiable", async () => {
    await channel.send({ id: 1, __type: "User" } as unknown as Notifiable, new Ping(1));
    await channel.send({ id: 2, __type: "Team" } as unknown as Notifiable, new Ping(2));

    const rows = await channel.recent(10);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
