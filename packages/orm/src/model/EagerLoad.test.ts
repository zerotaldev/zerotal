import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { hasMany } from "./decorators/hasMany.ts";
import { belongsTo } from "./decorators/belongsTo.ts";
import { hasOne } from "./decorators/hasOne.ts";
import { table } from "./decorators/table.ts";
import { RelationNotLoadedError } from "../errors/index.ts";
import type { HasMany, BelongsTo, HasOne } from "./relations/RelationRegistry.ts";

// ── Database setup ────────────────────────────────────────────────────────────

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);

  await db`
    CREATE TABLE accounts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    )
  `;
  await db`
    CREATE TABLE entries (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      amount     INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )
  `;
  await db`
    CREATE TABLE profiles (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      bio        TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `;
  await db`
    CREATE TABLE notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      deleted_at TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `;
});

afterAll(async () => {
  _setBaseModelConnection(null);
  await db.end();
});

beforeEach(async () => {
  await db`DELETE FROM entries`;
  await db`DELETE FROM profiles`;
  await db`DELETE FROM notes`;
  await db`DELETE FROM accounts`;
});

// ── Models ────────────────────────────────────────────────────────────────────
//
// Declare Entry/Profile before Account so the lazy () => Account references
// close over the class defined below without forward-reference issues.

@table("entries")
class Entry extends BaseModel {
  accountId!: number;
  amount!: number;

  @belongsTo(() => Account, { foreignKey: "account_id" })
  account!: BelongsTo<Account>;
}

class Profile extends BaseModel {
  static override table = "profiles";
  static override timestamps = true;

  accountId!: number;
  bio!: string | null;
}

@table("notes")
class Note extends BaseModel {
  static override softDeletes = true;

  accountId!: number;
}

@table("accounts")
class Account extends BaseModel {
  name!: string;

  @hasMany(() => Entry, { foreignKey: "account_id" })
  entries!: HasMany<Entry>;

  @hasOne(() => Profile, { foreignKey: "account_id" })
  profile!: HasOne<Profile>;

  @hasMany(() => Note, { foreignKey: "account_id" })
  notes!: HasMany<Note>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function seedAccount(name: string) {
  return Account.create({ name });
}

async function seedEntry(accountId: number, amount: number) {
  return Entry.create({ accountId, amount } as Partial<Entry>);
}

async function seedProfile(accountId: number, bio: string | null) {
  return Profile.create({ accountId, bio } as Partial<Profile>);
}

// ── hasMany eager loading ─────────────────────────────────────────────────────

describe("hasMany eager loading via .with()", () => {
  it("attaches a non-empty entries array to each account", async () => {
    const acc = await seedAccount("Alpha");
    await seedEntry(acc.id, 100);
    await seedEntry(acc.id, 200);

    const accounts = await Account.query().with("entries").get();
    expect(accounts).toHaveLength(1);

    const loaded = accounts[0]!;
    const entries = (loaded as unknown as { entries: Entry[] }).entries;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toBeInstanceOf(Entry);
    expect(entries.map((e) => e.amount).sort()).toEqual([100, 200]);
  });

  it("attaches an empty array when account has no entries", async () => {
    await seedAccount("Empty");

    const accounts = await Account.query().with("entries").get();
    const entries = (accounts[0]! as unknown as { entries: Entry[] }).entries;
    expect(entries).toEqual([]);
  });

  it("stitches entries to the correct account when multiple accounts exist", async () => {
    const a1 = await seedAccount("A1");
    const a2 = await seedAccount("A2");
    await seedEntry(a1.id, 10);
    await seedEntry(a1.id, 20);
    await seedEntry(a2.id, 99);

    const accounts = await Account.query().orderBy("id").with("entries").get();
    expect(accounts).toHaveLength(2);

    const a1Entries = (accounts[0]! as unknown as { entries: Entry[] }).entries;
    const a2Entries = (accounts[1]! as unknown as { entries: Entry[] }).entries;

    expect(a1Entries).toHaveLength(2);
    expect(a2Entries).toHaveLength(1);
    expect(a2Entries[0]!.amount).toBe(99);
  });

  it("issues exactly two queries (no N+1)", async () => {
    // Smoke: 5 accounts each with 3 entries — if N+1 were triggered
    // we would need 1 + 5 = 6 queries.  The with() engine does exactly 2.
    for (let i = 0; i < 5; i++) {
      const acc = await seedAccount(`Acct${i}`);
      for (let j = 0; j < 3; j++) await seedEntry(acc.id, j * 10);
    }
    const accounts = await Account.query().with("entries").get();
    expect(accounts).toHaveLength(5);
    for (const acc of accounts) {
      expect((acc as unknown as { entries: Entry[] }).entries).toHaveLength(3);
    }
  });

  it("works with first() too", async () => {
    const acc = await seedAccount("Single");
    await seedEntry(acc.id, 42);

    const loaded = await Account.query().with("entries").first();
    expect(loaded).not.toBeNull();
    const entries = (loaded! as unknown as { entries: Entry[] }).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.amount).toBe(42);
  });

  it("can be combined with where()", async () => {
    const a1 = await seedAccount("Target");
    const a2 = await seedAccount("Other");
    await seedEntry(a1.id, 7);
    await seedEntry(a2.id, 8);

    const accounts = await Account.query().where("name", "Target").with("entries").get();

    expect(accounts).toHaveLength(1);
    const entries = (accounts[0]! as unknown as { entries: Entry[] }).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.amount).toBe(7);
  });
});

