---
title: Inertia Server-Side Rendering
description: Render the first paint on the server, and what changes when you do.
---

# Server-side rendering

By default Inertia renders the first page on the client. Server-side rendering (SSR)
renders the initial HTML on the server instead — better Time-to-First-Byte and
crawlable content — while subsequent navigations keep using the fast JSON path.

Turn `ssr` on and every first page load is server-rendered. That is the whole of it:

```ts
// config/inertia.ts
import { InertiaConfig } from "@zerotal/inertia";
import { env } from "zerotal";

export default InertiaConfig({
  htmlTemplate: "./resources/app.html",
  version: env("ASSET_VERSION", "1"),
  ssr: true,
});
```

No controller changes. `Inertia.render()` renders the component into the root, injects
the page's `<Head>` tags into the document head, and marks the root
`data-server-rendered` so the client **hydrates** that markup instead of throwing it
away and painting again. The scaffolded `app.tsx` already does the hydrating half:

```tsx fragment
setup({ el, App, props }) {
  const app = <App {...props} />;
  if (el.hasAttribute("data-server-rendered")) {
    hydrateRoot(el, app);
  } else {
    createRoot(el).render(app);
  }
}
```

Subsequent navigations are unaffected — an `X-Inertia` XHR gets the page object as JSON
either way, because server rendering is about the _first_ arrival.

> **Before 1.13.4, `ssr: true` did not do this.** It registered `POST /__ssr` and nothing
> in the request path consulted it, so an app that set the flag and read this page got
> exactly the empty root it had before, and server rendering was reachable only by
> rewriting each route to `inertiaStream()`. If you worked around that with a per-route
> switch, you can delete it.

Pages render with the framework they are authored in: React `.tsx` via
`react-dom/server`, Vue `.vue` via `@inertiajs/vue3` + `vue/server-renderer`. Install the
server renderer for the framework your app uses.

**A page that fails to server-render still works.** The failure is logged and the
client-rendered document is served instead, because taking a route down because an
_optimisation_ failed would make `ssr: true` a liability rather than an improvement.

## What `POST /__ssr` is for, and why you probably do not want it

Set `ssrEndpoint: true` and the app exposes `POST /__ssr`, which accepts
`{ component, props, url }` and returns `{ body, head }`.

That is the contract upstream Inertia uses, and it exists there for a reason that does not
apply here: **PHP and Ruby have no JavaScript runtime**, so the web framework cannot import
a `.tsx` and must hand rendering to a separate Node process. The HTTP hop is forced by the
host language.

Bun _is_ a JavaScript runtime. `ssr: true` imports the component and renders it inline, in
the same process, with no serialisation and no network. So the endpoint solves a problem
this framework does not have.

What it is still good for is the one case that remains real: **deliberately moving render
CPU off the web process**, onto another process or another host, on an app where rendering
competes with request handling. Then the hop is the point rather than the cost.

It is throttled, answers a 404 to anything that is not loopback, and takes `ssrSecret` for
a renderer on another host.

> **`ssr: true` does not register it, since 1.14.0.** It used to, which meant turning
> rendering on opened a route the app never asked for. See
> [the upgrade note](/docs/upgrade#1-13-to-1-14).

## Streaming SSR — a different question

`inertiaStream()` is **not** how you turn SSR on — that is the config flag. Streaming is
about **time to first byte**: the document goes out in pieces as the component renders,
rather than being buffered and sent whole.

That is a trade, which is why it stays a per-route choice rather than an app-wide one. A
streamed response starts arriving sooner and finishes no earlier, and on a page that is
mostly shell the buffering costs nothing worth reclaiming. Reach for it on a heavy
landing page; leave everything else on `Inertia.render()`.

Both render the component and both mark the root for hydration. The only difference is
whether the bytes are streamed.

### How it streams

It uses React 18's
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

| Criterion      | `inertia()`                             | `inertiaStream()`                  |
| -------------- | --------------------------------------- | ---------------------------------- |
| Return type    | `Promise<void>`                         | `Promise<void>`                    |
| Rendering      | Server-rendered when `ssr: true`        | Always server-rendered             |
| Response body  | Fully buffered string                   | Streaming `ReadableStream`         |
| TTFB           | After the render                        | As the component renders           |
| Page `<Head>`  | In the served `<head>` when `ssr: true` | Collected into the served `<head>` |
| XHR navigation | JSON (the normal path)                  | JSON — the same page object        |

With `ssr: false` — the default — `inertia()` serves an empty root and the page object,
and the browser does all the rendering.

**Both implement the whole protocol.** An `X-Inertia: true` request gets the page
object as JSON from either one; the streaming half applies to the first arrival,
which is the only load that renders a document.

That means a route can be moved to `inertiaStream()` for its cold load without
anything else changing. Until 1.13.2 it could not: `inertiaStream()` answered every
request with `text/html`, including the XHR, so pointing a route at it broke
client-side navigation _to_ that route. The first load looked perfect — which is what
a person checks — and the second click did nothing, for somebody already in the app.
Apps that hit this wrote a header check in front of the call; that workaround still
works and is no longer needed.

> **Tip** — Stream the heaviest landing pages and leave everything else on `inertia()`.
> Streaming costs TTFB on a page that is mostly shell, so it is a choice per route
> rather than a global default.

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

**With `ssr: false` — the default — `inertia()` does not server-render the component at
all.** Its response body is the template with an empty root and the page object beside
it:

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

1. **Turn on `ssr: true`.** One line, every page: the component is rendered, `<Head>` is
   collected, and the served `<head>` is the page's own. This is the change to reach for
   unless you have a reason not to.
2. **Switch a single page to `inertiaStream()`**, if you want that and streaming on one
   route without turning rendering on everywhere.
3. **Set the tags in middleware**, if the metadata is server-side data the component
   does not otherwise need.

`curl` is also how most people first check whether a deploy worked. An empty
`<div id="app">` in that output is not a broken deploy.

It throws if the template hasn't loaded, or if the component name contains path
traversal (`..` or a leading `/`).

## Next steps

- [Inertia overview](/docs/inertia) — the guide's front page and the rest of the sections.
- [Reference](/docs/inertia/references) — the full API surface in one table.
