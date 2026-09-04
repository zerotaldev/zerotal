# Zerotal

> **Zero to total.** The batteries-included full-stack framework for Bun.

Zerotal (ZEE-ro-tal) is a full-stack web framework built entirely on Bun. Where the JavaScript ecosystem offers fast routers and asks you to assemble the rest, Zerotal ships the whole application layer: a decorator-based ORM with relations, factories and migrations; authentication with pluggable guards, policies and permissions; sessions, CSRF and security headers; validation; queues, caching and scheduling; i18n, notifications, broadcasting, telemetry and multi-tenancy; **Flow**, a server-driven UI layer that streams rendered patches over a WebSocket so there is no API to maintain; an Inertia adapter for React and Vue SPAs; and a CLI that scaffolds, migrates, seeds and serves.

Everything is TypeScript, typed end-to-end, and nothing needs configuring. Zerotal takes the conventions that made full-stack frameworks productive for a decade and rebuilds them on a runtime where TypeScript is the only language you need. Install the stable set in one dependency (`bun add zerotal`), or pull in only the `@zerotal/*` packages you need — every package works together through a typed IoC container, a service-provider bootstrap, and a convention-driven directory layout.

> **Runtime requirement:** Bun ≥ 1.3.14 — the floor CI actually tests. Node.js is not supported — Zerotal uses `Bun.sql`, `Bun.CryptoHasher`, `Bun.build`, and other Bun-native APIs throughout. See the [Support Policy](docs/support-policy.md) for the runtime and database matrix.

---

## Distribution: packages ship as TypeScript source

Every `@zerotal/*` package is **published as TypeScript source — there is no build step and no compiled `dist/`**. Each package's `exports`, `main`, and `types` point directly at `./src/*.ts`, and the npm tarball contains the `src` tree (tests excluded).

This is a deliberate choice, not an oversight:

- Zerotal only runs on **Bun**, which executes and type-strips `.ts` files natively — there is nothing to compile for the runtime.
- You always get readable source and accurate types, with no source-map indirection.

**What this means for you as a consumer:**

- **Use Bun** to run your application (`bun run …`). Importing `@zerotal/*` from a plain Node.js process is not supported.
- If you type-check or bundle your app, your tooling will read Zerotal's `.ts` source directly. That's expected — it's a TS-aware toolchain (Bun, or a bundler/`tsc` that understands TypeScript). No `.d.ts` files are shipped because the source _is_ the types.

If you need conventional compiled output (`dist` + `.d.ts`) for a non-Bun toolchain, that would require adding a build step — it is **not** how Zerotal is shipped today.

---

## Quick start

```bash
bun create zerotal my-app
cd my-app
bun install
cp .env.example .env       # then set DATABASE_URL if not using the default SQLite file
bun zt key:generate       # generates APP_KEY into .env
bun zt migrate            # create the database schema
bun zt dev                # start the dev server, with hot reload
```

---

## Packages

Each package has its own README with installation, setup, and usage examples — follow the links below.

### Foundation

