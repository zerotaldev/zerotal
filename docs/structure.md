---
title: Directory Structure
description: Where each kind of file lives in a Zerotal app and how the framework wires those directories by convention.
---

# Directory Structure

A freshly scaffolded Zerotal app organizes code into predictable directories, most
of which are auto-discovered and wired by convention so you rarely touch the
bootstrap files.

```text
# project root
my-app/
├── app/
│   ├── controllers/
│   ├── events/             ← event classes (auto-discovered)
│   ├── exceptions/
│   │   └── Handler.ts
│   ├── jobs/
│   ├── listeners/          ← event listeners (auto-discovered)
│   ├── middleware/
│   ├── models/             ← ORM models (auto-discovered)
│   ├── observers/          ← model observers (auto-discovered)
│   ├── policies/           ← authorization policies (auto-discovered)
│   ├── providers/
│   │   └── AppServiceProvider.ts
│   ├── flow/                ← Flow Pages (server-driven UI)
│   │   └── pages/
│   └── requests/           ← FormRequest validation classes
├── bootstrap/
│   ├── app.ts              ← Application bootstrap
│   └── providers.ts        ← Provider registry
├── config/
│   ├── app.ts
│   ├── database.ts
│   ├── mail.ts
│   └── ...
├── database/
│   ├── migrations/
│   ├── seeders/
│   └── factories/
├── docs/                   ← Optional: serve with Router.markdown()
├── public/                 ← Static assets
│   └── uploads/
├── resources/
│   └── views/              ← JSX / TSX view components
├── routes/
│   └── index.ts            ← Explicit route definitions
├── tests/
│   ├── Feature/
│   └── Unit/
├── .env
├── .env.example
├── bun.lockb
├── package.json
└── zt.ts               ← CLI entry point (don't edit)
```

## Key directories

### app/

Application code lives here. Zerotal uses no magic autoloading — you import what
you need explicitly, so names and locations are entirely up to you.

**`app/controllers/`** — HTTP controller classes. Each method maps to a route
action. Name them freely; the framework just needs the class and method name at
`Router.get('/path', MyController, 'method')`.

**`app/exceptions/Handler.ts`** — your custom exception handler. Extends
`ExceptionHandler` from `zerotal`. Registered in `bootstrap/app.ts` via
`app.withExceptionHandler(Handler)`.

**`app/jobs/`** — background job classes for `@zerotal/queue`.

**`app/middleware/`** — custom middleware classes implementing `Pipe<HttpContext>`.

**`app/models/`** — ORM model classes extending `BaseModel` from `@zerotal/orm`.
Auto-discovered at boot; the table name is derived by convention, so `@table` is optional.

**`app/providers/`** — service providers for registering custom bindings and
booting application services.

**`app/flow/pages/`** — Flow Component classes. When using file-based routing these
are scanned automatically and registered as reactive WebSocket routes.

**`app/requests/`** — FormRequest validation classes. Group by domain:
`app/requests/posts/StorePostRequest.ts`.

Providers, middleware, observers, policies, listeners, events, jobs, and validators
are all auto-discovered and wired by convention. Providers run their full lifecycle
without being listed in `bootstrap/providers.ts`; middleware registers as a named
group (reference it by class name, or set `static global = true`); observers and
policies attach by name; listeners bind via `static listens`; jobs and validators
self-register on import. No manual wiring — see
[Conventions](/docs/conventions).

### bootstrap/

**`bootstrap/app.ts`** — the application singleton. Wires together exception
handling, global middleware, and opt-in conventions:

```ts
// bootstrap/app.ts
import { Application } from "zerotal";
import { DevtoolsInjectionMiddleware } from "@zerotal/devtools";
import { Handler } from "../app/exceptions/Handler.ts";
import providers from "./providers.ts";

export default Application.create({ providers })
  .withExceptionHandler(Handler)
  .routing({ web: `${import.meta.dir}/../routes/index.ts` })
  .fileBasedRouting({ web: `${import.meta.dir}/../app/routes` })
  .use([DevtoolsInjectionMiddleware]);
```

