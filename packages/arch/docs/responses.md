---
title: Responses
description: Send JSON, HTML views, redirects, and custom responses back to the client from controllers and middleware.
---

# Responses

Controllers and middleware build the outgoing response by calling helper methods
on the per-request `HttpContext`. After your action returns, the pipeline reads
the context's `response` and sends it to the client.

In a route handler you receive the request `HttpContext` directly — name it `ctx`
— and call `ctx.json(...)`, `ctx.view(...)`, `ctx.redirect(...)`, and friends.
Middleware receives the same context and uses the identical methods.

> **Note** — Handlers and middleware receive the same `HttpContext` object. Every
> helper below works on it; `ctx` is just the variable name used throughout.

## Getting Started

Responses are built into `@zerotal/core` — nothing to install. Every handler
receives an `HttpContext` carrying the helpers below:

```typescript
import type { HttpContext } from "zerotal";
```

## JSON

```typescript fragment
// in a controller
ctx.json(data); // 200 OK  — Content-Type: application/json
ctx.json(data, 201); // 201 Created
ctx.json({ errors }, 422); // 422 Unprocessable Content
```

`json(data, status = 200)` serialises with `Response.json`, so anything
JSON-serialisable is accepted: plain objects, arrays, ORM models, `null`.

## HTML views

### Full document

`view()` accepts either pre-rendered markup, or a view component plus its props.
It prepends `<!DOCTYPE html>` and sets `Content-Type: text/html`:

```typescript fragment
// in a controller
import { WelcomePage } from "../../resources/views/WelcomePage.tsx";

ctx.view(WelcomePage(ctx, { title: "Hello" })); // pre-rendered markup
ctx.view(WelcomePage, { title: "Hello" }); // component + props
ctx.view(WelcomePage, { title: "Hello" }, 201); // component, props, status
```

When you pass a component, it receives the request `HttpContext` as its first
argument and your props as its second. Route params and model bindings reach the
component through `ctx.params`.

JSX syntax needs `"jsxImportSource": "zerotal"` in your `tsconfig.json` — set
once for the whole project, and already present in scaffolded apps. See the
[View](/docs/view) guide.

> **Tip** — Passing the component form (`ctx.view(WelcomePage, props)`) lets the
> framework hand the component the `HttpContext` for you, so you can read route
> params and model bindings from `ctx.params` without wiring them up by hand.

### Raw HTML

For htmx, Turbo Streams, or any partial render — no DOCTYPE prepended:

```typescript fragment
// in a controller
ctx.html('<p class="alert">Saved!</p>');
ctx.html(renderPartial(data), 200);
```

### Markdown

Render a Markdown string to a full HTML page using Bun's built-in
`Bun.markdown.html()`. Tables, strikethrough, tasklists, autolinks, and heading
IDs are enabled by default:

```typescript fragment
// in a controller
const content = await Bun.file("./docs/guide.md").text();
ctx.markdown(content);
ctx.markdown(content, { title: "Getting Started", headings: { ids: true } });
```

When no `title` option is given, the first heading in the document is used,
falling back to `"Docs"`.

## Redirects

```typescript fragment
// in a controller
ctx.redirect("/dashboard"); // 302 Found
ctx.redirect("/dashboard", 303); // 303 See Other  ← use after POST/PUT
ctx.redirect("/dashboard", 301); // 301 Permanent
ctx.redirect("/dashboard", 307); // 307 Temporary (preserves method)
ctx.redirect("/dashboard", 308); // 308 Permanent  (preserves method)

ctx.back(); // 302 to Referer (safe — same origin only)
ctx.back(303); // 303 to Referer
```

`back()` reads the `Referer` header and falls back to `/` when it is missing or
points to a different origin.

> **Tip** — POST-Redirect-GET: use `303` after mutating actions so browsers
> always issue a `GET` on the redirect target and form re-submission is
> prevented.

> **Danger** — `back()` only follows a `Referer` on the same origin; a
> cross-origin or forged value falls back to `/`. This prevents open-redirect
> attacks — never bypass it by reading the header yourself.

## File downloads