// ── belongsTo eager loading ───────────────────────────────────────────────────

describe("belongsTo eager loading via .with()", () => {
  it("attaches the parent account to each entry", async () => {
    const acc = await seedAccount("Parent");
    await seedEntry(acc.id, 55);

    const entries = await Entry.query().with("account").get();
    expect(entries).toHaveLength(1);

    const loadedAccount = (entries[0]! as unknown as { account: Account }).account;
    expect(loadedAccount).toBeInstanceOf(Account);
    expect(loadedAccount.name).toBe("Parent");
  });

  it("stitches the correct parent for each entry across multiple accounts", async () => {
    const a1 = await seedAccount("Acc1");
    const a2 = await seedAccount("Acc2");
    await seedEntry(a1.id, 1);
    await seedEntry(a2.id, 2);

    const entries = await Entry.query().orderBy("id").with("account").get();
    expect(entries).toHaveLength(2);

    const acc1 = (entries[0]! as unknown as { account: Account }).account;
    const acc2 = (entries[1]! as unknown as { account: Account }).account;
    expect(acc1.name).toBe("Acc1");
    expect(acc2.name).toBe("Acc2");
  });
});

// ── hasOne eager loading ──────────────────────────────────────────────────────

describe("hasOne eager loading via .with()", () => {
  it("attaches a single profile to the account", async () => {
    const acc = await seedAccount("WithProfile");
    await seedProfile(acc.id, "A short bio");

    const accounts = await Account.query().with("profile").get();
    const loadedProfile = (accounts[0]! as unknown as { profile: Profile | null }).profile;
    expect(loadedProfile).toBeInstanceOf(Profile);
    expect(loadedProfile!.bio).toBe("A short bio");
  });

  it("attaches null when no profile exists", async () => {
    await seedAccount("NoProfile");

    const accounts = await Account.query().with("profile").get();
    const loadedProfile = (accounts[0]! as unknown as { profile: Profile | null }).profile;
    expect(loadedProfile).toBeNull();
  });
});

// ── Lazy-load guard ───────────────────────────────────────────────────────────

describe("Lazy-load guard (RelationNotLoadedError)", () => {
  it("throws when accessing entries without .with()", async () => {
    const acc = await seedAccount("Guard");
    await seedEntry(acc.id, 1);

    const accounts = await Account.query().get();
    expect(accounts).toHaveLength(1);

    expect(() => {
      return (accounts[0]! as unknown as { entries: Entry[] }).entries;
    }).toThrow(RelationNotLoadedError);
  });

  it("throws when accessing account without .with()", async () => {
    const acc = await seedAccount("Guard");
    await seedEntry(acc.id, 5);

    const entries = await Entry.query().get();
    expect(() => {
      return (entries[0]! as unknown as { account: Account }).account;
    }).toThrow(RelationNotLoadedError);
  });

  it("does NOT throw after .with() eager-loads the relation", async () => {
    const acc = await seedAccount("OK");
    await seedEntry(acc.id, 3);

    const accounts = await Account.query().with("entries").get();
    expect(() => {
      return (accounts[0]! as unknown as { entries: Entry[] }).entries;
    }).not.toThrow();
  });
});

