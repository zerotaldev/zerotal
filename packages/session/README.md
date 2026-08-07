# @zerotal/session

> Signed per-request session storage with cookie & Redis drivers, CSRF protection, and flash data.

`@zerotal/session` gives every HTTP request a signed data store you can read, write, flash, and regenerate from anywhere in the request pipeline. It ships cookie and Redis drivers, automatic CSRF protection for state-changing requests, and a `Session` facade that resolves the current request's session through async-local storage.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/session
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { SessionProvider } from "@zerotal/session";

export default [
  // …other providers
  SessionProvider,
];
```

`SessionProvider` registers `SessionMiddleware` and `CsrfMiddleware` globally — no explicit `.use()` needed. Configure in `config/session.ts`:

```ts
import { SessionConfig } from "@zerotal/session";
import { env } from "@zerotal/core";

export default SessionConfig({
  driver: env("SESSION_DRIVER", "cookie"), // 'cookie' | 'redis'
  lifetime: 86400,
  cookie: "zerotal_session",
  secure: env("APP_ENV") === "production",
  secret: env("APP_KEY", ""), // REQUIRED — signs the session cookie
});
```

## Usage

### Reading and writing

Inside a handler use `http.session`; anywhere else use the `Session` facade — both expose the same API.

```ts
import { Session } from "@zerotal/session";

// In a route handler:
async action({ http }: Context) {
  http.session.set("locale", "fr");
  const locale = http.session.get("locale") as string;
  http.session.has("locale");   // boolean
  http.session.forget("locale");
  http.session.flush();         // wipe all data
}

// Anywhere (services, jobs) via the facade:
Session.set("locale", "fr");
Session.get("locale");
```

### Flash data (one-request-only)

```ts
async store({ http }: Context) {
  await Post.create(await http.body());
  http.flash("success", "Post published!"); // survives exactly one redirect
  http.redirect("/posts", 303);
}

async index({ http }: Context) {
  const success = http.flashed<string>("success"); // gone after this request
}
```

### Session fixation protection

```ts
http.session.regenerate(); // new session ID after login/logout; data preserved
```

### CSRF

`CsrfMiddleware` validates a `_token` field on `POST`/`PUT`/`PATCH`/`DELETE` from browser forms. Requests carrying an `Authorization: Bearer` header are exempt.

```html
<form method="POST" action="/posts">
  <input type="hidden" name="_token" value="${http.csrfToken()}" />
</form>
```

For fetch/XHR, send the token as the `X-CSRF-Token` header.

## Exports

- **Provider & config** — `SessionProvider`, `SessionConfig`
- **Facade** — `Session`
- **Core** — `SessionManager`, `SessionAccessor`
- **Middleware** — `SessionMiddleware`, `AuthSessionMiddleware`, `CsrfMiddleware`
- **Drivers** — `CookieDriver`, `RedisDriver`
- **Errors** — exported from the package's error vocabulary (`./errors.ts`)
- **Types** — `SessionOptions`, `CsrfOptions`, `SessionDriver`, `SessionPayload`, `SessionConfigShape`

## Documentation

- [Session](../../docs/session.md)
- [Cookies](../../docs/cookies.md)
- [CSRF](../../docs/csrf.md)
- [Session-based Authentication](../../docs/authentication.md#login-logout-registration)
