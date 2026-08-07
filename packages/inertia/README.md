# @zerotal/inertia

> A native, Bun-powered Inertia.js server adapter for React/Vue SPAs without a separate API.

Lets you build single-page apps using server-side routing and controllers — no
separate API layer, no client-side router. Controllers return Inertia page
responses; the stock `@inertiajs/react` / `@inertiajs/vue3` clients render the
matching component. Ships full Inertia v3 support: controller-less page routes,
auto-merged shared props, asset versioning, the data-props layer (partial reloads,
`optional`/`defer`/`merge`), history encryption, precognition, and optional
streaming SSR. Flash, errors, and old input are read from the request's session
when the app runs [`@zerotal/session`](../session/README.md) — no hard
dependency between the two packages.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

## Installation

```bash
bun add @zerotal/inertia
# plus the client of your choice:
bun add @inertiajs/react react react-dom   # React
# or
bun add @inertiajs/vue3 vue                # Vue
```

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { InertiaProvider } from "@zerotal/inertia";

export default [InertiaProvider];
```

`InertiaProvider` loads the HTML template and asset version at boot,
auto-registers `InertiaMiddleware` (you do **not** add it to `.use()` manually),
and registers the `POST /__ssr` endpoint when `ssr: true`. Configure it in
`config/inertia.ts`:

```ts
// config/inertia.ts
import { InertiaConfig } from "@zerotal/inertia";
import { env } from "@zerotal/core";

export default InertiaConfig({
  htmlTemplate: "./resources/app.html", // must contain <!-- @inertia -->
  version: env("ASSET_VERSION", "1"), // cache-bust string; bump on each deploy
  assetsUrl: "/assets",
  ssr: false, // set true to enable POST /__ssr
});
```

## Usage

Return a page from any controller action. `inertia()` reads the active request
from context (no `ctx`/`http` argument) and sets the response as a side effect, so
the action returns `Promise<void>` — always `return inertia(...)`:

```ts
import type { Context } from "@zerotal/core";
import { inertia } from "@zerotal/inertia";
import { Post } from "../models/Post.ts";

export class DashboardController {
  async index({ http }: Context): Promise<void> {
    const posts = await Post.query().latest().limit(5).get();
    return inertia("Dashboard", { posts }); // → resources/pages/Dashboard.tsx
  }
}
```

Control which props are sent and when with the prop wrappers:

```ts
import { inertia, optional, defer, merge } from "@zerotal/inertia";

return inertia("Users/Index", {
  users: () => User.all(), // lazy — only evaluated when sent
  roles: optional(() => Role.all()), // only on a partial reload that asks for it
  stats: defer(() => computeStats()), // loaded after first paint
  feed: merge(() => Post.paginate(15, page)), // appended on "load more"
});
```

Render controller-less pages straight from a route, and send external/full-page
visits via the unified facade:

```ts
import { Router } from "@zerotal/core";
import { Inertia } from "@zerotal/inertia";

Router.inertia("/about", "About/Index"); // no props
Router.inertia("/admin", "Admin/Dashboard", [AuthMiddleware]); // middleware shorthand

return Inertia.location("https://billing.stripe.com/session/abc"); // 409 / 302
```

Register custom shared props once and they merge into every page:

```ts
import { Inertia } from "@zerotal/inertia";

Inertia.share({
  appName: "Acme",
  year: () => new Date().getFullYear(), // evaluated per request
  flags: Inertia.optional(() => FeatureFlag.all()),
});
```

## Exports

- `inertia`, `inertiaStream`, `buildPageObject` — render page responses.
- `Inertia` — unified facade for the Inertia protocol
  (`render`, `share`, `optional`, `defer`, `merge`, `location`, …).
- `inertiaRoute` / `Router.inertia()` — controller-less page routes.
- `InertiaProvider`, `InertiaMiddleware`, `PrecognitionMiddleware` — wiring.
- `sharedProps`, `share` — shared-props registry.
- Prop wrappers + factories: `InertiaProp`, `OptionalProp`, `AlwaysProp`,
  `DeferProp`, `MergeProp`, `InfiniteScrollProp`, `optional`, `lazy`, `always`,
  `defer`, `merge`, `deepMerge`, `scroll`; plus `resolveProps`.
- `encryptHistory`, `clearHistory`, `setHistoryEncryptionDefault` — history encryption.
- `location` — external / fragment redirects.
- `assetVersion`, `setAssetVersion`, `generatePageRegistry`, `detectVuePlugin`,
  `SsrHandler` — versioning, build, and SSR utilities.
- `InertiaConfig` / `InertiaConfigShape` — config factory and shape.
- Types: `PageObject`, `InertiaProviderOptions`, `PropFactory`, `MergeConfig`,
  `PaginatorLike`, `ScrollConfig`, `ResolvedPage`.
- Errors: `InertiaError`, `InertiaTemplateNotLoadedError`, `InvalidComponentError`.

## Documentation

- [Inertia overview](../../docs/inertia/index.md)
- [Rendering Pages](../../docs/inertia/rendering.md)
- [Props](../../docs/inertia/props.md)
- [Middleware & Versioning](../../docs/inertia/middleware.md)
- [Server-Side Rendering](../../docs/inertia/ssr.md)
- [CLI & Build](../../docs/inertia/build.md)
- [References](../../docs/inertia/references.md)
