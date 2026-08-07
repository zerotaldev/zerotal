import { Router } from "zerotal";
import { Layout } from "../app/routes/_layout.ts";
import { createHtmlResponse } from "@app/support/helpers.ts";
import { listPosts, loadPost, formatDate, type BlogPost } from "@app/support/blog.ts";
import type { BunMarkdownOptions } from "zerotal/helpers";

const MARKDOWN_OPTIONS: BunMarkdownOptions = {
  tables: true,
  strikethrough: true,
  tasklists: true,
  autolinks: true,
  headings: { ids: true },
};

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Each category gets its own tile so the grid is scannable by colour before it is
 * read. Posts predating categories fall back to the neutral entry.
 */
// Each tile has to read as distinct against the cream page, so the palette here
// spans hue rather than lightness — a pale tint disappears into the background.
const CATEGORY_TILE: Record<string, { bg: string; fg: string; glyph: string }> = {
  Announcements: { bg: "bg-voltage-100", fg: "text-ink", glyph: "◆" },
  Flow: { bg: "bg-ink", fg: "text-voltage", glyph: "≈" },
  Engineering: { bg: "bg-teal-deep", fg: "text-cream", glyph: "⌘" },
  Guides: { bg: "bg-signal-amber", fg: "text-ink", glyph: "▤" },
};
const NEUTRAL_TILE = { bg: "bg-stone-100", fg: "text-stone-500", glyph: "●" };

/** The tile standing in for a thumbnail — no post carries an image. */
function tile(category?: string): string {
  const { bg, fg, glyph } = (category && CATEGORY_TILE[category]) || NEUTRAL_TILE;
  return `<div class="flex aspect-video items-center justify-center rounded-xl ${bg} ${fg}" aria-hidden="true">
      <span class="font-display text-4xl leading-none">${glyph}</span>
    </div>`;
}

function postCard(post: BlogPost): string {
  const date = post.date
    ? `<time datetime="${escHtml(post.date)}" class="text-[0.8125rem] font-medium text-ash">${escHtml(formatDate(post.date))}</time>`
    : "";
  const description = post.description
    ? `<p class="mt-2 line-clamp-3 text-[0.9375rem] leading-7 text-stone-600">${escHtml(post.description)}</p>`
    : "";
  const category = post.category
    ? `<span class="inline-flex rounded-full border border-stone-200 px-2.5 py-0.5 text-xs font-medium text-stone-600">${escHtml(post.category)}</span>`
    : "";

  // Card order mirrors the reference listing: visual, date, title, category, read.
  return `
    <li class="list-none">
      <a href="/blog/${escHtml(post.slug)}"
         class="group flex h-full flex-col rounded-2xl border border-stone-200 bg-white/60 p-4 no-underline transition-all hover:-translate-y-0.5 hover:border-voltage-700/40 hover:shadow-lg">
        ${tile(post.category)}
        <div class="flex flex-1 flex-col px-2 pt-4 pb-1">
          ${date}
          <h2 class="font-display mt-1 text-xl font-semibold tracking-[-0.03em] text-ink group-hover:text-voltage-700">${escHtml(post.title)}</h2>
          ${description}
          <div class="mt-4 flex flex-1 items-end justify-between gap-3">
            ${category}
            <span class="inline-flex items-center gap-1.5 text-[0.8125rem] font-semibold text-voltage-700">
              Read
              <svg class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02z" clip-rule="evenodd"/></svg>
            </span>
          </div>
        </div>
      </a>
    </li>`;
}

/** One post as a full-width row — the list view's answer to {@link postCard}. */
function postRow(post: BlogPost): string {
  const date = post.date
    ? `<time datetime="${escHtml(post.date)}" class="text-[0.8125rem] font-medium text-ash">${escHtml(formatDate(post.date))}</time>`
    : "";
  const description = post.description
    ? `<p class="mt-1 line-clamp-2 text-[0.9375rem] leading-7 text-stone-600">${escHtml(post.description)}</p>`
    : "";
  // Hidden on narrow screens: sharing the row with the title there squeezes it
  // into a two-word column. The tile's colour still carries the category.
  const category = post.category
    ? `<span class="hidden shrink-0 rounded-full border border-stone-200 px-2.5 py-0.5 text-xs font-medium text-stone-600 sm:inline-flex">${escHtml(post.category)}</span>`
    : "";
  const { bg, fg, glyph } = (post.category && CATEGORY_TILE[post.category]) || NEUTRAL_TILE;

  return `
    <li class="list-none">
      <a href="/blog/${escHtml(post.slug)}"
         class="group flex items-center gap-5 rounded-2xl border border-stone-200 bg-white/60 p-4 no-underline transition-all hover:border-voltage-700/40 hover:shadow-md">
        <div class="flex size-16 shrink-0 items-center justify-center rounded-xl ${bg} ${fg}" aria-hidden="true">
          <span class="font-display text-2xl leading-none">${glyph}</span>
        </div>
        <div class="min-w-0 flex-1">
          ${date}
          <h2 class="font-display mt-0.5 text-lg font-semibold tracking-[-0.03em] text-ink group-hover:text-voltage-700">${escHtml(post.title)}</h2>
          ${description}
        </div>
        ${category}
      </a>
    </li>`;
}

