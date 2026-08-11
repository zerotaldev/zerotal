import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { SQL } from "bun";
import { BaseModel, _setBaseModelConnection } from "./BaseModel.ts";
import { column } from "./decorators/column.ts";
import { table } from "./decorators/table.ts";
import { morphTo } from "./decorators/morphTo.ts";
import { morphMany } from "./decorators/morphMany.ts";
import { morphOne } from "./decorators/morphOne.ts";
import type { MorphTo, MorphMany, MorphOne } from "./relations/RelationRegistry.ts";

// ── Schema ─────────────────────────────────────────────────────────────────

let db: SQLInstance;

beforeAll(async () => {
  db = new SQL(":memory:");
  _setBaseModelConnection(db);

  await db`
    CREATE TABLE posts (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      title   TEXT NOT NULL
    )
  `;
  await db`
    CREATE TABLE videos (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      title   TEXT NOT NULL
    )
  `;
  await db`
    CREATE TABLE comments (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      body             TEXT NOT NULL,
      commentable_type TEXT NOT NULL,
      commentable_id   INTEGER NOT NULL
    )
  `;
  await db`
    CREATE TABLE images (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      url            TEXT NOT NULL,
      imageable_type TEXT NOT NULL,
      imageable_id   INTEGER NOT NULL
    )
  `;

  // Posts: id 1 "Hello", id 2 "World"
  await db`INSERT INTO posts (title) VALUES ('Hello')`;
  await db`INSERT INTO posts (title) VALUES ('World')`;

  // Videos: id 1 "Reel"
  await db`INSERT INTO videos (title) VALUES ('Reel')`;

  // Comments
  await db`INSERT INTO comments (body, commentable_type, commentable_id) VALUES ('comment A', 'Post', 1)`;
  await db`INSERT INTO comments (body, commentable_type, commentable_id) VALUES ('comment B', 'Post', 1)`;
  await db`INSERT INTO comments (body, commentable_type, commentable_id) VALUES ('comment C', 'Video', 1)`;
  await db`INSERT INTO comments (body, commentable_type, commentable_id) VALUES ('comment D', 'Post', 2)`;

  // Images (morphOne)
  await db`INSERT INTO images (url, imageable_type, imageable_id) VALUES ('/img/1.png', 'Post', 1)`;
  await db`INSERT INTO images (url, imageable_type, imageable_id) VALUES ('/img/2.png', 'Post', 2)`;
});

afterAll(async () => {
  _setBaseModelConnection(null);
  await (db as unknown as { close(): Promise<void> }).close();
});

// ── Model fixtures ─────────────────────────────────────────────────────────

@table("posts", { timestamps: false })
class Post extends BaseModel {
  @column({}) title!: string;

  @morphMany(() => Comment, { morphName: "commentable" })
  comments!: MorphMany<Comment>;

  @morphOne(() => Image, { morphName: "imageable" })
  image!: MorphOne<Image>;
}

@table("videos", { timestamps: false })
class Video extends BaseModel {
  @column({}) title!: string;

  @morphMany(() => Comment, { morphName: "commentable" })
  comments!: MorphMany<Comment>;
}

@table("comments", { timestamps: false })
class Comment extends BaseModel {
  @column({}) body!: string;
  @column({}) commentableType!: string;
  @column({}) commentableId!: number;

  @morphTo({ morphMap: { Post: () => Post, Video: () => Video } })
  commentable!: MorphTo<Post | Video>;
}

@table("images", { timestamps: false })
class Image extends BaseModel {
  @column({}) url!: string;
  @column({}) imageableType!: string;
  @column({}) imageableId!: number;

  @morphTo({ morphMap: { Post: () => Post } })
  imageable!: MorphTo<Post>;
}

// ── morphMany ──────────────────────────────────────────────────────────────

describe("morphMany", () => {
  it("eager-loads comments for posts", async () => {
    const posts = (await Post.query().with("comments").get()) as (Post & { comments: Comment[] })[];
    const hello = posts.find((p) => p.title === "Hello")!;
    const world = posts.find((p) => p.title === "World")!;

    expect(hello.comments).toHaveLength(2);
    expect(hello.comments.map((c) => c.body).sort()).toEqual(["comment A", "comment B"]);
    expect(world.comments).toHaveLength(1);
    expect(world.comments[0]!.body).toBe("comment D");
  });

  it("eager-loads comments for videos", async () => {
    const videos = (await Video.query().with("comments").get()) as (Video & {
      comments: Comment[];
    })[];
    expect(videos[0]!.comments).toHaveLength(1);
    expect(videos[0]!.comments[0]!.body).toBe("comment C");
  });

  it("empty result when no comments exist for parent", async () => {
    const posts = (await Post.query().with("comments").where("id", 999).get()) as (Post & {
      comments: Comment[];
    })[];
    expect(posts).toHaveLength(0);
  });
});

// ── morphOne ───────────────────────────────────────────────────────────────

describe("morphOne", () => {
  it("eager-loads the first image for each post", async () => {
    const posts = (await Post.query().with("image").get()) as (Post & { image: Image | null })[];
    const hello = posts.find((p) => p.title === "Hello")!;
    const world = posts.find((p) => p.title === "World")!;

    expect(hello.image).not.toBeNull();
    expect(hello.image!.url).toBe("/img/1.png");
    expect(world.image).not.toBeNull();
    expect(world.image!.url).toBe("/img/2.png");
  });
});

// ── morphTo ────────────────────────────────────────────────────────────────

describe("morphTo", () => {
  it("eager-loads the polymorphic owner (Post)", async () => {
    const comments = (await Comment.query().with("commentable").get()) as (Comment & {
      commentable: Post | Video | null;
    })[];
    const commentA = comments.find((c) => c.body === "comment A")!;
    expect(commentA.commentable).not.toBeNull();
    expect((commentA.commentable as Post).title).toBe("Hello");
  });

  it("eager-loads across multiple types (Post and Video)", async () => {
    const comments = (await Comment.query().with("commentable").get()) as (Comment & {
      commentable: Post | Video | null;
    })[];
    const commentC = comments.find((c) => c.body === "comment C")!;
    expect(commentC.commentable).not.toBeNull();
    expect((commentC.commentable as Video).title).toBe("Reel");
  });

  it("sets null when morphMap has no entry for the type", async () => {
    await db`INSERT INTO comments (body, commentable_type, commentable_id) VALUES ('orphan', 'Unknown', 99)`;
    const comments = (await Comment.query()
      .with("commentable")
      .where("body", "orphan")
      .get()) as (Comment & { commentable: Post | Video | null })[];
    expect(comments[0]!.commentable).toBeNull();
  });

  it("sets null when the FK points to a non-existent row", async () => {
    await db`INSERT INTO comments (body, commentable_type, commentable_id) VALUES ('missing', 'Post', 9999)`;
    const comments = (await Comment.query()
      .with("commentable")
      .where("body", "missing")
      .get()) as (Comment & { commentable: Post | Video | null })[];
    expect(comments[0]!.commentable).toBeNull();
  });
});
