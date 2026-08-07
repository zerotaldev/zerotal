import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { hasMany } from "./decorators/hasMany.ts";
import { belongsTo } from "./decorators/belongsTo.ts";
import { manyToMany } from "./decorators/manyToMany.ts";
import { table } from "./decorators/table.ts";
import type { HasMany, BelongsTo, ManyToMany } from "./relations/RelationRegistry.ts";

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);
  await db`CREATE TABLE authors (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, author_id INTEGER, title TEXT, published INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, body TEXT, approved INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, created_at TEXT, updated_at TEXT)`;
  await db`CREATE TABLE post_tag (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER, tag_id INTEGER)`;
});
afterAll(async () => {
  _setBaseModelConnection(null);
  await db.end();
});
beforeEach(async () => {
  for (const t of ["post_tag", "tags", "comments", "posts", "authors"])
    await db`DELETE FROM ${db(t)}`;
  await db`DELETE FROM sqlite_sequence`;
});

@table("comments")
class Comment extends BaseModel {
  postId!: number;
  body!: string;
  approved!: number;
  @belongsTo(() => Post, { foreignKey: "post_id" }) post!: BelongsTo<Post>;
}
class Tag extends BaseModel {
  static override table = "tags";
  name!: string;
}
@table("posts")
class Post extends BaseModel {
  authorId!: number;
  title!: string;
  published!: number;
  @belongsTo(() => Author, { foreignKey: "author_id" }) author!: BelongsTo<Author>;
  @hasMany(() => Comment, { foreignKey: "post_id" }) comments!: HasMany<Comment>;
  @manyToMany(() => Tag, {
    pivotTable: "post_tag",
    pivotForeignKey: "post_id",
    pivotRelatedKey: "tag_id",
  })
  tags!: ManyToMany<Tag>;
}
@table("authors")
class Author extends BaseModel {
  name!: string;
  @hasMany(() => Post, { foreignKey: "author_id" }) posts!: HasMany<Post>;
}

async function seed() {
  const a1 = await Author.create({ name: "Ann" } as never);
  const a2 = await Author.create({ name: "Bob" } as never); // Bob has no posts
  const p1 = await Post.create({ authorId: a1.id, title: "Hello", published: 1 } as never);
  const p2 = await Post.create({ authorId: a1.id, title: "Draft", published: 0 } as never);
  await Comment.create({ postId: p1.id, body: "c1", approved: 1 } as never);
  await Comment.create({ postId: p1.id, body: "c2", approved: 0 } as never);
  const t1 = await Tag.create({ name: "tech" } as never);
  const t2 = await Tag.create({ name: "news" } as never);
  await db`INSERT INTO post_tag (post_id, tag_id) VALUES (${p1.id}, ${t1.id}), (${p1.id}, ${t2.id})`;
  return { a1, a2, p1, p2, t1, t2 };
}

describe("relationship existence", () => {
  it("has() / doesntHave()", async () => {
    await seed();
    expect((await Author.query().has("posts").get()).map((a: any) => a.name)).toEqual(["Ann"]);
    expect((await Author.query().doesntHave("posts").get()).map((a: any) => a.name)).toEqual([
      "Bob",
    ]);
  });
  it("has() with count comparison", async () => {
    await seed();
    expect((await Author.query().has("posts", ">=", 2).get()).map((a: any) => a.name)).toEqual([
      "Ann",
    ]);
    expect((await Author.query().has("posts", ">=", 3).get()).length).toBe(0);
  });
  it("whereHas() with constraint", async () => {
    await seed();
    const withApproved = await Post.query()
      .whereHas("comments", (q) => q.where("approved", 1))
      .get();
    expect(withApproved.map((p: any) => p.title)).toEqual(["Hello"]);
    const none = await Post.query()
      .whereHas("comments", (q) => q.where("approved", 99))
      .get();
    expect(none.length).toBe(0);
  });
  it("whereDoesntHave()", async () => {
    await seed();
    const noApproved = await Post.query()
      .whereDoesntHave("comments", (q) => q.where("approved", 1))
      .get();
    expect(noApproved.map((p: any) => p.title).sort()).toEqual(["Draft"]);
  });
  it("whereRelation()", async () => {
    await seed();
    const rows = await Post.query().whereRelation("comments", "body", "c2").get();
    expect(rows.map((p: any) => p.title)).toEqual(["Hello"]);
  });
  it("orWhereHas()", async () => {
    await seed();
    const rows = await Post.query()
      .where("published", 1)
      .orWhereHas("comments", (q) => q.where("approved", 0))
      .get();
    expect(rows.map((p: any) => p.title).sort()).toEqual(["Hello"]);
  });
  it("manyToMany existence: whereHas tags", async () => {
    await seed();
    const tagged = await Post.query().has("tags").get();
    expect(tagged.map((p: any) => p.title)).toEqual(["Hello"]);
    const tech = await Post.query()
      .whereHas("tags", (q) => q.where("name", "tech"))
      .get();
    expect(tech.map((p: any) => p.title)).toEqual(["Hello"]);
  });
});

