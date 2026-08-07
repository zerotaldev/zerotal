---
title: Session
description: Give every HTTP request a signed, per-user data store you can read, write, and flash from anywhere in the pipeline.
---

# Session

`@zerotal/session` attaches a signed, per-user data store to every HTTP request.
Read, write, flash, and regenerate session data from anywhere in the request
pipeline without managing cookies by hand.

## Getting Started

```bash
# in your project root
bun add @zerotal/session
```

## Register the provider

Add `SessionProvider` to the providers array in `bootstrap/providers.ts`:

```typescript
// bootstrap/providers.ts
import { SessionProvider } from "@zerotal/session";

export default [
  // …your other providers
  SessionProvider,
];
```

Registering the provider switches on the following (it only runs in the `web` and
`test` environments):

- `onRegister` — binds `session.driver` (the cookie or redis driver) and the
  `session` accessor as lazy singletons in the container.
- `onBooting` — auto-registers `SessionMiddleware` via `app.useOnce()`, so the
  session is loaded on every request, and warns if `session.secure` is off in
  production.
- `onBooted` — pre-resolves both singletons so the `Session` facade can read them
  synchronously.

> **Note** — `SessionProvider` registers only `SessionMiddleware`. CSRF protection
> is a separate middleware you opt into — see [CSRF protection](#csrf-protection).

## Configuration

Create `config/session.ts`. Use the `SessionConfig()` helper so every field stays
type-checked while supplying the defaults:

```typescript
// config/session.ts
import { SessionConfig } from "@zerotal/session";
import { env } from "zerotal";

export default SessionConfig({
  driver: "cookie", // 'cookie' | 'redis'
  lifetime: 86400, // seconds — 24 hours
  cookie: "zerotal_session",
  httpOnly: true,
  sameSite: "Lax",
  secure: env("APP_ENV") === "production",
  secret: env("APP_KEY", ""), // signs the session cookie
});
```

| Field      | Required | Default     | Description                                                  |
| ---------- | -------- | ----------- | ------------------------------------------------------------ |
| `driver`   | no       | `"cookie"`  | Storage backend: `"cookie"` or `"redis"`.                    |
| `lifetime` | no       | `86400`     | Session lifetime in seconds (24 hours).                      |
| `cookie`   | no       | `"session"` | Name of the session cookie.                                  |
| `httpOnly` | no       | `true`      | Marks the session cookie HTTP-only (hidden from JS).         |
| `sameSite` | no       | `"Lax"`     | SameSite policy: `"Strict"`, `"Lax"`, or `"None"`.           |
| `secure`   | no       | `false`     | Require HTTPS for the cookie. Turn on in production.         |
| `secret`   | no       | `""`        | HMAC secret used to sign the cookie. Set this in production. |

Add a signing secret to `.env`:

```env
# .env
APP_KEY=your-random-32-char-secret-here
```

> **Danger** — Without a strong `secret`, session cookies can be forged. The cookie
> driver throws `SessionSecretMissingError` if constructed with an empty secret;
> always set `APP_KEY` (or `session.secret`) before deploying.

## Basic usage

`SessionMiddleware` attaches a `SessionManager` to every request. There are two
ways to reach it:

- **`ctx.session`** inside a route handler — the `SessionManager` lives on the
  request `HttpContext` (middleware receives the same context, so it's
  `ctx.session` there too).
- **The `Session` facade** anywhere — controllers, services, jobs — without
  threading the context through.

```typescript
// in a controller or service
import { Session } from "@zerotal/session";

Session.set("locale", "fr");
const locale = Session.get<string>("locale");
Session.flash("success", "Saved!");
```

The facade resolves the current request's session via `RequestContext`, so it
works in any code running during a request. It requires `SessionMiddleware` to be
registered. Both `ctx.session` and `Session` expose the same methods (see the
[reference](#session-api) below).

## Reading and writing

```typescript
// in a controller
import type { HttpContext } from "zerotal";

async action(ctx: HttpContext) {
  // Write
  ctx.session.set("locale", "fr");
  ctx.session.set("cart", [1, 2, 3]);

  // Read (returns unknown — cast to your type)
  const locale = ctx.session.get("locale") as string;
  const cart   = ctx.session.get("cart") as number[];

  // Check existence
  const hasLocale = ctx.session.has("locale"); // boolean

  // Read and remove in one call
  const once = ctx.session.pull("cart");

  // Delete one key
  ctx.session.forget("locale");

  // Wipe all session data
  ctx.session.flush();

  // Return the current session ID
  const id = ctx.session.id();
}
```

## Flash data

Flash stores a value for **one subsequent request only** — it is automatically
swept after the next request. The canonical use case is POST-Redirect-GET status
messages.

```typescript
// in a controller — survives exactly one redirect
ctx.session.flash("success", "Post created!");
ctx.session.flash("errors", { title: ["Required"] });

// Or via the ctx shorthand (same thing):
ctx.flash("success", "Post created!");
ctx.flash("errors", { title: ["Required"] });

// Or via the Session facade (anywhere — no context needed):
Session.flash("success", "Post created!");
```

Read on the next request:

```typescript
// in a controller
const msg = ctx.flashed<string>("success");
const errors = ctx.flashed<Record<string, string[]>>("errors");
```

Full POST-Redirect-GET pattern:

```typescript
// in a controller
async store(ctx: HttpContext) {
  await Post.create(await ctx.body());
  ctx.flash("success", "Post published!");
  ctx.redirect("/posts", 303); // 303 ensures the browser GETs the redirect
}

async index(ctx: HttpContext) {
  const success = ctx.flashed<string>("success"); // available here, gone after
  ctx.view(PostsPage, { success });
}
```

## Session fixation protection

Always regenerate the session ID after a privilege change (login, logout, password
change) to prevent session-fixation attacks:

```typescript
// in a controller
ctx.session.regenerate(); // issues a new session ID; data is preserved
// or: Session.regenerate();
```

> **Danger** — Skipping `regenerate()` on login lets an attacker who planted a
> known session ID before authentication ride the now-privileged session.

## Session drivers

| Driver   | Notes                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cookie` | Default. Session data is signed and stored in a browser cookie. No server storage needed. Max ~4 KB per session.                                      |
| `redis`  | Session data stored in Redis by ID. Use when sessions are large, shared across cluster nodes, or need server-side invalidation. Requires a Redis URL. |

### Which driver should I use?

- **`cookie`** — the default. Reach for it unless you outgrow it: it needs no
  infrastructure and keeps state with the client.
- **`redis`** — switch when sessions exceed the ~4 KB cookie budget, must be shared
  across multiple nodes, or need to be invalidated server-side (e.g. force-logout).

Switch drivers via the environment without changing application code:

```env
# .env.production
SESSION_DRIVER=redis
SESSION_REDIS=redis://localhost:6379
```

```typescript
// config/session.ts
import { SessionConfig } from "@zerotal/session";
import { env } from "zerotal";

export default SessionConfig({
  driver: env("SESSION_DRIVER", "cookie"),
  // …
});
```

> **Note** — The redis driver reads its connection URL from the `session.redis`
> config key (defaulting to `redis://localhost:6379`). Wire it from an env var as
> shown above.

## CSRF protection

`CsrfMiddleware` defends state-changing requests against cross-site request forgery.
Unlike `SessionMiddleware`, it is **not** auto-registered — add it after the session
middleware, typically in the `web` middleware group:

```typescript
// bootstrap/app.ts (or wherever you register middleware)
import { SessionMiddleware, CsrfMiddleware } from "@zerotal/session";

app.use([SessionMiddleware, CsrfMiddleware]);
// In production over HTTPS, mark the XSRF cookie Secure:
// app.use([SessionMiddleware, CsrfMiddleware.with({ secure: true })]);
```

On its first request the middleware stores a random token in the session. On any
unsafe method (anything other than `GET`, `HEAD`, `OPTIONS`) it compares — in
constant time — the session token against the `x-csrf-token` or `x-xsrf-token`
request header, returning **`419`** on a mismatch.

After every request it also sets a non-HttpOnly `XSRF-TOKEN` cookie, so Axios
(and therefore Inertia) reads it and replays it as the `X-XSRF-TOKEN` header
automatically — no manual wiring for those clients.

To expose the token elsewhere (HTML meta tag, Inertia shared props), read it with
`CsrfMiddleware.token()`:

```typescript
// in a controller or Inertia shared-props factory
import { CsrfMiddleware } from "@zerotal/session";

const token = CsrfMiddleware.token(); // reads the active request's session
```

For a plain HTML form posting via `fetch`, surface the token in a meta tag and send
it as a header:

```html
<!-- in your layout -->
<meta name="csrf-token" content="${CsrfMiddleware.token()}" />
```

```typescript
// in your client JS
const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content");

fetch("/posts", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-CSRF-Token": token ?? "",
  },
  body: JSON.stringify({ title: "Hello" }),
});
```

> **Warning** — The token is validated from a request **header**, not a `_token`
> form field. A classic `<form method="POST">` with no JavaScript will not pass
> the header, so submit through `fetch`/Axios (Inertia does this for you).

## Accessing the session outside a handler

Use the **`Session` facade** — it reaches the current request's session through
`RequestContext`, so service-layer code never has to thread `ctx` through:

```typescript
// in a service
import { Session } from "@zerotal/session";

function rememberLocale(locale: string) {
  Session.set("locale", locale);
}

function currentLocale(): string | undefined {
  return Session.get<string>("locale");
}
```

This is the recommended approach for anything that isn't a route handler. If you
need the raw `HttpContext` for other reasons, `RequestContext.tryGet()` (or
`RequestContext.get()` to throw when absent) still gives it to you, but for the
session itself prefer the facade.

## Authenticated sessions

`AuthSessionMiddleware` extends `SessionMiddleware`: after loading the session it
reads `session.get("user_id")`, looks the user up with a callback you supply, and
attaches the result to `ctx.user` for the rest of the request.

```typescript
// bootstrap/app.ts
import { AuthSessionMiddleware, CookieDriver } from "@zerotal/session";
import { env } from "zerotal";
import { User } from "../app/models/User.ts";

app.use(
  class extends AuthSessionMiddleware {
    constructor() {
      super(new CookieDriver(env("APP_KEY", "")), (id) => User.find(id));
    }
  },
);
```

## Testing

Pre-seed session data with `withSession()`, then assert on the response with
`assertSessionHas()`:

```typescript
// in a test
import { createTestApp } from "@zerotal/testing";

const res = await testApp.withSession({ locale: "fr", cart: [1, 2, 3] }).get("/checkout");

res.assertOk();
```

```typescript
// in a test
const res = await testApp.post("/locale", { locale: "fr" });

res.assertSessionHas("locale");
res.assertSessionHas("locale", "fr");
```

```typescript
// in a test — assert a flash key was written before a redirect
const res = await testApp.actingAs(user).post("/posts", { title: "Hello" });

res.assertRedirect("/posts");
res.assertSessionHas("success"); // flash key was written
```

## References

### Session API

In a handler the session is `ctx.session`; the `Session` facade exposes the same
methods anywhere. The facade is generic (`Session.get<T>(key)`), while
`ctx.session.get` returns `unknown`.

| Method                                                 | Signature                               | Description                              |
| ------------------------------------------------------ | --------------------------------------- | ---------------------------------------- |
| `ctx.session.get(key)` / `Session.get<T>(key)`         | `(key: string) => unknown`              | Read a value (`undefined` if absent).    |
| `ctx.session.set(key, value)` / `Session.set(...)`     | `(key: string, value: unknown) => void` | Write a value.                           |
| `ctx.session.has(key)` / `Session.has(key)`            | `(key: string) => boolean`              | Check whether a key exists.              |
| `ctx.session.pull(key)` / `Session.pull<T>(key)`       | `(key: string) => unknown`              | Read a value and remove it in one call.  |
| `ctx.session.forget(key)` / `Session.forget(key)`      | `(key: string) => void`                 | Delete a key.                            |
| `ctx.session.flush()` / `Session.flush()`              | `() => void`                            | Delete all keys.                         |
| `ctx.session.flash(key, value)` / `Session.flash(...)` | `(key: string, value: unknown) => void` | Write a one-request-only value.          |
| `ctx.session.regenerate()` / `Session.regenerate()`    | `() => void`                            | Issue a new session ID (data preserved). |
| `ctx.session.id()` / `Session.id()`                    | `() => string`                          | Return the current session ID.           |

### HttpContext helpers

| Method                  | Signature                               | Description                                   |
| ----------------------- | --------------------------------------- | --------------------------------------------- |
| `ctx.flash(key, value)` | `(key: string, value: unknown) => void` | Shorthand for `ctx.session.flash()`.          |
| `ctx.flashed<T>(key)`   | `(key: string) => T \| undefined`       | Read a value flashed in the previous request. |

### CsrfMiddleware

| Member                       | Signature                                    | Description                                         |
| ---------------------------- | -------------------------------------------- | --------------------------------------------------- |
| `CsrfMiddleware.token(ctx?)` | `(ctx?: HttpContext) => string \| undefined` | Read the current request's CSRF token from session. |
| `CsrfMiddleware.with(opts)`  | `(opts: { secure?: boolean }) => Middleware` | Configure the middleware (e.g. a `Secure` cookie).  |

### Errors

Session errors extend `SessionError`, which extends the framework's
`ZerotalError`. Most surface at boot rather than per request — they are
configuration faults, and failing loudly at startup beats silently losing
sessions.

| Error                        | Code                       | Raised when                                                |
| ---------------------------- | -------------------------- | ---------------------------------------------------------- |
| `SessionError`               | `E_SESSION`                | Base class — catch this to handle any session failure.     |
| `SessionSecretMissingError`  | `E_SESSION_SECRET_MISSING` | No `SESSION_SECRET` is configured. Raised at boot.         |
| `SessionDriverMissingError`  | `E_SESSION_DRIVER_MISSING` | The configured driver name matches nothing registered.     |
| `SessionCookieOverflowError` | —                          | The serialised session exceeds the 4 KB a cookie can hold. |

`SessionCookieOverflowError` is the one you meet in real use. The `cookie` driver
stores the whole session in the cookie itself, so putting a user object — or a
flash message with a stack trace — into the session overflows a hard browser
limit:

```typescript
// in a controller
import { SessionCookieOverflowError } from "@zerotal/session";

try {
  http.session.put("report", hugeObject);
} catch (error) {
  if (error instanceof SessionCookieOverflowError) {
    // Keep a key in the session, the payload somewhere with room.
    const id = await Cache.put(hugeObject);
    http.session.put("reportId", id);
  } else throw error;
}
```

The fix is nearly always to store an identifier rather than the object, or to
move to a server-side driver where the cookie holds only the session id.

## Next steps

- [Middleware](/docs/middleware) — where `SessionMiddleware` and `CsrfMiddleware`
  sit in the pipeline.
- [HttpContext](/docs/context) — the `ctx` object that carries the session.
- [Authentication](/docs/authentication) — build on regenerated, user-scoped sessions.
- [Cookies](/docs/cookies) — the lower-level cookie API the cookie driver builds on.
