---
title: Conventions
description: How Zerotal auto-discovers and wires your app/* classes at boot, with no manual register() calls.
---

# Conventions

Zerotal auto-discovers and wires your app classes by **convention** at boot — drop a file in the
right `app/*` directory and it just works, no manual `register()` calls. This covers providers,
middleware, services, models, observers, policies, event listeners, events, jobs, schedules, and
validators, plus optional auto-migration.

## Mental model

Each kind of class lives in a well-known directory; a **concern descriptor** knows how to scan
that directory and register what it finds. Core owns a few concerns (events, services, listeners,
jobs, validators); packages contribute the rest (`models`/`observers` from ORM, `policies` from
auth, `schedules` from scheduler) via `app.registerConcern(...)`, so core depends on neither ORM
nor auth.

Discovery happens at three points in the boot sequence, each ordered so later steps can rely on
earlier ones:

```text
# boot timeline (left → right)

app/providers/*    →   register → boot phases   →   app/middleware/*   →   convention phase
(before register,      (your explicit + the         (before routes        (everything else,
 full lifecycle)        discovered providers)         load)                 concerns by order)
```

- **Providers** are discovered _before_ the register phase, so they run their full lifecycle.
- **Middleware** is discovered _before_ routes load, so routes can reference it by name.
- Everything else runs in the **convention phase**, after all providers have booted, with each
  concern sorted by its `order` (lower runs first).

> **Note** — In development and tests Zerotal scans the filesystem. You can disable discovery or
> override any path via [config](#configuration); a generated manifest can replace runtime scanning
> in production.

## Models — app/models/

Every `Model` subclass under `app/models/` is registered automatically:

```typescript
// app/models/User.ts
import { Model, column, hasMany } from "@zerotal/orm";
import { Post } from "./Post.ts";

export class User extends Model {
  @column() name!: string;
  @column() email!: string;
  @hasMany(() => Post, { foreignKey: "user_id" }) posts!: Post[];
}
```

No `@table` needed. The table name is derived by convention — `pluralize(snake(ClassName))`:

| Class      | Table        |
| ---------- | ------------ |
| `User`     | `users`      |
| `BlogPost` | `blog_posts` |
| `Category` | `categories` |
| `Person`   | `people`     |

Override the name (or set timestamps/soft-deletes) with `@table` whenever you need to:

```typescript
// app/models/Account.ts
@table("legacy_accounts", { softDeletes: true })
export class Account extends Model {
  /* … */
}
```

> **Warning** — Use real fields for convention models. Declare columns as `@column() name!: string`, not
> `@column() declare name: string`. The loader identifies a class's columns from a probe
> instance's own fields, and `declare` fields are erased at runtime. (With an explicit `@table`,
> either form works.)
>
> Models that ship **inside packages** (not under an app's `app/models/`) and models defined
> **inline in tests** are not auto-discovered — they keep using `@table`.

## Observers — app/observers/

`XObserver` is attached to model `X` automatically (the `Observer` suffix is stripped and matched
against the discovered models):

```typescript
// app/observers/UserObserver.ts
import type { ModelObserver } from "@zerotal/orm";
import type { User } from "../models/User.ts";

export class UserObserver implements ModelObserver<User> {
  creating(user: User) {
    user.uuid = crypto.randomUUID();
  }
  created(user: User) {
    /* … */
  }
}
```

Override the target with `static model = SomeModel` when the name doesn't match.

## Policies — app/policies/

`XPolicy` is registered with the Gate for model `X`:

```typescript
// app/policies/PostPolicy.ts
import { Policy } from "@zerotal/auth";
import type { Post } from "../models/Post.ts";
import type { User } from "../models/User.ts";