Auth resolves the session user automatically from your registered `AuthUser` model —
no `withUserResolver(...)` wiring. Override with `app.withUserResolver(...)` or
`AuthProvider.resolveUsing(...)` only for custom logic.

**`bootstrap/providers.ts`** — ordered list of provider classes. Registration
order matters: providers lower in the list can depend on bindings from providers
higher up.

> **Note** — Most providers are auto-discovered from `app/providers/`. Use
> `bootstrap/providers.ts` for the package providers you register explicitly and
> when registration order is load-bearing.

### config/

Each file exports a typed config object (default export); an optional named
`validate(config)` export is run at startup. The `zt.ts` entry point loads the
whole directory synchronously with `configLoader("./config")` and injects it via
`app.useConfig(config.all())`. Access at runtime via the `Config` [facade](/docs/container#facades) — a static
accessor over a container binding — or typed
per-package helpers. App-wide auto-discovery settings live under the `conventions`
key of `config/app.ts` — see [Conventions](/docs/conventions)
and the [Config system](/docs/config-system) for the full loading flow.

### database/

**`database/migrations/`** — migration files named `YYYY_MM_DD_HHMMSS_description.ts`.
Run with `bun zt migrate`.

**`database/seeders/`** — seeder classes for populating the database with
test or default data.

**`database/factories/`** — model factories used in tests and seeders.

### public/

Files placed here are served directly as static assets. Register the directory
with `Router.static('/assets', './public/assets')` in `routes/index.ts`.

### routes/index.ts

All explicit route registrations. This file runs after file-based routes are
scanned, so explicit routes take precedence over file routes for the same path.

```ts
// routes/index.ts
import { Router } from "zerotal";
import { PostController } from "../app/controllers/PostController.ts";

Router.get("/posts", PostController, "index").name("posts.index");
```

### zt.ts

The universal CLI entry point managed by the framework. Do not edit.

```bash
# in your project root
bun zt serve          # start HTTP server
bun zt worker         # start background worker
bun zt migrate        # run pending migrations
bun zt route:list     # list all routes
bun zt make:model     # scaffold a model
bun zt list           # all available commands
```

## File-based routing directory

If you call `app.fileBasedRouting({ web: "./app/routes" })`, that directory mirrors
the URL structure of your app. See the [Routing](/docs/routing) guide for full
details.

```text
# app/routes/ — paths map to URLs
app/routes/
  index.ts              → GET /
  about.ts              → GET /about
  users/
    index.ts            → GET /users
    [id].ts             → GET /users/:id, DELETE /users/:id
    [id]/
      posts.ts          → GET /users/:id/posts
  (api)/
    _middleware.ts      ← middleware for everything below
    status.ts           → GET /status
```

## Flow Pages directory

Flow Pages have their own directory under `app/flow/pages/` (or wherever you
point `fileBasedRouting`). The directory supports the same `(group)` and `[param]`
conventions as file-based routes. A `_middleware.ts` file in any subdirectory
applies to all Flow Pages below it.

```text
# app/flow/pages/ — Flow routes
app/flow/pages/
  (auth)/
    _middleware.ts        ← GuestMiddleware — only guests see these
    login.tsx             → /login
    register.tsx          → /register
  (protected)/
    _middleware.ts        ← AuthMiddleware
    dashboard.tsx         → /dashboard
    settings.tsx          → /settings
  index.tsx               → /
```

## Next steps

- [Conventions](/docs/conventions) — how Zerotal wires these directories by name.
- [Config system](/docs/config-system) — how the `config/` directory is loaded.
- [Routing](/docs/routing) — define routes in `routes/index.ts`.
- [Lifecycle](/docs/lifecycle) — how `bootstrap/app.ts` boots the app.
