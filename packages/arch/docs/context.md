---
title: Requests Context
description: Every handler and middleware receives the per-request HttpContext directly — route params, typed input helpers, uploads, headers, response building, flash, and after-response hooks on one object.
---

# Requests Context

Every route handler and every middleware receives one argument: the request
`HttpContext`. There is no separate request object — the incoming `Request` is a
property on the context (`ctx.request`), and everything you'd reach for to read it
hangs off the same argument. It holds the raw request, the response being built,
the matched route params and resolved model bindings (on `ctx.params`), and the
helpers for reading input and shaping the reply.

```typescript
// in a controller
import type { HttpContext } from "zerotal";

export class PostController {
  async show(ctx: HttpContext) {
    return ctx.json({ id: ctx.params.id });
  }
}
```

You rarely construct one yourself — the framework creates it per request, stores it
in request-scoped (`AsyncLocalStorage`) storage, and hands it to your code. For
tests, build one with [`HttpContext.fake()`](#testing).

## Destructuring the context

Every method on the context is bound to its instance, so you can destructure
exactly what a handler needs — methods included — without losing `this`:

```typescript fragment
// routes: Router.get('/posts/:post/:tab', PostController, 'show')

async show({ view, params: { post, tab } }: HttpContext<{ post: Post; tab: string }>) {
  return view(ShowPost, { post, tab });
}
```

`view` is a bound method here, `post` is a resolved model binding, and `tab` is a
raw route param — all pulled straight off the one argument. Name the whole argument
instead (`async show(ctx: HttpContext)`) when you prefer `ctx.view(...)` /
`ctx.params.post`; both styles work.

> **Warning** — Computed getters (`took`, `subdomains`) are _not_ bound methods, so
> destructuring them takes a one-time snapshot at destructure time. `took` (elapsed
> ms) in particular will be frozen — read `ctx.took` directly when you want it live.

## Typed params

`HttpContext` is generic over the shape of `params`. With no type argument,
`ctx.params` is `Record<string, string>` — the raw matched segments. Pass a type
argument to describe what the route resolves, including model bindings:

```typescript fragment
// raw params only — every value is a string
async index(ctx: HttpContext) {
  const page = ctx.params.page; // string | undefined
}

// typed params + a resolved model binding
async show(ctx: HttpContext<{ post: Post; tab: string }>) {
  ctx.params.post; // Post  (resolved binding)
  ctx.params.tab; // string (raw param)
}
```

The framework hands every handler the same runtime object; the type argument is a
declaration _you_ make about what this route resolves — exactly as you'd annotate
any function parameter.

## Route-model bindings

A binding turns a raw `:param` string into a loaded model instance before your
handler runs. The framework folds the instance onto `ctx.params` under the param's
name (and exposes it via `ctx.model<T>()`).

Usually there is nothing to declare: a param whose name matches an auto-registered
model binds on its own, so `:post` resolves through `Post` by primary key.

```typescript fragment
// routes/web.ts — :post is already bound to Post
Router.get("/posts/:post", PostController, "show");

// Declare one only to override the default — a different key, or a custom lookup:
Router.get("/posts/:post", PostController, "show").bind("post", (slug) =>
  Post.query().where("slug", slug).firstOrFail(),
);
```

```typescript fragment
// in PostController — ctx.params.post is the resolved Post, not the raw id
async show(ctx: HttpContext<{ post: Post }>) {
  return ctx.json(ctx.params.post);
}

// the same instance, read explicitly
async show(ctx: HttpContext) {
  const post = ctx.model<Post>("post");
  return ctx.json(post);
}
```

Resolution runs before the middleware pipeline, so a missing record produces a 404
rendered by the exception handler rather than a half-run handler. An unbound param
stays a raw string on `ctx.params`. The full binding surface — implicit binding,
custom resolvers, scoped bindings — lives in [Routing](/docs/routing).

## Reading input

The scalar helpers check route params first, then the query string, and coerce to
the type the method name promises. Each takes an optional fallback.

```typescript fragment
// in a controller
ctx.query("page", "1"); // string | undefined — query string only
ctx.string("sort", "asc"); // string | undefined — param then query
ctx.integer("id"); // number | undefined — param then query, parsed as int
ctx.boolean("active", false); // boolean — param then query, coerced
```

### Number parsing

`integer()` reads the param-then-query value and parses it with `parseInt(raw, 10)`.
It returns the `fallback` (or `undefined` when you pass none) in two cases: the key
is absent, or the value is not a valid integer (`NaN`). Because parsing is base-10,
`"08"` reads as `8` and a trailing-garbage value like `"42abc"` parses to `42` —
validate with a [form request](/docs/validator) when you need to reject malformed
input rather than coerce it.

```typescript fragment
// in a controller — GET /posts?page=3
ctx.integer("page"); // 3
ctx.integer("page", 1); // 3 (fallback unused)
ctx.integer("missing", 1); // 1 (absent → fallback)
ctx.integer("missing"); // undefined (absent, no fallback)
ctx.integer("count"); // GET ?count=abc → undefined (NaN → fallback)
```

### Boolean coercion

`boolean()` reads the param-then-query value and returns `true` only when it is one
of `'1'`, `'true'`, `'yes'`, or `'on'` (compared case-insensitively). Any other
present value is `false`; an absent value returns the fallback, which defaults to
`false`.

```typescript fragment
// in a controller
ctx.boolean("active"); // ?active=true / ?active=1 / ?active=ON → true
ctx.boolean("active"); // ?active=0 / ?active=no / ?active= → false
ctx.boolean("active"); // absent → false (default fallback)
ctx.boolean("active", true); // absent → true (custom fallback)
```

> **Note** — These coercion helpers are for raw string params. A param bound to a
> model holds the model instance on `ctx.params`, so read it as `ctx.params.post` or
> `ctx.model<Post>("post")`, never `ctx.integer("post")`.

### The request body

`body()` parses and caches the body (JSON, form-urlencoded, or multipart fields) so
repeated calls are free, and returns `{}` on an absent or invalid body:

```typescript fragment
const data = await ctx.body<{ title: string; body: string }>();
```

`input()` reads a single merged value in priority order — route params → cached
body → query string — without awaiting:

```typescript fragment
ctx.input("id"); // route :id or ?id=
ctx.input("q", "all"); // with fallback
```

> **Warning** — `input()` only sees body data if `await ctx.body()` (or a
> FormRequest) ran earlier in the lifecycle; otherwise it falls through to the query
> string. For guaranteed body access, `await ctx.body()` first.

Read a header with `header()` (case-insensitive) or pull a Bearer token with
`bearerToken()`:

```typescript fragment
ctx.header("x-forwarded-for"); // string | null
ctx.bearerToken(); // string | null — strips the "Bearer " prefix
```

### Uploaded files

`file()` returns the first `UploadedFile` for a form field (or `null`); `files()`
returns all of them. Both parse and cache the multipart body on first call.

```typescript fragment
const avatar = await ctx.file("avatar"); // UploadedFile | null
const attachments = await ctx.files("attachments"); // UploadedFile[]
```

An `UploadedFile` describes the upload and knows how to persist itself. Validate
before storing, then hand it a disk — `store()` returns the stored path:

```typescript fragment
// in a controller — single file
const avatar = await ctx.file("avatar");

if (avatar) {
  avatar.originalName; // original filename as sent by the browser
  avatar.size; // bytes
  avatar.mimeType; // MIME type, e.g. 'image/jpeg'
  avatar.extension(); // 'jpg', 'png', etc.

  const valid = avatar.isValid({
    maxSize: 2 * 1024 * 1024, // 2 MB
    mimes: ["image/jpeg", "image/png"],
  });

  const path = await avatar.store("avatars", Storage.disk("s3"));
}
```

```typescript fragment
// in a controller — multiple files
for (const file of await ctx.files("attachments")) {
  await file.store("uploads", Storage.disk());
}
```

> **Danger** — `originalName` is supplied by the client and may be untrusted.
> `store()` defaults to a `<uuid>.<ext>` filename precisely so attacker-controlled
> names never reach your filesystem — sanitise the original before displaying it.

See [Storage](/docs/storage) for configuring the disks `store()` writes to.

## Building the response

The response helpers set `ctx.response` for you and return nothing — they are
terminal. You can also `return` a value from a controller; see
[Responses](/docs/responses) for the full set.

```typescript fragment
ctx.json({ user }); // 200 application/json
ctx.json({ errors }, 422); // custom status
ctx.view(WelcomeView, { name }); // full HTML document (prepends <!DOCTYPE html>)
ctx.html("<p>fragment</p>"); // HTML fragment, no DOCTYPE
ctx.redirect("/dashboard"); // 302
ctx.redirect("/dashboard", 303); // 303 — use after POST/PUT/DELETE
ctx.back(); // redirect to the Referer (same-origin only)
ctx.back(303); // same, with a 303 status
```

`view()` accepts either pre-rendered markup, or a **view component plus its props**.
A view component receives the request `HttpContext` first and your props second:

```typescript fragment
// resources/views/Welcome.tsx
export default function Welcome(ctx: HttpContext, { title }: { title: string }) {
  return (
    <html>
      <body>
        <h1>{title}</h1>
        <p>{ctx.url.pathname}</p>
      </body>
    </html>
  );
}

// in a controller
ctx.view(Welcome, { title: "Hello" });
```

Route params and model bindings reach the component through `ctx.params`; the second
argument is strictly the props you pass. `markdown()` renders a Markdown string to a
full HTML document via `Bun.markdown.html()`.

> **Danger** — `back()` falls back to `/` whenever the `Referer` is missing or points
> to a different origin, preventing open-redirect attacks through a forged `Referer`
> header. Don't replace it with a raw `redirect(referer)`.

## Middleware

Middleware is a class with a `handle(ctx, next)` method. It receives the same
`HttpContext` and either calls `next()` to pass control down the pipeline or
short-circuits by producing a response:

```typescript
// app/middleware/EnsureActive.ts
import type { HttpContext, NextFn } from "zerotal";

export class EnsureActive {
  async handle(ctx: HttpContext, next: NextFn): Promise<Response | void> {
    if (!ctx.boolean("active")) return ctx.redirect("/inactive");
    return next();
  }
}
```

Handlers and middleware now receive the exact same object, so there's a single
mental model and a single way to read params. See [Middleware](/docs/middleware) for
the pipeline, ordering, and registration.

## The authenticated user

`ctx.user` is **not** a built-in field. When `PersistUserMiddleware` (from
[`@zerotal/auth`](/docs/authentication)) runs, it reads the session's user id, loads
the matching record, and assigns it to `ctx.user`; `AuthMiddleware` reads it to guard
routes. It is `undefined` for guests.

```typescript fragment
if (!ctx.user) throw new UnauthorizedError();
return ctx.json({ email: ctx.user.email });
```

The resolver that loads the user from the session id is configured from your
registered auth model — see [Authentication](/docs/authentication).

## Client IP

```typescript fragment
ctx.ip(); // string | null — socket-level IP from Bun's server.requestIP()
```

Returns `null` when no Bun server reference was injected (e.g. in unit tests created
with `HttpContext.fake()`).

> **Warning** — `ctx.ip()` is the socket IP. Behind a trusted proxy it returns the
> proxy's address, not the end-user's. Read the forwarded header yourself with
> `ctx.header("x-forwarded-for")`, or let [`ThrottleMiddleware`](/docs/middleware)
> resolve proxy-aware IPs via its `trustedProxies` option.

## URL & matching helpers

```typescript fragment
ctx.path(); // "/posts" — pathname only
ctx.fullUrl(); // "https://app.test/posts?page=2"
ctx.host(); // "app.test"
ctx.is("/admin/*"); // glob match against the path (* excludes /, ** includes it)
ctx.subdomain("tenant"); // string | null — from Router.group({ domain })
ctx.subdomains; // { tenant: "acme" }
```

`isJson()` / `wantsJson()` inspect the `Content-Type` / `Accept` headers — handy in
an exception handler, or anywhere one route serves both browsers and API clients:

```typescript fragment
// in a controller or middleware
if (ctx.wantsJson()) {
  ctx.json({ message: "Unauthorized" }, 401);
} else {
  ctx.redirect("/login", 303);
}
```

## Flash data

Flash writes a value to the session for the **next** request only — ideal for
post-redirect success and error messages. It requires `SessionMiddleware` and
silently no-ops without it.

```typescript fragment
// before redirecting
ctx.flash("success", "Post saved!");
return ctx.redirect("/posts", 303);
```

```typescript fragment
// on the next request
const msg = ctx.flashed<string>("success"); // 'Post saved!'
```

The redirect response builders (`redirect().withSuccess(...)`) wrap this pattern more
fluently — see [Responses](/docs/responses).

## After-response callbacks

Register work to run **after** the response has been sent — fire-and-forget side
effects that shouldn't delay the client. `afterResponse()` returns `this`, so calls
chain.

```typescript fragment
ctx.afterResponse(async () => {
  await analytics.track(ctx.requestId, ctx.url.pathname);
});
```

A callback's errors are logged and swallowed, so one failure never affects the
response or the other callbacks.

> **Note** — `afterResponse()` acquires the request-scoped container reference
> synchronously at registration time, so the scope cannot be flushed before your
> callback gets a chance to run.

## Accessing the context anywhere

You don't have to thread `ctx` through every function. From anywhere in the async
call chain, `request()` returns the current request's `HttpContext`:

```typescript
import { request } from "zerotal";

request(); // the HttpContext — throws outside a request
request("page", "1"); // shorthand for request().input("page", "1")
```

The rule is two lines: take `ctx` where it's handed to you (handlers, hooks,
middleware); call `request()` anywhere else. Code that also runs **outside** a
request — a service shared with CLI commands or queue workers — uses
`HttpContext.tryGet()`, which returns `undefined` instead of throwing.

