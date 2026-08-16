---
title: Inertia
description: Build a single-page app with server-side routing and controllers — no separate API layer or client-side router.
---

# Inertia

[Inertia.js](https://inertiajs.com) lets you build a single-page app using
server-side routing and controllers — no separate API layer, no client-side router.
Your controllers return Inertia **page responses**; Inertia renders the matching
React (or Vue) component client-side on navigation, and returns a full HTML document
on the first load.

Zerotal's `@zerotal/inertia` package is a native, Bun-powered Inertia server adapter with full
**Inertia v3** protocol support: controller-less page routes, automatic shared props, asset
versioning, the complete data-props layer (partial reloads, `optional`/`defer`/`merge`/`once` props,
history encryption, precognition), a `make:page` generator, a `Bun.build`-based bundler, and optional
streaming SSR — all wired by a single provider. The stock `@inertiajs/react` / `@inertiajs/vue3`
clients work against it unchanged.

## How it works

1. **First load** — a `GET` request hits a controller, which calls `inertia()`. The
   server renders the full HTML document with the page object (component name +
   props) embedded as JSON.
2. **Client boot** — the Inertia client reads that page object and mounts the named
   component.
3. **Navigation** — subsequent links/visits send an `X-Inertia: true` request. The
   same controller runs, but `inertia()` returns **only the JSON page object** — the
   client swaps the page component without a full reload.

The server stays the source of truth for routing and data; the client is just a thin
renderer that morphs between pages.

## Getting Started

The framework adapter (React or Vue) is a peer dependency you install in your app —
the server package works against whichever you choose:

```bash
# in your project root
bun add @inertiajs/react react react-dom   # React
# or
bun add @inertiajs/vue3 vue                # Vue
```

`@zerotal/inertia` itself ships with the framework. If you're adding it to an
existing app, `bun add @zerotal/inertia`.

## Register the provider

Add `InertiaProvider` to the providers array in `bootstrap/providers.ts`:

```ts
// bootstrap/providers.ts
import { InertiaProvider } from "@zerotal/inertia";

const providers = [
  // …your other providers
  InertiaProvider,
];

export default providers;
```

That's the only wiring you need. Registering the provider switches on the following (in lifecycle order):

- `onRegister` — registers the `Router.inertia()` route macro so it's available before routes load.
- `onBooting` — auto-registers `InertiaMiddleware` via `app.useOnce()`, loads the HTML template and asset version into memory, resolves the pages directory, applies the history-encryption default, and (when `ssr: true`) registers `POST /__ssr`.
- `onBooted` — registers Inertia's dev build routine (alongside any other view layer's, so both keep rebuilding) and lazily registers the `make:page` and `inertia:build` CLI commands when running in console mode.

You do **not** add `InertiaMiddleware` to `.use()` manually (see [Middleware & Versioning](/docs/inertia/middleware)).

## Configuration

Create `config/inertia.ts` with the `InertiaConfig()` helper (or `satisfies
InertiaConfigShape`). Every field has a default, so an empty `InertiaConfig({})` is valid:

```ts
// config/inertia.ts
import { InertiaConfig } from "@zerotal/inertia";
import { env } from "zerotal";

export default InertiaConfig({
  htmlTemplate: "./resources/app.html", // root template — must contain <!-- @inertia -->
  version: env("ASSET_VERSION", "1"), // cache-bust string; bump on each deploy
  assetsUrl: "/", // public URL prefix for built assets
  pagesDir: "resources/js/pages", // where page components live
  ssr: false, // set true to enable POST /__ssr (see SSR)
});
```

| Field            | Required | Default                  | Description                                                                                          |
| ---------------- | -------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `htmlTemplate`   | no       | `"./resources/app.html"` | Path to the root HTML template (must contain `<!-- @inertia -->`); falls back to a built-in default. |
| `version`        | no       | `"1"`                    | Asset version string embedded in every page object; bump on each deploy.                             |
| `assetsUrl`      | no       | `"/"`                    | Public URL prefix for built assets.                                                                  |
| `pagesDir`       | no       | `"resources/js/pages"`   | Directory (relative to the project root) where Inertia page components live.                         |
| `ssr`            | no       | `false`                  | Register `POST /__ssr` for endpoint SSR (requires a server renderer).                                |
| `encryptHistory` | no       | `false`                  | Encrypt browser history state globally; per-page overrides via `Inertia.encryptHistory()`.           |

### HTML template

The template is loaded **once at boot**; `<!-- @inertia -->` is where the page
object and root `<div>` are injected on every response:

```html
<!-- resources/app.html -->
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My App</title>
    <script type="module" src="/assets/app.js" defer></script>
  </head>
  <body>
    <!-- @inertia -->
  </body>
</html>
```

> **Note** — If `htmlTemplate` is missing, `InertiaProvider` falls back to a built-in default
> template in development so the app still boots — but in production a missing template
> throws. Provide your own for real projects.

## Your first page

A controller action calls `inertia(component, props)`:

