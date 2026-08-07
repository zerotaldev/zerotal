# @zerotal/core

> The foundation of the Zerotal framework — IoC container, application lifecycle, HTTP pipeline, and the conventions everything else builds on.

`@zerotal/core` is the heart of Zerotal, a Bun-native, full-stack TypeScript web framework. It owns the IoC container, the `Application` bootstrap/lifecycle engine, service providers, the router and HTTP pipeline, the typed config system, facades, events, JSX server-side views, and the console runtime. Every other Zerotal package (`@zerotal/orm`, `@zerotal/auth`, `@zerotal/session`, …) plugs into the primitives defined here.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14** (uses Bun-native APIs).

## Installation

```bash
bun add @zerotal/core
```

## What's inside

- **Container** — an IoC container with singleton/scoped/transient/value lifetimes, `@inject()` auto-wiring, contextual bindings, aliases, resolution hooks, and per-request scopes via `AsyncLocalStorage`.
- **Application** — the singleton that owns the container, discovers providers and config, loads routes, and drives the boot → start → stop lifecycle.
- **Router** — explicit (`Router.get/post/resource/view/...`) and file-based routing into one router, with groups, named routes, model binding, and `route()` URL generation.
- **Middleware** — the `Pipe` interface plus built-ins: `CorsMiddleware`, `ThrottleMiddleware`, `RateLimiter`, `SecureHeadersMiddleware`, `WebhookMiddleware`.
- **HttpContext** — the per-request object holding the `Request`/`Response`, route params, authenticated user, and input/response helpers.
- **Config** — a typed, dot-path config system (`config("app.name")`) backed by `config/*.ts` files, plus the `env()` helper for deployment state.
- **Facades** — thin static accessors over container bindings; core ships `Config`, `Events`, and `Artisan`.
- **Events** — a class-based event bus (`Emitter`) and a catalogue of framework events.
- **Views** — a JSX server-side rendering runtime (`@zerotal/core/jsx-runtime`) with layouts, `safe()`/`esc()`, and `view()`.
- **Commands** — the `Command` base class, `CommandRunner`, and a set of built-in CLI commands.
- **Encryption / Hashing** — `Crypt` (authenticated encryption), `Hash` (password hashing), and signed-URL helpers.

## Usage

### Bootstrap an application

```typescript
// bootstrap/app.ts
import { Application, basePath } from "@zerotal/core";

export default Application.create().routing({ web: basePath("routes/web.ts") });
```

`Application.create()` builds the singleton once; providers under `app/providers/*` and config under `config/*.ts` are auto-discovered at boot. `currentApp()` returns it anywhere afterward.

### Define routes

```typescript
import { Router } from "@zerotal/core";
import { PostController } from "../app/controllers/PostController.ts";

Router.get("/posts", PostController, "index");
Router.get("/posts/:slug", PostController, "show").name("posts.show").bind("post", Post);
Router.resource("articles", PostController);

// Inline closure handler — no controller needed
Router.get("/health", ({ http }) => http.json({ ok: true }));
```

### A controller using HttpContext

```typescript
import type { Context } from "@zerotal/core";
import { Post } from "../models/Post.ts";

export class PostController {
  async index({ http }: Context): Promise<void> {
    const posts = await Post.all();
    http.json({ posts });
  }

  async store({ http }: Context): Promise<void> {
    const { title, body } = await http.body<{ title: string; body: string }>();
    const post = await Post.create({ title, body, userId: http.user!.id });
    http.json(post, 201);
  }
}
```

### Bind and resolve from the container

```typescript
import { ServiceProvider, inject } from "@zerotal/core";

export class AppServiceProvider extends ServiceProvider {
  onRegister(): void {
    this.app.container.singleton(CacheManager, async (c) => {
      const cfg = await c.make("config");
      return new CacheManager(cfg.get("cache"));
    });
  }
}

// Auto-wiring — declare constructor dependencies with @inject
@inject(CacheManager)
export class PostRepository {
  constructor(private cache: CacheManager) {}
}
```

### Read configuration

```typescript
import { config, env } from "@zerotal/core";

config("app.name"); // typed as string via the ConfigRegistry
config("app.port", 3000); // with a fallback
const dbUrl = env("DATABASE_URL", "sqlite://./database.sqlite");
```

## Subpath exports

| Import                        | Provides                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@zerotal/core`               | The full public API: `Application`, `Container`, `Router`/`Route`, `HttpContext`, middleware, errors, events, config, facades, helpers, crypto, and view authoring helpers. |
| `@zerotal/core/commands`      | Built-in console commands — `ServeCommand`, `WorkerCommand`, `KeyGenerateCommand`, `RouteListCommand`, the `Make*` scaffolders, and more.                                   |
| `@zerotal/core/helpers`       | Standalone helper functions — `env`, `config`, `basePath`, `request`, `response` builders, `Str`, `Collection`, and pipe/tap utilities.                                     |
| `@zerotal/core/facades`       | The built-in facades: `Config`, `Events`, `Artisan`.                                                                                                                        |
| `@zerotal/core/macros/config` | The config macro used by the build tooling.                                                                                                                                 |
| `@zerotal/core/jsx-runtime`   | The JSX runtime for server-side views — set `jsxImportSource: "@zerotal/core"` in tsconfig to use it.                                                                       |

## Documentation

- [Application lifecycle](../../docs/application.md)
- [Container](../../docs/container.md)
- [Routing](../../docs/routing)
- [Controllers](../../docs/controllers.md)
- [Middleware](../../docs/middleware.md)
- [Context](../../docs/context.md)
- [Service providers](../../docs/providers.md)
- [Configuration](../../docs/config-system.md)
- [Views](../../docs/view.md)
