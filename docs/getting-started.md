---
title: Getting Started
description: Scaffold, configure, and run your first Zerotal application on Bun in a few minutes.
---

# Getting Started

Zerotal is a full-stack framework for [Bun](https://bun.sh). This guide walks you
from a blank machine to a running app with a route, a model, and a service
provider.

## Requirements

- **Bun** ≥ 1.3.14 — [install](https://bun.sh/docs/installation)
- A PostgreSQL, MySQL, or SQLite database (SQLite requires nothing extra)

## Create a new project

```bash
# in your project root's parent directory
bun create zerotal my-app    # or: bunx create-zerotal my-app
cd my-app
```

The scaffolder prompts for a project name and a template, then generates a
ready-to-run project and installs dependencies. The **database** prompt only
appears for the API template:

| Prompt       | Options                                                                     |
| ------------ | --------------------------------------------------------------------------- |
| Project name | Defaults to `my-zerotal-app`                                                |
| Template     | **API**, **Flow**, **React**, **Vue**, or **Minimal** (see the guide below) |
| Database     | **SQLite** (zero setup), **PostgreSQL**, or **MySQL** — API template only   |

It writes a fresh `APP_KEY` into the generated `.env.example` for you (no manual
generation needed). For Postgres/MySQL it reminds you to set `DATABASE_URL`
before migrating.

### Without a terminal — CI, scripts, agents

Every prompt has a flag, and the scaffolder never asks a question when there is
no TTY to answer it:

```bash
bunx create-zerotal my-app --template=api --db=postgres --no-install
bunx create-zerotal my-app --yes            # take the defaults for anything unset
bunx create-zerotal --help
```

| Flag                      |                                                    |
| ------------------------- | -------------------------------------------------- |
| `-t`, `--template <name>` | `api`, `admin`, `flow`, `react`, `vue`, `minimal`  |
| `--db <name>`             | `sqlite`, `postgres`, `mysql` — API template only  |
| `-y`, `--yes`             | Take defaults for anything not given; never prompt |
| `--no-install`            | Skip `bun install`                                 |
| `-h`, `--help`            | Usage                                              |
| `-v`, `--version`         | The scaffolder's own version                       |

An answer that is missing and cannot be asked for is an error naming the flag
that would supply it, and the exit code is non-zero — so a pipeline fails where
it used to wait. A failed `bun install` also exits non-zero when there is no
terminal: a half-built project that reports success is worse than one that stops.

### Which template should I use?

- **API** — JSON REST API with core, [ORM](/docs/orm), [auth](/docs/authentication),
  [validation](/docs/validator), and [testing](/docs/testing/index). The default for a backend service.
- **Flow** — server-driven reactive UI ([Flow](/docs/flow) pages, top nav, Tailwind).
- **React** — [Inertia](/docs/inertia) + React SPA with file-based routes and Tailwind.
- **Vue** — Inertia + Vue SPA with file-based routes and Tailwind.
- **Minimal** — a single page with JSX views and Tailwind on the bare framework.

> **Note** — Only the **API** template ships a database config and migrations.
> The Flow, React, Vue, and Minimal templates start without a database.

## Project structure

The **API** template generates the following. Other templates vary (SPA
templates add a `resources/` frontend, for example):

```
# my-app/ (API template)
my-app/
├── app/
│   ├── controllers/        # HTTP controllers
│   ├── middleware/          # Custom middleware
│   └── models/              # ORM models (auto-discovered)
├── bootstrap/
│   └── app.ts               # Builds the Application (providers + routing)
├── config/                  # Config files (database, session, queue…) — auto-loaded
├── database/
│   └── migrations/          # Database migrations
├── routes/
│   └── index.ts             # Route definitions
├── tests/                   # Test suites
├── zt.ts                   # Managed CLI entry point — do not edit
└── .env                     # Environment variables (git-ignored)
```

`zt.ts` is the entry point for **everything** — `bun zt serve`, `migrate`,
`test`, and every `make:*` generator run through it. It boots `bootstrap/app.ts`,
which defines your [Application](/docs/application). Anything under `app/models/`,
`app/providers/`, and `config/` is [auto-discovered](/docs/conventions) at boot —
no manual registration.

> **Tip** — `app/providers/` is auto-discovered when present. The API template
> doesn't generate one; run `bun zt make:provider …` and the framework picks it
> up at boot.

## Environment setup

The scaffolder generates `.env.example` with a ready-made `APP_KEY`. Copy it to
`.env`:

```bash
# in your project root
cp .env.example .env
```

```ini
# .env
APP_ENV=development
APP_KEY=base64:…              # pre-generated; rotate with `bun zt key:generate`
DATABASE_URL=./database/db.sqlite
SESSION_SECRET=change-me-in-production
```

The database is configured with a single **`DATABASE_URL`** — SQLite uses a file
path, Postgres/MySQL use a connection string:

```ini
# .env — alternative DATABASE_URL forms
# DATABASE_URL=postgres://user:pass@localhost:5432/my_app
# DATABASE_URL=mysql://root@localhost:3306/my_app
```

> **Danger** — Change `SESSION_SECRET` before deploying. The placeholder value is
> not safe for production.

See [Configuration](/docs/config-system) for the full config system.

## Run migrations

```bash
# in your project root
bun zt migrate
```

## Start the dev server

```bash
# in your project root
bun dev          # → bun zt serve --dev
```

Your app is now running at **http://localhost:3000** with hot reload enabled —
`--dev` watches your files and hot-swaps routes without dropping connections. The
generated `package.json` also gives you `bun start` (production serve) and
`bun test`.

## Your first route

Open `routes/index.ts` and add:

```typescript
// routes/index.ts
import { Router } from "zerotal";
import { PostController } from "../app/controllers/PostController.ts";

Router.get("/posts", PostController, "index");
Router.post("/posts", PostController, "store");
```

Create the controller:

```typescript
// app/controllers/PostController.ts
import type { HttpContext } from "zerotal";

export class PostController {
  async index(ctx: HttpContext) {
    return ctx.json({ posts: [] });
  }

  async store(ctx: HttpContext) {
    const body = await ctx.request.json();
    return ctx.json({ created: body }, 201);
  }
}
```

> **Note** — Every controller action receives the request
> [HttpContext](/docs/context) directly. Read route params and resolved model
> bindings from `ctx.params`; type them with the generic, e.g.
> `ctx: HttpContext<{ post: Post }>`.

## Your first model

```bash
# in your project root
bun zt make:model Post --migration
```

This generates `app/models/Post.ts` and a matching migration. Models in
`app/models/` are auto-discovered at boot — no manual registration, and the table
name is derived by convention (`Post` → `posts`), so `@table` is optional. The
same applies to observers, policies, and event listeners; see
[Conventions](/docs/conventions).

Open the migration and define your columns:

```typescript
// database/migrations/xxxx_create_posts_table.ts
import { Migration, Schema } from "@zerotal/orm";

export default class CreatePostsTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("posts", (table) => {
      table.increments("id");
      table.string("title");
      table.text("body");
      table.string("slug").unique();
      table.timestamps();
    });
  }

  async down(): Promise<void> {
    await Schema.drop("posts");
  }
}
```

Run it:

```bash
# in your project root
bun zt migrate
```

Your model is ready to use:

```typescript
// in a controller or service
import { Post } from "../models/Post.ts";

const posts = await Post.query().latest().limit(10).get();
const post = await Post.find(1);
const fresh = await Post.create({ title: "Hello", body: "...", slug: "hello" });
```

## Adding a service provider

Providers are where you wire up your own bindings. Scaffold one:

```bash
# in your project root
bun zt make:provider AppServiceProvider
```

```typescript
// app/providers/AppServiceProvider.ts
import { ServiceProvider } from "zerotal";
import { PaymentGateway } from "../services/PaymentGateway.ts";
import { StripeGateway } from "../services/StripeGateway.ts";

export class AppServiceProvider extends ServiceProvider {
  onRegister(): void {
    this.app.container.singleton(
      PaymentGateway,
      () => new StripeGateway({ key: Bun.env.STRIPE_KEY! }),
    );
  }
}
```

Anything under `app/providers/` is **auto-discovered and registered at boot** — no
manual wiring needed. You only touch `bootstrap/app.ts` when you need to control
_ordering_ (e.g. one provider must register before another). See
[Service Providers](/docs/providers) and [Conventions](/docs/conventions).

## Available commands

Everything runs through `zt.ts`. The most common:

```bash
# in your project root
bun zt make:model Name --migration   # model + migration
bun zt make:controller Name          # controller class
bun zt make:middleware Name          # middleware class
bun zt make:provider Name            # service provider
bun zt make:job Name                 # queue job
bun zt migrate                       # run pending migrations
bun zt migrate:rollback              # roll back last batch
bun zt migrate:status                # show migration status
bun zt migrate:fresh                 # roll back all + re-migrate
bun zt key:generate                  # generate a fresh APP_KEY
bun zt queue:work                    # start the queue worker
```

There are many more (`make:policy`, `make:factory`, `make:seeder`, `make:page`,
`db:seed`, `schedule:list`, …). Run `bun zt list` to see them all, or see
[Commands](/docs/commands) for the full list and
[Scaffolding](/docs/scaffolding) for what each generator produces.

## Next steps

- [Routing](/docs/routing) — route definitions, groups, parameters, and file-based routes.
- [Controllers](/docs/controllers) — move route logic into classes.
- [ORM](/docs/orm) — models, queries, and relationships.
- [Configuration](/docs/config-system) — how config and auto-discovery work.
- [Flow](/docs/flow) — server-driven reactive UI (or [Inertia](/docs/inertia) for a React/Vue SPA).
