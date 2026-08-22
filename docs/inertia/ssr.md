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
- The HTML template must contain `<!-- @inertia -->`
- The page component must exist under your pages directory (`resources/js/pages/<component>.tsx`)

It throws if the template hasn't loaded, or if the component name contains path
traversal (`..` or a leading `/`).

### inertia vs. inertiaStream

|                | `inertia()`            | `inertiaStream()`                  |
| -------------- | ---------------------- | ---------------------------------- |
| Return type    | `Promise<void>`        | `Promise<void>`                    |
| Rendering      | Buffered HTML string   | Streaming `renderToReadableStream` |
| Response body  | Fully buffered string  | Streaming `ReadableStream`         |
| TTFB           | After full render      | After the prefix is flushed        |
| XHR navigation | JSON (the normal path) | N/A — only the first-page document |

For XHR navigations (`X-Inertia: true`), keep using `inertia()` — streaming only
benefits the initial HTML document load.

> **Tip** — Stream the heaviest landing pages and leave everything else on `inertia()`.

## Next steps

- [Inertia overview](/docs/inertia) — the guide's front page and the rest of the sections.
- [Reference](/docs/inertia/references) — the full API surface in one table.
