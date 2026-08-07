---
title: Inertia Rendering Pages
description: Return a page from a controller, choose a component, and control the response.
---

# Rendering pages

Every Inertia response goes through one helper: `inertia()`. This section covers how it
resolves components, what it returns for each request type, controller-less page
routes, and how redirects behave.

## The inertia helper

```ts
function inertia(component: string, props?: Record<string, unknown>): Promise<void>;
```

Call `inertia()` from any controller action. It reads the active request from
`RequestContext` (via AsyncLocalStorage), so there is **no context argument** — and
it sets `ctx.response` as a side effect. It is **async** (it resolves lazy/deferred props), so it
returns `Promise<void>` — always `return inertia(...)` (or `await` it):

```ts
// app/controllers/PostController.ts
import type { HttpContext } from "zerotal";
import { inertia } from "@zerotal/inertia";
import { Post } from "../models/Post.ts";

export class PostController {
  async index(ctx: HttpContext): Promise<void> {
    const posts = await Post.query()
      .withScopes((s) => s.published())
      .with("author")
      .orderBy("published_at", "desc")
      .paginate(10, Number(ctx.query("page", "1")));

    return inertia("Posts/Index", { posts });
  }

  async show(ctx: HttpContext): Promise<void> {
    const post = await Post.query()
      .where("slug", ctx.params["slug"]!)
      .with("author")
      .with("comments")
      .firstOrFail();

    return inertia("Posts/Show", { post });
  }
}
```

`return inertia(...)` is idiomatic: the helper returns `Promise<void>`, so returning it ends the
action.

> **Warning** — `inertia()` takes `(component, props)` — _not_
> `inertia(ctx, component, props)`. The request is resolved from context
> automatically.

### Controlling which props are sent, and when

Props can be more than plain values. Wrap them to make them lazy, optional, deferred, or mergeable —
the foundation for partial reloads, "load more" lists, and deferred content:

```ts
// in a controller
import { inertia, optional, defer, merge } from "@zerotal/inertia";

return inertia("Users/Index", {
  users: () => User.all(), // lazy — only evaluated when sent
  roles: optional(() => Role.all()), // only on a partial reload that asks for it
  stats: defer(() => computeStats()), // loaded after first paint
  feed: merge(() => Post.paginate(15, page)), // appended on "load more"
});
```

A unified `Inertia` facade exposes the full protocol API (`Inertia.render`, `Inertia.optional`,
`Inertia.defer`, `Inertia.merge`, `Inertia.share`, `Inertia.location`, …). See
[Data Props](/docs/inertia/props) for the full v3 feature set.

## Component resolution

The component string maps to a file under your pages directory (`resources/js/pages/`
by default, configurable via `pagesDir`), with the framework extension appended
(`.tsx` for React, `.vue` for Vue):

| `inertia(...)` call           | Component file                            |
| ----------------------------- | ----------------------------------------- |
| `inertia("Dashboard")`        | `resources/js/pages/Dashboard.tsx`        |
| `inertia("Posts/Index")`      | `resources/js/pages/Posts/Index.tsx`      |
| `inertia("Admin/Users/Edit")` | `resources/js/pages/Admin/Users/Edit.tsx` |

Component names are validated — a name containing `..` or a leading `/` is rejected
to prevent path traversal.

### Props serialization

Props are JSON-serialized into the page object. **Pass plain data, not live ORM
models with unloaded relations** — eager-load what the page needs (`.with("author")`)
or map to a plain shape. Shared props (`auth.user`) are already reduced to scalars
for you; see [Shared Props](/docs/inertia/props).

## First load vs. navigation

`inertia()` branches on the `X-Inertia` request header:

| Request                            | Response                                                 |
| ---------------------------------- | -------------------------------------------------------- |
| First load (no `X-Inertia` header) | Full HTML document with the page object JSON embedded    |
| XHR navigation (`X-Inertia: true`) | JSON page object only (`Content-Type: application/json`) |

Both responses carry `Vary: X-Inertia` so browsers and CDNs cache the HTML and JSON
variants separately. The page object always includes the current `url` and asset
`version`.

## Controller-less routes

For pages that need no controller logic (marketing pages, static dashboards), render
straight from the route with the `Router.inertia()` macro (added by the package):

```ts
// routes/web.ts
import { Router } from "zerotal";

Router.inertia("/about", "About/Index"); // no props
Router.inertia("/home", "Home/Index", { greeting: "Hello" }); // static props
Router.inertia("/admin", "Admin/Dashboard", [AuthMiddleware]); // middleware shorthand
```

The third argument is polymorphic: pass a **props object**, or pass a **middleware
array** directly as a shorthand. To use both, pass props third and middleware fourth:

```ts
// routes/web.ts
Router.inertia("/admin", "Admin/Dashboard", { title: "Admin" }, [AuthMiddleware]);
```

## Redirects

After a non-GET action (a form POST/PUT/DELETE), redirect as usual — return a 302 and
[`InertiaMiddleware`](/docs/inertia/middleware) upgrades it to a **303** so the
browser issues a GET on the target instead of replaying the form:

```ts
// in a controller
async store(ctx: HttpContext): Promise<void> {
  const post = await Post.create(await ctx.body());
  ctx.flash("success", "Post created.");
  return ctx.redirect(`/posts/${post.slug}`); // 302 → 303, then renders Posts/Show
}
```

Validation failures redirect back with errors in the session, which surface as the
`errors` shared prop on the re-rendered page — again, see
[Shared Props](/docs/inertia/props).

### External redirects — Inertia.location

To send the browser to an external URL (or force a full-page visit), use `Inertia.location(url)`. On
an Inertia request it returns a `409` + `X-Inertia-Location` so the client does a `window.location`
visit; on a normal request it's a plain `302`:

```ts
// in a controller
import { Inertia } from "@zerotal/inertia";

return Inertia.location("https://billing.stripe.com/session/abc");
```

Redirects to a target with a URL fragment (`/page#section`) are automatically converted to a `409` +
`X-Inertia-Redirect` on Inertia requests so the fragment is preserved across the visit. See
[External & fragment redirects](/docs/inertia/props#external-fragment-redirects).

## Next steps

- [Inertia overview](/docs/inertia) — the guide's front page and the rest of the sections.
- [Reference](/docs/inertia/references) — the full API surface in one table.
