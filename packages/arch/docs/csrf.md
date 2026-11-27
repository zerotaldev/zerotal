---
title: CSRF Protection
description: Block cross-site request forgery by requiring a per-session token on every mutating request.
---

# CSRF Protection

Cross-site request forgery (CSRF) protection ensures that mutating requests
(POST/PUT/PATCH/DELETE) originate from your own app, not a malicious third-party
page. Zerotal's `CsrfMiddleware` (from `@zerotal/session`) handles this with a
per-session token, which a plain HTML form sends back in a hidden field and a script in a
header.

```typescript
// in a controller or middleware setup
import { CsrfMiddleware } from "@zerotal/session";
```

> **Note** — `CsrfMiddleware` ships inside `@zerotal/session`; if the
> [session](/docs/session) package is already installed, there is nothing extra
> to add. Otherwise run `bun add @zerotal/session`.

## Getting Started

CSRF protection ships inside `@zerotal/session`, but `SessionProvider` does not turn it on:
it registers the session, not `CsrfMiddleware`. The Flow starter registers it in
`bootstrap/app.ts`, and every form in it carries the token. Elsewhere, register it yourself,
as [Enabling it](#enabling-it) shows. Until you do, the only cross-site defence a
session cookie has is its `SameSite=Lax` attribute, which stops other sites but not
other subdomains of your own.

```typescript
import { CsrfMiddleware } from "@zerotal/session";
```

## How it works

1. On the first request, the middleware generates a random token
   (`crypto.randomUUID()`) and stores it in the [session](/docs/session).
2. On every response it sets a readable `XSRF-TOKEN` cookie (non-`HttpOnly`,
   `SameSite=Lax`, `Path=/`).
3. On a **mutating** request it requires that token back, compared in constant time: in an
   `X-CSRF-TOKEN` or `X-XSRF-TOKEN` header, or in a `_token` field of a form body
   (`application/x-www-form-urlencoded` or `multipart/form-data`). The field is read from a
   copy of the request, so the handler still reads the body itself, however it reads it.
4. A missing or wrong token returns **419** (`{ "message": "CSRF token mismatch." }`).

`GET`, `HEAD`, and `OPTIONS` are treated as safe and skip the check.

Because the cookie is readable by JavaScript, an HTTP client that echoes it **attaches the
`X-XSRF-TOKEN` header automatically**, as the common ones do, and the Inertia adapter's
requests carry it with no extra wiring.

> **Danger** — The `XSRF-TOKEN` cookie intentionally omits the `HttpOnly` flag so
> JavaScript can read it. This is by design (it carries no auth, only the CSRF
> token), but never store a session secret or credential in a non-`HttpOnly`
> cookie.

## Enabling it

Register `CsrfMiddleware` **after** `SessionMiddleware` — it reads and writes the
session. In production over HTTPS, set `secure: true` so the cookie carries the
`Secure` flag:

```typescript fragment
// bootstrap/app.ts
import { SessionMiddleware, CsrfMiddleware } from "@zerotal/session";

app.use([
  SessionMiddleware,
  CsrfMiddleware, // HTTP / development
  // CsrfMiddleware.with({ secure: true }) // HTTPS / production
]);
```

`CsrfMiddleware.with({ ... })` returns a zero-argument middleware class with your
options baked in, so it drops straight into the `app.use([...])` array.

| Option   | Required | Default | Description                                       |
| -------- | -------- | ------- | ------------------------------------------------- |
| `secure` | no       | `false` | Add the `Secure` flag to the `XSRF-TOKEN` cookie. |

> **Warning** — Register `CsrfMiddleware` after `SessionMiddleware`. Without an
> active session the token has nowhere to live and every mutating request fails
> with a 419.

## Submitting the token

### Forms

Put `CsrfMiddleware.field()` inside every form that posts. It renders the hidden `_token`
field holding the session's token, and the middleware reads it from the form body:

```tsx
import { CsrfMiddleware } from "@zerotal/session";

<form method="post" action={route("login.store")}>
  {CsrfMiddleware.field()}
  <input name="email" type="email" />
  <button type="submit">Sign in</button>
</form>;
```

A Flow page renders it as markup, and a compiled page compiles it, `cspSafe` included. In a
template string it is the same markup: `${CsrfMiddleware.field()}`. Outside a request, or
without a session, it renders nothing. A script that sends a form's fields on (the Flow
starter's `data-method="put"` forms do) sends `_token` with them.

### Inertia and other HTTP clients

No work needed when the client echoes the cookie: the `XSRF-TOKEN` cookie is read and sent
back as `X-XSRF-TOKEN` on every mutating request. Flow's own uploads do this too.

### Manual fetch

Expose the token server-side and send it in the header. `CsrfMiddleware.token()` returns the
current session's token:

```typescript fragment
// in an Inertia shared-props factory
import { CsrfMiddleware } from "@zerotal/session";

Inertia.share({ csrf_token: () => CsrfMiddleware.token() });

// …or embed it in an HTML meta tag for a classic page:
// <meta name="csrf-token" content="${CsrfMiddleware.token()}">
```

```typescript fragment
// client-side fetch
await fetch("/posts", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-CSRF-TOKEN": document.querySelector('meta[name="csrf-token"]').content,
  },
  body: JSON.stringify(data),
});
```

> **Tip** — `CsrfMiddleware.token()` defaults to the active request context, so it
> works inside a no-argument shared-prop factory. Pass an explicit `HttpContext`
> only when you call it outside the in-flight request.

## Which approach should I use?

- **A server-rendered form** — put `{CsrfMiddleware.field()}` inside it.
- **An Inertia app, or a client that echoes the cookie** — do nothing. The
  cookie-to-header round trip is automatic; the token is never your concern.
- **Hand-written `fetch`** — read the `XSRF-TOKEN` cookie, or expose the token with
  `CsrfMiddleware.token()` (meta tag or shared prop), and send it back in the
  `X-CSRF-TOKEN` header.
- **Stateless bearer-token API** — skip CSRF entirely (see below).

## Pure-API routes

CSRF protection guards **session-cookie** auth. Stateless APIs authenticated with
[bearer tokens](/docs/authentication#api-token-authentication) don't need it — a
token in the `Authorization` header can't be sent ambiently by a browser. Apply
`CsrfMiddleware` to your web/session routes and leave it off bearer-token API groups.

## Testing

Set your suite up once as described in [Testing](/docs/testing). CSRF protection
is the rare feature whose test is mostly about proving a request **fails**.

**A rejected request is `419`, not `403`.** That status is specific enough to be
worth asserting by number — a `403` in this test means your authorization denied
the request and CSRF never ran:

```typescript fragment
// tests/http/csrf.test.ts
import { test } from "bun:test";
import { createApp } from "../helpers.ts";

test("an unsafe request without a token is refused", async () => {
  const app = await createApp();

  const res = await app.post("/posts", { title: "Hello" });

  res.assertStatus(419);
  await app.close();
});
```

**Safe methods are exempt**, so a `GET` proves nothing about your CSRF setup. If
that is the only request in the test, the middleware could be absent entirely and
the suite would stay green:

```typescript fragment
// tests/http/csrf.test.ts
test("GET is never challenged", async () => {
  (await app.get("/posts")).assertOk(); // passes with or without CSRF — not a CSRF test
});
```

To test the **success** path, seed the session with a token you choose and send
the same value on the header the middleware reads:

```typescript fragment
// tests/http/csrf.test.ts
const token = "test-csrf-token";

const res = await app
  .withSession({ _csrf_token: token })
  .post("/posts", { title: "Hello" }, { "X-CSRF-Token": token });

res.assertCreated();
```

The middleware accepts `X-CSRF-Token`, `X-XSRF-Token` or a `_token` form field, and stores
the value under the `_csrf_token` session key — seeding it directly is both simpler
and less brittle than scraping the token out of a rendered form. The Flow starter's
`tests/support.ts` does this for every form post a test makes, and its `Browser` takes the
token from the `XSRF-TOKEN` cookie instead, as a visitor's browser does.

> **Note** — Exempting a route (a webhook receiver, say) is worth a test of its
> own asserting the request succeeds _without_ a token. That is the one case
> where a missing-token request passing is the correct outcome, and it should be
> deliberate rather than accidental.

## References

| Member           | Signature                                                              | Description                                                                |
| ---------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `CsrfMiddleware` | `class CsrfMiddleware extends BaseMiddleware<CsrfOptions>`             | Validates the token on mutating requests and sets the `XSRF-TOKEN` cookie. |
| `.with()`        | `static with(options: Partial<CsrfOptions>): new () => CsrfMiddleware` | Bake `secure` into a zero-arg middleware class for `app.use([...])`.       |
| `.token()`       | `static token(ctx?: HttpContext): string \| undefined`                 | Read the current request's CSRF token; defaults to the active context.     |
| `.field()`       | `static field(ctx?: HttpContext): CsrfField`                           | The hidden `_token` input for a form, as markup; empty without a token.    |
| `CsrfOptions`    | `{ secure?: boolean }`                                                 | Options accepted by `.with()`.                                             |

## Next steps

- [Session](/docs/session) — where the CSRF token is stored.
- [Cookies](/docs/cookies) — the `XSRF-TOKEN` and session cookies.
- [Authentication](/docs/authentication) — session vs. bearer-token auth.
- [Middleware](/docs/middleware) — how `CsrfMiddleware` runs in the pipeline.
