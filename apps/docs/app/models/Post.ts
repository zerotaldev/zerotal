import { BaseModel, belongsTo, column, table } from "zerotal/orm";
import { Str } from "zerotal";
import { Carbon } from "zerotal/carbon";
import { User } from "./User.ts";

/**
 * A blog article, authored through `/admin` and served at `/blog/:slug`.
 *
 * Posts committed as `blog/*.md` still render — see `app/support/blog.ts`, which
 * reads this table first and falls back to the files. A row wins over a file of
 * the same slug, so an imported post can be edited without touching the repo.
 */
/**
 * The categories a post can carry, in the order the blog's filter bar lists them.
 *
 * A closed set on purpose: the filter bar is only legible while it stays short,
 * and a free-text field drifts into near-duplicates ("Flow" / "flow" / "Flow UI")
 * that split one topic across several pills.
 */
export const POST_CATEGORIES = ["Announcements", "Flow", "Engineering", "Guides"] as const;

export type PostCategory = (typeof POST_CATEGORIES)[number];

@table("posts")
export class Post extends BaseModel {
  // Only what an author types. `publishedAt` and `authorId` are set by the server
  // on the way past, never mass-assigned from a form payload.
  static override fillable = ["slug", "title", "description", "body", "category"];

  /** URL segment. Unique — it is what `/blog/:slug` resolves against. */
  @column() slug!: string;
  @column() title!: string;
  @column({ nullable: true }) description?: string;
  /** One of {@link POST_CATEGORIES}; absent on posts written before categories existed. */
  @column({ nullable: true }) category?: string;
  /** The article itself, in Markdown. Rendered at read time, stored as written. */
  @column("text") body!: string;
  /**
   * Null while a draft: unpublished posts are invisible to `/blog`. The
   * `datetime` cast hydrates this as a {@link Carbon}, not a `Date`.
   */
  @column({ type: "datetime", cast: "datetime", nullable: true }) publishedAt?: Carbon | null;
  @column({ type: "number", nullable: true }) authorId?: number;

  @belongsTo(() => User, { foreignKey: "authorId" })
  author?: User;

  /**
   * `/blog/:post` and `/admin/posts/:post/edit` address a post by its slug, which
   * is the readable, shareable identifier — so the model resolves route bindings
   * that way instead of by primary key.
   */
  static async resolveRouteBinding(value: string): Promise<Post> {
    return Post.query().where("slug", value).firstOrFail() as Promise<Post>;
  }

  /** True once `publishedAt` has passed. Drafts and future-dated posts are not live. */
  get isPublished(): boolean {
    return this.publishedAt != null && this.publishedAt.isPast();
  }

  /**
   * A slug for `title` that no other post holds, suffixing `-2`, `-3`, … on
   * collision. `ignoreId` keeps a post from colliding with itself on edit.
   */
  static async uniqueSlug(title: string, ignoreId?: number): Promise<string> {
    const base = Str.slugify(title) || "post";
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      const query = Post.query().where("slug", candidate);
      if (ignoreId != null) query.where("id", "!=", ignoreId);
      if (!(await query.first())) return candidate;
    }
  }
}
