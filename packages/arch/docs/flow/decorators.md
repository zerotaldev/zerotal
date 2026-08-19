---
title: Flow Decorators
description: The decorators that expose state and actions to the client: @expose, @locked, @computed, and friends.
---

# Decorators

Decorators are the primary way to define a Flow component's public contract with the browser. They control what gets synced to the client, what the client can change, how state is persisted, and how the component communicates with the rest of the page.

All decorators are imported from `@zerotal/flow`.

## The @expose decorator

Marks a property or method as part of the public contract with the browser.

- **On a property** — the value is included in the signed snapshot and synced to the client on every patch. The client can update it via a bound `value`/`checked` attribute or a client expression like `onClick={() => this.count++}`.
- **On a method** — makes it callable from the browser over the WebSocket via event bindings like `onClick={this.save}`.

```typescript
import { expose } from "@zerotal/flow";

export class CounterPage extends Component {
  @expose count: number = 0;
  @expose name: string = "";
  @expose filter: string = "all";

  @expose increment(): void {
    this.count++;
  }

  @expose async save(): Promise<void> {
    await Post.create({ title: this.title, body: this.body });
    this.flash("Post saved.");
    this.redirect("/posts");
  }
}
```

Only `@expose` properties are two-way: the client can push updates back to the server. If you only need the server to push state to the client, use `@locked` instead.

## The @locked decorator

Sent to the client for display, but the client cannot mutate it. Included in the snapshot so it survives WebSocket round-trips without re-loading from the database.

A `value={this.x}` binding on a `@locked` property renders as a read-only display — not an editable field.

Use `@locked` for data loaded in `onMount()` that the server controls: model results, user info, computed totals, child props from the parent:

```tsx
export class PostsPage extends Component {
  @locked posts: Post[] = [];
  @locked user: User | null = null;
  @locked total: number = 0;

  override async onMount() {
    this.user = await User.findOrFail(this.userId);
    this.posts = await Post.query()
      .where("user_id", this.user.id)
      .where("status", "published")
      .orderBy("created_at", "desc")
      .get();
    this.total = this.posts.length;
  }

  override async render() {
    return (
      <div>
        <h1>Posts by {this.user?.name}</h1>
        <p>{this.total} posts</p>
        <ul>
          {this.posts.map((p) => (
            <li key={String(p.id)}>{p.title}</li>
          ))}
        </ul>
      </div>
    );
  }
}
```

## The @validate decorator