| Package                                    | Description                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@zerotal/core`](packages/core)           | IoC container, Application lifecycle, Router, HTTP pipeline, middleware, events, config, facades, JSX server views. Bundles three primitives as subpaths: distributed locks ([`@zerotal/core/lock`](docs/lock.md)), structured logging ([`@zerotal/core/logger`](docs/logger.md)), and file storage ([`@zerotal/core/storage`](docs/storage.md)) |
| [`@zerotal/orm`](packages/orm)             | Active Record ORM on `Bun.sql` — models, migrations, QueryBuilder, relationships, soft deletes                                                                                                                                                                                                                                                   |
| [`@zerotal/media`](packages/media)         | Attach files to models — media collections, image conversions, responsive images, and ordering, on any Zerotal storage disk                                                                                                                                                                                                                      |
| [`@zerotal/validator`](packages/validator) | `FormRequest` class-based validation with a fluent `RuleBuilder`                                                                                                                                                                                                                                                                                 |
| [`@zerotal/session`](packages/session)     | Cookie and Redis session drivers, CSRF protection, cookies                                                                                                                                                                                                                                                                                       |
| [`@zerotal/auth`](packages/auth)           | Session auth, bearer tokens, Gate / policy authorization, password reset, roles & 2FA, WebAuthn, social / OAuth login (GitHub, Google, Apple)                                                                                                                                                                                                    |

### Frontend & rendering

| Package                                | Description                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [`@zerotal/flow`](packages/flow)       | Reactive SSR over WebSocket — server-side `Component` classes, streamed HTML diffs, Alpine morph |
| [`@zerotal/flow-ui`](packages/flow-ui) | Themeable, shadcn-style component library built on Flow primitives                               |
| [`@zerotal/inertia`](packages/inertia) | Inertia.js adapter for React / Vue SPAs without a separate API                                   |

### Services & infrastructure

| Package                                            | Description                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [`@zerotal/cache`](packages/cache)                 | `Cache` facade — in-memory and Redis drivers, tags, TTL, idempotency                                            |
| [`@zerotal/queue`](packages/queue)                 | In-process job queue with `WorkerPool`, retry, batches, and scheduled dispatch                                  |
| [`@zerotal/scheduler`](packages/scheduler)         | Cron-style task scheduling                                                                                      |
| [`@zerotal/broadcasting`](packages/broadcasting)   | Real-time WebSocket broadcasting, Pusher-compatible channels, Redis driver                                      |
| [`@zerotal/notifications`](packages/notifications) | Multi-channel notifications — **mail** (SMTP/Resend), database, broadcast, Slack, SMS. `MailMessage` lives here |

### Cross-cutting

| Package                                    | Description                                                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@zerotal/telemetry`](packages/telemetry) | OpenTelemetry-style distributed tracing and spans; bridges `FrameworkEvents` to OTLP                                                                                        |
| [`@zerotal/client`](packages/client)       | Type-safe **frontend/SPA** API client (route-map typed) with circuit breaker. For **server-to-server** outgoing requests use core's `Http` facade instead                   |
| [`@zerotal/i18n`](packages/i18n)           | Internationalization and localization                                                                                                                                       |
| [`@zerotal/tenancy`](packages/tenancy)     | Multi-tenancy                                                                                                                                                               |
| [`@zerotal/audit`](packages/audit)         | Audit logging / activity log                                                                                                                                                |
| [`@zerotal/monitor`](packages/monitor)     | Health checks, metrics, and an application monitoring dashboard                                                                                                             |
| [`@zerotal/ai`](packages/ai)               | **Experimental** ([maturity](docs/support-policy.md#maturity-levels)) — provider-agnostic AI generation: text, streaming, structured output, typed tools, and an agent loop |

### Tooling

| Package                                     | Description                                                                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@zerotal/admin`](packages/admin)          | Admin panel with resource management and field types                                                                                                     |
| [`@zerotal/devtools`](packages/devtools)    | Development tools panel, request tracing                                                                                                                 |
| [`@zerotal/arch`](packages/arch)            | **Beta** ([maturity](docs/support-policy.md#maturity-levels)) — agent surface: an MCP server exposing the API surface, routes, schema, docs and `doctor` |
| [`@zerotal/testing`](packages/testing)      | Test helpers, model factories, fakes, database utilities                                                                                                 |
| [`create-zerotal`](packages/create-zerotal) | `bun create zerotal` scaffolding CLI                                                                                                                     |

---

## Project structure

```
my-app/
├── app/
│   ├── controllers/        # HTTP controllers
│   ├── models/             # ORM models
│   ├── middleware/         # Custom middleware
│   ├── policies/           # Authorization policies
│   ├── jobs/               # Queue jobs
│   ├── mail/               # Mailable classes
│   ├── events/             # Event handlers
│   ├── observers/          # Model observers
│   └── flow/             # Flow reactive SSR components (*.tsx)
├── bootstrap/
│   ├── app.ts              # Application entry point
│   └── providers.ts        # Service provider registration
├── config/                 # app.ts, db.ts, cache.ts, queue.ts, mail.ts, …
├── database/
│   └── migrations/         # TypeScript migration classes (Schema builder)
├── public/                 # Static assets
├── routes/
│   └── index.ts            # Route definitions
├── storage/                # Uploaded files, logs, SQLite database
└── .env
```

---

## Bootstrap

```ts
// bootstrap/app.ts
import { Application } from "@zerotal/core";
import { Handler } from "../app/exceptions/Handler.ts";
import { User } from "../app/models/User.ts";
import providers from "./providers.ts";

export default Application.create(providers)
  .withExceptionHandler(Handler)
  .withUserResolver((id) => User.find(id));
```

Providers are registered in `bootstrap/providers.ts` and declare which packages are active in the application. The CLI (`bun zt serve`) boots this app and loads the convention-based `app/`, `config/`, and `routes/` layout. Apps that prefer file-based routing add `.fileBasedRouting(basePath("app/pages"))` to the builder.

---

## Routing & Controllers

Routes are registered by calling static `Router` methods at module load. A route maps a path to either a controller class + action name, or an inline closure handler:

```ts
// routes/index.ts
import { Router, view, type HttpContext } from "@zerotal/core";
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

Controllers are plain classes — dependencies are resolved from the IoC container:

```ts
// app/controllers/PostController.ts
import type { HttpContext } from "@zerotal/core";
import Post from "../models/Post.ts";

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

---

## ORM

Active Record–style models backed by `Bun.sql`:

```ts
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

  // Reusable query scope (defined with Model.scope, not a decorator)
  static published = Model.scope((q) => q.where("published", true));
}
```

```ts
// Fluent query builder
const posts = await Post.query()
  .withScopes((s) => s.published())
  .with(["author", "comments"])
  .orderBy("created_at", "desc")
  .limit(20)
  .get();

// Filtering happens in SQL — the builder is wide enough that you should rarely
// load a table and filter it in JavaScript
const results = await Post.query()
  .whereIn("author_id", editorIds)
  .whereNotNull("published_at")
  .whereBetween("views", [100, 1000])
  .whereLike("title", "%release%")
  .whereYear("published_at", 2026)
  .whereHas("comments", (q) => q.where("approved", true))
  .whereDoesntHave("flags")
  .orWhere("pinned", true)
  .paginate(20, page);

const total = await Post.query().where("published", true).count();

// Relationships
const post = await Post.find(1);
await post.load(["comments"]);

// Create / update
const created = await Post.create({ title: "Hello", body: "..." });
created.fill({ published: true });
await created.save();
```

Every one of those has an `orWhere*` counterpart, and there are more —
`whereJson`, `whereExists`, `whereRelation`, `whereMonth`, chunking, streaming
and cursor pagination. See **[Queries](https://zerotal.dev/docs/orm/queries)**
for the full surface; it is worth ten minutes before writing your first
repository method.

Migrations live in `database/migrations/` as TypeScript classes built with the `Schema` builder, and run with `bun zt migrate`:

```ts
// database/migrations/001_create_posts_table.ts
import { Schema } from "@zerotal/orm";

export default class CreatePostsTable {
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

---

## Flow — Reactive SSR over WebSocket

Flow is Zerotal's reactive full-stack layer. **`Component`** classes run entirely on the server. You write plain JSX and bind handlers directly (`onClick={this.save}`); on every interaction the server hydrates the component from a signed snapshot, re-runs the method, re-renders, and streams only the changed HTML back, which Alpine.js morphs into the DOM. No client-side state management, no separate API, no hand-written client reactivity.

### How it works

1. **Initial GET** — the component renders to HTML; an HMAC-signed snapshot of its state is embedded in the page.
2. **WebSocket upgrade** — the client opens a persistent WS connection.
3. **Interaction** — the client sends the snapshot + the action to invoke (plus any client-written values).
4. **Server** — verifies the signature, hydrates the component, runs the action, re-renders, and diffs the output.
5. **DOM morph** — only the changed patches stream back and Alpine.js morphs them in; a fresh snapshot ships with each patch.

A named method reference (`onClick={this.save}`) is a **server action** — it round-trips and re-renders. An arrow function (`onClick={() => this.count++}`) is a **client expression** — it updates the DOM instantly with no round-trip.

### Component class

```tsx
/** @jsxImportSource @zerotal/flow */
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

Bindings the compiler understands directly: `value={this.x}` / `checked={this.x}` (two-way for `@expose`, read-only for `@locked`), `error={this.errors.field}`, reactive `class`/`style`/`href`, plus interaction props such as `live`, `blur`, `loadingAttr`, `show`, `confirm`, `navigate`, and `poll`. There is no `pulse()`/`flow()` wrapper — the compiler reads each prop and emits the right directive.

### Key decorators

| Decorator           | Description                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `@expose`           | Two-way contract with the browser — syncs a property both ways, or makes a method callable over the WebSocket. |
| `@locked`           | Pushed to the client for display only; the client cannot mutate it.                                            |
| `@computed`         | Getter derived from other state; memoized per render, not stored.                                              |
| `@transient`        | Excluded from the snapshot; reset to default on every round-trip.                                              |
| `@validate(r => …)` | Attaches validation rules to a property (fluent `RuleBuilder` callback), surfaced via `this.errors`.           |
| `@url` / `@session` | Sync a property to the URL query string / persist it in the HTTP session.                                      |
| `@renderless`       | An exposed method that runs but skips the re-render (downloads, side-effects).                                 |
| `@on("event")`      | Listen for cross-component events and real-time broadcasts.                                                    |

### Routing

```ts
import { Router } from "@zerotal/core";
import { CounterPage } from "../app/flow/CounterPage.tsx";

Router.flow("/counter", CounterPage);
```

Register `FlowProvider` in `bootstrap/providers.ts` to mount the WebSocket handler and inject the client runtime. See the **[`@zerotal/flow` README](packages/flow)** and the [Flow docs](docs/flow/index.md) for the full API — lifecycle hooks, islands/composition, forms, file uploads, and the built-in component library.

### Security model

- **HMAC snapshot signing** — every snapshot is signed with `APP_KEY`; tampered payloads are rejected before hydration.
- **`@expose` / `@locked` allowlist** — only allowlisted properties can be read or mutated from a client frame.
- **Constant-time verification** — prevents signature timing attacks.
- **Persistent middleware** — auth and session middleware re-run on every WebSocket action, not only the initial HTTP request.

---

## Authentication & Authorization

```ts
import { Auth, Gate, createToken } from "@zerotal/auth";

// Login
await Auth.attempt({ email, password });

// Bearer token (API) — issue a personal access token; `plaintext` is shown once
const { plaintext, row } = await createToken({ tokenableId: user.id, name: "mobile-app" });

// In a controller / middleware — current user (guest-safe; undefined when not logged in)
const user = Auth.userOrNull();
if (!user) return response.redirect("/login");

// Authorization is policy-based — register a PostPolicy, then:
Gate.authorize("update", post); // throws 403 unless the policy allows it
// Gate.via(PostPolicy).allows("update", post); // check without throwing
```

Password reset, email verification, and policy classes are also included.

---

## Validation

```ts
import { FormRequest, type RuleBuilder } from "@zerotal/validator";

export class StorePostRequest extends FormRequest {
  // The RuleBuilder `r` is passed in; do not annotate the return type — it is inferred
  rules(r: RuleBuilder) {
    return {
      title: r.string().min(3).max(255),
      body: r.string().min(10),
      tags: r.array(r.string()).optional(),
    };
  }
}

// Call validate() as a static method — it reads the current HttpContext and
// returns strongly-typed data; throws a 422 (JSON) or redirect on failure.
const data = await StorePostRequest.validate();
```

---

## Queue & Jobs

```ts
import { Job, JobRegistry, Queue, Bus } from "@zerotal/queue";

export class SendWelcomeEmail extends Job {
  override readonly maxAttempts = 3;
  override readonly retryDelay = 5000; // ms

  constructor(public readonly userId: number) {
    super();
  }

  // Jobs serialize to/from a plain payload so they survive the queue
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

// Dispatch
await Queue.dispatch(new SendWelcomeEmail(user.id));

// Batch — run in parallel, then a completion job
await Bus.batch([new ProcessImage(imageId), new GenerateThumbnail(imageId)])
  .then(new NotifyUploadComplete(imageId))
  .dispatch();
```

Run a worker with `bun zt worker`.

---

## Cache

```ts
import { Cache } from "@zerotal/cache";

const posts = await Cache.remember("posts.recent", 60, () =>
  Post.query().orderBy("created_at", "desc").limit(10).get(),
);

await Cache.put("key", value, 300);
await Cache.forget("key");

// Tag-based invalidation
await Cache.tags(["posts"]).put("post:1", post, 600);
await Cache.tags(["posts"]).flush();
```

---

## Notifications

```ts
import { Notification, MailMessage } from "@zerotal/notifications";

export class InvoicePaid extends Notification {
  via(user: User) {
    return ["mail", "database"];
  }

  toMail(user: User) {
    return new MailMessage()
      .subject("Invoice paid")
      .line(`Your invoice #${this.invoice.id} has been paid.`);
  }
}

// The User model mixes in Notifiable (WithNotifications), which provides .notify()
await user.notify(new InvoicePaid(invoice));
```

Channels: mail, database, broadcast, Slack, SMS.

---

## Telemetry

```ts
import { withSpan } from "@zerotal/telemetry";

const result = await withSpan("db.query.posts", async (span) => {
  span.setAttribute("db.table", "posts");
  return Post.query().get();
});
```

OpenTelemetry-compatible exporters can be plugged in via the provider.

---

## Inertia (SPA mode)

For teams that prefer React or Vue on the frontend:

```ts
// Controller / route handler
import { Inertia } from "@zerotal/inertia";

async index() {
  return Inertia.render("Posts/Index", {
    posts: await Post.query().withScopes((s) => s.published()).get(),
  });
}
```

```tsx
// resources/js/Pages/Posts/Index.tsx (React)
export default function Index({ posts }: { posts: Post[] }) {
  return (
    <ul>
      {posts.map((p) => (
        <li key={p.id}>{p.title}</li>
      ))}
    </ul>
  );
}
```

Shared props, SSR, partial reloads, and `Link` navigation are all supported.

---

## Testing

```ts
import { createTestApp, Factory, assertDatabaseHas } from "@zerotal/testing";
import { NotificationFake } from "@zerotal/notifications";
import app from "../bootstrap/app.ts";
import { User } from "../app/models/User.ts";

// Define a factory once, reuse everywhere
const UserFactory = Factory.define(User, (f) => ({
  name: f.string(10),
  email: f.email(),
  password: "password",
}));

const testApp = await createTestApp(() => app);
const user = await UserFactory.create();

const res = await testApp.actingAs(user).get("/posts");
res.assertOk();

// Fake notifications (mail is a notification channel)
const fake = NotificationFake.install();
await testApp.post("/register", { email: "alice@example.com" });
await assertDatabaseHas("users", { email: "alice@example.com" });
fake.assertSentTo(user, WelcomeNotification);
fake.restore();

await testApp.close();
```

---

## Environment variables

| Variable         | Required  | Description                                                         |
| ---------------- | --------- | ------------------------------------------------------------------- |
| `APP_KEY`        | Yes       | 32-byte secret — signs Flow snapshots, encrypts sessions            |
| `APP_ENV`        | No        | `development` (default) or `production`                             |
| `APP_URL`        | No        | Full base URL (used in mail links, etc.)                            |
| `DATABASE_URL`   | Yes       | `postgres://user:pass@host:5432/db` or `sqlite:./storage/db.sqlite` |
| `SESSION_DRIVER` | No        | `cookie` (default) or `redis`                                       |
| `REDIS_URL`      | If Redis  | `redis://localhost:6379`                                            |
| `MAIL_DRIVER`    | No        | `smtp`, `resend`, or `log`                                          |
| `SMTP_HOST`      | If SMTP   | SMTP server hostname                                                |
| `RESEND_API_KEY` | If Resend | Resend API key                                                      |
| `AWS_*`          | If S3     | `AWS_KEY`, `AWS_SECRET`, `AWS_REGION`, `AWS_BUCKET`                 |
| `PORT`           | No        | HTTP server port (default `3000`)                                   |

Generate `APP_KEY` (writes it into `.env`):

```bash
bun zt key:generate
```

---

## Development

```bash
bun install       # install all workspace dependencies
bun test          # run the full test suite
bun run typecheck # type-check every package
bun zt dev       # start dev server with hot reload
```

> There is no build step — packages ship as source (see [Distribution](#distribution-packages-ship-as-typescript-source)).

### Starting a new app

Scaffold a fresh app with `bun create zerotal my-app` — the starters are `api` (the default), `admin`, `flow`, `react`, `vue`, and `minimal`. The monorepo itself ships no reference applications; `apps/` holds the documentation site only.

---

## Documentation

The full documentation lives in [`docs/`](docs). Start with **[Getting Started](docs/getting-started.md)**, then dive into the area you need.

**Core**

| Guide                                                                | Description                               |
| -------------------------------------------------------------------- | ----------------------------------------- |
| [Getting Started](docs/getting-started.md)                           | Install, project structure, first route   |
| [Project Structure](docs/structure.md)                               | Directory layout and conventions          |
| [Container](docs/container.md)                                       | IoC container, binding, resolution        |
| [Service Providers](docs/providers.md)                               | Registration, boot lifecycle              |
| [Lifecycle](docs/lifecycle.md)                                       | Application boot phases                   |
| [Routing](docs/routing.md)                                           | Route registration, groups, model binding |
| [Controllers](docs/controllers.md)                                   | Controller classes and actions            |
| [Middleware](docs/middleware.md)                                     | HTTP middleware pipeline                  |
| [Requests Context](docs/context.md) / [Responses](docs/responses.md) | HttpContext, request input, responses     |
| [Configuration](docs/config-system.md)                               | Config files, env binding, typed config   |
| [Commands](docs/commands.md)                                         | The `zt` CLI and custom commands          |

**Data**

| Guide                                  | Description                                                   |
| -------------------------------------- | ------------------------------------------------------------- |
| [ORM](docs/orm/index.md)               | Models, casts, relationships, lifecycle                       |
| [Queries](docs/orm/queries.md)         | `Model.query()` — the `where*` surface, scopes, pagination    |
| [Query Builder](docs/query-builder.md) | `DB.table()` — the same fluent API for tables without a model |
| [Migrations](docs/migrations.md)       | Schema builder, running migrations                            |
| [Seeding](docs/seeding.md)             | Database seeders and factories                                |
| [Validation](docs/validator.md)        | FormRequest, RuleBuilder, available rules                     |

**Frontend**

| Guide                            | Description                                       |
| -------------------------------- | ------------------------------------------------- |
| [Flow](docs/flow/index.md)       | Reactive SSR — components, decorators, directives |
| [Inertia](docs/inertia/index.md) | SPA pages, shared props, SSR                      |
| [Views](docs/view.md)            | Server-rendered JSX views                         |

**Auth & security**

| Guide                                      | Description                          |
| ------------------------------------------ | ------------------------------------ |
| [Session](docs/session.md)                 | Session drivers and configuration    |
| [Authentication](docs/authentication.md)   | Login, tokens, guards                |
| [Authorization](docs/authorization.md)     | Gates, policies                      |
| [Roles & 2FA](docs/roles-and-2fa.md)       | Role management, TOTP, WebAuthn      |
| [CSRF](docs/csrf.md)                       | CSRF protection                      |
| [Encryption & Hashing](docs/encryption.md) | Crypt, password hashing, signed URLs |

**Services**

| Guide                                      | Description                                                    |
| ------------------------------------------ | -------------------------------------------------------------- |
| [Queue](docs/queue.md)                     | Jobs, workers, batches, chains                                 |
| [Scheduler](docs/scheduler.md)             | Cron-style task scheduling                                     |
| [Cache](docs/cache.md)                     | Drivers, `remember()`, tags, idempotency                       |
| [Notifications](docs/notifications.md)     | Multi-channel notifications — including **mail** (SMTP/Resend) |
| [Storage](docs/storage.md)                 | Disks, file operations                                         |
| [Broadcasting](docs/broadcasting/index.md) | WebSocket channels, presence, Redis driver                     |
| [HTTP Client](docs/client/index.md)        | ApiClient, circuit breaker                                     |
| [Distributed Lock](docs/lock.md)           | `@zerotal/core/lock`                                           |
| [Logger](docs/logger.md)                   | Channels, drivers, structured logging                          |
| [Telemetry](docs/telemetry.md)             | Tracing, spans, exporters                                      |
| [Monitor](docs/monitor.md)                 | Health checks, metrics, dashboard                              |

**Testing & deployment**

| Guide                                | Description                              |
| ------------------------------------ | ---------------------------------------- |
| [Testing](docs/testing/index.md)     | Test app, factories, fakes, assertions   |
| [Deployment](docs/deployment.md)     | Production config, environment variables |
| [Conventions](docs/conventions.md)   | Framework conventions and patterns       |
| [Upgrade Guide](docs/upgrade.md)     | Version upgrade notes                    |
| [Contributing](docs/contributing.md) | Development workflow                     |
