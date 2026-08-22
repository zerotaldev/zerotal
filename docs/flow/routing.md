---
title: Flow Routing
description: Map URLs to Flow pages — file-based routes, route parameters, and navigation.
---

# Routing

Flow pages are plain TypeScript classes. Register them as routes with `Router.flow()`, or place them in a directory and let file-based routing discover them automatically. Either way, the same page class powers both the initial HTTP render and all subsequent WebSocket updates.

## The Router.flow method

`Router.flow(path, PageClass, middleware?)` registers a `Component` subclass as a `GET` route. The third argument accepts an array of middleware classes that run on the **initial GET and on every WebSocket update** — this is Flow's persistent middleware model (no separate "attach middleware per WS frame" step required).

```typescript fragment
// routes/web.ts
import { Router } from "zerotal";
import { DashboardPage } from "#app/flow/DashboardPage.tsx";
import { PostsPage } from "#app/flow/PostsPage.tsx";
import { PostDetailPage } from "#app/flow/PostDetailPage.tsx";
import { AdminPage } from "#app/flow/AdminPage.tsx";
import { RequireAuthMiddleware } from "#app/middleware/RequireAuth.ts";
import { RequireAdminMiddleware } from "#app/middleware/RequireAdmin.ts";

// No middleware — anyone can access
Router.flow("/posts", PostsPage);

// Single dynamic segment
Router.flow("/posts/:slug", PostDetailPage);

// Auth guard — middleware re-runs on every WebSocket update
Router.flow("/dashboard", DashboardPage, [RequireAuthMiddleware]);

// Multiple guards
Router.flow("/admin", AdminPage, [RequireAuthMiddleware, RequireAdminMiddleware]);
```

### Named routes

Chain `.name()` to give a route a name for reverse URL generation:

```typescript fragment
Router.flow("/dashboard", DashboardPage, [RequireAuthMiddleware]).name("dashboard");
Router.flow("/posts", PostsPage).name("posts.index");
Router.flow("/posts/:slug", PostDetailPage).name("posts.show");
```

### Route groups

Use `Router.group()` to share a prefix and/or middleware across several Flow routes:

```typescript fragment
Router.group({ prefix: "/app", middleware: [RequireAuthMiddleware] }, () => {
  Router.flow("/dashboard", DashboardPage); // /app/dashboard
  Router.flow("/profile", ProfilePage); // /app/profile
  Router.flow("/settings", SettingsPage); // /app/settings
});

Router.group(
  { prefix: "/admin", middleware: [RequireAuthMiddleware, RequireAdminMiddleware] },
  () => {
    Router.flow("/", AdminDashboardPage); // /admin
    Router.flow("/users", AdminUsersPage); // /admin/users
    Router.flow("/posts", AdminPostsPage); // /admin/posts
  },
);
```

Middleware declared on the group is persistent: it re-runs on every WebSocket update for every page in the group.

## File-based routing

When you call `.fileBasedRouting()` on `Application`, the framework scans the given directory and auto-registers any file that exports a `Component` subclass. No import required in a route file.

```typescript fragment
// bootstrap/app.ts
import { Application, basePath } from "zerotal";
import providers from "./providers.ts";

export default Application.create({ providers })
  .routing({ web: basePath("routes/web.ts") })
  .fileBasedRouting({ web: basePath("app/flow") });
```

Any `Component` subclass exported from a file under `app/flow/` is registered automatically. The URL path is derived from the file path relative to the root directory:

| File                                 | URL                     |
| ------------------------------------ | ----------------------- |
| `app/flow/DashboardPage.tsx`         | `/dashboard-page`       |
| `app/flow/PostsPage.tsx`             | `/posts-page`           |
| `app/flow/posts/IndexPage.tsx`       | `/posts/index-page`     |
| `app/flow/posts/[slug].tsx`          | `/posts/:slug`          |
| `app/flow/posts/[slug]/comments.tsx` | `/posts/:slug/comments` |
| `app/flow/admin/users/[id].tsx`      | `/admin/users/:id`      |

