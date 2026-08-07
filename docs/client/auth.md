---
title: Client Authentication
description: Bearer tokens, CSRF, and refreshing credentials on a 401.
---

# Authentication & CSRF

The client supports the two ways a browser app proves who it is, and the choice is
usually made for you by where the API lives:

- **Bearer tokens** suit APIs on another origin, mobile clients, and anything where
  the caller holds a credential it can attach itself.
- **Session cookies** suit an API served from your own domain, where the browser
  already carries the session and CSRF protection is the concern instead.

## Bearer tokens

Attach a bearer token (string or a resolver, sync or async) without writing an interceptor —
update it at runtime with `setToken()`:

```ts
// app/api/client.ts
const api = createApiClient<Routes>({
  token: () => authStore.accessToken, // re-read on every request
});
api.setToken(freshToken); // or update imperatively
```

Prefer the resolver form. A plain string is captured once at construction, so a
token refreshed later never reaches the client; a function is consulted on every
request and always sees the current value.

Calling `setToken()` with no argument clears the token, which is what a logout
should do — otherwise the next request still carries the credential of the user who
just signed out.

> **Note** — The `token` is only applied when no `Authorization` header is already
> present on the request, so a per-request override always wins.

## Session cookies and CSRF

For session/cookie (SPA) auth, set `withCredentials` to send cookies, which also turns on CSRF:
the client reads the `XSRF-TOKEN` cookie and sends it as `X-XSRF-TOKEN` on mutating requests
(matching the session/CSRF middleware). Customize the names with `csrf`:

```ts
// app/api/client.ts
createApiClient<Routes>({
  withCredentials: true, // credentials: 'include' + CSRF on
  csrf: { cookie: "XSRF-TOKEN", header: "X-XSRF-TOKEN" }, // defaults shown
});
```

Enabling `withCredentials` turns CSRF on by default, so the two travel together and
neither needs configuring in the common case. Set `csrf: false` to opt out, or pass
an object to rename the cookie and header to match a server that uses different
ones.

The token is attached only to mutating requests — `POST`, `PUT`, `PATCH`, `DELETE`.
A `GET` is exempt because it should not change state, so it needs no protection
from being triggered cross-site. If a `GET` in your API does change something, that
is the thing to fix; adding a CSRF header to it would only hide the problem.

The header is skipped when the request already carries one, so a caller that sets
its own value keeps it.

## 401 / token refresh

`onUnauthorized` is called when any request receives a 401 response. It receives
the error and a `retry` function. Call `retry()` — optionally with header overrides
— to re-execute the failed request. The retry is limited to **one attempt**.

```ts
// app/api/client.ts
const api = createApiClient<Routes>({
  baseUrl: "https://api.example.com",

  onUnauthorized: async (err, retry) => {
    const newToken = await authStore.refresh();
    return retry({ Authorization: `Bearer ${newToken}` });
  },
});
```

If `onUnauthorized` is not provided or does not call `retry`, the 401 error is
thrown normally.

The single-attempt limit is deliberate: a refresh that itself returns 401 would
otherwise retry forever, turning an expired session into an endless loop of
requests. When the retry also fails, the error is thrown and the app can send the
user to the login screen.

One case the hook does not solve on its own is a page that fires several requests
at once. Each 401 calls `onUnauthorized` separately, so a naive handler triggers
several concurrent refreshes and the losers of that race may invalidate the winner's
token. Have the refresh itself de-duplicate — cache the in-flight promise in your
auth store and hand the same one to every caller until it settles:

```ts
// app/api/authStore.ts
let inflight: Promise<string> | null = null;

export function refresh(): Promise<string> {
  inflight ??= requestNewToken().finally(() => (inflight = null));
  return inflight;
}
```

## Next steps

- [Client overview](/docs/client) — the guide's front page and the rest of the sections.
- [Error handling](/docs/client/errors) — the errors a rejected request throws.
- [CSRF protection](/docs/csrf) — the server side of the cookie and header pair.
