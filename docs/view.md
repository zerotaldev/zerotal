---
title: View
description: Render server-side HTML from typed JSX components that escape untrusted data by default.
---

# View

Zerotal's view layer is a JSX server-side rendering engine built into
`@zerotal/core` — the same package that provides `ctx.view()`. It compiles JSX
to plain HTML strings at request time: no virtual DOM, no hydration, and no
client JavaScript unless you opt in.

## Getting Started

The view runtime ships inside `@zerotal/core`, so there is no package to install
or provider to register — you only point the TypeScript JSX transform at it. Set
it once in `tsconfig.json` and every `.tsx` file in the project is covered:

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "zerotal"
  }
}
```

Scaffolded projects already have this — `bun create zerotal` writes it into the
template's `tsconfig.json`, so the JSX examples below compile as-is.

## Basic usage

Components are plain TypeScript functions that return `SafeHtml`. Type them with
`FC<Props>` for the standard `(props, children) => SafeHtml` shape:

```tsx
// resources/views/Card.tsx
import type { FC } from "zerotal/view";

interface CardProps {
  title: string;
  children?: unknown;
}

export const Card: FC<CardProps> = ({ title, children }) => (
  <div class="card">
    <h2>{title}</h2>
    <div class="card-body">{children}</div>
  </div>
);
```

All string children are HTML-escaped automatically. To embed pre-rendered HTML,
use the [`safe()` helper or `Raw` component](#embedding-raw-html).

> **Tip** — Prefer native HTML attribute names (`class`, `for`, `tabindex`, …).
> React-style `className` and `htmlFor` are accepted and mapped to `class`/`for`,
> but native names are idiomatic here.

> **Warning** — SSR only, no client interactivity. The runtime emits plain HTML
> strings; event-handler props like `onClick` are not serialized and are silently
> dropped. For interactive UI, reach for [Flow](/docs/flow) (server-driven)
> or [Inertia](/docs/inertia) (React/Vue) instead.

## Attributes

The runtime renders attributes from props with a few rules:

```tsx fragment
// in a component
<input type="text" value={name} disabled={isLocked} required={false} data-id={42} />
// → <input type="text" value="…" disabled data-id="42">
```

- **Boolean `true`** renders the bare attribute (`disabled`); **`false`, `null`,
  and `undefined`** omit it entirely — ideal for conditional attributes.
- Only **string** and **number** values are rendered as `key="value"` (both
  escaped).
- `className` → `class` and `htmlFor` → `for` are mapped; every other key is used
  verbatim.
- **No object values.** `style` must be a string (`style="color:red"`), not an
  object — non-string, non-number values are dropped.
- `key` is ignored in output (it's a JSX hint, not an HTML attribute).

## How children render

Children are rendered by type, which is the engine's security boundary:

| Child value                             | Output                                  |
| --------------------------------------- | --------------------------------------- |
| `SafeHtml` (from JSX / `safe()`)        | Passed through unescaped                |
| `string`                                | **HTML-escaped** (treated as untrusted) |
| `number`                                | Stringified (inert — no escaping)       |
| `true` / `false` / `null` / `undefined` | Renders nothing                         |
| `Array`                                 | Each item rendered and concatenated     |

Two consequences worth remembering:

```tsx fragment
// in a component
{
  user && <Welcome name={user.name} />;
}
{
  /* false/null → nothing, so guards just work */
}

{
  count;
}
{
  /* 0 renders "0" — numbers are never blank */
}
```

Void elements (`<br>`, `<img>`, `<input>`, `<hr>`, `<meta>`, …) render without a
closing tag automatically.

## Rendering in a controller

Call `view()` from a controller action to set the response. It accepts any value
whose `.toString()` returns HTML — a `SafeHtml` instance from JSX is the normal
case:

```tsx fragment
// app/controllers/PostController.tsx
import { view } from "zerotal";
import type { HttpContext } from "zerotal";
import { Post } from "../models/Post.ts";
import { PostList } from "../resources/views/PostList.tsx";

export class PostController {
  async index(ctx: HttpContext) {
    const posts = await Post.query().latest().get();
    view(<PostList posts={posts} title="All Posts" />);
  }
}
```

### Passing a component and props

You can also hand `view()` (or `ctx.view()`) the **component itself** plus its
props. The component receives the request `HttpContext` as its first argument and
your props as its second; route params and model bindings reach it through
`ctx.params`:

```tsx
// resources/views/Welcome.tsx
import type { HttpContext } from "zerotal";

export default function Welcome(ctx: HttpContext, { title }: { title: string }) {
  return (
    <div>
      <h1>{title}</h1>
      <p>{ctx.url.pathname}</p>
    </div>
  );
}
```

```ts fragment
// routes/index.ts — the HttpContext is injected; you only pass the extra props
import { Router } from "zerotal";
import Welcome from "../resources/views/Welcome.tsx";

