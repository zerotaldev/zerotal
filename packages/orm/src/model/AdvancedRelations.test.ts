import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { hasMany } from "./decorators/hasMany.ts";
import { belongsTo } from "./decorators/belongsTo.ts";
import { hasManyThrough } from "./decorators/hasManyThrough.ts";
import { hasOneThrough } from "./decorators/hasOneThrough.ts";
import { morphToMany } from "./decorators/morphToMany.ts";
import { morphedByMany } from "./decorators/morphedByMany.ts";
import { manyToMany } from "./decorators/manyToMany.ts";
import { table } from "./decorators/table.ts";
import type { HasMany, HasOne, BelongsTo, ManyToMany } from "./relations/RelationRegistry.ts";

let db: SQLInstance;
beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`CREATE TABLE countries (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE makers (id INTEGER PRIMARY KEY AUTOINCREMENT, country_id INTEGER, name TEXT, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, maker_id INTEGER, title TEXT, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE labels (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE taggables (id INTEGER PRIMARY KEY AUTOINCREMENT, label_id INTEGER, taggable_id INTEGER, taggable_type TEXT, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER, body TEXT, created_at TEXT, updated_at TEXT)`;
});
afterAll(async () => {
  _setBaseModelConnection(null);
  await db.end();
});
beforeEach(async () => {
  for (const t of ["taggables", "labels", "comments", "articles", "makers", "countries"])
    await db`DELETE FROM ${db(t)}`;
  await db`DELETE FROM sqlite_sequence`;
});

@table("articles")
class Article extends BaseModel {
  makerId!: number;
  title!: string;
  @belongsTo(() => Maker, { foreignKey: "maker_id" }) maker!: BelongsTo<Maker>;
  @morphToMany(() => Label, { morphName: "taggable", relatedPivotKey: "label_id" })
  labels!: ManyToMany<Label>;
}
@table("makers")
class Maker extends BaseModel {
  countryId!: number;
  name!: string;
  @hasMany(() => Article, { foreignKey: "maker_id" }) articles!: HasMany<Article>;
}
@table("countries")
class Country extends BaseModel {
  name!: string;
  @hasManyThrough(() => Article, () => Maker, { firstKey: "country_id", secondKey: "maker_id" })
  articles!: HasMany<Article>;
  @hasOneThrough(() => Article, () => Maker, { firstKey: "country_id", secondKey: "maker_id" })
  anArticle!: HasOne<Article>;
}
@table("labels")
class Label extends BaseModel {
  name!: string;
  @morphedByMany(() => Article, { morphName: "taggable", parentPivotKey: "label_id" })
  articles!: ManyToMany<Article>;
}
@table("comments")
class Comment extends BaseModel {
  articleId!: number | null;
  body!: string;
  @belongsTo(() => Article, { foreignKey: "article_id", withDefault: { title: "Untitled" } })
  article!: BelongsTo<Article>;
}

describe("has*Through", () => {
  it("hasManyThrough loads related across intermediate", async () => {
    const c = await Country.create({ name: "NZ" } as never);
    const m = await Maker.create({ countryId: c.id, name: "Acme" } as never);
    await Article.create({ makerId: m.id, title: "A1" } as never);
    await Article.create({ makerId: m.id, title: "A2" } as never);
    const c2 = await Country.create({ name: "AU" } as never); // no makers
    const loaded = await Country.query().with("articles").get();
    const nz = loaded.find((x: any) => x.name === "NZ") as any;
    const au = loaded.find((x: any) => x.name === "AU") as any;
    expect(nz.articles.map((a: any) => a.title).sort()).toEqual(["A1", "A2"]);
    expect(au.articles).toEqual([]);
  });
  it("hasOneThrough loads a single related", async () => {
    const c = await Country.create({ name: "NZ" } as never);
    const m = await Maker.create({ countryId: c.id, name: "Acme" } as never);
    await Article.create({ makerId: m.id, title: "A1" } as never);
    const loaded = (await Country.query().with("anArticle").first()) as any;
    expect(loaded.anArticle.title).toBe("A1");
  });
});