Class names become kebab-case URL segments: `DashboardPage` → `/dashboard-page`. For cleaner URLs, use explicit `Router.flow()` registration in a route file alongside file-based routing — both can coexist in the same app.

### Dynamic segments

Name a file (or directory) with square brackets to create a dynamic route segment:

```
app/flow/
  posts/
    [slug].tsx        →  /posts/:slug
    [slug]/
      comments.tsx    →  /posts/:slug/comments
  users/
    [id]/
      profile.tsx     →  /users/:id/profile
      edit.tsx        →  /users/:id/edit
```

### Per-file middleware

Export a `middleware` array from a file-route to attach middleware to that specific page:

```typescript fragment
// app/flow/admin/DashboardPage.tsx
import { RequireAuthMiddleware } from "#app/middleware/RequireAuth.ts";
import { RequireAdminMiddleware } from "#app/middleware/RequireAdmin.ts";

export const middleware = [RequireAuthMiddleware, RequireAdminMiddleware];

export class DashboardPage extends Component {
  // …
}
```

Or use a `_middleware.ts` file in a directory to apply middleware to every file in that directory:

```typescript fragment
// app/flow/admin/_middleware.ts
import { RequireAuthMiddleware } from "#app/middleware/RequireAuth.ts";
import { RequireAdminMiddleware } from "#app/middleware/RequireAdmin.ts";

export const middleware = [RequireAuthMiddleware, RequireAdminMiddleware];
```

## Accessing route parameters

### Query string parameters — @url

For query string parameters (`/posts?page=2&search=typescript`), use the `@url` decorator. The field is filled from the URL on the first render, and stays in sync as the value changes:

```typescript fragment
@url page:   number = 1;
@url search: string = "";
@url status: string = "all";

// Custom parameter name: /posts?q=typescript
@url({ as: "q" }) query: string = "";

// Push browser history on change (back button works)
@url({ history: "push" }) tab: string = "overview";
```

### Query-aware navigation

Where `@url` syncs a reactive prop **to** the URL, `this.currentUrl()` and `this.navigateCurrent()` go the other way — they **build** a URL from the one you're on with some query params changed, for filter links and instant filtering. Both are client-only helpers (the compiler rewrites them to the client runtime), so they update without a server round-trip to start.

```typescript fragment
// Build a URL from the current one — returns a string, does NOT navigate.
this.currentUrl({ query: { page: 3 } });
//  /posts?search=ts&page=2   →   /posts?search=ts&page=3

// Build that URL and SPA-navigate to it (layout stays mounted) — returns a Promise.
this.navigateCurrent({ query: { status: "active" } });
```

The merge rules:

- Params you pass are **added or updated**; params you don't mention are **preserved**.
- A value of `null`, `undefined`, or `""` **removes** that param (so `0` and `false` are kept).
- `hash: "section-2"` sets the hash; `hash: ""` clears it; omit it to leave the hash alone.

**Use `currentUrl()` in a binding** — an attribute value or a text child. The compiler turns it into a reactive client binding, so the link always reflects the current URL:

```tsx fragment
// Pagination links that preserve the active search / filters
<a href={this.currentUrl({ query: { page: this.page - 1 } })} flow:navigate>Previous</a>
<a href={this.currentUrl({ query: { page: this.page + 1 } })} flow:navigate>Next</a>
```

**Use `navigateCurrent()` in a handler** — perfect for instant filters that navigate as the user picks:

```tsx fragment
<select onChange={(e) => this.navigateCurrent({ query: { status: e.target.value || null } })}>
  <option value="">All</option>
  <option value="active">Active</option>
  <option value="archived">Archived</option>
</select>

// Clear a filter — passing "" removes the param
<button onClick={() => this.navigateCurrent({ query: { search: "" } })}>Clear search</button>
```

Like any navigation, this lands at the top of the page. A filter sitting partway
down is the case where that's wrong — the user is looking at the control they
just changed, and the results move out from under them. Pass `preserveScroll` to
leave the viewport where it is:

```tsx fragment
<select
  onChange={(e) =>
    this.navigateCurrent({ query: { status: e.target.value || null }, preserveScroll: true })
  }
>
```

