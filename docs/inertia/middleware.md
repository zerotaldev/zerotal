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