describe("polymorphic many-to-many", () => {
  it("morphToMany + morphedByMany", async () => {
    const a = await Article.create({ makerId: 1, title: "Post" } as never);
    const l1 = await Label.create({ name: "tech" } as never);
    const l2 = await Label.create({ name: "news" } as never);
    await db`INSERT INTO taggables (label_id, taggable_id, taggable_type) VALUES
      (${l1.id}, ${a.id}, 'Article'), (${l2.id}, ${a.id}, 'Article')`;
    const article = (await Article.query().with("labels").first()) as any;
    expect(article.labels.map((l: any) => l.name).sort()).toEqual(["news", "tech"]);
    const label = (await Label.query().where("id", l1.id).with("articles").first()) as any;
    expect(label.articles.map((x: any) => x.title)).toEqual(["Post"]);
  });
  it("morph type discriminates", async () => {
    const a = await Article.create({ makerId: 1, title: "Post" } as never);
    const l1 = await Label.create({ name: "tech" } as never);
    // a row for a different type should be ignored
    await db`INSERT INTO taggables (label_id, taggable_id, taggable_type) VALUES
      (${l1.id}, ${a.id}, 'Article'), (${l1.id}, 999, 'Video')`;
    const label = (await Label.query().where("id", l1.id).with("articles").first()) as any;
    expect(label.articles.length).toBe(1);
  });
});

describe("belongsTo ergonomics", () => {
  it("associate / dissociate", async () => {
    const a = await Article.create({ makerId: 1, title: "Post" } as never);
    const c = new Comment();
    c.body = "Nice";
    c.associate("article", a);
    expect(c.articleId).toBe(a.id);
    await c.save();
    const reloaded = await Comment.find(c.id);
    expect(reloaded!.articleId).toBe(a.id);
    c.dissociate("article");
    expect(c.articleId).toBeNull();
  });
  it("withDefault returns default model when absent", async () => {
    await Comment.create({ articleId: null, body: "Orphan" } as never);
    const loaded = (await Comment.query().with("article").first()) as any;
    expect(loaded.article).not.toBeNull();
    expect(loaded.article.title).toBe("Untitled");
  });
});

describe("pivot enrichment", () => {
  it("withPivot + withTimestamps via manyToMany", async () => {
    await db`CREATE TABLE roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at TEXT, updated_at TEXT)`;
    await db`CREATE TABLE user_role (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, role_id INTEGER, scope TEXT, created_at TEXT, updated_at TEXT)`;
    await db`CREATE TABLE pusers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at TEXT, updated_at TEXT)`;
    class Role extends BaseModel {
      static override table = "roles";
      name!: string;
    }
    @table("pusers")
    class PUser extends BaseModel {
      name!: string;
      @manyToMany(() => Role, {
        pivotTable: "user_role",
        pivotForeignKey: "user_id",
        pivotRelatedKey: "role_id",
        withPivot: ["scope"],
        withTimestamps: true,
      })
      roles!: ManyToMany<Role>;
    }
    const u = await PUser.create({ name: "Al" } as never);
    const r = await Role.create({ name: "admin" } as never);
    await db`INSERT INTO user_role (user_id, role_id, scope) VALUES (${u.id}, ${r.id}, 'global')`;
    const loaded = (await PUser.query().with("roles").first()) as any;
    expect(loaded.roles[0].pivot.scope).toBe("global");
    // attach with timestamps
    const r2 = await Role.create({ name: "editor" } as never);
    await loaded.roles.attach(r2.id, { scope: "local" });
    const row = (await db`SELECT * FROM user_role WHERE role_id = ${r2.id}`) as any[];
    expect(row[0].scope).toBe("local");
    expect(row[0].created_at).not.toBeNull();
  });
});