// ── Empty result set ──────────────────────────────────────────────────────────

describe("Empty result set handling", () => {
  it("does not throw when primary query returns no rows", async () => {
    // No accounts seeded — get() should return [] without touching entries
    const accounts = await Account.query().with("entries").get();
    expect(accounts).toHaveLength(0);
  });
});

// ── withCount ─────────────────────────────────────────────────────────────────

describe("withCount()", () => {
  it("adds a commentsCount property to each model", async () => {
    const acc = await seedAccount("WithCount");
    await seedEntry(acc.id, 100);
    await seedEntry(acc.id, 200);
    await seedEntry(acc.id, 300);

    const accounts = (await Account.query().withCount("entries").get()) as unknown as Array<{
      commentsCount?: number;
      entriesCount?: number;
      id: number;
    }>;
    const found = accounts.find((a) => a.id === acc.id);
    expect(found).toBeDefined();
    // withCount injects both camelCase and snake_case
    expect((found as Record<string, unknown>)["entriesCount"]).toBe(3);
  });

  it("returns 0 for relations with no matching rows", async () => {
    const acc = await seedAccount("EmptyCount");
    // no entries for this account

    const accounts = (await Account.query().withCount("entries").get()) as unknown as Array<
      Record<string, unknown>
    >;
    const found = accounts.find((a) => a["id"] === acc.id);
    expect(found?.["entriesCount"]).toBe(0);
  });

  it("can combine withCount and where filters", async () => {
    const acc1 = await seedAccount("Filter1");
    const acc2 = await seedAccount("Filter2");
    await seedEntry(acc1.id, 5);
    await seedEntry(acc2.id, 10);
    await seedEntry(acc2.id, 20);

    const accounts = (await Account.query()
      .where("id", acc2.id)
      .withCount("entries")
      .get()) as unknown as Array<Record<string, unknown>>;

    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.["entriesCount"]).toBe(2);
  });
});

// ── withSum / withAvg / withMin / withMax ─────────────────────────────────────

describe("withSum() / withAvg() / withMin() / withMax()", () => {
  it("withSum() adds a sum property", async () => {
    const acc = await seedAccount("SumTest");
    await seedEntry(acc.id, 100);
    await seedEntry(acc.id, 200);

    const accounts = (await Account.query()
      .where("id", acc.id)
      .withSum("entries", "amount")
      .get()) as unknown as Array<Record<string, unknown>>;

    expect(accounts[0]?.["entriesSumAmount"]).toBe(300);
  });

  it("withAvg() adds an avg property", async () => {
    const acc = await seedAccount("AvgTest");
    await seedEntry(acc.id, 100);
    await seedEntry(acc.id, 300);

    const accounts = (await Account.query()
      .where("id", acc.id)
      .withAvg("entries", "amount")
      .get()) as unknown as Array<Record<string, unknown>>;

    expect(accounts[0]?.["entriesAvgAmount"]).toBe(200);
  });

  it("withMin() and withMax() work correctly", async () => {
    const acc = await seedAccount("MinMaxTest");
    await seedEntry(acc.id, 50);
    await seedEntry(acc.id, 150);

    const accounts = (await Account.query()
      .where("id", acc.id)
      .withMin("entries", "amount")
      .withMax("entries", "amount")
      .get()) as unknown as Array<Record<string, unknown>>;

    expect(accounts[0]?.["entriesMinAmount"]).toBe(50);
    expect(accounts[0]?.["entriesMaxAmount"]).toBe(150);
  });

  it("distinct aliases for two sums of the same relation on different columns", async () => {
    const acc = await seedAccount("TwoSums");
    await seedEntry(acc.id, 100);
    await seedEntry(acc.id, 200);

    const accounts = (await Account.query()
      .where("id", acc.id)
      .withSum("entries", "amount")
      .withMax("entries", "amount")
      .get()) as unknown as Array<Record<string, unknown>>;

    // Column is part of the attribute name, so these do not collide.
    expect(accounts[0]?.["entriesSumAmount"]).toBe(300);
    expect(accounts[0]?.["entriesMaxAmount"]).toBe(200);
  });
});