## Asking once per request

`RequestContext.remember(key, factory)` runs `factory` at most once per request
for a given key and hands every later caller the same answer:

```typescript fragment
import { RequestContext } from "zerotal";

const settings = await RequestContext.remember(`household:${id}:settings`, () =>
  Settings.query().where("household_id", id).first(),
);
```

This is the other half of the [N+1 detector](/docs/database#n1-detection): the
detector tells you a query ran too many times, and when the answer is the same
every time, "ask once" is the fix rather than eager loading.

Two behaviours are deliberate, and both are the ones a hand-rolled version
usually gets wrong:

- **The promise is cached, not the resolved value.** Cache after the `await` and
  a `Promise.all` of ten readers all miss — none has resolved when the others
  look. Caching the promise makes the first caller's in-flight work the answer
  for the other nine.
- **A rejected promise is evicted.** Otherwise one transient failure poisons
  every later read in the same request, including the retry.

Outside a request it is a pass-through. A queue worker has no request to scope
to, and quietly sharing a value across jobs would be worse than not caching.

`RequestContext.forget(key)` drops a value when a write invalidates a read taken
earlier in the same request.

## Testing

`HttpContext.fake()` builds a context without a live server — perfect for unit
testing controllers and middleware:

```typescript fragment
const ctx = HttpContext.fake("http://localhost/posts?page=2", {
  method: "GET",
  headers: { Authorization: "Bearer token" },
});

await new PostController().index(ctx);
expect(ctx.response?.status).toBe(200);
```

Pass a `body` to exercise handlers that read one, and assign `ctx.params` directly
when the handler expects route params a real match would have provided:

```typescript fragment
// in a test — a POST with a JSON body
const ctx = HttpContext.fake("http://localhost/posts", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "Hello", body: "World" }),
});
ctx.params = { id: "42" };
```

The signature is `HttpContext.fake(url?, init?, container?)`; all three are optional.
See [Testing](/docs/testing) for the full harness, and
[HTTP testing](/docs/testing/http) for the higher-level request helpers.

## References

### `HttpContext<TParams>`

```typescript fragment
class HttpContext<TParams extends Record<string, unknown> = Record<string, string>> {
  constructor(request: Request, container: ScopedResolver);
}
```

The per-request object every handler and middleware receives. `TParams` types
`ctx.params` — defaulting to `Record<string, string>` (raw params), or the bag of
raw params and resolved model bindings you declare for a route.

#### Properties

| Property    | Type                    | Description                                                  |
| ----------- | ----------------------- | ------------------------------------------------------------ |
| `request`   | `Request`               | The raw Bun/Web API `Request` object.                        |
| `response`  | `Response \| undefined` | Set by handlers; read by the framework to send the reply.    |
| `url`       | `URL`                   | Parsed URL (`pathname`, `searchParams`, `origin`, …).        |
| `params`    | `TParams`               | Route params, plus resolved model bindings under their name. |
| `requestId` | `string`                | UUID generated per request (`crypto.randomUUID()`).          |
| `startedAt` | `number`                | `performance.now()` timestamp captured at construction.      |
| `locale`    | `string`                | Current locale (default `'en'`); set by `I18nMiddleware`.    |
| `took`      | `number` (getter)       | Whole milliseconds elapsed since `startedAt`.                |
| `container` | `ScopedResolver`        | The request-scoped container for this request.               |

#### Input methods

| Method        | Signature                                | Description                                      |
| ------------- | ---------------------------------------- | ------------------------------------------------ |
| `query`       | `(key, fallback?): string \| undefined`  | Read a query-string param.                       |
| `string`      | `(key, fallback?): string \| undefined`  | Read a param then query as a string.             |
| `integer`     | `(key, fallback?): number \| undefined`  | Read a param then query, parsed base-10.         |
| `boolean`     | `(key, fallback = false): boolean`       | Coerce a param/query to a boolean.               |
| `input`       | `<T>(key, fallback?): T`                 | Merged read: params → cached body → query.       |
| `body`        | `<T>(): Promise<T>`                      | Parse and cache the request body.                |
| `header`      | `(key, fallback = null): string \| null` | Read a request header (case-insensitive).        |
| `bearerToken` | `(): string \| null`                     | Extract the `Authorization: Bearer` token.       |
| `file`        | `(field): Promise<UploadedFile \| null>` | First uploaded file for a form field.            |
| `files`       | `(field): Promise<UploadedFile[]>`       | All uploaded files for a form field.             |
| `model`       | `<T>(name): T`                           | Resolved route-model binding; throws if unbound. |

#### Response methods

| Method     | Signature                                    | Description                                         |
| ---------- | -------------------------------------------- | --------------------------------------------------- |
| `json`     | `(data, status = 200): void`                 | Set a JSON response.                                |
| `view`     | `(componentOrMarkup, props?, status?): void` | Render a full HTML document (`<!DOCTYPE html>`).    |
| `markdown` | `(content, options?, status = 200): void`    | Render Markdown to a full HTML page.                |
| `html`     | `(markup, status = 200): void`               | Set a raw HTML fragment (no DOCTYPE).               |
| `redirect` | `(url, status = 302): void`                  | Set a redirect (`301 \| 302 \| 303 \| 307 \| 308`). |
| `back`     | `(status = 302): void`                       | Redirect to the same-origin `Referer`, else `/`.    |

#### Request, session & lifecycle methods

| Method          | Signature                  | Description                                            |
| --------------- | -------------------------- | ------------------------------------------------------ |
| `path`          | `(): string`               | Request pathname (no query).                           |
| `fullUrl`       | `(): string`               | Full URL including query string.                       |
| `host`          | `(): string`               | Host portion of the URL.                               |
| `is`            | `(pattern): boolean`       | Glob-match the path (`*` excludes `/`, `**` includes). |
| `subdomain`     | `(name): string \| null`   | A single subdomain param from a `domain` group.        |
| `isJson`        | `(): boolean`              | True when the body is `application/json`.              |
| `wantsJson`     | `(): boolean`              | True when `Accept` includes `application/json`.        |
| `ip`            | `(): string \| null`       | Socket-level client IP, or `null`.                     |
| `flash`         | `(key, value): void`       | Write a value to the session for the next request.     |
| `flashed`       | `<T>(key): T \| undefined` | Read a value flashed in the previous request.          |
| `afterResponse` | `(callback): this`         | Run a callback after the response is sent.             |

#### Static methods

| Method   | Signature                                | Description                                           |
| -------- | ---------------------------------------- | ----------------------------------------------------- |
| `tryGet` | `(): HttpContext \| undefined`           | The active context, or `undefined` outside a request. |
| `fake`   | `(url?, init?, container?): HttpContext` | Build a context for unit tests.                       |

> **Note** — `requestId` is echoed back to the client in the `X-Request-Id` response
> header by [`LoggerMiddleware`](/docs/logger), not by the framework core. The id
> itself always exists on the context.

### `UploadedFile`

Returned by `file()` and `files()`.

| Member           | Signature                                                                                  | Description                           |
| ---------------- | ------------------------------------------------------------------------------------------ | ------------------------------------- |
| `originalName`   | `originalName: string`                                                                     | Client-supplied filename (untrusted). |
| `mimeType`       | `mimeType: string`                                                                         | Browser-reported MIME type.           |
| `size`           | `size: number`                                                                             | File size in bytes.                   |
| `extension`      | `extension(): string`                                                                      | Lowercase extension without the dot.  |
| `isValid`        | `isValid(options?: FileValidationOptions): boolean`                                        | Check `maxSize` / `mimes` rules.      |
| `store`          | `store(directory: string, disk: StorageDisk, filename?: string): Promise<string>`          | Write to a disk, returns the path.    |
| `storeAndGetUrl` | `storeAndGetUrl(directory: string, disk: StorageDisk, filename?: string): Promise<string>` | Store and return the public URL.      |

## Next steps

- [Controllers](/docs/controllers) — where the context is most often used.
- [Validator](/docs/validator) — validate the input you read here, with `FormRequest`.
- [Responses](/docs/responses) — the full response-building API.
- [Middleware](/docs/middleware) — how the context flows through the pipeline.
- [Routing](/docs/routing) — route params and route-model binding.
- [Storage](/docs/storage) — the disks `UploadedFile.store()` writes to.