export class PostPolicy extends Policy<Post> {
  update(user: User, post: Post) {
    return post.userId === user.id;
  }
  delete(user: User, post: Post) {
    return post.userId === user.id;
  }
}
```

Authorization (`Gate.allows("update", post)`, `ctx.authorize(...)`) resolves the policy from the
model's class automatically. Override the target with `static model = Post`.

## Events & listeners — app/events/, app/listeners/

A listener declares the event(s) it handles via `static listens`:

```typescript
// app/events/UserRegistered.ts
export class UserRegistered {
  constructor(public user: User) {}
}
```

```typescript
// app/listeners/SendWelcomeEmail.ts
import { UserRegistered } from "../events/UserRegistered.ts";

export class SendWelcomeEmail {
  static listens = UserRegistered; // or an array: [UserRegistered, ...]
  async handle(e: UserRegistered) {
    await Mail.send(new WelcomeMail(e.user));
  }
}
```

The loader binds each listener on the app event bus — no `Emitter.on(...)` wiring. Classes under
`app/events/` need no registration of their own; importing them is the whole effect (it bundles
them and runs any module-level side effects before listeners bind).

## Model events

A model can map its lifecycle events to event classes, which are dispatched on the bus when they
fire — listeners then react with no coupling to the model:

```typescript
// app/models/Order.ts
export class Order extends Model {
  static dispatchesEvents = { created: OrderPlaced, deleted: OrderCancelled };
}
```

Keys are the lifecycle event names: `creating`, `created`, `updating`, `updated`, `saving`,
`saved`, `deleting`, `deleted`, `retrieved`. Each event class is constructed with the model
instance and emitted. Dispatch honours hook suppression, so factory seeding stays silent. If no
event bus is bound (ORM used standalone), it's a safe no-op.

> **Tip** — Observers and `dispatchesEvents` coexist. Use an **observer** to group all lifecycle
> handlers in one class, and **`dispatchesEvents`** for decoupled pub/sub with independent
> listeners.

## Providers — app/providers/

Any `ServiceProvider` under `app/providers/` is registered automatically — you don't list it in
`bootstrap/providers.ts`. Discovered providers run the full lifecycle
(`onRegister` → `onBooting` → `onBooted`), appended **after** the providers you registered
explicitly (so framework providers boot first), and de-duplicated if also listed by hand.

```typescript
// app/providers/AppServiceProvider.ts
import { ServiceProvider } from "zerotal";

export class AppServiceProvider extends ServiceProvider {
  override onRegister() {
    this.app.container.singleton("billing", () => new Billing());
  }
}
```

## Middleware — app/middleware/

Each middleware class under `app/middleware/` is registered as a **named group** under its class
name, so routes can reference it by string without importing it:

```typescript
// app/middleware/EnsureSubscribed.ts
import { BaseMiddleware } from "zerotal";

export class EnsureSubscribed extends BaseMiddleware<{}> {
  async handle(ctx, next) {
    /* … */ return next(ctx);
  }
}
```

```typescript
// routes/web.ts — reference by class name
Router.group({ middleware: ["EnsureSubscribed"] }, () => {
  /* … */
});
```

Middleware is **not** applied globally by default. Opt a class into the global pipeline with
`static global = true`:

```typescript
// app/middleware/RequestId.ts
export class RequestId extends BaseMiddleware<{}> {
  static global = true; // runs on every request
  async handle(ctx, next) {
    /* … */ return next(ctx);
  }
}
```

## Services — app/services/

Service classes under `app/services/` auto-register with the container, so `App.make(MyService)`
resolves them with the lifetime they declare. A class opts into a lifetime with a `static lifetime`
flag:

```typescript
// app/services/UsersService.ts
import { GateService } from "@zerotal/auth";

export class UsersService {
  static lifetime = "singleton"; // "singleton" | "scoped" | "transient"
  constructor(private gate: GateService) {}
}
```

- `singleton` / `scoped` → bound with a factory that auto-wires a fresh instance via
  `container.build()`.
- `transient` or no flag → nothing is registered; the container already auto-wires unregistered
  classes on demand, so resolution still works (a new instance each time). Non-service exports
  (types, helpers) are therefore ignored.

## Jobs — app/jobs/

Queue job classes under `app/jobs/` are imported at boot, which triggers their
`JobRegistry.register()` self-registration — so dispatch works without a manual import or the
generated jobs barrel (the barrel is still used for production workers).

```typescript
// app/jobs/NotifyFollowersJob.ts
import { Job } from "@zerotal/queue";