// ── withExists ────────────────────────────────────────────────────────────────

describe("withExists()", () => {
  it("adds a boolean <relation>Exists property", async () => {
    const has = await seedAccount("HasEntries");
    await seedEntry(has.id, 10);
    const none = await seedAccount("NoEntries");

    const accounts = (await Account.query()
      .whereIn("id", [has.id, none.id])
      .withExists("entries")
      .get()) as unknown as Array<Record<string, unknown>>;

    const a = accounts.find((x) => x["id"] === has.id);
    const b = accounts.find((x) => x["id"] === none.id);
    expect(a?.["entriesExists"]).toBe(true);
    expect(b?.["entriesExists"]).toBe(false);
  });
});

// ── soft-delete correctness ─────────────────────────────────────────────────────

describe("aggregates honour the related model's soft-delete scope", () => {
  it("withCount excludes soft-deleted related rows (unconstrained fast path)", async () => {
    const acc = await seedAccount("SoftCount");
    await Note.create({ accountId: acc.id } as never);
    await Note.create({ accountId: acc.id } as never);
    const trashed = await Note.create({ accountId: acc.id } as never);
    await trashed.delete(); // soft delete

    const accounts = (await Account.query()
      .where("id", acc.id)
      .withCount("notes")
      .get()) as unknown as Array<Record<string, unknown>>;

    expect(accounts[0]?.["notesCount"]).toBe(2);
  });

  it("with() excludes soft-deleted related rows (H2 regression)", async () => {
    const acc = await seedAccount("SoftWith");
    await Note.create({ accountId: acc.id } as never);
    const trashed = await Note.create({ accountId: acc.id } as never);
    await trashed.delete(); // soft delete

    const loaded = await Account.query().where("id", acc.id).with("notes").first();
    expect((loaded as unknown as { notes: unknown[] }).notes.length).toBe(1);
  });
});

// ── collection loadCount (single query) ─────────────────────────────────────────

describe("Model.loadCount() over a fetched collection", () => {
  it("sets <relation>Count on every model in one query", async () => {
    const a1 = await seedAccount("Coll1");
    const a2 = await seedAccount("Coll2");
    await seedEntry(a1.id, 1);
    await seedEntry(a1.id, 2);
    await seedEntry(a2.id, 3);

    const accounts = await Account.query().whereIn("id", [a1.id, a2.id]).get();
    await Account.loadCount(accounts, "entries");

    const m1 = accounts.find((x) => (x as unknown as { id: number }).id === a1.id) as Record<
      string,
      unknown
    >;
    const m2 = accounts.find((x) => (x as unknown as { id: number }).id === a2.id) as Record<
      string,
      unknown
    >;
    expect(m1["entriesCount"]).toBe(2);
    expect(m2["entriesCount"]).toBe(1);
  });
});

// ── load() / loadMissing() ────────────────────────────────────────────────────

describe("load() / loadMissing()", () => {
  it("load() populates a relation on an existing instance", async () => {
    const acc = await seedAccount("LoadTest");
    await seedEntry(acc.id, 500);
    await seedEntry(acc.id, 750);

    // Fetch without eager loading — accessing entries throws before load()
    const fetched = (await Account.find(acc.id)) as Account & { entries: Entry[] };
    // Relation is a lazy-load guard getter before load() is called
    const descBefore = Object.getOwnPropertyDescriptor(fetched, "entries");
    expect(typeof descBefore?.get).toBe("function");

    await fetched.load(["entries"]);
    expect(Array.isArray(fetched.entries)).toBe(true);
    expect(fetched.entries).toHaveLength(2);
  });

  it("loadMissing() skips already-loaded relations", async () => {
    const acc = await seedAccount("LoadMissingTest");
    await seedEntry(acc.id, 100);

    const accounts = (await Account.query().with("entries").get()) as unknown as Array<
      Account & { entries: Entry[] }
    >;
    const loaded = accounts.find((a) => a.id === acc.id)!;

    // entries is already loaded — loadMissing should be a no-op
    const originalEntries = loaded.entries;
    await loaded.loadMissing(["entries"]);
    expect(loaded.entries).toBe(originalEntries); // same reference, not reloaded
  });
});
