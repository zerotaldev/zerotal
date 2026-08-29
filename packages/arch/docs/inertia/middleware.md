---
title: Inertia Middleware & Versioning
description: The Inertia middleware, asset versioning, and forcing a full reload after a deploy.
---

# Middleware & versioning

`InertiaMiddleware` implements the parts of the Inertia protocol that have to happen
at the HTTP layer. You don't register it manually — `InertiaProvider` adds it for you
via `useOnce()` during boot.

## What the middleware does

`InertiaMiddleware` handles three protocol requirements on every response:

1. **302 → 303 for non-GET redirects.** Inertia requires a 303 after a
   POST/PUT/DELETE so the browser issues a `GET` on the redirect target instead of
   replaying the form submission. Without this, redirect-after-submit flows break.

2. **Asset-version mismatch → 409.** When the client's `X-Inertia-Version` header
   differs from the server's current [asset version](#asset-versioning), the
   middleware responds **409** with an `X-Inertia-Location` header. The Inertia
   client reacts by doing a full page reload to pull the new assets — this is how
   zero-downtime deploys avoid stale-bundle errors.

3. **`Vary: X-Inertia` on every response.** Prevents a browser/CDN cache from serving
   a JSON navigation response where an HTML document is expected (or vice versa) on
   Back/Refresh.

## Automatic registration

`InertiaProvider.onBooting()` calls `this.app.useOnce(InertiaMiddleware)`, so simply
registering the provider is enough:

```ts
// bootstrap/providers.ts — this is all you need
import { InertiaProvider } from "@zerotal/inertia";

export default [
  // …auth, session providers…
  InertiaProvider,
];
```

You do **not** add `InertiaMiddleware` to `Application.create().use([...])` — doing so
would just register it twice (and `useOnce` guards against that anyway).

> **Note** — Ordering & `ctx.user`. Shared props read `ctx.user` at the moment `inertia()`
> runs _inside your controller_ — which is after the entire middleware pipeline. So
> the authenticated user is always populated by the time props are built; you don't
> need to hand-order `InertiaMiddleware` relative to auth.

## Which redirects are covered

**All of them.** `useOnce()` registers `InertiaMiddleware` as _global_ middleware, so it
runs on every request the app serves — however that route declared its own middleware,
whether as an array, a map form (`{ ALL, POST }`), a group, or nothing at all. There is
no route that reaches a controller without passing through it, so there is no redirect
it does not mark.

This is worth stating plainly because the opposite belief is expensive. An app that
thinks some routes miss the middleware writes its own global `InertiaRedirectMiddleware`
to cover them, and then cannot tell whether it is still needed: removing it leaves every
test green either way, because the tests assert a status and a `Location` and those were
never the part that broke.

Three things have to be true for the Inertia client to follow a redirect, and the
middleware guarantees all three:

|                                                                              | Set on                                                                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A redirect status — `303` after a non-GET, so the browser follows with `GET` | every Inertia redirect                                                             |
| `Location`                                                                   | your handler; carried through untouched, along with `Set-Cookie`                   |
| `X-Inertia: true`                                                            | **every** Inertia redirect, including one your handler already returned as a `303` |

That last row is the one that was wrong before 1.8.0: the marker was set inside the
302→303 conversion, so a handler doing the protocol-correct thing already —
`http.redirect(to, 303)` — skipped the only line that marked the response as Inertia's.
The request succeeded, the row was written, and the form sat there with its fields still
filled in.

### Pinning it from a test

`assertRedirect` checks the two headers that were never the problem. `assertInertiaRedirect`
checks all three:

```typescript fragment
// tests/Feature/OrdersTest.ts
const res = await app.post("/orders", data, { headers: { "X-Inertia": "true" } });

res.assertInertiaRedirect("/orders/1");
```

Send the request with the `X-Inertia` header, or there is nothing to assert — a redirect
to a browser that is not running Inertia is just a redirect.

## Asset versioning

The asset version is a string sent as part of every page object. When it changes, the
client knows its cached bundle is stale and triggers a reload (the 409 flow above).

Set a baseline in [config](/docs/inertia#configuration) (`version`), or compute one at boot
from the actual bundle so it changes automatically on every deploy:

```ts
// in a ServiceProvider.onBooting()
import { setAssetVersion } from "@zerotal/inertia";

const hash = Bun.hash(await Bun.file("public/assets/app.js").text()).toString(16);
setAssetVersion(hash);
```

| Function             | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `setAssetVersion(v)` | Set the current version (called by the provider).  |
| `assetVersion()`     | Read the current version (embedded in every page). |

Hashing the built bundle is the most robust option: the version is guaranteed to
change exactly when the client code changes, so users always reload onto matching
assets after a deploy.

## Next steps

- [Inertia overview](/docs/inertia) — the guide's front page and the rest of the sections.
- [Reference](/docs/inertia/references) — the full API surface in one table.