/** How the list is ordered. `newest` is the order `listPosts()` already returns. */
const SORTS = {
  newest: "Newest",
  oldest: "Oldest",
  az: "A–Z",
  za: "Z–A",
} as const;
type Sort = keyof typeof SORTS;

const VIEWS = { grid: "Grid", list: "List" } as const;
type View = keyof typeof VIEWS;

/** State the listing reads from the query string. */
interface ListingState {
  category?: string;
  sort: Sort;
  view: View;
}

/**
 * A `/blog` URL carrying the current state with `patch` applied. Every control is
 * a link rather than a widget, so each view is a real URL a reader can share and
 * a crawler can index — but that only holds if changing one control preserves
 * the others, which is what this is for. Defaults are omitted to keep the
 * canonical listing at a bare `/blog`.
 *
 * Returns the URL already escaped for an `href` attribute: separators between
 * query parameters are `&amp;`, not a bare `&`.
 */
function blogUrl(
  state: ListingState,
  // `category: undefined` is meaningful here — it is how the "All" pill clears
  // the filter — so the patch type has to admit it explicitly.
  patch: { category?: string | undefined; sort?: Sort; view?: View },
): string {
  const next = { ...state, ...patch };
  const params = new URLSearchParams();
  if (next.category) params.set("category", next.category);
  if (next.sort !== "newest") params.set("sort", next.sort);
  if (next.view !== "grid") params.set("view", next.view);
  const query = params.toString();
  return query ? `/blog?${escHtml(query)}` : "/blog";
}

const PILL_ON = "border-ink bg-ink text-cream";
const PILL_OFF =
  "border-stone-200 text-stone-600 hover:border-stone-300 hover:bg-stone-50 hover:text-ink";

function pill(label: string, href: string, on: boolean): string {
  return `<a href="${href}" ${on ? 'aria-current="page"' : ""}
        class="rounded-full border px-3.5 py-1.5 text-sm font-medium no-underline transition ${on ? PILL_ON : PILL_OFF}">${escHtml(label)}</a>`;
}

/** Category pills. */
function filterBar(categories: string[], state: ListingState): string {
  if (categories.length === 0) return "";
  return `<nav class="flex flex-wrap gap-2" aria-label="Filter posts by category">
      ${pill("All", blogUrl(state, { category: undefined }), !state.category)}
      ${categories
        .map((c) => pill(c, blogUrl(state, { category: c }), c === state.category))
        .join("\n      ")}
    </nav>`;
}

/** Sort options on the left, the grid/list toggle on the right. */
function controlBar(state: ListingState, count: number): string {
  const sorts = (Object.keys(SORTS) as Sort[])
    .map((key) => {
      const on = key === state.sort;
      return `<a href="${blogUrl(state, { sort: key })}" ${on ? 'aria-current="true"' : ""}
          class="rounded-lg px-2.5 py-1 text-sm font-medium no-underline transition ${
            on ? "bg-stone-200/70 text-ink" : "text-stone-500 hover:bg-stone-100 hover:text-ink"
          }">${SORTS[key]}</a>`;
    })
    .join("\n        ");

  const views = (Object.keys(VIEWS) as View[])
    .map((key) => {
      const on = key === state.view;
      return `<a href="${blogUrl(state, { view: key })}" ${on ? 'aria-current="true"' : ""}
          class="rounded-lg px-3 py-1 text-sm font-medium no-underline transition ${
            on ? "bg-white text-ink shadow-sm" : "text-stone-500 hover:text-ink"
          }">${VIEWS[key]}</a>`;
    })
    .join("\n        ");

  return `<div class="mt-6 mb-8 flex flex-wrap items-center justify-between gap-4 border-t border-stone-200 pt-5">
      <div class="flex items-center gap-1">
        <span class="mr-1 text-sm text-stone-400">Sort</span>
        ${sorts}
      </div>
      <div class="flex items-center gap-3">
        <span class="text-sm text-stone-400">${count} ${count === 1 ? "post" : "posts"}</span>
        <div class="flex items-center gap-1 rounded-xl bg-stone-100 p-1" role="group" aria-label="View as">
        ${views}
        </div>
      </div>
    </div>`;
}

