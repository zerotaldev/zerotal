/** @jsxImportSource @zerotal/flow */
import { Component, Pagination, expose, url, Pager } from "@zerotal/flow";
import type { HtmlNode } from "@zerotal/flow";
import { Carbon } from "zerotal/carbon";
import { Post } from "@app/models/Post.ts";
import { AdminLayout } from "./AdminLayout.tsx";
import { formatDate } from "@app/support/blog.ts";

/**
 * Every post, newest first, with a live search box and a numbered pager.
 *
 * The `Pagination` mixin supplies the `page` field and points database pagination
 * at it, which is what lets `paginate()` below take no page argument.
 */
export class PostsPage extends Component.using(Pagination) {
  static layout = AdminLayout;
  static title = "Posts";

  // @url implies @expose — the field is in the address bar, so the client holds it.
  @url search = "";

  override async onUpdated(prop: string): Promise<void> {
    // A new filter invalidates the page number: page 4 of the old result set is
    // rarely page 4 of the new one, and is often past the end.
    if (prop === "search") this.resetPage();
  }

  @expose async destroy(id: number): Promise<void> {
    const post = await Post.find<Post>(id);
    if (!post) return;
    await post.delete();
    this.flash(`Deleted “${post.title}”.`);
  }

  @expose async togglePublished(id: number): Promise<void> {
    const post = await Post.find<Post>(id);
    if (!post) return;
    post.publishedAt = post.isPublished ? null : Carbon.now();
    await post.save();
    this.flash(post.isPublished ? `Published “${post.title}”.` : `“${post.title}” is now a draft.`);
  }

  override async render(): Promise<HtmlNode> {
    // No page argument: paginate() follows this component's `page` field, because
    // Flow registers a resolver for the request. The `?page=` in the URL and the
    // pager below are the same number.
    const posts = await Post.query()
      .when(this.search, (q) => q.where("title", "like", `%${this.search}%`))
      .orderBy("createdAt", "desc")
      .paginate<Post>(10);

    return (
      <section>
        <header class="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 class="font-display text-2xl font-bold tracking-[-0.03em]">Posts</h1>
            <p class="mt-1 text-sm text-stone-600">
              {posts.total} {posts.total === 1 ? "post" : "posts"}
            </p>
          </div>
          <a
            href="/admin/posts/new"
            class="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-cream no-underline transition hover:bg-ink/90"
          >
            New post
          </a>
        </header>

        <input
          value={this.search}
          live
          type="search"
          placeholder="Search titles…"
          class="mt-6 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-voltage-700 focus:ring-2 focus:ring-voltage-700/20"
        />

        {posts.data.length === 0 ? (
          <p class="mt-10 rounded-xl border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
            {this.search ? `Nothing matches “${this.search}”.` : "No posts yet."}
          </p>
        ) : (
          <ul class="mt-6 space-y-2">
            {posts.data.map((post) => (
              <li
                key={post.id}
                class="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3"
              >
                <div class="min-w-0 flex-1">
                  <a
                    href={`/admin/posts/${post.slug}/edit`}
                    class="font-medium text-ink no-underline hover:text-voltage-700"
                  >
                    {post.title}
                  </a>
                  <p class="mt-0.5 text-xs text-stone-500">
                    /blog/{post.slug}
                    {post.publishedAt
                      ? ` · ${formatDate(post.publishedAt.format("YYYY-MM-DD"))}`
                      : ""}
                  </p>
                </div>

                <span
                  class={
                    post.isPublished
                      ? "rounded-full bg-voltage-50 px-2.5 py-0.5 text-xs font-medium text-voltage-700"
                      : "rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600"
                  }
                >
                  {post.isPublished ? "Published" : "Draft"}
                </span>

                <button
                  type="button"
                  onClick={() => this.togglePublished(post.id)}
                  class="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-medium text-stone-700 transition hover:bg-stone-50"
                >
                  {post.isPublished ? "Unpublish" : "Publish"}
                </button>
                <button
                  type="button"
                  onClick={() => this.destroy(post.id)}
                  confirm={`Delete “${post.title}”? This cannot be undone.`}
                  class="rounded-lg px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        <div class="mt-8">
          <Pager paginator={posts} />
        </div>
      </section>
    );
  }
}