Router.get("/", () => view(Welcome, { title: "Welcome to Zerotal" }));
```

The component may be async — `view()` awaits it before setting the response.

> **Warning** — JSX renders synchronously. A JSX expression evaluates to
> `SafeHtml` right away, so components used inline (`<PostList … />`) can't be
> `async`. If you need to load data while rendering, use the component + props
> form above (which awaits an async component), or do the loading in the
> controller or a [`Router.view`](#controller-less-pages) props factory and pass
> the resolved data in as props.

### Which view form should I use?

| You have…                                                     | Use                                     |
| ------------------------------------------------------------- | --------------------------------------- |
| Already-rendered JSX, data loaded synchronously               | `view(<Page … />)`                      |
| An async component, or want the `HttpContext`/params injected | `view(Page, props)`                     |
| A page with no controller at all                              | [`Router.view`](#controller-less-pages) |
| A page resolved from the filesystem                           | [File-based pages](#file-based-pages)   |

## Layouts

Bind a shared layout to page components so every page doesn't need to manually
wrap its content. `defineLayout(Layout)` returns a `wrap(Page)` factory; the
wrapped page merges the layout's props (minus `children`) with its own:

```tsx
// resources/views/layouts/AppLayout.tsx

interface AppLayoutProps {
  title: string;
  children?: unknown;
}

