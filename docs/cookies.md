---
title: Cookies
description: Read and write raw HTTP cookies via the request/response headers when the session isn't the right fit.
---

# Cookies

Most state you'd reach for cookies for is better handled by the
[session](/docs/session) — it stores data in a **signed, `HttpOnly`** cookie for you.
When you need to read or set a raw cookie directly, you work with the standard
`Request`/`Response` headers on the [HTTP context](/docs/context).

## Which should I use?

- **Session** — the default. User state, flash messages, anything sensitive or
  tamper-prone. The [session](/docs/session) driver signs and encrypts it for you.
- **Raw cookie** — small, non-sensitive client preferences the browser must read
  too (a theme toggle, a dismissed-banner flag). Reach for the manual approach
  below only here.

> **Danger** — A plain `Set-Cookie` value is fully client-visible and editable.
> Zerotal signs the session cookie so it can't be tampered with; for a tamper-proof
> value of your own, store it in the session or sign it yourself with
> [`Url.sign`](/docs/encryption#signed-urls) or [encryption](/docs/encryption) rather
> than trusting a raw cookie.

## Reading a cookie

Cookies arrive in the request's `Cookie` header. Read and parse it from the context:

```ts
// in a controller
import type { HttpContext } from "zerotal";

function readCookie(ctx: HttpContext, name: string): string | undefined {
  const header = ctx.request.headers.get("Cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

const theme = readCookie(ctx, "theme") ?? "light";
```

## Setting a cookie

Set the response with a `ctx` helper, then append a `Set-Cookie` header to it. Use
`append` (not `set`) so multiple cookies can be sent in one response:

```ts
// in a controller
ctx.json({ ok: true }); // assigns ctx.response

ctx.response!.headers.append(
  "Set-Cookie",
  `theme=dark; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`,
);
```

> **Note** — `ctx.json()` returns `void` — it sets `ctx.response` for you. Reach for
> the response object via `ctx.response` after calling a response helper; don't
> assign its return value.

### Recommended attributes

| Attribute           | Why                                                                |
| ------------------- | ------------------------------------------------------------------ |
| `Path=/`            | Make the cookie apply site-wide.                                   |
| `HttpOnly`          | Hide it from JavaScript — use for anything sensitive.              |
| `Secure`            | Only send over HTTPS. Enable in production.                        |
| `SameSite=Lax`      | Sensible CSRF-resistant default; use `Strict` for extra isolation. |
| `Max-Age=<seconds>` | Lifetime. Omit for a session cookie that clears on browser close.  |

To **delete** a cookie, set it again with `Max-Age=0`:

```ts
// in a controller
ctx.response!.headers.append("Set-Cookie", "theme=; Path=/; Max-Age=0");
```

## Framework-managed cookies

You rarely set cookies by hand — two parts of the framework manage their own:

- **Session cookie** — the [session](/docs/session) driver stores the whole session
  in a single cookie, **signed with HMAC-SHA256** and flagged `HttpOnly`,
  `SameSite=Lax` (and `Secure` in production). Its name (`cookie`) and lifetime
  (`lifetime`) come from `config/session.ts`. Put user state in the session rather
  than rolling your own signed cookie.
- **`XSRF-TOKEN` cookie** — [`CsrfMiddleware`](/docs/csrf) sets this readable
  (non-`HttpOnly`) cookie after every request so Axios/Inertia can echo it back as
  the `X-XSRF-TOKEN` header.

## Next steps

- [Session](/docs/session) — signed, `HttpOnly` cookie-backed state (the usual choice).
- [CSRF Protection](/docs/csrf) — the `XSRF-TOKEN` cookie.
- [HTTP Context](/docs/context) — the request/response objects you read and write.
- [Encryption](/docs/encryption) — sign or encrypt your own cookie values.
