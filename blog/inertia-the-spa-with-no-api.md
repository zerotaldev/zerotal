---
title: "React, Server-Routed: The SPA That Never Grew an API"
description: "Inertia removes the API layer between your controllers and your React or Vue pages. Zerotal implements the full v3 props protocol — partial reloads, deferred props, merged infinite scroll, precognition — so the server keeps deciding what crosses the wire and when."
date: 2026-08-10
category: Announcements
order: 9
---

# React, Server-Routed: The SPA That Never Grew an API

There is a specific moment in a project where the architecture doubles. You have a working server with routes, controllers, validation and a database. Then the frontend needs to be a real SPA, and suddenly you also have: a REST or GraphQL layer, a second router, a client-side store, response types hand-maintained on both sides, and a fetch wrapper with retry logic. None of it is _product_. All of it is now yours to keep in sync.

[Inertia](https://inertiajs.com) is the answer to that, and it is a deceptively small idea: your controllers keep returning pages, they just return **React or Vue components with props** instead of HTML. There is no API, because there is nothing for an API to sit between. Server-side routing, server-side controllers, server-side validation — with a client-rendered SPA on top.

`@zerotal/inertia` is a native, Bun-powered adapter with full **Inertia v3** support, and the stock `@inertiajs/react` / `@inertiajs/vue3` clients work against it unchanged. This post is about the half people underestimate: the props protocol, which is where an Inertia app gets fast.

## The whole loop

```ts
// app/controllers/DashboardController.ts
import { inertia } from "@zerotal/inertia";

export class DashboardController {
  async index(ctx: HttpContext): Promise<void> {
    const posts = await Post.query().latest().limit(5).get();
    return inertia("Dashboard", { posts });
  }
}
```

```tsx
// resources/js/pages/Dashboard.tsx
export default function Dashboard({ posts, auth }: Props) {
  return (
    <main>
      {auth.user && <p>Welcome back, {auth.user.name}</p>}
      {posts.map((p) => (
        <Link key={p.id} href={`/posts/${p.slug}`}>
          {p.title}
        </Link>
      ))}
    </main>
  );
}
```

That is the entire contract. `inertia()` reads the current request from context — there is **no context argument** — and sets the response as a side effect, so an action returns `Promise<void>` and `return inertia(...)` is idiomatic.

On a first load the server sends a full HTML document with the page object embedded. On every navigation after that, the same controller runs and returns only the JSON page object; the client swaps the component. Both responses carry `Vary: X-Inertia` so a browser or CDN never serves the JSON variant where the document was expected.

Pages that need no controller logic skip the controller entirely:

```ts
Router.inertia("/about", "About/Index");
Router.inertia("/home", "Home/Index", { greeting: "Hello" });
Router.inertia("/admin", "Admin/Dashboard", { title: "Admin" }, [AuthMiddleware]);
```

## Props are the API, so the protocol is about props

Here is the part that matters. Once the API layer is gone, **the props object is the wire contract** — and every performance question becomes "which props, evaluated when". Inertia v3 answers that with wrappers, and Zerotal implements all of them.

The base case is the one people miss, and it is free:

```ts
return inertia("Users/Index", {
  users: () => User.all(), // a function, not a value
  companies: () => Company.all(),
});
```

A function prop is always _sent_ on a full visit but only _evaluated_ when it is actually included. So when the client does `router.reload({ only: ["users"] })`, the `companies` query never runs. You did not write a branch, a second endpoint, or a partial-reload handler — you wrapped the value in an arrow.

The full ladder:

| Wrapper                      | Full visit | Partial reload | Evaluated        |
| ---------------------------- | ---------- | -------------- | ---------------- |
| `User.all()`                 | always     | optionally     | always           |
| `() => User.all()`           | always     | optionally     | only when needed |
| `optional(() => User.all())` | **never**  | optionally     | only when needed |
| `always(value)`              | always     | **always**     | always           |

`optional()` is for data a page can fetch on demand — expensive, below the fold, behind a tab. `always()` is for things the client must never lose to an `only` filter; the shared `errors` bag uses it internally, which is why a partial reload can never accidentally strip your validation messages.

## Deferred props: render now, fill in after

Some data is slow and nothing you do will make it fast. `defer()` takes it out of the first response entirely and tells the client to come back for it:

```ts
return inertia("Users/Index", {
  users: () => User.all(),
  permissions: defer(() => Permission.all()), // default group
  teams: defer(() => Team.all(), "attributes"), // grouped…
  projects: defer(() => Project.all(), "attributes"), // …one follow-up request
});
```

Grouping is the control that makes this usable at scale: each group is one request, so you decide the parallelism instead of firing one round-trip per slow prop. The first response carries a `deferredProps` map; the client partial-reloads each group and renders `<Deferred>` fallbacks meanwhile.

And a deferred prop that throws does not have to take the page with it:

```ts
permissions: defer(() => Permission.all(), "default", { rescue: true }),
```

The key is reported in `rescuedProps`, the client renders the `<Deferred rescue>` slot, and the rest of the page is unaffected. A flaky third-party call degrades to a small empty panel rather than a 500.

## Infinite scroll where the server still owns pagination

This is the feature people hand-roll worst. By default a reloaded prop _replaces_ the client's value, which is exactly wrong for "load more" — you wanted to append. `merge()` says so:

```ts
return inertia("Feed", { posts: merge(() => Post.paginate(15, page)) });
```

With chainable targeting when the shape is nested:

```ts
merge(users).append("data").matchOn("data.id"); // append into users.data, replace by id
merge(items).prepend();
deepMerge(chat).matchOn("messages.id");
```

`matchOn` is the quiet one: it de-duplicates by key, so a row that appears on two pages because someone inserted a record mid-scroll updates in place instead of showing twice.

`scroll()` goes further and is purpose-built for the client's `<InfiniteScroll>`:

```ts
return inertia("Posts/Index", {
  posts: scroll(() => Post.paginate(15, page)),
});
```

It merges `posts.data` and emits a `scrollProps` entry describing the current, next and previous page, derived from the paginator. The client then knows when to load more **and which direction** — scroll up and it sends `X-Inertia-Infinite-Scroll-Merge-Intent: prepend`, and Zerotal prepends instead of appending. No controller change. Bidirectional infinite scroll, with the server still the only thing that knows how pagination works, in one wrapper.

`.once()` closes the set: a prop resolved a single time and remembered by the client across navigations, for the data that genuinely does not change per page.

```ts
plans: optional(() => Plan.all()).once(),
```

## The props every page gets

Passing the current user from every controller is the kind of repetition that is fine for six controllers and a liability at sixty. Shared props are merged into every page automatically:

```ts
{
  auth:   { user: ctx.user ?? null },
  flash:  { success: …, error: … },
  errors: always(session.get("errors") ?? {}),
  old:    session.get("old") ?? {},
}
```

Your controller's props are spread _over_ these, so a key you pass yourself wins. Register your own once and they join the set:

```ts
Inertia.share({
  appName: "Acme",
  year: () => new Date().getFullYear(), // evaluated per request
  flags: Inertia.optional(() => FeatureFlag.all()),
});
```

Note that a shared prop can be any wrapper, so "the feature flags, but only when a page asks" is expressible without a controller knowing about it.

One deliberate detail: `auth.user` is reduced to **scalar fields only**. That is not laziness — a live ORM model with an unloaded `@hasMany` relation throws the moment `JSON.stringify` touches the relation getter. The plain object is always safe to serialize. If a page needs related data, the controller eager-loads it and passes it as a normal prop, which is also where you want that decision to be visible.

## Live validation against the real rules

Client-side validation that duplicates server rules is a second source of truth that drifts. Precognition removes the duplicate: the form asks the **server** whether the input is valid, and the server answers without running the controller's side effects.

```ts
// The controller is unchanged.
async store(ctx: HttpContext) {
  const data = await StorePostRequest.validate();
  // …only reached on a real submit
}
```

When a request carries `Precognition: true`, `FormRequest.validate()` runs the rules and short-circuits with a `204` (valid) or `422` (errors) — optionally narrowed to the fields named in `Precognition-Validate-Only`, so a blur on the email field validates the email field. Your rules live in one place and the live form is checked against them.

## Deploys, versioning, and the 409 that saves you

A user with yesterday's bundle open when you deploy is the classic Inertia failure. The protocol handles it and Zerotal wires it automatically: every page object carries an asset version, and when the client's `X-Inertia-Version` no longer matches, `InertiaMiddleware` answers **409** with `X-Inertia-Location`. The client does a full reload onto the new assets.

Make the version derive from the bundle itself and it is correct by construction:

```ts
const hash = Bun.hash(await Bun.file("public/assets/app.js").text()).toString(16);
setAssetVersion(hash);
```

The version now changes exactly when the client code changes — never on a deploy that only touched the server, always on one that did not.

The same middleware upgrades a post-submit `302` to a `303` so the browser issues a GET instead of replaying the form, and stamps `Vary: X-Inertia`. You never register it; the provider does.

## The build is Bun

No separate bundler config, no plugin ecosystem to assemble:

```bash
bun zt make:page Users/Index
bun zt make:page Settings --layout MainLayout
bun zt inertia:build -p
```

`inertia:build` runs `Bun.build` with code splitting on, auto-detects the CSS (and Vue) plugins your project has, and prints an output table. The splitting is real per-page splitting, driven by a generated page registry that maps `"Users/Index"` to a dynamic `import()` — so a navigation loads that page's chunk and nothing else. Both `make:page` and `inertia:build` regenerate the registry, so it never falls out of sync with the directory.

`make:page` detects React or Vue from the adapter you installed. `--layout` emits a persistent layout — mounted once, surviving client-side navigations, so only the page content re-renders.

## Server-side rendering, two ways

Turn on the standard contract globally:

```ts
export default InertiaConfig({ ssr: true }); // registers POST /__ssr
```

First loads render on the server; navigations keep the fast JSON path. React pages render through `react-dom/server`, Vue through `@inertiajs/vue3` + `vue/server-renderer`.

Or stream the pages where time-to-first-byte actually matters, one controller at a time:

```ts
return inertiaStream("Posts/Show", { post });
```

`inertiaStream()` uses React 18's `renderToReadableStream` and flushes the template's HTML prefix immediately, so the browser starts parsing `<head>` and fetching assets while the component is still rendering. It is a drop-in swap for `inertia()` — the recommendation is to stream your heaviest landing pages and leave everything else alone.

## Testing stops at the boundary you own

An Inertia route serves two different things depending on one header, so a test says which one it wants. Send `X-Inertia: true` and assert on the page object rather than parsing markup:

```ts
const res = await app.actingAs(user).get("/dashboard", { "X-Inertia": "true" });

res.assertJsonPath("component", "Dashboard");
res.assertJsonPath("props.stats.orders", 12);
```

The assertion worth adding that nobody adds is the partial reload — because a partial reload that quietly returns _everything_ still passes every page-level test while doing none of the work you added it for:

```ts
const res = await app.actingAs(user).get("/dashboard", {
  "X-Inertia": "true",
  "X-Inertia-Partial-Data": "stats",
  "X-Inertia-Partial-Component": "Dashboard",
});

const page = res.json<{ props: Record<string, unknown> }>();
expect(page.props.notifications).toBeUndefined(); // excluded, as asked
```

That test fails the day someone unwraps a lazy prop back into a bare value.

## What you didn't build

No REST layer. No GraphQL schema. No client-side router. No store. No response types maintained twice. No fetch wrapper. No separate validation rules for the frontend. No bundler config.

Your controllers still return pages; the pages are just React now. And the props protocol means the decisions that used to require a new endpoint — _don't send that until asked_, _load that after paint_, _append rather than replace_ — are each one word in the object you were already returning.

From here: [Inertia](/docs/inertia) is the front page, [Props](/docs/inertia/props) has the full v3 wrapper set and shared props, [Rendering](/docs/inertia/rendering) covers component resolution and redirects, [SSR](/docs/inertia/ssr) covers both rendering modes, and [CLI & Build](/docs/inertia/build) covers the bundler and the page registry. Start fresh with `bun create zerotal` and the `react` or `vue` template — routes, pages and Tailwind arrive wired together.