export function AppLayout({ title, children }: AppLayoutProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>{title} — My App</title>
        <link rel="stylesheet" href="/assets/app.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

```tsx fragment
// resources/views/About.tsx
import { defineLayout } from "zerotal/view";
import { AppLayout } from "./layouts/AppLayout.tsx";

const wrap = defineLayout(AppLayout);

// AboutPage receives { title } (from AppLayout) merged with its own props
export const AboutPage = wrap<{ heading: string }>(({ heading }) => (
  <main>
    <h1>{heading}</h1>
    <p>We build things.</p>
  </main>
));
```

```ts fragment
// routes/index.ts
import { Router } from "zerotal";
import { AboutPage } from "../resources/views/About.tsx";

Router.view("/about", AboutPage, { title: "About Us", heading: "Hello" });
```

`Router.view()` calls the component and responds with the HTML string.

## Controller-less pages

For server-rendered pages that don't need a controller, register the component
directly with `Router.view()`. The third argument is the props — a **static
object**, or a **per-request factory** that receives the `HttpContext` and may be
async:

```ts fragment
// routes/index.ts
// Static props — evaluated once at registration (marketing / info pages):
Router.view("/about", AboutPage, { title: "About Us" });

// Dynamic props — resolved per request, can be async:
Router.view("/dashboard", DashboardPage, async (ctx) => ({
  user: ctx.user,
  posts: await Post.query().where("user_id", ctx.user!.id).get(),
}));

// No props:
Router.view("/privacy", PrivacyPage);
```

The returned registration is chainable:

```ts fragment
// routes/index.ts
Router.view("/terms", TermsPage)
  .name("terms") // name the route for url() generation
  .withLayout(AppLayout); // wrap the output in a layout component
```

## File-based pages

Under [file-based routing](/docs/routing), a page file's **default export**
becomes a `GET` route automatically. The page is a function of `(http, params)`
and may be async:

```tsx fragment
// app/views/posts/[slug].tsx  →  GET /posts/:slug
import type { HttpContext } from "zerotal";
import { Post } from "../../models/Post.ts";

export default async function PostPage(http: HttpContext, params: { slug: string }) {
  const post = await Post.query().where("slug", params.slug).firstOrFail();
  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.excerpt}</p>
    </article>
  );
}

// Optional — wrap every page in this directory with a layout:
export { AppLayout as layout } from "../layouts/AppLayout.tsx";
```

In a `.tsx`/`.jsx` file the default-exported function is detected as a page
automatically. If your page lives in a plain `.ts` file, mark it with
`definePage()` so the resolver recognizes it:

```ts
// app/views/greet.ts
import { definePage } from "zerotal/view";

export default definePage((http, params) => `<h1>Hello ${params.name}</h1>`);
```

## Embedding raw HTML

When you have pre-rendered markup (e.g. from a Markdown renderer) use `safe()` or
`<Raw>` to bypass escaping:

```tsx fragment
// in a component
import { safe, Raw } from "zerotal/view";

// Option 1 — safe(): wrap a string as SafeHtml inline
<article>{safe(markdownToHtml(post.body))}</article>

// Option 2 — Raw component: composable, e.g. passed as a child
<article><Raw html={markdownToHtml(post.body)} /></article>

// Option 3 — dangerouslySetInnerHTML on an element (best for a single element)
<article dangerouslySetInnerHTML={{ __html: markdownToHtml(post.body) }} />
```

`dangerouslySetInnerHTML` replaces the element's children entirely.

> **Danger** — All three bypass escaping. Only pass HTML you trust or have
> sanitized; rendering untrusted markup this way is an XSS hole.

## Escaping outside JSX

`esc()` escapes a value for use in raw string templates, where automatic JSX
escaping isn't available:

```ts fragment
// in a helper
import { esc } from "zerotal/view";

const snippet = `<p>Hello, ${esc(user.name)}!</p>`;
```

## Fragments

Use `Fragment` (or the `<>...</>` shorthand) to return multiple root elements:

```tsx
// in a component
import { Fragment } from "zerotal/view";

const Items = ({ items }: { items: string[] }) => (
  <>
    {items.map((item) => (
      <li>{item}</li>
    ))}
  </>
);
```

## Testing

Set your suite up once as described in [Testing](/docs/testing). A view is a
function returning a node that stringifies, so most of it tests without a server.

**Render the component and assert on the string.** No request, no router, no
browser:

```typescript fragment
// tests/views/PostCard.test.ts
import { test, expect } from "bun:test";
import { PostCard } from "../../resources/views/PostCard.tsx";

test("renders the title and author", () => {
  const html = String(PostCard({ post: { title: "Hello", author: "Jane" } }));

  expect(html).toContain("Hello");
  expect(html).toContain("Jane");
});
```

**Escaping is the test that matters.** Every view that renders user input has one
job beyond looking right, and it is the job that becomes a security incident:

```typescript fragment
// tests/views/PostCard.test.ts
test("escapes markup in user-supplied text", () => {
  const html = String(PostCard({ post: { title: "<script>alert(1)</script>" } }));

  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;");
});
```

Write the same test for anything passed through `safe()` or `<Raw>` — those opt
out of escaping deliberately, so the test documents that the value is trusted and
fails if someone later routes user input into it.

**Through a route, assert the rendered text** rather than the markup around it.
`assertSee` survives a class rename; a full-HTML comparison does not:

```typescript fragment
// tests/http/posts.test.ts
const res = await app.get("/posts");

res.assertOk();
res.assertSee("Hello");
res.assertDontSee("Draft"); // unpublished posts stay hidden
```

> **Note** — `assertSee` matches anywhere in the body, so a short string can
> match an attribute or a class name and pass for the wrong reason. Assert on
> something distinctive enough to only appear in the content you mean.

## References

### Helpers

| Export            | Signature                                          | Description                                                          |
| ----------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| `safe(html)`      | `(html: string) => SafeHtml`                       | Wrap a trusted HTML string as `SafeHtml` so it isn't re-escaped.     |
| `Raw({ html })`   | `(props: { html: string }) => SafeHtml`            | Component form of `safe()` — composable as a child.                  |
| `esc(value)`      | `(value: unknown) => string`                       | Escape a value for raw string templates (not needed inside JSX).     |
| `Fragment`        | `(props: { children?: unknown }) => SafeHtml`      | Group multiple roots; `<>…</>` is shorthand.                         |
| `defineLayout(L)` | `(Layout) => (Page) => Component`                  | Bind a layout to pages; returns a `wrap(Page)` factory.              |
| `definePage(fn)`  | `(fn: (http, params) => SafeHtml \| string) => fn` | Mark a `(http, params)` function as a file-route page (`.ts` files). |

### Response and routing helpers

| Member        | Signature                                                             | Description                                                         |
| ------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `view`        | `view(markup, status?): void`                                         | Set a pre-rendered view as the current response.                    |
| `view`        | `view(component, props?, status?): void \| Promise<void>`             | Render a component called with the `HttpContext` and your `props`.  |
| `Router.view` | `Router.view(path, component, props?, middleware?): ViewRegistration` | Register a controller-less GET route that renders a view component. |

### Types

| Export           | Description                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `SafeHtml`       | Opaque wrapper for already-escaped HTML — the return type of every JSX expression.                                        |
| `Html`           | Alias for `SafeHtml` — useful in controller return-type annotations.                                                      |
| `FC<P>`          | Functional component type — `(props: P & { children?: unknown }) => SafeHtml`.                                            |
| `Children`       | Type for the `children` prop.                                                                                             |
| `HttpContext<T>` | The request context a view component or controller action receives; route params and model bindings live on `ctx.params`. |

## Types

`ViewComponent` is what `view()` accepts — a function taking the request context and your props,
returning markup. `ViewLayout` is the wrapper form a layout takes. Both are exported so a helper
that returns a component, or a registry that holds several, can be typed.

## Next steps

- [Flow](/docs/flow) — server-driven interactive components over WebSocket.
- [Inertia](/docs/inertia) — React/Vue SPA pages backed by your controllers.
- [Routing](/docs/routing) — `Router.view()` and file-based page routing.
- [Responses](/docs/responses) — `view()` and the other response helpers.
- [Controllers](/docs/controllers) — move view logic into controller actions.
