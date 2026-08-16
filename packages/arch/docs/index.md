---
title: Documentation
description: Start here — installation, the ideas behind Zerotal, and a map of every guide in the documentation.
---

# Zerotal Documentation

Zerotal is a Bun-native, full-stack TypeScript framework. You write plain classes,
drop them in convention-named folders, and the framework wires them together at
boot — no build step, no manual registration.

## New here?

Three pages, in order, and you'll be productive:

1. **[Getting Started](/docs/getting-started)** — scaffold a project, run it, add a
   route, a model, and a [service provider](/docs/providers). Fifteen minutes.
2. **[About Zerotal](/docs/about)** — the whole framework on one screen: the four
   ideas it rests on, and a runnable example of every major feature.
3. **[Conventions](/docs/conventions)** — what gets auto-discovered, and the naming
   rules that make it happen. This is the page that stops the surprises.

```bash
# in your project's parent directory
bun create zerotal my-app
cd my-app && bun dev
```

## Find your way around

| If you want to…                    | Read                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handle a request                   | [Routing](/docs/routing) · [Controllers](/docs/controllers) · [Middleware](/docs/middleware) · [Requests Context](/docs/context)                  |
| Talk to a database                 | [Database](/docs/database) · [ORM](/docs/orm) · [Migrations](/docs/migrations) · [Query Builder](/docs/query-builder)                             |
| Build a UI                         | [Views](/docs/view) · [Flow](/docs/flow) · [Inertia](/docs/inertia) · [Assets](/docs/assets)                                                      |
| Sign users in                      | [Authentication](/docs/authentication) · [Authorization](/docs/authorization) · [Roles & 2FA](/docs/roles-and-2fa) · [Social Login](/docs/social) |
| Do work in the background          | [Queue](/docs/queue) · [Scheduler](/docs/scheduler) · [Broadcasting](/docs/broadcasting)                                                          |
| Understand how the framework boots | [The Application](/docs/application) · [Lifecycle](/docs/lifecycle) · [Container](/docs/container) · [Providers](/docs/providers)                 |
| Test what you built                | [Testing](/docs/testing) · [HTTP Tests](/docs/testing/http) · [Database Tests](/docs/testing/database)                                            |
| See what's running in production   | [Logger](/docs/logger) · [Monitor](/docs/monitor) · [Telemetry](/docs/telemetry) · [Health](/docs/health)                                         |
| Ship it                            | [Deployment](/docs/deployment) · [Commands](/docs/commands)                                                                                       |

## Choosing a frontend

Zerotal doesn't pick for you, and the choice is per project rather than per
framework:

- **[Views](/docs/view)** — server-rendered JSX. No client runtime at all. Right for
  content sites, forms, and anything that doesn't need live updates.
- **[Flow](/docs/flow)** — reactive components rendered on the server, updated
  over a WebSocket. You write TypeScript classes, not client state. Right when you
  want interactivity without a separate frontend codebase.
- **[Inertia](/docs/inertia)** — a React or Vue SPA that talks to your controllers
  directly, with no API layer to maintain. Right when you already know React or Vue
  and want the full client-side experience.

## Reference

- **[API Reference](/docs/api)** — generated from source, every exported symbol.
- **[Commands](/docs/commands)** — every `bun zt` command.
- **[Release Notes](/docs/changelog)** · **[Upgrade Guide](/docs/upgrade)**
- **[Package Development](/docs/package-development)** — build your own `@zerotal`-style package.
- **[Contribution Guide](/docs/contributing)** · **[Inspirations](/docs/inspirations)**
