---
title: Inertia Server-Side Rendering
description: Render the first paint on the server, and what changes when you do.
---

# Server-side rendering

By default Inertia renders the first page on the client. Server-side rendering (SSR)
renders the initial HTML on the server instead — better Time-to-First-Byte and
crawlable content — while subsequent navigations keep using the fast JSON path.

Zerotal offers two approaches: the **`/__ssr` endpoint** (standard Inertia SSR) and
**streaming SSR** via `inertiaStream()`.

## Which should I use?

- **Endpoint SSR** (`ssr: true`) — the standard Inertia SSR contract. Turn it on
  globally and the Inertia client renders the first page through `POST /__ssr`. Use
  this when you want crawlable, server-rendered HTML across the whole app with no
  per-controller change.
- **Streaming SSR** (`inertiaStream()`) — swap `inertia()` for `inertiaStream()` in
  the controllers whose initial document you want streamed for the fastest TTFB. Use
  it selectively on heavy landing pages; everything else stays on `inertia()`.

## Endpoint SSR

Enable the SSR endpoint in config:

```ts
// config/inertia.ts
import { InertiaConfig } from "@zerotal/inertia";
import { env } from "zerotal";

export default InertiaConfig({
  htmlTemplate: "./resources/app.html",
  version: env("ASSET_VERSION", "1"),
  ssr: true, // registers POST /__ssr — requires a server renderer
});
```

When `ssr: true`, `InertiaProvider` registers `POST /__ssr`, which accepts
`{ component, props, url }` and returns `{ body, head }` — the same contract as the
Inertia Node SSR server. On a first-page load the server renders the component into
the template instead of shipping an empty root `<div>`; subsequent navigations use
the normal JSON path. Pages render with the framework they're authored in: React
`.tsx` via `react-dom/server`, or Vue `.vue` via `@inertiajs/vue3` +
`vue/server-renderer` — install the server renderer for the framework(s) your app uses.

## Streaming SSR

`inertiaStream()` is a drop-in async alternative to `inertia()` that uses React 18's
`renderToReadableStream` to improve TTFB. Instead of buffering the whole render, it
streams the React output between the template's HTML prefix and suffix:

```
│ HTML prefix (everything before <!-- @inertia -->) │ → browser starts parsing <head>
│ React component stream                             │ → above-the-fold content arrives early
│ <div> close + page JSON + HTML suffix              │
```

Swap `inertia()` → `inertiaStream()` and `await` it — nothing else changes:

```ts fragment
// app/controllers/PostController.ts
import { inertiaStream } from "@zerotal/inertia";

export class PostController {
  async show(ctx: HttpContext): Promise<void> {
    const post = await Post.findOrFail(ctx.params["id"]);
    return inertiaStream("Posts/Show", { post });
  }
}
```

### Requirements

- `react-dom/server` ≥ 18 (for `renderToReadableStream`)
- `@inertiajs/react` — the same adapter the browser entry point uses; the server
  renders through its `<App>` so `<Head>` works (see below)
- The HTML template must contain `<!-- @inertia -->`
- The page component must exist under your pages directory (`resources/js/pages/<component>.tsx`)

### inertia vs. inertiaStream

| Criterion      | `inertia()`              | `inertiaStream()`                  |
| -------------- | ------------------------ | ---------------------------------- |
| Return type    | `Promise<void>`          | `Promise<void>`                    |
| Rendering      | None — empty root + JSON | Streaming `renderToReadableStream` |
| Response body  | Fully buffered string    | Streaming `ReadableStream`         |
| TTFB           | Immediate                | After the shell is ready           |
| Page `<Head>`  | Client only              | Collected into the served `<head>` |
| XHR navigation | JSON (the normal path)   | N/A — only the first-page document |

For XHR navigations (`X-Inertia: true`), keep using `inertia()` — streaming only
benefits the initial HTML document load.

> **Tip** — Stream the heaviest landing pages and leave everything else on `inertia()`.

## Page metadata: `<Head>` on the server

Both server-rendered paths — `inertiaStream()` and the `/__ssr` endpoint — collect
whatever your page's `<Head>` declares and splice it into the template's `<head>`
before the response goes out. A page writes its metadata once, in the component, and
gets it in the HTML as well as in the browser:

```tsx fragment
// resources/js/pages/Trips/Show.tsx
import { Head } from "@inertiajs/react";

export default function Show({ trip }) {
  return (
    <>
      <Head>
        <title>{trip.name}</title>
        <meta name="description" content={trip.summary} />
        <meta property="og:title" content={trip.name} />
        <meta property="og:image" content={trip.heroUrl} />
      </Head>
      …
    </>
  );
}
```

An injected tag **replaces** the template's tag of the same identity rather than
being added after it — `<title>` by being a title, `<meta>` by its `name` or
`property`. That is not a detail: a document with two `<title>` tags is a document
with the _first_ one, so an appended title would be present, correct and ignored.
Anything the template does not already declare is appended before `</head>`.

Two things it does not do:

- **The title callback is client-side.** `createInertiaApp({ title })` in your
  browser entry point is not visible to the server, so a page rendering
  `<Head><title>Kruger</title></Head>` serves `Kruger` and the browser then shows
  `Kruger — App`. Put the suffix in the `<Head>` itself if the served title matters
  to you, which for a link preview it usually does.
- **`inertia()` does not render, so it does not collect.** A page returned through
  plain `inertia()` sends the template's `<head>` as written. See
  [What a crawler sees](#what-a-crawler-sees).

## What a crawler sees

`inertia()` — the default — **does not server-render the component at all.** Its
response body is the template with an empty root and the page object beside it:

```html
<body>
  <div id="app"></div>
  <script type="application/json" data-page="app">
    { … }
  </script>
</body>
```

That is the normal Inertia arrangement and it is the right default: the page is
built by the client, and every navigation after the first is JSON. But it means the
served document contains **a title and a JSON blob**, and it is worth knowing which
readers of your site run JavaScript and which do not:

| Reader                                               | Runs JavaScript       | Sees your page    |
| ---------------------------------------------------- | --------------------- | ----------------- |
| A browser                                            | yes                   | yes               |
| Googlebot, Bingbot                                   | yes, on a second pass | yes, later        |
| WhatsApp, Slack, iMessage, X, Facebook link previews | **no**                | title + meta only |
| `curl`, uptime checks, most RSS and reader tools     | **no**                | title + meta only |

So the link preview a page produces is decided entirely by its `<head>` — which is
the template's, identically, on every page, unless you do one of these:

1. **Switch the page to `inertiaStream()`.** The component is rendered, `<Head>` is
   collected, and the served `<head>` is the page's own. This is the smallest change
   and the one to reach for on pages that get shared.
2. **Turn on endpoint SSR** (`ssr: true`) for the whole app.
3. **Set the tags in middleware**, if the metadata is server-side data the component
   does not otherwise need.

`curl` is also how most people first check whether a deploy worked. An empty
`<div id="app">` in that output is not a broken deploy.

It throws if the template hasn't loaded, or if the component name contains path
traversal (`..` or a leading `/`).

## Next steps

- [Inertia overview](/docs/inertia) — the guide's front page and the rest of the sections.
- [Reference](/docs/inertia/references) — the full API surface in one table.