Attaches a validation rule to a property, built with the framework validator's fluent chain
(`@zerotal/validator`'s `RuleBuilder`). Picked up automatically when you call `this.validate()`
with no arguments, and used for [real-time validation](#real-time-validation) on update.

Combine with `@expose` for a property that is both two-way bound and validated:

```typescript
@expose @validate((rule) => rule.required().email())              email:    string = "";
@expose @validate((rule) => rule.required().min(8))               password: string = "";
@expose @validate((rule) => rule.required().min(2).max(50))       name:     string = "";
@expose @validate((rule) => rule.required().in(["admin", "user", "guest"])) role: string = "user";
@expose @validate((rule) => rule.number().min(0))                 age?:     number;
```

> Rules are written with the chain, not strings — `(rule) => rule.required().min(8)`, not
> `"required|min:8"`. `rule.required()` is shorthand for a required string; start from a typed
> builder (`rule.number()`, `rule.boolean()`, …) for other types. Pass a custom message to any rule,
> e.g. `rule.required("Please enter your name")`.

The validation runs when you call `this.validate()` inside an action:

```typescript
@expose async register(): Promise<void> {
  await this.validate(); // reads all @validate rules on the class

  // Only reached if all fields are valid:
  const user = await User.create({
    name:     this.name,
    email:    this.email,
    password: this.password,
    role:     this.role,
  });

  this.redirect("/dashboard");
}
```

You can also pass rules directly to `this.validate()` — they override the decorator-based rules:

```typescript
@expose async update(): Promise<void> {
  await this.validate({
    email:    (rule) => rule.required().email(),
    password: (rule) => rule.string().optional().min(8),
  });

  await this.user.fill({ email: this.email }).save();
  this.flash("Profile updated.");
}
```

### Real-time validation

When a `@validate` field is bound `live` (or `blur`), each change is validated on
the server as it arrives. The field's error appears (and clears)
as the user edits, with no action call and without affecting any other field.

> **Note** — `live` is the prop you write; `flow:model.live` is what it compiles to. The compiled
> form is not writable in TSX: the `.` in an attribute name is a parse error (`TS1003`), so
> copying it out of the emitted HTML into a component will not build.

```tsx
@expose @validate((rule) => rule.required().email()) email = "";

async render() {
  return (
    <div>
      <input type="email" value={this.email} live />
      <span error={this.errors.email} />
    </div>
  );
}
```

Only the changed field is validated, and cross-field rules (like `confirmed`) see the other fields'
current values. Fields bound with the default (deferred) `flow:model` validate when you call
`this.validate()` in an action instead.

See [Forms & Validation](/docs/flow/forms) for the full validation rules reference and the error display API.

## The @url decorator

Syncs a property to the browser URL query string. Initialised from the query string on the initial page load; updated in the URL on every patch. The URL becomes shareable and bookmark-friendly automatically:

```typescript
// Page and search stay in the URL: /posts?page=2&search=TypeScript
@url page:   number = 1;
@url search: string = "";
@url status: string = "all";

// Custom query parameter name: /posts?q=TypeScript
@url({ as: "q" }) query: string = "";

// Push a new browser history entry on change (back button works)
@url({ history: "push" }) tab: string = "overview";

// Custom name AND push history
@url({ as: "p", history: "push" }) currentPage: number = 1;
```

`@url` properties can also be read-only (`@locked`) if the server alone controls the URL parameter — though this is uncommon.

## The @session decorator

Binds a property to the HTTP session, so the value survives a browser refresh. Requires `SessionMiddleware` to be active for the route.

The field reads and writes the session key of the same name — the same value a controller or another component sees:

```typescript
@session userId: string = "";           // the session's `userId`
@session preferredTheme: string = "light";
```

Pass options to change the key, or to keep it to this component:

```typescript
// Read a differently-named key
@session({ key: "s" }) whatever: number = 0;

// Namespace it to this component → flow:Preferences:draft
@session({ scoped: true }) draft: string = "";
```

Use `scoped: true` for working state that belongs to one page and shouldn't collide with anything else — a half-finished draft, a wizard step. Leave it off for values the rest of the app shares.

A `@session` field is **not** in the WebSocket snapshot: it is read from and written to the session on each request, so the browser never receives it and cannot write it. Add `@locked` when the client needs to read the value.

- It persists until the session expires or the user logs out.
- It doesn't count against snapshot size.
- It's the right tool for cross-page preferences, dismissal flags, and anything the user should see the same way on their next visit.

## The @computed decorator

A getter derived from other state. Not stored in the snapshot — recomputed on every render pass. The result is **memoized for the duration of a single render**, so an expensive getter read multiple times in the same template runs only once:

```typescript
@computed get fullName(): string {
  return `${this.firstName} ${this.lastName}`;
}

@computed get filteredPosts(): Post[] {
  // Even if render() reads filteredPosts 3 times, this filter runs only once per render:
  return this.posts.filter((p) => p.status === this.filter);
}

@computed get totalRevenue(): number {
  return this.orders.reduce((sum, o) => sum + o.total, 0);
}

@computed get isOverBudget(): boolean {
  return this.totalRevenue > this.budgetLimit;
}
```

Use them freely in a template as a text child — `{this.fullName}` — where they render a **static, server-evaluated** value (memoized per render). Because a computed getter isn't stored in the snapshot, it re-evaluates and updates on the next server patch, not client-side — so it can't be bound reactively: `{this.total}` is fine, but `text={this.total}` (a client-reactive binding) is not. For a value that must update on the client without a round-trip, keep it in an `@expose` property (write it from an action or an `onUpdated` hook) rather than deriving it with `@computed`.

## The @transient decorator

Excludes a property from the snapshot entirely. Reset to its class-level default on every WebSocket round-trip. Use for ephemeral UI state that shouldn't persist between server calls:

```typescript
@transient isUploading:   boolean = false;
@transient dropzoneActive: boolean = false;
@transient tempMessage:    string  = "";
@transient previewUrl:     string  = "";
```

The pattern: start an upload, set `this.isUploading = true`, send a response. On the next round-trip the flag is already `false` again — you don't have to reset it manually.

## The @renderless decorator

An `@expose`d method that runs on the server but **skips the re-render cycle**. Use for side-effects that don't change the UI: file downloads, external API calls, jobs that just need to fire:

```typescript
@expose @renderless async exportCsv(): Promise<void> {
  const rows = await Report.all();
  const csv  = rows.map((r) => `${r.id},${r.name},${r.email}`).join("\n");
  this.download("report.csv", csv, "text/csv;charset=utf-8");
}

@expose @renderless async triggerWebhook(): Promise<void> {
  await fetch("https://hooks.example.com/notify", {
    method: "POST",
    body: JSON.stringify({ userId: this.userId }),
  });
  this.flash("Webhook sent.", "success");
}

@expose @renderless async archivePost(): Promise<void> {
  await Post.where("id", this.postId).update({ status: "archived" });
  this.redirect("/posts");
}
```

Because the render cycle is skipped, `@renderless` actions are faster and cheaper for effects that don't produce UI output.

## The @on decorator

Registers a method as a listener for cross-component events dispatched via `this.dispatch()`. The method is implicitly exposed — no separate `@expose` needed:

```typescript
@on("post-created")
async handlePostCreated(data: { id: number; title: string }): Promise<void> {
  this.posts = await Post.query().orderBy("created_at", "desc").limit(10).get();
  this.flash(`"${data.title}" was published.`);
}

@on("user-updated")
async refreshUser(data: { userId: number }): Promise<void> {
  this.user = await User.findOrFail(data.userId);
}

// Listen for real-time WebSocket broadcasts (see Events doc for channel formats)
@on("socket:orders,OrderPlaced")
async onOrderPlaced(payload: { id: number }): Promise<void> {
  this.orderCount++;
  this.flash("New order received!", "success");
}

// A channel naming a record needs a resolver — the string form is read off the
// class, so `"socket:orders.${this.id},…"` would subscribe to that literal text.
@on((self) => `socket-private:orders.${self.orderId},OrderCancelled`)
async onOrderCancelled(payload: { id: number }): Promise<void> {
  this.orderCount--;
}
```

Both forms are a `ListenerName`: the event string itself, or a resolver handed the component instance that returns one.

See [Events & Broadcasting](/docs/flow/events) for dispatch methods, targeting, broadcasting, and native event integration.

## The @reactive decorator

For child components — marks a prop the parent can re-push whenever its value changes. The child re-renders with the new prop while keeping the rest of its own state intact.

Declare the reactive prop on the child:

```tsx
export class PriceTag extends Component {
  @reactive currency = "USD";
  @reactive amount = 0;

  @computed get formatted(): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: this.currency,
    }).format(this.amount);
  }

  override async render() {
    return <span class="price text-2xl font-bold">{this.formatted}</span>;
  }
}
```

Pass the prop from the parent:

```tsx
// When this.currency changes, PriceTag re-renders automatically:
<PriceTag currency={this.currency} amount={this.subtotal} />
```

Unlike `@locked`, `@reactive` props are **live** — the parent keeps them current on every round-trip. See [Layouts & Composition](/docs/flow/layouts#reactive-props) for the full pattern.

## The @modelable decorator

A reactive prop that **also syncs back to the parent** (two-way). The parent property and the child prop stay in lock-step. Use for reusable input/control components that need to write a value back to their parent:

```tsx
export class StarRating extends Component {
  @modelable rating: number = 0; // two-way bound to parent

  @expose set(n: number): void {
    this.rating = n; // flows up to the parent immediately
  }

  override async render() {
    return (
      <div class="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={String(n)}
            onClick={() => this.set(n)}
            class={n <= this.rating ? "text-yellow-400" : "text-gray-300"}
          >
            ★
          </button>
        ))}
      </div>
    );
  }
}

// Parent — this.productRating and StarRating.rating stay in sync both ways:
<StarRating value={this.productRating} />;
```

See [Layouts & Composition](/docs/flow/layouts#two-way-props) for the full `@modelable` pattern with nested form controls.

## Decorator combination reference

| Combination                                     | Meaning                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| `@expose prop`                                  | Synced to client; client can mutate via `value=` or client expression |
| `@locked prop`                                  | Synced to client for display only; client cannot change it            |
| `@url prop`                                     | Two-way, AND synced to the URL query string                           |
| `@url({ as: "q" }) prop`                        | URL-synced with a custom query parameter name                         |
| `@url({ history: "push" }) prop`                | URL-synced; browser history entry pushed on each change               |
| `@expose @validate((r) => r.required()…) prop`  | Two-way, AND auto-validated by `this.validate()` + live on update     |
| `@url @validate((r) => r.number().min(1)) page` | URL-synced page number with type validation                           |
| `@session prop`                                 | Reads/writes the session key of the same name (not in snapshot)       |
| `@session({ key: "s" }) prop`                   | Reads/writes the session key `s`                                      |
| `@session({ scoped: true }) prop`               | Namespaces the key to this component                                  |
| `@transient prop`                               | Local-only; excluded from snapshot; reset on each round-trip          |
| `@computed get prop()`                          | Derived; not in snapshot; memoized per render pass                    |
| `@expose method`                                | Callable from the browser via WebSocket                               |
| `@expose @renderless method`                    | Callable from browser; skips re-render cycle                          |
| `@on("event") method`                           | Listens for cross-component events (auto-exposed)                     |
| `@on("socket:channel,Event") method`            | Listens for real-time server broadcasts                               |
| `@on((self) => "socket:…") method`              | Same, with the channel resolved per instance (record ids)             |
| `@reactive prop`                                | Child prop; parent re-pushes on change, child re-renders              |
| `@modelable prop`                               | Two-way child prop; writes from child flow back to parent             |

## Action helpers

These helpers are available inside any `@expose`d method:

```typescript
// Flash a toast notification to the browser
this.flash("Saved successfully!"); // level defaults to "success"
this.flash("Could not connect.", "error");
this.flash("Check your inbox.", "info");
this.flash("Your session expires in 5 minutes.", "warning");

// Redirect after the action completes (sends a redirect effect to the browser)
this.redirect("/dashboard");
this.redirect(`/posts/${post.id}`);
this.redirectRoute("profile", { id: 1 }); // named route → /users/1 (extra keys become ?query)
this.redirectIntended("/dashboard"); // back to where AuthMiddleware intercepted, else the fallback

// Force onMount() to re-run this round-trip (useful for reloading stale data)
this.refresh();

// The document title is `static title` on the class, not an action — see Routing.

// Run JavaScript in the browser after the DOM patch is applied. `$` is a tagged
// template, so interpolated values are encoded for you.
this.$`$refs.titleInput.focus()`;
this.$`window.scrollTo({ top: 0, behavior: 'smooth' })`;
this.$`$dispatch('toast', { message: ${this.message} })`;

// Trigger a file download in the browser
this.download("report.csv", csvContent, "text/csv;charset=utf-8");
this.download("export.json", JSON.stringify(data, null, 2), "application/json");
```

## The errors API

`this.errors` is a typed proxy over the validation error bag. It is populated by `this.validate()` and `this.addError()`.

```tsx
// Check if any validation errors exist
if (this.errors.any()) {
  return; // stop processing
}

// Check a specific field
if (this.errors.has("email")) {
  this.flash("Please fix the email address.", "error");
}

// In JSX — reactive; shows the first error message for the field or hides itself:
<span error={this.errors.email} class="text-sm text-red-500" />
<span error={this.errors.name}  class="text-sm text-red-500" />

// Add manual errors (e.g., from a database constraint)
this.addError("email", "That email address is already taken.");
this.addError("slug",  "This slug is already in use.");

// Clear validation state
this.resetValidation();          // clear all fields
this.resetValidation("email");   // clear one specific field
```

The `error` JSX prop compiles to `flow:error="field"`. It reads from `this.errors.<field>` reactively — when the field has no error, the element is hidden; when it has one, the element shows the first message. No conditional rendering needed in the template.

## Next steps

- [Flow overview](/docs/flow) — the guide's front page and the rest of the sections.
- [Reference](/docs/flow/references) — every decorator, prop, and directive in one table.
