import { Glob } from "bun";
import { basePath } from "zerotal";
import { join } from "node:path";
import { parseFrontmatter, extractTitle } from "./helpers.ts";
import { Carbon } from "zerotal/carbon";
import { Post } from "@app/models/Post.ts";

// Posts have two homes. The `posts` table is where anything written at /admin
// lands — that is the path that needs no redeploy. `blog/*.md` at the repo root
// is the original file-backed set, still rendered so a checkout with an empty
// database is not an empty blog. A row shadows a file of the same slug, which is
// what lets the seeder import the files and the editor then take over.
const BLOG_DIR = join(basePath("/"), "../../blog");

/** One post's front-matter, as the index needs it. */
export interface BlogPost {
  slug: string;
  title: string;
  description?: string;
  /** ISO `YYYY-MM-DD` from front matter; absent when the post omits it. */
  date?: string;
  /**
   * Full publication instant, for sorting only — `date` is truncated to the day,
   * so posts published on the same day would otherwise fall through to the
   * alphabetical tiebreak. Set on database rows; file posts sort by `date` +
   * `order` instead.
   */
  publishedAt?: string;
  /** One of `POST_CATEGORIES`; absent on posts that predate categories. */
  category?: string;
  /**
   * Tie-break for posts sharing a date, ascending. Launch day publishes several
   * posts at once and the announcement has to lead; without this the order is
   * whatever the directory scan happened to return. Unset sorts last.
   */
  order?: number;
}

/** A post's front matter plus its Markdown body. */
export interface LoadedPost extends BlogPost {
  content: string;
}

function readPost(slug: string, source: string): LoadedPost {
  const { data, content } = parseFrontmatter(source);
  const order = Number(data["order"]);
  return {
    slug,
    title: data["title"] ?? extractTitle(content, slug),
    ...(data["description"] ? { description: data["description"] } : {}),
    ...(data["date"] ? { date: data["date"] } : {}),
    ...(data["category"] ? { category: data["category"] } : {}),
    ...(Number.isFinite(order) ? { order } : {}),
    content,
  };
}

/** A published post row, in the shape the index and the post page read. */
function fromRow(post: Post): LoadedPost {
  return {
    slug: post.slug,
    title: post.title,
    ...(post.description ? { description: post.description } : {}),
    ...(post.publishedAt
      ? { date: post.publishedAt.format("YYYY-MM-DD"), publishedAt: post.publishedAt.toDatabase() }
      : {}),
    ...(post.category ? { category: post.category } : {}),
    content: post.body,
  };
}

/** Every file-backed post. Used on its own only when a slug has no row. */
async function listFilePosts(): Promise<LoadedPost[]> {
  const posts: LoadedPost[] = [];
  for await (const file of new Glob("*.md").scan({ cwd: BLOG_DIR })) {
    const slug = file.replace(/\.md$/, "");
    posts.push(readPost(slug, await Bun.file(join(BLOG_DIR, file)).text()));
  }
  return posts;
}

/**
 * Every published post, newest first — database rows plus any `blog/*.md` file
 * whose slug has no row. Posts without a `date` sort last (then alphabetically),
 * so an undated draft never displaces a dated release note.
 */
export async function listPosts(): Promise<BlogPost[]> {
  const rows = await Post.query()
    .whereNotNull("publishedAt")
    .where("publishedAt", "<=", Carbon.now().toDatabase())
    .get<Post>();

  const bySlug = new Map<string, LoadedPost>();
  for (const post of await listFilePosts()) bySlug.set(post.slug, post);
  for (const row of rows) bySlug.set(row.slug, fromRow(row));

  const posts: BlogPost[] = [];
  for (const { content, ...meta } of bySlug.values()) {
    void content;
    posts.push(meta);
  }
  return posts.sort((a, b) => {
    // Full instant when the post has one, else the day from front matter. Two
    // rows published the same day are separated here rather than falling through
    // to the alphabetical tiebreak, which would ignore publication order.
    const at = a.publishedAt ?? a.date;
    const bt = b.publishedAt ?? b.date;
    if (at !== bt) {
      if (!at) return 1;
      if (!bt) return -1;
      return bt.localeCompare(at);
    }
    const ao = a.order ?? Infinity;
    const bo = b.order ?? Infinity;
    if (ao !== bo) return ao - bo;
    return a.title.localeCompare(b.title);
  });
}

/** Load one published post by slug — the row if there is one, else the file. */
export async function loadPost(slug: string): Promise<LoadedPost | null> {
  // Reject traversal and nesting: slugs are flat, and name a `<slug>.md` file.
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return null;

  const row = await Post.query().where("slug", slug).first<Post>();
  // A draft is not a 404 for its author — but this is the public reader's path,
  // so an unpublished row hides the file it shadows rather than exposing either.
  if (row) return row.isPublished ? fromRow(row) : null;

  const filePath = join(BLOG_DIR, `${slug}.md`);
  if (!(await Bun.file(filePath).exists())) return null;
  return readPost(slug, await Bun.file(filePath).text());
}

/** `2026-07-31` → `31 July 2026`; passes anything unparseable through. */
export function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