Pagination is the opposite case: page 2 should start at the top, so leave it off.
`<Link preserveScroll>` does the same thing for a link — see
[Components](/docs/flow/components).

> **Warning** — Both helpers are client-only: they have no value on the server and throw if called from a server action or `onMount()`. Use them directly inside JSX bindings (an attribute value, a text child, or an `onClick`/`onChange` handler) — the compiler rewrites those to the `$flow.currentUrl` / `$flow.navigateCurrent` client magics. They're fully type-checked, no `$`-prefixed syntax. To navigate from server code instead, return a `redirect()`.

### Path parameters

Name a field after the segment and it arrives filled. `/posts/:post` names the `Post` model, so the page receives the loaded record — no query, and no lookup code:

```typescript fragment
// routes/web.ts — nothing to declare; :post is a Post
Router.flow("/posts/:post", PostDetailPage);
```

```typescript fragment
export class PostDetailPage extends Component {
  @locked post!: Post; // :post — the record, already loaded

  @expose async deletePost(): Promise<void> {
    await this.post.delete();
    this.redirect("/posts");
    this.flash("Post deleted.");
  }

  override async render() {
    return (
      <div>
        <h1>{this.post.title}</h1>
        <div class="prose">{this.post.body}</div>
        <button onClick={this.deletePost}>Delete</button>
      </div>
    );
  }
}
```

A segment that names a model arrives as the record; one that doesn't arrives as its plain string, so `@locked slug = ""` on `/posts/:slug` is filled the same way.