export class NotifyFollowersJob extends Job {
  override readonly queue = "notifications";
  override readonly maxAttempts = 5;

  constructor(private readonly postId: number) {
    super();
  }

  // Constructor arguments must be serialised to survive the queue.
  override payload(): Record<string, unknown> {
    return { postId: this.postId };
  }

  async handle(): Promise<void> {
    // …
  }
}
```

Dispatch it from anywhere without importing the class into a barrel:

```typescript
// in a controller
await Queue.dispatch(new NotifyFollowersJob(post.id));
```

The registration key is the class name, so two jobs may not share one — see
[Queue](/docs/queue) for the full lifecycle.

## Schedules — app/schedules/

Classes under `app/schedules/` that extend the `Schedule` base class are instantiated and
registered with the scheduler at boot. Each declares its cadence (a `cron` string or the fluent
`frequency()` method) and its work (`handle()`); the loader translates the class's declarative
settings into a scheduled task.

```typescript
// app/schedules/SendDailyReports.ts
import { Schedule } from "@zerotal/scheduler";

export class SendDailyReports extends Schedule {
  cron = "0 8 * * *";
  withoutOverlapping = true;
  async handle() {
    await Queue.dispatch(new SendReportsJob());
  }
}
```

This concern runs in the **worker** environment (to execute tasks) and **console** (so
`schedule:list` can enumerate them); it never runs in `web`. Contributed by `SchedulerProvider`.
See [Scheduler](/docs/scheduler) for the full `Schedule` settings reference.

## Validators — app/validators/

Files under `app/validators/` are auto-imported at boot, so any module-level registration they
perform is in place before the first request. This is where a shared `FormRequest` base class or a
rule set used across several requests belongs:

```typescript
// app/validators/StorePostRequest.ts
import { FormRequest } from "@zerotal/validator";

export class StorePostRequest extends FormRequest {
  rules(r) {
    return {
      title: r.string().min(3).max(120),
      body: r.string().min(1),
    };
  }
}
```

The auto-import matters for anything with a **side-effect at module scope**. A `FormRequest`
subclass imported by its controller would load anyway; a module that registers something on
import only runs because this concern imports it.

## Auto-migration

Once models are registered at boot, Zerotal can sync the schema additively — create missing tables
and add missing columns to match your models (TypeORM-style `synchronize`):

```typescript
// config/database.ts
import { DatabaseConfig } from "@zerotal/orm";

export default DatabaseConfig({
  url: env("DATABASE_URL", "sqlite://./database.sqlite"),
  synchronize: true, // dev convenience
});
```

- **Opt-in:** off unless enabled (like TypeORM), and **hard-off in `production`** regardless —
  there you run `migrate` with generated migration files. A common setup enables it only for
  tests/local via env (`synchronize: env("APP_ENV") !== "production"`).
- **Additive by default:** `true` creates missing tables and adds missing columns; it never
  drops or alters existing ones.
- **Disruptive opt-in:** pass `synchronize: { enabled: true, disruptive: true }` to also drop
  columns no model declares anymore. This destroys their data (and logs a warning per drop), so
  keep it to local/test. See [Migrations → Disruptive sync](/docs/migrations#disruptive-sync).

> **Danger** — Disruptive sync drops columns and the data they hold. Never enable it in production;
> the concern is hard-off there regardless, but keep it scoped to local/test even so.

## Configuration

Auto-discovery is configured under the `conventions` key in `config/app.ts`. `AppConfig()` fills
in every default, so you only set what you want to change:

```typescript
// config/app.ts
import { env } from "zerotal";
import { AppConfig } from "zerotal/config";

