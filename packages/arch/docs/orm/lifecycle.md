---
title: Lifecycle & Events
description: Hook into every persistence event, enforce status transitions, and prune stale records as your models are created, changed, and deleted.
---

# Lifecycle & Events

Every time a model is created, updated, deleted, or hydrated, the ORM fires a
lifecycle event. This page covers the four ways to react to those events — raw
hooks, observer classes, a declarative state machine, and the app-event-bus
bridge — plus a pruning API for automated housekeeping.

## Mental model

A single persistence call fans out to a fixed sequence of lifecycle events. The
same events feed every reaction system, so you choose by how you want to organise
your code, not by which event you can see:

```text
create()  →  beforeSave → beforeCreate → INSERT → afterCreate → afterSave
update()  →  beforeSave → beforeUpdate → UPDATE → afterUpdate → afterSave
delete()  →  beforeDelete → DELETE → afterDelete
query     →  hydrate row → afterFind
                 │
                 ├─ HookRegistry callbacks (lowest level)
                 ├─ Observer methods        (grouped per model)
                 └─ dispatchesEvents         (onto the app event bus)
```

> **Note** — Hooks and observers for the same model **both** fire; observers are
> registered through `HookRegistry` under the hood, so they run in registration
> order alongside any standalone hooks.

## Which should I use?

- **Hooks** (`HookRegistry.register`) — a one-off side-effect for a single event.
  The lowest-level option; reach for it when you don't want a whole class.
- **Observers** (`Model.observe`) — several related side-effects for one model,
  kept together in one class. Prefer this once you have more than one or two hooks.
- **`dispatchesEvents`** — when the consumers live in other modules and shouldn't
  import the model. Maps lifecycle events onto the application event bus.
- **State machine** — when a column moves through a fixed set of statuses and you
  want illegal transitions rejected rather than silently saved.

## Hooks