Return a `Response` directly with the appropriate headers:

```typescript fragment
// in a controller
const file = Bun.file("./exports/report.csv");

ctx.response = new Response(file as unknown as BodyInit, {
  headers: {
    "Content-Type": "text/csv",
    "Content-Disposition": 'attachment; filename="report.csv"',
  },
});
```

## Custom responses

Set `ctx.response` to any `Response` object — the pipeline sends it verbatim:

```typescript fragment
// in a controller
ctx.response = new Response("pong", { status: 200 });

ctx.response = new Response(JSON.stringify({ ok: true }), {
  status: 200,
  headers: { "Content-Type": "application/json", "X-Custom": "value" },
});

// Stream a large body
const stream = new ReadableStream({ ... });
ctx.response = new Response(stream, {
  headers: { "Content-Type": "text/event-stream" },
});
```

## Appending headers to any response

Every helper assigns a fresh `Response` to `ctx.response`. To add a header,
rebuild it from the existing one:

```typescript fragment
// in a controller, after setting ctx.response via any helper
const existing = ctx.response!;
const headers = new Headers(existing.headers);
headers.set("X-Request-Id", ctx.requestId);

ctx.response = new Response(existing.body, {
  status: existing.status,
  headers,
});
```

## Flash + redirect

Flash a message and redirect in one step — the flashed value is available via
`ctx.flashed()` on the next request. Flashing requires an active session
(see [Session](/docs/session)) and silently no-ops without one:

```typescript fragment
// in a controller
ctx.flash("success", "Post created!");
ctx.redirect("/posts", 303);
```

In [Inertia](/docs/inertia) apps use the `inertia()` helper with `back()` or
`redirect()` — no flash needed because Inertia preserves shared props across
redirects.

## Content negotiation

Use `wantsJson()` (true when the client sends `Accept: application/json`) to
respond differently based on what the client accepts:

```typescript fragment
// in a controller
async destroy(ctx: HttpContext): Promise<void> {
  await post.delete();

  if (ctx.wantsJson()) {
    ctx.response = new Response(null, { status: 204 });
  } else {
    ctx.flash("success", "Post deleted.");
    ctx.redirect("/posts", 303);
  }
}
```

## Router-level view shortcut

For routes that only render a view with static or request-computed props, skip
the controller entirely with `Router.view()`. A static props object is evaluated
once at registration; a factory function receives the `HttpContext` per request
and may be async:

```typescript fragment
// routes/web.ts
import { Router } from "zerotal";

Router.view("/about", AboutPage, { title: "About Us" });

Router.view("/dashboard", DashboardPage, async (ctx) => ({
  user: ctx.user,
  stats: await fetchStats(ctx.user!.id),
}));
```

## Which helper should I use?

- **`ctx.json()`** — API endpoints, fetch/XHR clients, Inertia validation
  errors.
- **`ctx.view()`** — full server-rendered HTML pages from a JSX component.
- **`ctx.html()`** — HTML fragments for htmx or Turbo Streams (no DOCTYPE).
- **`ctx.markdown()`** — serve a `.md` file as a styled documentation page.
- **`ctx.redirect()` / `ctx.back()`** — after a mutation, or to send the user
  elsewhere; pair with `flash()` for a one-request status message.
- **`ctx.response = new Response(...)`** — downloads, streams, custom status
  codes (e.g. `204 No Content`), or any header set the helpers don't cover.

## Testing

Set your suite up once as described in [Testing](/docs/testing). Every request
through `TestApp` comes back as a `TestResponse`, whose assertions read as the
sentence you would have written in a comment.

**Assert the status by meaning, not by number**, so a failure says what went
wrong rather than what integer it saw:

```typescript fragment
// tests/http/posts.test.ts
import { test } from "bun:test";
import { createApp } from "../helpers.ts";

test("creating a post", async () => {
  const app = await createApp();

  const res = await app.actingAs(user).post("/posts", { title: "Hello" });

  res.assertCreated(); // clearer than assertStatus(201)
  res.assertJsonPath("data.title", "Hello");
  await app.close();
});
```