export default AppConfig({
  name: "Example",
  url: env("APP_URL", "http://localhost:3000"),
  key: env("APP_KEY", "changeme-in-production"),

  // Defaults shown — omit entirely unless you want to change them.
  conventions: {
    enabled: true,
    paths: {
      providers: "app/providers",
      middleware: "app/middleware",
      models: "app/models",
      observers: "app/observers",
      policies: "app/policies",
      listeners: "app/listeners",
      events: "app/events",
      jobs: "app/jobs",
      schedules: "app/schedules",
      validators: "app/validators",
      commands: "app/commands",
    },
  },
});
```

| Field     | Required | Default                | Description                                                |
| --------- | -------- | ---------------------- | ---------------------------------------------------------- |
| `enabled` | no       | `true`                 | Master switch for convention-based auto-registration.      |
| `paths`   | no       | the `app/*` dirs above | Per-concern directory overrides, relative to the app root. |

Set `conventions.enabled: false` to opt out entirely and wire everything manually. Path overrides
let you relocate any concern. Files starting with `_` and `*.test.ts` / `*.test.tsx` /
`*.spec.ts` / `*.d.ts` are always skipped.

## Custom concerns

Discovery is extensible. A provider can contribute its own concern descriptor via
`app.registerConcern(...)`:

```typescript
// app/providers/AppServiceProvider.ts — inside onRegister/onBooting
this.app.registerConcern({
  name: "validators",
  order: 60,
  dir: "app/validators",
  register(mod, ctx) {
    for (const exported of Object.values(mod)) {
      /* register exported as needed */
    }
  },
});
```

`order` controls sequencing (lower runs first). A `run(ctx)` hook (no `dir`) defines a one-shot
step that runs after the scanned concerns at the same point in the ordering — this is how
auto-migration is wired (`order: 100`, `run`-only). Restrict a concern to certain runtimes with
`envs` (e.g. `envs: ["worker", "console"]`, as `schedules` does).

## Reference

The concerns that run in the convention phase, in `order`. `events`, `services`, `listeners`,
`jobs`, and `validators` are owned by core; the rest are contributed by their packages.

| Concern        | Directory        | Order | Runs in         | Contributed by       |
| -------------- | ---------------- | ----- | --------------- | -------------------- |
| `events`       | `app/events`     | 5     | all             | core                 |
| `models`       | `app/models`     | 10    | all             | `@zerotal/orm`       |
| `services`     | `app/services`   | 10    | all             | core                 |
| `observers`    | `app/observers`  | 20    | all             | `@zerotal/orm`       |
| `policies`     | `app/policies`   | 30    | all             | `@zerotal/auth`      |
| `listeners`    | `app/listeners`  | 40    | all             | core                 |
| `jobs`         | `app/jobs`       | 50    | all             | core                 |
| `schedules`    | `app/schedules`  | 55    | worker, console | `@zerotal/scheduler` |
| `validators`   | `app/validators` | 60    | all             | core                 |
| `auto-migrate` | _(run-only)_     | 100   | non-production  | `@zerotal/orm`       |

`providers` (`app/providers`) and `middleware` (`app/middleware`) are not convention-phase concerns
— they are discovered earlier in the boot sequence (see [Mental model](#mental-model)).

`commands` (`app/commands`) is discovered by the CLI's command runner rather than the convention
phase — console, worker, and test environments only, since HTTP boot has no use for parsing CLI
files. It honours `conventions.enabled` and the `paths.commands` override like the rest. See
[Commands](/docs/commands#auto-discovery).

## Next steps

- [Structure](/docs/structure) — see how the `app/*` directories fit the project layout.
- [Providers](/docs/providers) — register and boot services explicitly when convention isn't enough.
- [Config system](/docs/config-system) — how `config/*.ts` files are loaded and merged.
- [Migrations](/docs/migrations) — generate schema changes instead of relying on `synchronize`.