Run async callbacks before or after any persistence event. Register them once at
boot (typically in a service provider's `onBooting()`):

```typescript
// in a ServiceProvider.onBooting()
import { HookRegistry } from "@zerotal/orm";

// Auto-generate a slug before a Post is created
HookRegistry.register(Post, "beforeCreate", async (post) => {
  if (!post.slug) {
    post.slug = slugify(post.title);
  }
});

// Bust the cache after a Post is deleted
HookRegistry.register(Post, "afterDelete", async (post) => {
  await Cache.forget(`post:${post.id}`);
  await Cache.forget(`post:slug:${post.slug}`);
});

// Validate custom business rules before an update
HookRegistry.register(Order, "beforeUpdate", async (order) => {
  if (order.isDirty("status") && order.status === "cancelled") {
    if (order.original("status") === "shipped") {
      throw new Error("Cannot cancel a shipped order.");
    }
  }
});
```

The signature is:

```typescript
HookRegistry.register<T>(ModelClass: Function, hook: HookName, fn: (model: T) => Promise<void> | void): void
```

**Available hooks:**

| Hook           | Fires                                           |
| -------------- | ----------------------------------------------- |
| `beforeCreate` | Before the first `INSERT` for a new model       |
| `afterCreate`  | After the `INSERT` succeeds                     |
| `beforeUpdate` | Before `UPDATE` on an existing model            |
| `afterUpdate`  | After `UPDATE` succeeds                         |
| `beforeSave`   | Before both `INSERT` and `UPDATE`               |
| `afterSave`    | After both `INSERT` and `UPDATE` succeed        |
| `beforeDelete` | Before `DELETE` (soft or hard)                  |
| `afterDelete`  | After `DELETE` succeeds                         |
| `afterFind`    | After any model is hydrated from a query result |

Hooks fire in registration order, and inherited hooks (registered against a parent
class) run before a subclass's own. Multiple hooks can be registered for the same
event.

> **Tip** — Factories silence hooks and observers during seeding. Call
> `.dispatchEvents()` on the factory to opt back in.

## Observers

Observers group all lifecycle callbacks for a model in a single class. The method
names follow the event-tense convention (`creating`/`created`, `updating`/
`updated`, `saving`/`saved`, `deleting`/`deleted`, `retrieved`) — implement only
the ones you need:

```typescript
// app/observers/UserObserver.ts
import type { ModelObserver } from "@zerotal/orm";

export class UserObserver implements ModelObserver<User> {
  async creating(user: User) {
    user.slug = slugify(user.name);
  }

  async created(user: User) {
    await Mail.send(new WelcomeMail(user.email));
  }

  async updated(user: User) {
    if (user.isDirty("email")) {
      await Mail.send(new EmailChangedMail(user.email));
    }
  }

  async deleted(user: User) {
    await Cache.forget(`user:${user.id}`);
  }
}
```

Register the observer once at boot:

```typescript
// in a ServiceProvider.onBooting()
import { User } from "#app/models/User.ts";
import { UserObserver } from "#app/observers/UserObserver.ts";

User.observe(UserObserver);
```

Each observer method maps onto the matching hook — `creating` → `beforeCreate`,
`created` → `afterCreate`, `retrieved` → `afterFind`, and so on — so observers and
standalone hooks share the same registration-order execution.

## State machine

When a column moves through a fixed set of statuses, declare the allowed
transitions as a state machine. The behaviour is an **opt-in mixin**: compose it
with `Model.using(State)` so only models that declare a workflow carry the
`transitionTo` / `forceState` / `onTransition` API.

### Declaring states

```typescript
// app/models/Post.ts
import { Model, State, column, table } from "@zerotal/orm";

const States = {
  draft: { canTransitionTo: ["review", "archived"] as const },
  review: { canTransitionTo: ["published", "draft"] as const },
  published: { canTransitionTo: ["archived"] as const },
  archived: { canTransitionTo: [] as const },
} as const;

@(table("posts").withTimestamps())
export class Post extends Model.using(State) {
  static states = States;
  static stateField = "status"; // default — override if your column isn't named 'status'

  @column("string") status!: keyof typeof States;
}
```

> **Warning** — The state machine is _not_ on `Model`. A model that extends
> `Model` directly has no `transitionTo()`; you must compose
> `Model.using(State)`.

### Transition guards

A guard runs before the target state is entered. Return `false` to block the
transition silently, or throw a `StateError` to block it with a message:

```typescript
// app/models/Subscription.ts
import { Model, State, StateError, column, table } from "@zerotal/orm";

const States = {
  pending: { canTransitionTo: ["active", "cancelled"] as const },
  active: {
    canTransitionTo: ["suspended", "expired"] as const,
    guard: async (subscription: Subscription) => {
      if (!subscription.stripeId) {
        // StateError(model, from, to, detail?)
        throw new StateError(
          "Subscription",
          "pending",
          "active",
          "Cannot activate without a Stripe ID.",
        );
      }
    },
  },
  suspended: { canTransitionTo: ["active", "cancelled"] as const },
  expired: { canTransitionTo: [] as const },
  cancelled: { canTransitionTo: [] as const },
} as const;

@table("subscriptions")
export class Subscription extends Model.using(State) {
  static states = States;
  static stateField = "status";

  @column("string") status!: keyof typeof States;
  @column("string?") stripeId?: string;
}
```

> **Note** — `StateError` carries `(model, from, to, detail?)` and surfaces as an
> HTTP `422`. Returning `false` from a guard raises the same error with a generic
> message.

### Transition listeners

Register callbacks that fire after a successful transition. Call `onTransition` in
a service provider's `onBooting()` so it runs once at startup:

```typescript
// in a ServiceProvider.onBooting()
// Specific state
Post.onTransition("published", async (post, { from }) => {
  await Mail.send(new PostPublishedMail(post));
  console.log(`Post ${post.id} moved from ${from} → published`);
});

// Wildcard — fires on every transition
Post.onTransition("*", async (post, { from, to }) => {
  await Audit.log("post.state_change", { id: post.id, from, to });
});
```

### Using transitions

```typescript
// in a controller or service
// Validates canTransitionTo, runs the guard, saves, then fires callbacks
await post.transitionTo("review");
await post.transitionTo("published");

// Throws StateError — "published" cannot transition to "draft"
await post.transitionTo("draft");

// Force a state without validation — blocked in production
await post.forceState("draft");
```

`transitionTo()` updates the state column and calls `save()` once the transition is
validated and the guard passes, then runs the matching `onTransition` callbacks
followed by any `"*"` wildcard callbacks.

> **Danger** — `forceState()` bypasses `canTransitionTo`, guards, and callbacks. It
> throws when `APP_ENV` is `production`, so keep it to test factories, seeders, and
> data-repair scripts.

### State machine in a controller

```typescript
// app/controllers/PostController.ts
import { StateError } from "@zerotal/orm";

export async function publish(ctx: HttpContext) {
  const post = await Post.findOrFail(ctx.params("id"));

  try {
    await post.transitionTo("published");
    return json({ status: post.status });
  } catch (e) {
    if (e instanceof StateError) {
      return json({ error: e.message }, 422);
    }
    throw e;
  }
}
```

## Dispatching model events to the app bus

`dispatchesEvents` maps lifecycle events to event classes that are automatically
dispatched on the application event bus when they fire. This is an alternative to
observers — useful when consumers live in separate modules. See the
[ORM index page](/docs/orm#bridging-model-events-to-the-app-event-bus) for the
companion overview.

```typescript
// app/events/PostEvents.ts
export class PostCreated {
  constructor(public post: Post) {}
}

// app/models/Post.ts
@table("posts")
export class Post extends Model {
  static dispatchesEvents = {
    created: PostCreated,
    updated: PostUpdated,
    deleted: PostDeleted,
  };
}
```

Valid keys: `creating`, `created`, `updating`, `updated`, `saving`, `saved`,
`deleting`, `deleted`, `retrieved`. Each event class is constructed with the model
instance. Dispatching is a no-op when no event bus is bound (for example, when the
ORM runs standalone).

Subscribe using the event bus anywhere in your application:

```typescript
// in a ServiceProvider or listener module
import { Events } from "zerotal";

Events.on(PostCreated, async ({ post }) => {
  await SearchIndex.sync(post);
  await Cache.tags("posts").flush();
});
```

## Model pruning

Mark stale records for automatic periodic cleanup without manually writing DELETE
queries.

### Implementing pruning

```typescript
// app/models/AuditLog.ts
@table("audit_logs")
export class AuditLog extends Model {
  @column("datetime") createdAt!: Carbon;

  // Return a query that selects records eligible for deletion
  static prunable() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 6); // older than 6 months
    return this.query().where("created_at", "<", cutoff.toISOString());
  }

  // Permanently remove rows instead of soft-deleting
  static massPrune = true;
}
```

```typescript
// in a scheduled task or REPL
const removed = await AuditLog.prune(); // default chunk size: 1000
const fewer = await AuditLog.prune(500); // custom chunk size
```

The signature is:

```typescript
static prune(chunkSize = 1000): Promise<number>
```

`prune()` works in chunks to avoid memory spikes on large tables and returns the
total number of records deleted. Calling it on a model without a `prunable()`
method throws.

### Scheduling pruning

```typescript
// bootstrap/app.ts or a scheduler provider
scheduler
  .job("prune-audit-logs", async () => {
    const count = await AuditLog.prune();
    console.log(`Pruned ${count} audit logs`);
  })
  .daily()
  .at("03:00");
```

### massPrune vs soft-delete pruning

| `massPrune`       | Behaviour                                             |
| ----------------- | ----------------------------------------------------- |
| `false` (default) | `delete()` — sets `deleted_at`, respects soft deletes |
| `true`            | `forceDelete()` — permanently removes the row         |

`massPrune` only changes behaviour for models that use soft deletes (`static
softDeletes = true`). For hard-delete models, `delete()` is already permanent, so
the two are identical.

## References

| Member                  | Signature                                                    | Description                                                 |
| ----------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| `HookRegistry.register` | `(ModelClass, hook: HookName, fn): void`                     | Register a lifecycle callback for a model.                  |
| `Model.observe`         | `(ObserverClass: new () => ModelObserver<T>): void`          | Wire an observer class's methods into the hook registry.    |
| `Model.onTransition`    | `(toState: string, cb: (model, { from, to }) => void): void` | Run a callback after a successful transition (`"*"` = any). |
| `model.transitionTo`    | `(newState: string): Promise<this>`                          | Validate, guard, save, then fire transition callbacks.      |
| `model.forceState`      | `(state: string): Promise<this>`                             | Set the state column unchecked; throws in production.       |
| `Model.prune`           | `(chunkSize = 1000): Promise<number>`                        | Delete `prunable()` records in chunks; returns the count.   |
| `Model.prunable`        | `(): ModelQueryBuilder<T>`                                   | Override to return the query selecting prunable records.    |

| Static field              | Type                                    | Description                                                |
| ------------------------- | --------------------------------------- | ---------------------------------------------------------- |
| `static states`           | `Record<string, StateDefinition>`       | The state machine schema (requires `Model.using(State)`).  |
| `static stateField`       | `string` (default `"status"`)           | Column holding the state value.                            |
| `static dispatchesEvents` | `Record<string, new (model) => object>` | Maps lifecycle keys to app-bus event classes.              |
| `static massPrune`        | `boolean` (default `false`)             | Permanently delete prunable rows instead of soft-deleting. |

## Next steps

- [ORM](/docs/orm) — model basics and the `dispatchesEvents` bridge.
- [Events](/docs/events) — subscribe to dispatched model events on the app bus.
- [Scheduler](/docs/scheduler) — run pruning jobs on a recurring schedule.
- [ORM queries](/docs/orm/queries) — build the queries that hooks and pruning rely on.