`assertOk`, `assertCreated`, `assertNoContent`, `assertNotFound`,
`assertUnauthorized`, `assertForbidden`, and `assertUnprocessable` all exist —
reach for `assertStatus(n)` only when the code has no name.

**Redirects and JSON need different assertions**, and picking the wrong one is
how a broken route passes. `assertRedirect` checks the `Location` header;
`assertJson` parses the body:

```typescript fragment
// tests/http/posts.test.ts
res.assertRedirect("/posts/hello"); // 3xx + Location
res.assertJson({ id: 1, title: "Hello" }); // exact body match
res.assertJsonPath("meta.total", 25); // one path, ignoring the rest
res.assertJsonCount(3, "data"); // array length at a path
```

**Prefer `assertJsonPath` to `assertJson`** for anything with a timestamp or an
id in it. An exact-match assertion on a whole body fails every time an unrelated
field is added, which trains people to update tests without reading them.

**Headers and cookies are part of the response contract** when a client depends
on them:

```typescript fragment
// tests/http/downloads.test.ts
res.assertHeader("Content-Type", "text/csv");
res.assertHeader("Content-Disposition");
res.assertCookie("session");
res.assertCookieMissing("remember_me");
```

> **Note** — `assertSee` and `assertDontSee` check the rendered body as text.
> They are for HTML responses; on a JSON body they will happily match a substring
> inside a field name and give you a passing test that proves nothing.

## References

Response helpers on `HttpContext`:

| Method      | Signature                                                            | Description                                                           |
| ----------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `json`      | `json(data: unknown, status = 200): void`                            | Serialise `data` as a JSON response.                                  |
| `view`      | `view(markup, status?)` / `view(component, props?, status?)`         | Render a full HTML document (prepends `<!DOCTYPE html>`).             |
| `html`      | `html(markup: string \| { toString(): string }, status = 200): void` | Send a raw HTML string with no DOCTYPE.                               |
| `markdown`  | `markdown(content: string, options?, status = 200): void`            | Render Markdown to a full HTML page via `Bun.markdown.html()`.        |
| `redirect`  | `redirect(url: string, status: 301\|302\|303\|307\|308 = 302): void` | Set a `Location` redirect response.                                   |
| `back`      | `back(status: 301\|302\|303\|307\|308 = 302): void`                  | Redirect to the same-origin `Referer`, or `/`.                        |
| `flash`     | `flash(key: string, value: unknown): void`                           | Stash a value for the next request (needs a session).                 |
| `flashed`   | `flashed<T>(key: string): T \| undefined`                            | Read a value flashed in the previous request.                         |
| `wantsJson` | `wantsJson(): boolean`                                               | True when `Accept` includes `application/json`.                       |
| `response`  | `response: Response \| undefined`                                    | The outgoing response; assign a `Response` directly for full control. |

Common status codes:

| Helper                   | Status | Typical use                                      |
| ------------------------ | ------ | ------------------------------------------------ |
| `ctx.json(data)`         | 200    | GET, success                                     |
| `ctx.json(data, 201)`    | 201    | POST, resource created                           |
| `ctx.json(null, 204)`    | —      | DELETE, no content (set `ctx.response` directly) |
| `ctx.json(errors, 422)`  | 422    | Validation failed                                |
| `ctx.json(msg, 401)`     | 401    | Unauthenticated                                  |
| `ctx.json(msg, 403)`     | 403    | Forbidden                                        |
| `ctx.json(msg, 404)`     | 404    | Not found                                        |
| `ctx.redirect(url)`      | 302    | General redirect                                 |
| `ctx.redirect(url, 303)` | 303    | After POST/PUT/DELETE                            |
| `ctx.redirect(url, 301)` | 301    | Permanent redirect                               |

## Next steps

- [Requests Context](/docs/context) — read input from the incoming request.
- [View](/docs/view) — render JSX and Markdown pages.
- [Inertia](/docs/inertia) — return Inertia responses for SPA frontends.
- [Cookies](/docs/cookies) — attach cookies to outgoing responses.
- [HttpContext](/docs/context) — the full per-request object these helpers live on.