```ts
// app/controllers/DashboardController.ts
import type { HttpContext } from "zerotal";
import { inertia } from "@zerotal/inertia";
import { Post } from "../models/Post.ts";

export class DashboardController {
  async index(ctx: HttpContext): Promise<void> {
    const posts = await Post.query().latest().limit(5).get();
    return inertia("Dashboard", { posts });
  }
}
```

`inertia()` reads the current request from context — it takes **no context
argument** — and sets the response as a side effect, so the action returns
`Promise<void>`. The component name (`"Dashboard"`) maps to
`resources/js/pages/Dashboard.tsx`.

```tsx
// resources/js/pages/Dashboard.tsx
import { Link } from "@inertiajs/react";

interface Props {
  posts: { id: number; slug: string; title: string }[];
  auth: { user: { name: string } | null }; // from shared props
}

export default function Dashboard({ posts, auth }: Props) {
  return (
    <main>
      <h1>Dashboard</h1>
      {auth.user && <p>Welcome back, {auth.user.name}</p>}
      {posts.map((post) => (
        <Link key={post.id} href={`/posts/${post.slug}`}>
          {post.title}
        </Link>
      ))}
    </main>
  );
}
```

Note `auth` is available without the controller passing it — see
[Shared Props](/docs/inertia/props). Generate new pages with
[`make:page`](/docs/inertia/build#generating-a-page) and bundle them with
[`inertia:build`](/docs/inertia/build#building-assets).

## Testing

Set your suite up once as described in [Testing](/docs/testing). An Inertia route
serves two different things depending on one header, so a test has to say which
one it wants.

**Send `X-Inertia: true` to get the page object** instead of the HTML shell. This
is the assertion you want in almost every route test — it checks the component
and its props without parsing markup:

```typescript
// tests/http/dashboard.test.ts
import { test } from "bun:test";
import { createApp } from "../helpers.ts";

test("the dashboard renders with its stats", async () => {
  const app = await createApp();

  const res = await app.actingAs(user).get("/dashboard", { "X-Inertia": "true" });

  res.assertJsonPath("component", "Dashboard");
  res.assertJsonPath("props.stats.orders", 12);
  await app.close();
});
```

**Without that header you get the full HTML document** with the page object
embedded in a `data-page` attribute — right for asserting the first paint, wrong
for asserting props:

```typescript
// tests/http/dashboard.test.ts
const res = await app.actingAs(user).get("/dashboard");

res.assertSee('<div id="app"');
res.assertHeader("Vary", "X-Inertia"); // the response varies by that header
```

**Test partial reloads by the props they omit.** A partial reload that quietly
returns everything is a performance bug no page-level assertion catches:

```typescript
// tests/http/dashboard.test.ts
const res = await app.actingAs(user).get("/dashboard", {
  "X-Inertia": "true",
  "X-Inertia-Partial-Data": "stats",
  "X-Inertia-Partial-Component": "Dashboard",
});

res.assertJsonPath("props.stats.orders", 12);
const page = res.json<{ props: Record<string, unknown> }>();
expect(page.props.notifications).toBeUndefined(); // excluded, as asked
```

**A version mismatch is a `409`, not an error.** It tells the client to reload so
it picks up new assets — worth a test if you set `ASSET_VERSION` on deploy:

```typescript
// tests/http/dashboard.test.ts
const res = await app.get("/dashboard", { "X-Inertia": "true", "X-Inertia-Version": "stale" });

res.assertStatus(409);
res.assertHeader("X-Inertia-Location");
```

> **Note** — For the client half — a component rendering, a form submitting, a
> deferred prop arriving — use [Browser Tests](/docs/testing/browser). These
> assertions stop at the boundary your server owns.

## The rest of the guide

| Page                                                | What it covers                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| [Rendering Pages](/docs/inertia/rendering)          | Return a page from a controller, choose a component, and control the response.                            |
| [Props](/docs/inertia/props)                        | Pass data to a page — eager, lazy, deferred, and merged props, plus the shared props every page receives. |
| [Middleware & Versioning](/docs/inertia/middleware) | The Inertia middleware, asset versioning, and forcing a full reload after a deploy.                       |
| [Server-Side Rendering](/docs/inertia/ssr)          | Render the first paint on the server, and what changes when you do.                                       |
| [DevTools](/docs/inertia/devtools)                  | Record each request's component, props, and timing for the Inertia DevTools extension.                    |
| [CLI & Build](/docs/inertia/build)                  | The page registry, the bundler pipeline, and building for production.                                     |
| [Reference](/docs/inertia/references)               | Every helper, prop type, and config key in one table.                                                     |

## Next steps

- [Controllers](/docs/controllers) — where most `inertia()` calls live.
- [Routing](/docs/routing) — declare routes and the `Router.inertia()` macro targets.
- [Middleware](/docs/middleware) — how `InertiaMiddleware` slots into the pipeline.
- [Validator](/docs/validator) — the validation that feeds the `errors` shared prop and precognition.
- [Providers](/docs/providers) — the lifecycle hooks `InertiaProvider` builds on.
- [Pagination](/docs/pagination) — the paginators `merge()` and `scroll()` consume.
