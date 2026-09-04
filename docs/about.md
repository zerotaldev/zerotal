---
title: About Zerotal
description: The complete standalone tour of Zerotal — what it is, the ideas behind it, and runnable examples for every major feature. Everything you need to start building on one page.
---

# About Zerotal

Zerotal is a **Bun-native, full-stack TypeScript web framework** for building
full-stack apps — from classic server-rendered pages to reactive live components and
Inertia.js SPAs.

This page is the **whole framework on one screen**: read it top to bottom and you'll
know what Zerotal is, how it's put together, and how to do the everyday things —
routing, models, validation, auth, background jobs, and picking a frontend — with
copy-pasteable code. Every section links to the deep-dive doc if you want more, but
you shouldn't _need_ to open them to get productive. When you're ready to scaffold,
skip to [Install and run](#install-and-run).

## The one-paragraph version

You write plain TypeScript classes — controllers, models, jobs, providers — and drop
them into convention-named folders (`app/controllers/`, `app/models/`, …). At boot,
Zerotal discovers them, wires their dependencies through a typed IoC container, and
runs everything on [Bun](https://bun.sh). There is **no build step**: Bun executes
`.ts` files directly, so what you write is what runs. If you've used a classic
full-stack MVC framework, the mental model transfers almost one-to-one — facades,
service providers, Active Record models, FormRequests, queues, policies — but the
language is TypeScript and the runtime is Bun.

## Who Zerotal is for

- **Full-stack MVC developers** who want the same ergonomics with end-to-end type safety.
- **TypeScript teams** who want a batteries-included backend without stitching a
  dozen libraries together.
- **Full-stack builders** who want to pick their frontend style per project —
  server-rendered JSX, reactive server components, or a React/Vue SPA — without
  changing frameworks.

## Four ideas hold it together

Everything else is detail. Internalize these four and the rest reads as variations on
a theme.

### 1. Bun-native, source-only

Zerotal runs **only on Bun** (≥ 1.3.14) and leans on Bun's APIs throughout — `Bun.sql`
for the database, `Bun.CryptoHasher` for hashing, `Bun.build` for bundling. Because
Bun runs and type-strips TypeScript natively, packages ship as **`.ts` source with no
compiled `dist/`**. You always read real source and get accurate types; there's
nothing to compile and no source-map indirection.

> **Note** — Node.js is not supported. Importing `@zerotal/*` from a plain Node
> process will fail — it expects Bun's runtime APIs.

### 2. Convention over configuration

Drop a file in the right folder and it's wired up. Models in `app/models/`, providers
in `app/providers/`, policies, observers, and event listeners are all
**auto-discovered at boot** — no manual registration. Table names, route model
bindings, and more are derived by convention (`Post` → the `posts` table). You edit
`bootstrap/app.ts` only when you need to control ordering.

### 3. The container wires everything

A typed **IoC (inversion-of-control) container** builds your objects for you. You
declare _how_ to build something once (usually in a provider), then ask for it by type
and the container resolves its dependencies. Controllers, services, and framework
internals are all resolved this way, which is what makes them easy to swap and test.

### 4. Providers are the on-switches

A **service provider** is a feature's setup script. Registering a provider in
`bootstrap/providers.ts` is what "turns on" a package — it binds services into the
container, registers middleware, subscribes to events, and cleans up on shutdown, each
in a defined [lifecycle](/docs/lifecycle) phase (`onRegister` → `onBooting` →
`onBooted` → `onStopping`). Want Inertia? Add `InertiaProvider`. Want reactive SSR?
Add `FlowProvider`. The provider list is the feature manifest for your app.

## Install and run

```bash
# in your project's parent directory
bun create zerotal my-app     # choose: API, Flow, React, Vue, or Minimal
cd my-app
cp .env.example .env         # APP_KEY is pre-generated for you
bun zt migrate              # create the database schema (API template)
bun zt dev                  # dev server + hot reload at http://localhost:3000
```

The scaffolder writes a fresh `APP_KEY` into `.env.example` and installs
dependencies. Pick a template at the prompt:

- **API** — JSON REST API (core + ORM + auth + validation + testing). The default.
- **Flow** — server-driven reactive UI (see [Flow](#flow-reactive-ssr)).
- **React** / **Vue** — Inertia SPA (see [Inertia](#inertia-react-vue-spa)).
- **Minimal** — one page with JSX views on the bare framework.

There's **no build step**: `bun zt dev` starts the server, `bun test` runs the suite,
`bun run typecheck` type-checks. More in [Getting Started](/docs/getting-started).

## The shape of an app

The folders are conventions the framework reads, not wiring you maintain:

```
# my-app/
my-app/
├── app/
│   ├── controllers/    # HTTP controllers (plain classes)
│   ├── models/         # ORM models — auto-discovered
│   ├── middleware/     # Custom middleware
│   ├── policies/       # Authorization policies
│   ├── providers/      # Your service providers — auto-discovered
│   ├── jobs/           # Queue jobs
│   ├── mail/           # Mailable classes
│   └── flow/         # Reactive SSR components (*.tsx)
├── bootstrap/
│   ├── app.ts          # Builds the Application (providers + routing)
│   └── providers.ts    # Which packages are active
├── config/             # Typed config files — auto-loaded
├── database/
│   └── migrations/     # Schema-builder migration classes
├── routes/
│   └── index.ts        # Route definitions
├── public/             # Static assets
├── storage/            # Uploads, logs, SQLite file
├── zt.ts              # The CLI entry point — do not edit
└── .env
```

`zt.ts` is the entry point for **everything** — `bun zt serve`, `migrate`, `test`,
and every `make:*` generator run through it. It boots `bootstrap/app.ts`:

```ts fragment
// bootstrap/app.ts
import { Application } from "zerotal";
import { Handler } from "../app/exceptions/Handler.ts";
import { User } from "../app/models/User.ts";
import providers from "./providers.ts";

export default Application.create({ providers })
  .withExceptionHandler(Handler)
  .withUserResolver((id) => User.find(id));
```

See [Directory Structure](/docs/structure) for the full tour.

## How a request flows

Most of what you write plugs into one of these steps:

1. **Boot** — `bun zt serve` loads `bootstrap/app.ts`, registers providers,
   auto-discovers `app/` and `config/`, and loads `routes/`.
2. **Match** — the request is matched to a route → a controller action or a closure.
3. **Pipeline** — it passes through the [middleware](/docs/middleware) stack (session,
   auth, CSRF, …) before reaching your handler.
4. **Handle** — your controller runs. It receives an [`HttpContext`](/docs/context)
   for request input and the response, and resolves dependencies from the container.
5. **Respond** — you return JSON, a [view](/docs/view), a [Flow](#flow-reactive-ssr)
   page, an [Inertia](#inertia-react-vue-spa) page, or a redirect.

Read [Request Lifecycle](/docs/lifecycle) for the exact sequence.

## Routing

Routes are registered by calling static `Router` methods at module load — map a path
to a controller + action, or to an inline closure:

```ts fragment
// routes/index.ts
import { Router, view, type HttpContext } from "zerotal";
import HomeController from "../app/controllers/HomeController.ts";
import PostController from "../app/controllers/PostController.ts";
import AdminController from "../app/controllers/AdminController.ts";
import { CounterPage } from "../app/flow/CounterPage.tsx";

// Controller + action
Router.get("/", HomeController, "index").name("home");

// Inline closure handler
Router.get("/health", (http: HttpContext) => http.json({ ok: true }));

// RESTful resource (index/create/store/show/edit/update/destroy)
Router.resource("posts", PostController);

// Reactive SSR page (Flow)
Router.flow("/counter", CounterPage);

// Route groups with shared prefix + middleware
Router.group({ prefix: "/admin", middleware: ["auth", "admin"] }, () => {
  Router.get("/dashboard", AdminController, "index");
});
```

Apps that prefer file-based routing add `.fileBasedRouting(basePath("app/pages"))` to
the app builder. Full details in [Routing](/docs/routing).

## Controllers

Controllers are plain classes; the action receives the request `HttpContext` and
dependencies resolve from the container:

```ts fragment
// app/controllers/PostController.ts
import type { HttpContext } from "zerotal";
import Post from "../models/Post.ts";
import { StorePostRequest } from "../requests/StorePostRequest.ts";

export default class PostController {
  async index(ctx: HttpContext) {
    const posts = await Post.query()
      .where("published", true)
      .with(["author", "tags"])
      .orderBy("created_at", "desc")
      .paginate(1, 20); // (page, perPage)
    return ctx.json(posts);
  }

  async store(ctx: HttpContext) {
    const data = await StorePostRequest.validate(); // reads the current HttpContext
    const post = await Post.create(data);
    return ctx.json(post, 201);
  }
}
```

Read route params and model bindings from `ctx.params`; type them with the generic,
e.g. `ctx: HttpContext<{ post: Post }>`. More in [Controllers](/docs/controllers) and
[Context](/docs/context).

## Models, queries, and migrations

Active Record–style models backed by `Bun.sql`. Columns and relationships are
decorators; the table name is derived by convention (so `@table` is optional):

```ts fragment
// app/models/Post.ts
import { Model, table, column, hasMany, belongsTo } from "@zerotal/orm";
import type { Carbon } from "@zerotal/core/carbon";

@table("posts")
export default class Post extends Model {
  @column() declare id: number;
  @column() declare title: string;
  @column("text") declare body: string;
  @column("boolean") declare published: boolean;
  @column("datetime") declare createdAt: Carbon;

  @hasMany(() => Comment) declare comments: Comment[];
  @belongsTo(() => User) declare author: User;

  // Reusable query scope
  static published = Model.scope((q) => q.where("published", true));
}
```

The fluent query builder and relationship loading:

```ts fragment
// in a controller or service
const posts = await Post.query()
  .withScopes((s) => s.published())
  .with(["author", "comments"])
  .orderBy("created_at", "desc")
  .limit(20)
  .get();

const post = await Post.find(1);
await post.load(["comments"]);

const created = await Post.create({ title: "Hello", body: "..." });
created.fill({ published: true });
await created.save();
```

Schema changes are TypeScript migration classes under `database/migrations/`, run with
`bun zt migrate`:

```ts
// database/migrations/001_create_posts_table.ts
import { Migration, Schema } from "@zerotal/orm";

export default class CreatePostsTable extends Migration {
  async up() {
    await Schema.create("posts", (table) => {
      table.increments("id");
      table.integer("user_id").index();
      table.string("title");
      table.text("body");
      table.boolean("published").default(false);
      table.timestamps();
    });
  }

  async down() {
    await Schema.drop("posts");
  }
}
```

Go deeper: [ORM](/docs/orm), [Query Builder](/docs/query-builder),
[Relationships](/docs/orm/relationships), [Migrations](/docs/migrations).

## Validation

Validation is class-based via `FormRequest` with a fluent `RuleBuilder`, so a
controller trusts its data by the time it runs:

```ts
// app/requests/StorePostRequest.ts
import { FormRequest, type RuleBuilder } from "@zerotal/validator";

export class StorePostRequest extends FormRequest {
  // Don't annotate the return type — it's inferred, which types the result of validate()
  rules(r: RuleBuilder) {
    return {
      title: r.string().min(3).max(255),
      body: r.string().min(10),
      tags: r.array(r.string()).optional(),
    };
  }
}
```

```ts fragment
// in a controller — reads the current HttpContext, returns typed data,
// throws a 422 (JSON) or a redirect-back on failure.
const data = await StorePostRequest.validate();
```

More rules and patterns in [Validation](/docs/validator).

## Authentication and authorization

Session auth, bearer tokens, and policy-based authorization ship together:

```ts fragment
// in a controller / service
import { Auth, Gate, createToken } from "@zerotal/auth";

// Login
await Auth.attempt({ email, password });

// Current user (guest-safe; undefined when not logged in)
const user = Auth.userOrNull();
if (!user) return ctx.redirect("/login");

// Bearer token (API) — `plaintext` is shown once
const { plaintext, row } = await createToken({ tokenableId: user.id, name: "mobile-app" });

// Authorization is policy-based
Gate.authorize("update", post); // throws 403 unless the policy allows it
// Gate.via(PostPolicy).allows("update", post); // check without throwing
```

Password reset, email verification, roles, 2FA (TOTP/WebAuthn), and OAuth are all
included. See [Authentication](/docs/authentication),
[Authorization](/docs/authorization), and [Roles & 2FA](/docs/roles-and-2fa).

## Pick your frontend

Zerotal ships three rendering models; choose per route, or mix them in one app.

### Server-rendered JSX views

Plain server-side JSX — the simplest option for content pages. See
[Views](/docs/view).

### Flow — reactive SSR

Flow is Zerotal's reactive layer. `Component` classes run **entirely on the server**;
you write plain JSX and bind handlers directly. On each interaction the server
re-runs the method, re-renders, and streams only the changed HTML back, which Alpine.js
morphs into the DOM — no client state management, no separate API.

```tsx
import { Component, expose, validate } from "@zerotal/flow";

export class CounterPage extends Component {
  @expose count = 0;
  @expose @validate((rule) => rule.required().min(2)) name = "";

  @expose increment() {
    this.count++;
  }

  override async render() {
    return (
      <div>
        <input value={this.name} live placeholder="Your name" />
        <span error={this.errors.name} class="text-red-500" />

        <p>Count: {this.count}</p>

        {/* Server action — round-trips and re-renders */}
        <button onClick={this.increment} loadingAttr="disabled">
          +
        </button>

        {/* Client expression — instant, no round-trip */}
        <button onClick={() => this.count--}>−</button>
      </div>
    );
  }
}
```

A named method reference (`onClick={this.increment}`) is a **server action** — it
round-trips. An arrow function (`onClick={() => this.count--}`) is a **client
expression** — instant, no round-trip. Register `FlowProvider`, route with
`Router.flow("/counter", CounterPage)`, and read [Flow](/docs/flow) for the full
decorator and directive set.

### Inertia — React / Vue SPA

Build a React or Vue SPA with no separate API layer. Controllers return page
responses; the Inertia client renders the matching component:

```ts fragment
// app/controllers/DashboardController.ts
import { inertia } from "@zerotal/inertia";
import { Post } from "../models/Post.ts";

export class DashboardController {
  async index(): Promise<void> {
    const posts = await Post.query().latest().limit(5).get();
    return inertia("Dashboard", { posts }); // → resources/js/pages/Dashboard.tsx
  }
}
```

```tsx fragment
// resources/js/pages/Dashboard.tsx (React)
import { Link } from "@inertiajs/react";

export default function Dashboard({ posts }: { posts: { id: number; title: string }[] }) {
  return (
    <ul>
      {posts.map((p) => (
        <li key={p.id}>
          <Link href={`/posts/${p.id}`}>{p.title}</Link>
        </li>
      ))}
    </ul>
  );
}
```

Register `InertiaProvider` and you get full Inertia v3 support — shared props, partial
reloads, deferred props, SSR, and precognition. See [Inertia](/docs/inertia).

> **Tip** — Server views for static content, **Flow** when you want rich
> interactivity but want to stay in TypeScript on the server, and **Inertia** when
> your team already lives in React/Vue.

## Background work: queue and jobs

Push slow work off the request. Jobs serialize to a plain payload so they survive the
queue:

```ts fragment
// app/jobs/SendWelcomeEmail.ts
import { Job, JobRegistry } from "@zerotal/queue";
import { User } from "../models/User.ts";
import { WelcomeNotification } from "../notifications/WelcomeNotification.ts";

export class SendWelcomeEmail extends Job {
  override readonly maxAttempts = 3;
  override readonly retryDelay = 5000; // ms

  constructor(public readonly userId: number) {
    super();
  }

  payload(): Record<string, unknown> {
    return { userId: this.userId };
  }
  static fromPayload(p: Record<string, unknown>) {
    return new SendWelcomeEmail(p.userId as number);
  }

  async handle() {
    const user = await User.find(this.userId);
    await user.notify(new WelcomeNotification());
  }
}

JobRegistry.register(SendWelcomeEmail);
```

```ts fragment
// dispatch from anywhere
import { Queue, Bus } from "@zerotal/queue";

await Queue.dispatch(new SendWelcomeEmail(user.id));

// Batch — run in parallel, then a completion job
await Bus.batch([new ProcessImage(id), new GenerateThumbnail(id)])
  .then(new NotifyUploadComplete(id))
  .dispatch();
```

Run a worker with `bun zt queue:work`. There's also a
[scheduler](/docs/scheduler) for cron-style tasks. More in [Queue](/docs/queue).

## Cache

```ts fragment
// in a controller or service
import { Cache } from "@zerotal/cache";

const posts = await Cache.remember("posts.recent", 60, () =>
  Post.query().orderBy("created_at", "desc").limit(10).get(),
);

await Cache.set("key", value, 300);
await Cache.forget("key");

// Tag-based invalidation
await Cache.tags(["posts"]).put("post:1", post, 600);
await Cache.tags(["posts"]).flush();
```

In-memory and Redis drivers, plus idempotency helpers. See [Cache](/docs/cache).

## Notifications and mail

One `Notification` class fans out across channels — mail, database, broadcast, Slack,
SMS:

```ts fragment
// app/notifications/InvoicePaid.ts
import { Notification, MailMessage } from "@zerotal/notifications";

export class InvoicePaid extends Notification {
  constructor(private invoice: Invoice) {
    super();
  }

  via(user: User) {
    return ["mail", "database"];
  }

  toMail(user: User) {
    return new MailMessage()
      .subject("Invoice paid")
      .line(`Your invoice #${this.invoice.id} has been paid.`);
  }
}
```

```ts fragment
// The User model mixes in Notifiable, which provides .notify()
await user.notify(new InvoicePaid(invoice));
```

See [Notifications](/docs/notifications) (mail lives here too).

## Configuration and environment

Config lives in typed files under `config/` (auto-loaded), reading from `.env`:

```ini
# .env
APP_ENV=development
APP_KEY=base64:…              # signs Flow snapshots, encrypts sessions
DATABASE_URL=./storage/db.sqlite   # or postgres://…  /  mysql://…
SESSION_DRIVER=cookie         # or redis
```

| Variable         | Required | Description                                                  |
| ---------------- | -------- | ------------------------------------------------------------ |
| `APP_KEY`        | Yes      | 32-byte secret — signs Flow snapshots, encrypts sessions     |
| `DATABASE_URL`   | Yes      | `postgres://…`, `mysql://…`, or `sqlite:./storage/db.sqlite` |
| `APP_ENV`        | No       | `development` (default) or `production`                      |
| `APP_URL`        | No       | Full base URL (used in mail links, etc.)                     |
| `SESSION_DRIVER` | No       | `cookie` (default) or `redis`                                |
| `MAIL_DRIVER`    | No       | `smtp`, `resend`, or `log`                                   |
| `PORT`           | No       | HTTP server port (default `3000`)                            |

Generate or rotate the key with `bun zt key:generate`. Full system in
[Configuration](/docs/config-system).

## Testing

First-class HTTP, database, and fake helpers:

```ts fragment
// tests/posts.test.ts
import { createTestApp, Factory, assertDatabaseHas } from "@zerotal/testing";
import { NotificationFake } from "@zerotal/notifications";
import app from "../bootstrap/app.ts";
import { User } from "../app/models/User.ts";

const UserFactory = Factory.define(User, (f) => ({
  name: f.string(10),
  email: f.email(),
  password: "password",
}));

const testApp = await createTestApp(() => app);
const user = await UserFactory.create();

const res = await testApp.actingAs(user).get("/posts");
res.assertOk();

// Fake notifications (mail is a channel)
const fake = NotificationFake.install();
await testApp.post("/register", { email: "alice@example.com" });
await assertDatabaseHas("users", { email: "alice@example.com" });
fake.assertSentTo(user, WelcomeNotification);
fake.restore();

await testApp.close();
```

Run with `bun test`. More in [Testing](/docs/testing).

## The zt CLI

Everything runs through `zt.ts`. The essentials:

```bash
# in your project root
bun zt make:model Post --migration   # model + migration
bun zt make:controller PostController
bun zt make:provider AppServiceProvider
bun zt make:job SendWelcomeEmail
bun zt make:page Dashboard           # Inertia page
bun zt migrate                       # run pending migrations
bun zt migrate:rollback              # roll back last batch
bun zt migrate:fresh                 # drop all + re-migrate
bun zt key:generate                  # fresh APP_KEY
bun zt queue:work                    # start the queue worker
bun zt dev                           # dev server, hot reload (also `bun run dev`)
bun zt list                          # every available command
```

More in [Commands](/docs/commands).

## What's in the box

Zerotal is a monorepo of composable `@zerotal/*` packages — register only what you
need:

| Area                | Packages / features                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HTTP core**       | Container, router, middleware, events, config, facades, JSX views (`@zerotal/core`)                                                                                                 |
| **Data**            | ORM, migrations, query builder, [validation](/docs/validator)                                                                                                                       |
| **Auth & security** | [Sessions](/docs/session), [auth](/docs/authentication), tokens, [policies](/docs/authorization), [roles & 2FA](/docs/roles-and-2fa), WebAuthn, OAuth, [CSRF](/docs/csrf)           |
| **Frontend**        | Flow, flow-ui component library, Inertia                                                                                                                                            |
| **Services**        | [Cache](/docs/cache), [queue](/docs/queue), [scheduler](/docs/scheduler), [storage](/docs/storage), [broadcasting](/docs/broadcasting), [notifications & mail](/docs/notifications) |
| **Cross-cutting**   | [Telemetry](/docs/telemetry), [HTTP client](/docs/client), [i18n](/docs/i18n), [tenancy](/docs/tenancy), [audit](/docs/audit), [monitor](/docs/monitor)                             |
| **Tooling**         | Admin panel, devtools, [testing](/docs/testing) helpers, `create-zerotal` scaffolder                                                                                                |

The [README](../README.md) has a package-by-package table with links.

## Working in the codebase

- **The `zt` CLI is your control panel.** `bun zt list` shows everything —
  scaffolding, migrations, the dev server, the worker, and tests all run through it.
- **No build, ever.** `bun zt dev` / `bun test` / `bun run typecheck`. No compile
  step to remember.
- **Starters are the fastest way in.** `bun create zerotal my-app` scaffolds a working
  app from one of six starters — `api`, `admin`, `flow`, `react`, `vue`, or `minimal`.
  Read the generated code alongside the docs.
- **Conventions are documented, not magic.** When something "just works" (a model you
  never registered, a policy suddenly enforced), [Conventions](/docs/conventions)
  explains exactly what the framework discovered and why.

## Next steps

- [Getting Started](/docs/getting-started) — scaffold and run your first app.
- [Directory Structure](/docs/structure) & [Conventions](/docs/conventions) — where things go and why they wire up.
- [Request Lifecycle](/docs/lifecycle), [Container](/docs/container), [Providers](/docs/providers) — how boot and wiring work.
- [ORM](/docs/orm) & [Query Builder](/docs/query-builder) — the data layer in depth.
- [Flow](/docs/flow) / [Inertia](/docs/inertia) — pick and learn your frontend model.