Flow does not decide how a segment resolves — the router does, and the page just receives the result. A record is looked up by primary key unless the model says otherwise, so resolving by a slug, or only publishing published posts, is [written once on the model](/docs/routing#the-model-owns-its-lookup) and changes nothing here.

Only `@locked` and `@expose` fields are filled, and only from segments the route actually matched. A plain undecorated property is never written from the URL.

When the field's name differs from the segment, `@param` says where it comes from — either the segment's name, or the model:

```typescript fragment
export class PostDetailPage extends Component {
  @locked @param(Post) article!: Post; // whichever segment resolved to a Post
  @locked @param("post") alsoArticle!: Post; // or name the segment
  @locked @param year: string = ""; // bare @param = the field's own name
}
```

Passing the model is the sturdier of the two — the field says what it wants and never has to track what a route called it. A model claims one segment name (its class name, or its `implicitBindingKey`), so there is nothing to be ambiguous about. Use the string form for the rare route that binds a second segment to the same model by hand; `@param(Model)` takes the first one.

### Reading the rest of the request

`onBoot()` and `onMount()` also receive the request itself — the same `HttpContext` a controller action gets — for anything the URL doesn't carry. It types `ctx.params` only, so the signed-in user is `{ user }`, not `params.user`:

```typescript fragment
override async onMount({ user }: HttpContext) {
  this.canEdit = user?.id === this.post.authorId;
}
```

The argument is optional, because a component can also be created outside a request — in a test, for example.

### Child components

A URL segment fills the **page**. `/posts/:post` gives the page its `post`; the components inside it get nothing from the URL, even if one of their fields happens to share the segment's name. If a child needs the post, the page hands it over:

```tsx fragment
// in the page's render()
<PostCard post={this.post} compact />
```

A prop lands on the field of the same name, before any hook runs:

```typescript fragment
export class PostCard extends Component {
  @locked post!: Post; // required — no default
  @locked compact = false; // optional — false when the page omits it
  @locked heading = "";

  override async onMount() {
    this.heading = this.post.title.toUpperCase(); // the prop is already here
  }
}
```

The initialiser is the convention: a field that has one is optional and falls back to it, and a field without one is required — so a page that forgets to pass it breaks on first use instead of quietly rendering the wrong thing.

A child still gets the request in `onBoot(ctx)` / `onMount(ctx)` — session, signed-in user, headers — like any page. It simply never reads the URL's segments, which is what lets the same `PostCard` work on `/posts/:post`, inside a list, and on a page with no segments at all.

Mark props `@locked` (or `@expose`) so their values survive round-trips in the child's own snapshot.

> **Warning** — Fields are filled from the URL on the first request only. A WebSocket action carries no URL, so the value comes back from the component's snapshot instead — which is why a model is never re-queried on every click. It also means you should not read `ctx.params` yourself in `onBoot()`: that hook runs on every request, after the snapshot has been restored, so it would blank the value on the first action.

### Integer route params

Coerce string params to numbers with `ctx.integer()`:

```typescript fragment
override async onMount(ctx: HttpContext) {
  this.userId = ctx.integer("id") ?? 0;
}
```

### All available request methods inside a Flow component

`onBoot()` and `onMount()` are handed the context directly. Everywhere else — an
`@expose`d action, or a service the page calls — reach for the `request()` helper,
which returns the same object from request-scoped storage:

```typescript
import { request } from "zerotal";

// Inside an @expose method, which takes its own arguments rather than a context:
const ctx = request();

ctx.params.slug; // string — matched route segment (initial GET only)
ctx.params.post; // Post   — a resolved route-model binding (initial GET only)
ctx.url.searchParams.get("q"); // string | null — raw query string access
ctx.string("search"); // string | undefined — reads params + query string
ctx.integer("page", 1); // number — coerced integer with fallback
ctx.boolean("active"); // boolean
ctx.user; // AuthenticatedUser | undefined — set by AuthMiddleware
ctx.ip(); // string | null — client IP
```

## Accessing the session

### The @session decorator — a field backed by the session

`@session` binds a field to a session key, so its value survives a browser refresh. Reads and writes go straight to the session; nothing is kept in the component's snapshot, so the browser never sees the value:

```typescript fragment
@session preferredTheme: string = "light";  // the session's `preferredTheme`
@session lastVisitedTab: string = "overview";

@session({ key: "cart_count" }) cartCount: number = 0;   // a differently-named key
@session({ scoped: true }) wizardStep: number = 1;       // flow:CheckoutPage:wizardStep
```

The key is the field's own name by default, so the value is the same one a controller or another component reads. Pass `scoped: true` for working state that belongs to this page alone — a wizard step, a half-finished draft — and the key is namespaced to the component instead.

Requires `SessionMiddleware` on the route. See [Decorators](/docs/flow/decorators#the-session-decorator) for the full options.

### Reading the session directly

For values that aren't a field on this component — a cart, a flash bag, anything you set elsewhere — use the [`Session`](/docs/session) facade. It resolves the in-flight request's session, so it works in any hook or action:

```typescript fragment
import { Session } from "@zerotal/session";

override async onMount() {
  if (Session.has("cart")) {
    this.cartItems = Session.get<CartItem[]>("cart") ?? [];
  }
}

@expose async addToCart(id: number): Promise<void> {
  Session.set("cart", [...this.cartItems, await Product.findOrFail(id)]);
}
```

`ctx.session` is the same store if you already have the context in hand.

Reach for `@session` when the value is a field on the component; reach for the facade when it isn't.

## Accessing the authenticated user

When `AuthMiddleware` (or your `RequireAuthMiddleware`) runs, it populates `ctx.user`. Access it via `request()`:

```typescript fragment
import { request } from "zerotal";

export class ProfilePage extends Component {
  @locked userId: number = 0;
  @locked userName: string = "";

  override async onBoot() {
    const user = request().user;
    this.userId = user?.id ?? 0;
    this.userName = user?.name ?? "";
  }

  override async onMount() {
    if (!this.userId) {
      this.redirect("/login");
      return;
    }
    this.profile = await Profile.where("user_id", this.userId).first();
  }
}
```

Because `onBoot()` runs on every request (initial GET and WebSocket), the auth check stays current for the full session — even if the user logs out in another tab.

## Page metadata

Declare static properties on the page class to control the document `<title>`, inject `<head>` content, and attach a layout:

```typescript fragment
export class DashboardPage extends Component {
  // Sets <title>Dashboard</title> on the initial render
  static title = "Dashboard";

  // Injected into <head> on the initial render
  static head = `
    <link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
    <meta name="robots" content="noindex">
  `;

  // Wrap the page in this layout (layout is preserved on navigate)
  static layout = AppLayout;
}
```

### The page title

`static title` takes a string, or a function of the component:

```typescript fragment
static title = "Posts";
static title = (c: PostPage) => `${c.post?.title ?? "Loading"} — My App`;
```

The function form is resolved on the server for every render and every patch, so a title
that depends on state follows it without an action doing anything:

```typescript fragment
@expose async loadPost(slug: string): Promise<void> {
  this.post = await Post.where("slug", slug).firstOrFail();
  // the title updates with it — nothing else to call
}
```

Only the resolved string is sent to the browser; the function stays on the server.

For per-render `<head>` content (meta tags, OG tags), use `<Head>` inside `render()`:

```tsx fragment
import { Head } from "@zerotal/flow";

override async render() {
  return (
    <div>
      <Head>
        <title>{this.post?.title ?? "Post"} — My App</title>
        <meta name="description" content={this.post?.excerpt ?? ""} />
        <meta property="og:image" content={this.post?.coverUrl ?? ""} />
      </Head>
      <h1>{this.post?.title}</h1>
    </div>
  );
}
```

## Complete example

A fully wired page with a dynamic route param, auth, session, query string, and layout:

```typescript fragment
import { Component, expose, locked, url, session } from "@zerotal/flow";
import { request } from "zerotal";
import { RequireAuthMiddleware } from "#app/middleware/RequireAuth.ts";
import { AppLayout } from "#app/flow/AppLayout.tsx";
import { Post } from "#app/models/Post.ts";

export class PostDetailPage extends Component {
  static layout   = AppLayout;
  static title    = "Post";

  // Route: /posts/:slug
  // Register: Router.flow("/posts/:slug", PostDetailPage, [RequireAuthMiddleware]);

  @locked slug:    string   = "";
  @locked post:    Post | null = null;
  @expose editing: boolean  = false;

  @url tab: string = "content";   // ?tab=content|comments
  @session viewed: boolean = false;       // persists across browser refreshes

  override async onBoot() {
    // Read the :slug segment on every request (initial + WebSocket updates)
    this.slug = request().params.slug ?? "";
  }

  override async onMount() {
    this.post = await Post.query()
      .where("slug", this.slug)
      .withRelationships(["author", "tags"])
      .first();

    if (!this.post) {
      this.redirect("/posts");
      return;
    }

    // Track that the user has viewed this post (session-persisted)
    if (!this.viewed) {
      await this.post.increment("view_count");
      this.viewed = true;
    }
  }

  @expose async publish(): Promise<void> {
    if (!this.post) return;
    await this.post.fill({ status: "published" }).save();
    this.flash(`"${this.post.title}" is now live.`);
    this.editing = false;
  }

  @expose async delete(): Promise<void> {
    if (!this.post) return;
    await this.post.delete();
    this.dispatch("post-deleted", { slug: this.slug });
    this.redirect("/posts");
    this.flash("Post deleted.");
  }

  override async render() {
    if (!this.post) return <div>Not found.</div>;

    return (
      <div class="max-w-3xl mx-auto py-12 px-6">
        <h1 class="text-3xl font-bold mb-4">{this.post.title}</h1>
        <p class="text-sm text-gray-500 mb-8">
          By {this.post.author?.name} · {this.post.view_count} views
        </p>

        <div class="prose">{this.post.body}</div>

        <div class="mt-8 flex gap-3">
          <button onClick={() => (this.editing = !this.editing)}>
            {this.editing ? "Cancel" : "Edit"}
          </button>
          {this.post.status === "draft" && (
            <button onClick={this.publish}>Publish</button>
          )}
          <button onClick={this.delete} class="text-red-600">Delete</button>
        </div>
      </div>
    );
  }
}
```

## Next steps

- [Flow overview](/docs/flow) — the guide's front page and the rest of the sections.
- [Reference](/docs/flow/references) — every decorator, prop, and directive in one table.
