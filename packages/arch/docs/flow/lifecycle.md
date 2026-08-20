---
title: Flow Lifecycle Hooks
description: Where to run code as a component mounts, updates, and tears down.
---

# Lifecycle Hooks

Lifecycle hooks let you run code at precise points in a component's life — on first load, on each WebSocket round-trip, before and after actions, around the render cycle, and on errors. They run server-side and have full access to the database, models, and services.

## Hook reference

| Hook                          | `GET` (initial) | WebSocket (subsequent)          |
| ----------------------------- | --------------- | ------------------------------- |
| `onBoot()`                    | ✓               | ✓                               |
| `onMount()`                   | ✓               | only if `this.refresh()` called |
| `onHydrate()`                 | —               | ✓                               |
| `onUpdating(prop, val, key?)` | —               | ✓ (per client write)            |
| `onUpdated(prop, val, key?)`  | —               | ✓ (per client write)            |
| `action()`                    | —               | ✓ (the invoked method)          |
| `onUpdate()`                  | —               | ✓ (once, after action)          |
| `onRendering()`               | ✓               | ✓                               |
| `render()`                    | ✓               | ✓                               |
| `onRendered(html)`            | ✓               | ✓                               |
| `onDehydrate()`               | ✓               | ✓                               |
| `onError(error)`              | —               | ✓ (on throw)                    |

## Request flow

```
GET /page  (initial render)            WebSocket action frame (subsequent)
  │                                      │
  ├─ onBoot(ctx)                         ├─ onBoot(ctx)
  ├─ onMount(ctx)                        ├─ onHydrate()       ← state restored from snapshot
  ├─ onRendering()                       ├─ onUpdating/onUpdated ← per client-written property
  ├─ render()                            ├─ action()          ← the invoked exposed method
  ├─ onRendered(html)                    ├─ onUpdate()        ← once, after action
  └─ onDehydrate()                       ├─ onRendering()
                                         ├─ render()
                                         ├─ onRendered(html)
                                         └─ onDehydrate()
```

`onMount()` is absent from the WebSocket column because it only runs on the initial `GET` — unless the action called `this.refresh()`, which re-inserts it into the WebSocket flow.

## Child component initialisation

A child gets its data from its parent, not from the URL. Each prop lands on the field of the same name before `onBoot()` and `onMount()` run, so the field's initialiser is its default and a hook can use the value straight away:

```typescript
export class CounterWidget extends Component {
  @locked label: string = "Count"; // ← <CounterWidget label="Views" />
  @locked step:  number = 1;       // ← defaults to 1 when the parent omits it
  @expose count: number = 0;

  @expose increment(): void {
    this.count += this.step;
  }

  override async render() {
    return (
      <div class="card">
        <p class="text-sm text-gray-500">{this.label}</p>
        <p class="text-3xl font-bold">{this.count}</p>
        <button onClick={this.increment}>+ {this.step}</button>
      </div>
    );
  }
}
```

Props that must survive round-trips need to be `@locked` — that keeps them in the snapshot, and the value is then restored from there rather than re-assigned. A `@reactive` prop is different: the parent re-pushes it whenever it changes, so the child sees the new value on the next round-trip.

A child receives the request `HttpContext` in `onBoot(ctx)` / `onMount(ctx)` like any page, so it can still read the session or the signed-in user. What it never reads is the URL's segments — those fill the page, not the pieces inside it, which is what lets a child be dropped anywhere.

## Per-request setup

Runs on **every** request: the initial `GET` and every WebSocket update. Use it for setup that must be fresh on every round-trip — resolving the authenticated user from context, initialising i18n, wiring up per-request services:

```typescript
import { request } from "zerotal";

override async onBoot() {
  const ctx = request();
  this.currentUserId = ctx.user?.id ?? 0;
  this.locale        = ctx.string("locale", "en") ?? "en";
}
```

`onBoot()` runs before both `onMount()` and `onHydrate()`, so state it sets is available in both.

Avoid expensive database queries in `onBoot()` — it fires on every round-trip, including fast UI interactions. Reserve those for `onMount()` or `onHydrate()`.

## Loading data

