/**
 * A model whose primary key is NOT an auto-incrementing `id` — `static primaryKey
 * = "uuid"`, or an `id` column the app mints itself.
 *
 * Every write path here used to read `this.id`, a property such a model never has,
 * so the WHERE clause bound NULL: `save()` on a loaded instance and `delete()` both
 * matched zero rows and reported success, and `refresh()` threw ModelNotFoundError
 * for a row that was present. The insert was worse than a no-op — it wrote the row,
 * then read it back by `last_insert_rowid()`, which no TEXT key equals, so the
 * instance came back with no timestamps and `_exists` still false and the next
 * `save()` inserted the same row a second time.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";
import { hasMany } from "./decorators/hasMany.ts";
import type { HasMany } from "./relations/RelationRegistry.ts";
import { ModelNotFoundError } from "../errors/index.ts";

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`
    CREATE TABLE documents (
      uuid       TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      views      INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )
  `;
  await db`
    CREATE TABLE revisions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      document_uuid TEXT NOT NULL,
      label        TEXT NOT NULL,
      created_at   TEXT,
      updated_at   TEXT
    )
  `;
  // A TEXT `id`: the key keeps its default name but the app still mints the value.
  await db`
    CREATE TABLE tickets (
      id         TEXT PRIMARY KEY,
      subject    TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    )
  `;
  // The ordinary shape, kept here so the minting change cannot regress it.
  await db`
    CREATE TABLE counters (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      label      TEXT NOT NULL,
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
  await db`DELETE FROM documents`;
  await db`DELETE FROM revisions`;
  await db`DELETE FROM tickets`;
  await db`DELETE FROM counters`;
});

@(table("documents").primaryKey("uuid"))
class Doc extends BaseModel {
  @column({ type: "string" }) uuid!: string;
  @column({ type: "string" }) title!: string;
  @column({ type: "number" }) views!: number;

  // A named key has to be named on the relation too — `localKey` defaults to "id".
  @hasMany(() => Revision, { foreignKey: "document_uuid", localKey: "uuid" })
  revisions!: HasMany<Revision>;

  static override fillable = ["uuid", "title", "views"] as const;
}

@table("revisions")
class Revision extends BaseModel {
  @column({ type: "string" }) documentUuid!: string;
  @column({ type: "string" }) label!: string;
  static override fillable = ["documentUuid", "label"] as const;
}

// No `@column` for `id`: BaseModel hard-types it as `number`, so a TEXT key is
// assigned through an index rather than redeclared. Naming the key (`primaryKey =
// "uuid"`, as Doc does) is the shape to reach for when the key is a string.
@table("tickets")
class Ticket extends BaseModel {
  @column({ type: "string" }) subject!: string;
  static override fillable = ["subject"] as const;
}

@table("counters")
class Counter extends BaseModel {
  @column({ type: "string" }) label!: string;
  static override fillable = ["label"] as const;
}

describe("custom primary key — insert", () => {
  it("writes the app-minted key and hydrates the instance from the row", async () => {
    const doc = await Doc.create({ uuid: "doc-1", title: "First", views: 0 });

    expect(doc.uuid).toBe("doc-1");
    // Read back off the row, not merely left on the instance: before the fix the
    // re-read missed and both timestamps stayed undefined.
    expect(doc.createdAt).toBeDefined();
    expect(doc.updatedAt).toBeDefined();

    const rows = await db`SELECT uuid, title FROM documents`;
    expect(rows).toEqual([{ uuid: "doc-1", title: "First" }]);
  });

  it("marks the instance resident, so the next save() updates instead of re-inserting", async () => {
    const doc = new Doc();
    doc.uuid = "doc-2";
    doc.title = "Draft";
    doc.views = 0;
    await doc.save();

    doc.title = "Revised";
    await doc.save(); // used to be a second INSERT → UNIQUE constraint failed

    const rows = await db`SELECT uuid, title FROM documents`;
    expect(rows).toEqual([{ uuid: "doc-2", title: "Revised" }]);
  });

  it("leaves an auto-incrementing id to the database", async () => {
    const a = await Counter.create({ label: "a" });
    const b = await Counter.create({ label: "b" });
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
  });

  it("writes a TEXT id the app minted rather than NULL", async () => {
    const t = new Ticket();
    (t as unknown as Record<string, unknown>)["id"] = "TCK-7";
    t.subject = "Printer on fire";
    await t.save();

    const rows = await db`SELECT id, subject FROM tickets`;
    expect(rows).toEqual([{ id: "TCK-7", subject: "Printer on fire" }]);
    expect(t.createdAt).toBeDefined();
  });
});

describe("custom primary key — update and delete", () => {
  it("updates the row the instance was loaded from", async () => {
    await Doc.create({ uuid: "doc-3", title: "Before", views: 0 });

    const found = await Doc.find("doc-3");
    found!.title = "After";
    await found!.save();

    const rows = await db`SELECT title FROM documents WHERE uuid = 'doc-3'`;
    expect(rows).toEqual([{ title: "After" }]);
  });

  it("reassigning the key moves the row instead of writing nothing", async () => {
    await Doc.create({ uuid: "old-key", title: "Movable", views: 0 });

    const found = await Doc.find("old-key");
    found!.uuid = "new-key";
    await found!.save();

    const rows = await db`SELECT uuid, title FROM documents`;
    expect(rows).toEqual([{ uuid: "new-key", title: "Movable" }]);
  });

  it("deletes the row", async () => {
    await Doc.create({ uuid: "doc-4", title: "Doomed", views: 0 });
    const found = await Doc.find("doc-4");
    await found!.delete();

    const rows = await db`SELECT uuid FROM documents`;
    expect(rows).toEqual([]);
  });

  it("increments a column", async () => {
    await Doc.create({ uuid: "doc-5", title: "Popular", views: 0 });
    const found = await Doc.find("doc-5");
    await found!.increment("views", 3);

    expect(found!.views).toBe(3);
    const rows = await db`SELECT views FROM documents WHERE uuid = 'doc-5'`;
    expect(rows).toEqual([{ views: 3 }]);
  });
});

describe("custom primary key — reload and copy", () => {
  it("refresh() and fresh() find the row", async () => {
    await Doc.create({ uuid: "doc-6", title: "Original", views: 0 });
    const found = await Doc.find("doc-6");

    await db`UPDATE documents SET title = 'Changed elsewhere' WHERE uuid = 'doc-6'`;

    await found!.refresh();
    expect(found!.title).toBe("Changed elsewhere");

    const copy = await found!.fresh();
    expect(copy.title).toBe("Changed elsewhere");
  });

  it("refresh() still reports a row that is genuinely gone", async () => {
    await Doc.create({ uuid: "doc-7", title: "Transient", views: 0 });
    const found = await Doc.find("doc-7");
    await db`DELETE FROM documents WHERE uuid = 'doc-7'`;

    await expect(found!.refresh()).rejects.toThrow(ModelNotFoundError);
  });

  it("replicate() drops the key, so the copy is insertable", async () => {
    await Doc.create({ uuid: "doc-8", title: "Template", views: 4 });
    const found = await Doc.find("doc-8");

    const copy = found!.replicate();
    expect((copy as unknown as Record<string, unknown>)["uuid"]).toBeUndefined();
    expect(copy.title).toBe("Template");

    copy.uuid = "doc-8-copy";
    await copy.save(); // used to collide on the key it had carried over

    const rows = await db`SELECT uuid FROM documents ORDER BY uuid`;
    expect(rows).toEqual([{ uuid: "doc-8" }, { uuid: "doc-8-copy" }]);
  });
});

describe("custom primary key — missing key", () => {
  it("refuses to update a row hydrated without its key column", async () => {
    await Doc.create({ uuid: "doc-9", title: "Partial", views: 0 });

    const [partial] = await Doc.query().select("title").get();
    expect((partial as unknown as Record<string, unknown>)["uuid"]).toBeUndefined();

    (partial as Doc).title = "Silently lost";
    // Previously bound NULL, matched nothing and resolved as though it had written.
    await expect((partial as Doc).save()).rejects.toThrow(/primary key "uuid" is not set/);

    const rows = await db`SELECT title FROM documents WHERE uuid = 'doc-9'`;
    expect(rows).toEqual([{ title: "Partial" }]);
  });

  it("refuses to delete a row hydrated without its key column", async () => {
    await Doc.create({ uuid: "doc-10", title: "Partial", views: 0 });
    const [partial] = await Doc.query().select("title").get();

    await expect((partial as Doc).delete()).rejects.toThrow(/primary key "uuid" is not set/);
    expect(await db`SELECT uuid FROM documents`).toEqual([{ uuid: "doc-10" }]);
  });
});

describe("custom primary key — relations and counts", () => {
  it("counts a relation keyed on the named column", async () => {
    await Doc.create({ uuid: "doc-11", title: "Parent", views: 0 });
    await Revision.create({ documentUuid: "doc-11", label: "v1" });
    await Revision.create({ documentUuid: "doc-11", label: "v2" });

    const doc = await Doc.find("doc-11");
    await doc!.loadCount("revisions");
    expect((doc as unknown as Record<string, unknown>)["revisionsCount"]).toBe(2);

    const all = await Doc.all();
    await Doc.loadCount(all, "revisions");
    expect((all[0] as unknown as Record<string, unknown>)["revisionsCount"]).toBe(2);
  });

  it("eager-loads a relation keyed on the named column", async () => {
    await Doc.create({ uuid: "doc-12", title: "Parent", views: 0 });
    await Revision.create({ documentUuid: "doc-12", label: "only" });

    const [doc] = await Doc.query().with("revisions").get();
    const loaded = (doc as unknown as { revisions: Revision[] }).revisions;
    expect(loaded.map((r) => r.label)).toEqual(["only"]);
  });
});

describe("custom primary key — a snake_case key name", () => {
  // The shape `@(table("users").primaryKey("user_id"))` from the docs: the column is
  // snake_case, the property camelCase, as for every other column.
  it("round-trips a snake_case key through insert, update and delete", async () => {
    await db`CREATE TABLE members (
      user_id    TEXT PRIMARY KEY,
      nickname   TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    )`;

    @(table("members").primaryKey("user_id"))
    class Member extends BaseModel {
      @column("string") userId!: string;
      @column("string") nickname!: string;
      static override fillable = ["userId", "nickname"] as const;
    }

    const m = await Member.create({ userId: "usr-1", nickname: "ada" });
    expect(m.userId).toBe("usr-1");
    expect(m.createdAt).toBeDefined();

    const found = await Member.find("usr-1");
    found!.nickname = "ada.l";
    await found!.save();
    expect(await db`SELECT nickname FROM members`).toEqual([{ nickname: "ada.l" }]);

    await found!.delete();
    expect(await db`SELECT user_id FROM members`).toEqual([]);

    await db`DROP TABLE members`;
  });
});