describe("constrained + nested eager loading", () => {
  it("constrained with(closure)", async () => {
    await seed();
    const posts = await Post.query()
      .where("id", 1)
      .with("comments", (q) => q.where("approved", 1))
      .get();
    expect((posts[0] as any).comments.map((c: any) => c.body)).toEqual(["c1"]);
  });
  it("object form with({rel: closure})", async () => {
    await seed();
    const posts = await Post.query()
      .where("id", 1)
      .with({ comments: (q) => q.where("approved", 1) })
      .get();
    expect((posts[0] as any).comments.length).toBe(1);
  });
  it("nested dot eager load author.posts", async () => {
    await seed();
    const comments = await Comment.query().with("post.author").get();
    expect((comments[0] as any).post.author.name).toBe("Ann");
  });
  it("nested with array + constraint", async () => {
    await seed();
    const authors = await Author.query()
      .with({ posts: (q) => q.where("published", 1) })
      .get();
    const ann = authors.find((a: any) => a.name === "Ann") as any;
    expect(ann.posts.map((p: any) => p.title)).toEqual(["Hello"]);
  });
  it("constrained withCount", async () => {
    await seed();
    const posts = await Post.query()
      .where("id", 1)
      .withCount({ comments: (q) => q.where("approved", 1) })
      .get();
    expect((posts[0] as any).commentsCount).toBe(1);
  });
  it("plain withCount still works", async () => {
    await seed();
    const posts = await Post.query().where("id", 1).withCount("comments").get();
    expect((posts[0] as any).commentsCount).toBe(2);
  });
  it("constrained and unconstrained withCount agree on orphaned pivot rows", async () => {
    const { p1 } = await seed();
    // A pivot row pointing at a related row that no longer exists. Both forms
    // compile through the same joined subquery now, so neither counts it —
    // previously the unconstrained fast path counted pivot rows directly and
    // the two answers disagreed on identical data.
    await db`INSERT INTO post_tag (post_id, tag_id) VALUES (${p1.id}, 9999)`;
    const plain = await Post.query().where("id", p1.id).withCount("tags").get();
    const constrained = await Post.query()
      .where("id", p1.id)
      .withCount({ tags: (q) => q.whereNotNull("tags.id") })
      .get();
    expect((plain[0] as any).tagsCount).toBe(2);
    expect((constrained[0] as any).tagsCount).toBe(2);
  });
});

describe("has()/whereHas() operator slot", () => {
  it("rejects an operator that is not a comparison", async () => {
    await seed();
    // The count operator is interpolated, not bound, so an operator arriving from a query
    // string is an injection point with a correct binding count — it executes cleanly.
    expect(() => Author.query().has("posts", "> 0 OR 1=1 --", 1)).toThrow(/unsupported operator/);
    expect(() => Author.query().whereHas("posts", undefined, "IS NOT NULL OR 1=1 OR 1", 1)).toThrow(
      /unsupported operator/,
    );
  });

  it("still accepts the real comparison operators", async () => {
    await seed();
    const atLeastTwo = await Author.query().has("posts", ">=", 2).get();
    expect(atLeastTwo.map((a: any) => a.name)).toEqual(["Ann"]);
  });
});