Runs once on the initial `GET` render, then is skipped on all subsequent WebSocket updates. It's the primary place to load data for the page.

A page on a dynamic segment needs no code here for the record it is about. A field of the model's type is [filled from the segment](/docs/flow/routing#path-parameters) before `onMount()` runs, so the query, the id field, and the 404 all belong to the route:

```typescript
export class PostPage extends Component {
  @locked post!: Post; // /posts/:post — nothing to load
}
```

What `onMount()` is for is everything the URL does not carry. It receives the route `HttpContext` — the same argument a controller action gets — which is where the signed-in user lives, and `ctx.params` is still there for a segment no field claimed:

```typescript
override async onMount({ user }: HttpContext) {
  this.canEdit = user?.id === this.post.authorId;
}
```

The context is passed to `onBoot()` too, but only the initial `GET` populates `ctx.params` — see the [warning in Routing](/docs/flow/routing#path-parameters). The argument is optional because a component can also be mounted outside a request (in a test, for example).

```typescript
override async onMount() {
  const [posts, drafts] = await Promise.all([
    Post.query()
      .where("status", "published")
      .orderBy("created_at", "desc")
      .limit(20)
      .get(),
    Post.query().where("status", "draft").count(),
  ]);

  this.posts  = posts;
  this.drafts = drafts;
  this.total  = posts.length;
}
```

Lists and counts are what belongs here — the things no route resolved and no parent passed down.

To force `onMount()` to re-run during a WebSocket action — for example after creating a new record and wanting to reload the list — call `this.refresh()` inside the action:

```typescript
@expose async createPost(): Promise<void> {
  await Post.create({ title: this.title, body: this.body });
  this.title = "";
  this.body  = "";
  this.refresh(); // triggers onMount() on this round-trip
  this.flash("Post published.");
}
```

## Re-deriving state after hydration

Runs on every WebSocket round-trip, immediately after state is restored from the snapshot. Use it to re-derive transient or protected state that wasn't persisted in the snapshot:

```typescript
export class PostEditorPage extends Component {
  @expose post!: Post; // /posts/:post/edit — re-read from the row every round-trip
  @transient wordCount = 0; // NOT persisted — derived again each time

  override async onHydrate() {
    await this.post.loadMissing(["author"]); // relations do not survive the round-trip
    this.wordCount = this.post.body.split(/\s+/).length;
  }

  @expose async updateTitle(title: string): Promise<void> {
    await this.post.fill({ title }).save();
    this.flash("Title updated.");
  }
}
```

> **This used to say to hold the id and re-query the model here.** A component could not hold a
> model then, so `@locked postId` plus a `@transient post` re-fetched in `onHydrate()` was the
> way to keep one fresh. It is no longer needed: a model held directly is [re-read from its row
> on every round-trip](/docs/flow/models#freshness), which is the same guarantee with none of
> the bookkeeping. The pattern still works — it is just two fields and a query doing what one
> field now does.

What is left for `onHydrate()` is the state a snapshot genuinely cannot carry: relations, which
are not part of a re-read, and anything derived from them.

## Intercepting client writes

Fires **before** a client-written property value is applied to the component. Throw to reject the write — the value is discarded, an error is added, and the component re-renders:

```typescript
override async onUpdating(prop: string, value: unknown, key?: string) {
  // Prevent role escalation
  if (prop === "role" && value === "super_admin") {
    throw new Error("You cannot assign this role.");
  }

  // Reject negative numbers for any numeric prop
  if (typeof value === "number" && value < 0) {
    throw new Error(`${prop} cannot be negative.`);
  }
}
```

`key` is present when the property is an array or object and the client updated a nested path (e.g., `form.email` — `prop` is `"form"`, `key` is `"email"`).

## Reacting after client writes

Fires **after** a client-written property is applied. Use it to normalise values, enforce computed side-effects, or trigger cascading updates:

```typescript
override async onUpdated(prop: string, value: unknown) {
  if (prop === "categoryId") {
    // When the category changes, reload the subcategories
    this.subcategories = await Category.where("parent_id", value).get();
    this.subcategoryId = null;
  }
}
```

## Per-property update hooks

Instead of branching on `prop` inside `onUpdating`/`onUpdated`, define a per-property method named `onUpdating<PropName>` or `onUpdated<PropName>` (Pascal-cased). Flow calls it automatically and keeps the generic fallback as a catch-all:

```typescript
@expose username = "";
@expose email    = "";
@expose tags:    string[] = [];

// Called only when the client writes to `username`:
async onUpdatedUsername(value: string) {
  this.username = value.toLowerCase().trim();
}

// Called only when the client writes to `email`:
async onUpdatingEmail(value: string) {
  if (!value.includes("@")) {
    throw new Error("Not a valid email address.");
  }
}

// Generic fallback — fired for any property not handled above:
async onUpdating(prop: string, value: unknown) {
  if (prop === "role" && value === "super_admin") {
    throw new Error("You cannot set this role.");
  }
}
```

The per-property form is cleaner and TypeScript-friendly: the parameter type matches the property type rather than `unknown`.

## After action, before render

Runs once after the invoked action completes, before the render cycle. Use it to apply cross-cutting logic that should happen after any action:

```typescript
override async onUpdate() {
  // Always log the current state to the audit trail after any action:
  await AuditLog.create({
    component:   this.constructor.name,
    userId:      this.currentUserId,
    snapshotSum: JSON.stringify(this).length,
  });
}
```

Unlike `onUpdated` (which fires per property, before the action), `onUpdate()` fires once per request, after the action returns.

## Before render

Runs immediately before `render()` on every request (initial and WebSocket). Use it for template-level setup that shouldn't be in `render()` itself — resolving shared view data, picking a layout variant, etc.:

```typescript
override async onRendering() {
  // Decide which layout variant to use based on the user's subscription
  if (this.user?.isPro) {
    this.layoutVariant = "pro";
  }
}
```

Avoid async database calls here unless truly necessary — `onMount()` and `onHydrate()` are the right places to load data. `onRendering()` is for lightweight, synchronous prep.

## After render

Receives the rendered HTML string. Use it to post-process the output, measure render time, or send the HTML to a cache:

```typescript
override async onRendered(html: string) {
  // Log very long renders for investigation
  if (html.length > 100_000) {
    await Logger.warn("flow.render.large", {
      component: this.constructor.name,
      bytes:     html.length,
    });
  }
}
```

The `html` parameter is the raw HTML of this component only — not the full page. Do not mutate it here; return value is ignored.

## Normalising before snapshot

Runs just before the component state is serialised into the snapshot at the end of every request. Use it to strip sensitive or ephemeral state that shouldn't be persisted:

```typescript
override async onDehydrate() {
  // Never persist raw upload paths between round-trips
  this.tempUploadPath = null;

  // Strip the full user object — only the ID needs to survive
  this.userObject = null;

  // Trim large arrays before snapshot to keep payload size down
  if (this.logBuffer.length > 100) {
    this.logBuffer = this.logBuffer.slice(-100);
  }
}
```

After `onDehydrate()`, the snapshot is signed and sent to the browser as an encrypted opaque blob. The next round-trip restores it before `onHydrate()` runs.

## Custom error handling

Called when an `@expose`d action throws an unhandled error. The default behaviour flashes the error message with level `"error"`. Override to log to an error tracker or display a custom message:

```typescript
override async onError(error: Error) {
  // Log to your error tracker
  await Sentry.captureException(error, {
    extra: {
      component: this.constructor.name,
      userId:    this.currentUserId,
    },
  });

  // Show a user-friendly message instead of the raw error text
  this.flash("Something went wrong. Our team has been notified.", "error");
}
```

If you want some errors to propagate normally and only handle specific types:

```typescript
override async onError(error: Error) {
  if (error instanceof DatabaseConnectionError) {
    this.flash("Database is temporarily unavailable. Please try again.", "error");
    return;
  }

  // Re-throw everything else to get the default flash behaviour
  throw error;
}
```

`onError()` does not run during the initial `GET` render — if `onMount()` throws, the error propagates to the HTTP layer and results in a 500 response. It only runs during WebSocket action frames.

## Next steps

- [Flow overview](/docs/flow) — the guide's front page and the rest of the sections.
- [Reference](/docs/flow/references) — every decorator, prop, and directive in one table.