/** Apply the requested order. `newest` is already how `listPosts()` sorts. */
function sortPosts(posts: BlogPost[], sort: Sort): BlogPost[] {
  switch (sort) {
    case "oldest":
      return [...posts].reverse();
    case "az":
      return [...posts].sort((a, b) => a.title.localeCompare(b.title));
    case "za":
      return [...posts].sort((a, b) => b.title.localeCompare(a.title));
    default:
      return posts;
  }
}

async function renderIndex(req?: Request): Promise<Response> {
  const posts = await listPosts();
  // Only categories in use get a pill — an empty filter is a dead end.
  const categories = [...new Set(posts.map((p) => p.category).filter(Boolean))] as string[];

  const params = req ? new URL(req.url).searchParams : new URLSearchParams();
  const requested = params.get("category") ?? undefined;
  const sort = params.get("sort") ?? "";
  const view = params.get("view") ?? "";

  // Anything unrecognised falls back to the default rather than rendering an
  // empty or broken page: a stale link should still show the blog.
  const state: ListingState = {
    ...(requested && categories.includes(requested) ? { category: requested } : {}),
    sort: sort in SORTS ? (sort as Sort) : "newest",
    view: view in VIEWS ? (view as View) : "grid",
  };

  const filtered = state.category ? posts.filter((p) => p.category === state.category) : posts;
  const shown = sortPosts(filtered, state.sort);

  const body =
    shown.length === 0
      ? `<p class="text-stone-500">No posts yet.</p>`
      : state.view === "list"
        ? `<ul class="m-0 flex flex-col gap-3 p-0">${shown.map(postRow).join("\n")}</ul>`
        : `<ul class="m-0 grid gap-6 p-0 sm:grid-cols-2 lg:grid-cols-3">${shown.map(postCard).join("\n")}</ul>`;

  const heading = state.category ? `Blog — ${escHtml(state.category)}` : "Blog";

  return createHtmlResponse(
    Layout({
      // not-prose keeps the card grid out of the article typography styles.
      content: `
        <header class="not-prose mb-8">
          <h1 class="font-display text-4xl font-bold tracking-[-0.03em] text-ink">${heading}</h1>
          <p class="mt-3 max-w-2xl text-lg leading-relaxed text-stone-600">
            Releases, architecture notes, and the reasoning behind the decisions.
          </p>
        </header>
        <div class="not-prose">
          ${filterBar(categories, state)}
          ${controlBar(state, shown.length)}
          ${body}
        </div>`,
      title: state.category ? `Blog — ${state.category}` : "Blog",
      description: "Releases, architecture notes, and the reasoning behind Zerotal's decisions.",
      pathname: "/blog",
      sidebar: false,
    }),
  );
}

async function renderPost(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  const slug = pathname.replace(/^\/blog\/?/, "").replace(/\/$/, "");
  if (!slug) return renderIndex(req);

  const post = await loadPost(slug);
  if (!post) {
    return createHtmlResponse(
      Layout({
        content: `<h1>Post not found</h1>
<p>No blog post found for <code>${escHtml(slug)}</code>.</p>
<p><a href="/blog">← All posts</a></p>`,
        title: "Not Found",
        pathname,
        sidebar: false,
      }),
      404,
    );
  }

  // The post's own `# H1` renders from the Markdown body, so the date line sits
  // above it as a kicker rather than duplicating the title.
  const dateLine = post.date
    ? `<p class="not-prose mb-2 text-[0.8125rem] font-medium text-ash">${escHtml(formatDate(post.date))}</p>`
    : "";
  const body = Bun.markdown.html(post.content, MARKDOWN_OPTIONS);

  return createHtmlResponse(
    Layout({
      content: `${dateLine}${body}
        <p class="not-prose mt-14 border-t border-stone-200 pt-6">
          <a href="/blog" class="text-[0.8125rem] font-semibold text-voltage-700 no-underline">← All posts</a>
        </p>`,
      title: post.title,
      ...(post.description ? { description: post.description } : {}),
      pathname,
      sidebar: false,
    }),
  );
}

// `/blog/*` does not match the bare `/blog`, and trimming the URL back to the
// section root is exactly what a reader does to find the index — same reasoning
// as the docs routes.
Router.raw("GET", "/blog", renderIndex);
Router.raw("GET", "/blog/*", renderPost);
