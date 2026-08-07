---
title: "Flow: One Class Is the Whole Feature"
description: "The reactive frontend without the second codebase. State lives on the server, patches stream over a WebSocket, and the API layer — the endpoints, the store, the types, the loading booleans — simply never exists."
date: 2026-07-31
category: Flow
order: 2
---

# Flow: One Class Is the Whole Feature

Count the artifacts in the last interactive feature you shipped.

There was a server endpoint. There was a client-side store or hook holding the same data in a second shape. There was the serialization contract between them — probably a type you hand-maintained, or generated, or just hoped stayed true. There was loading state. There was error state. There was the moment you renamed a field on the server and found out three days later that the client still asked for the old one.

That is the tax on interactivity. Most of us stopped noticing we pay it.

**Flow** is Zerotal's server-driven UI layer, and it removes the tax by removing the boundary. You write one TypeScript class. State lives on the server. Interactions travel up as signed frames, rendered patches come back down, and Alpine morphs them into the DOM.

```tsx
export class Counter extends Component {
  @expose count = 0;

  @expose increment(): void {
    this.count++;
  }

  override async render() {
    return (
      <div>
        <p>Count: {this.count}</p>
        <button onClick={this.increment}>+1</button>
      </div>
    );
  }
}
```

```ts
Router.flow("/counter", Counter);
```

That is the entire feature. No route handler, no `fetch`, no `useState`, no JSON contract, no client build, no second codebase. Or skip the route line entirely — drop the class in `app/flow/pages/` and file-based routing serves it.

## Let's build something real

A counter proves nothing. Here is a live-searched, database-paginated list with a delete action and a confirmation dialog — the feature you actually write over and over:

```tsx
export class PostsPage extends ComponentWith(Pagination) {
  @url search = "";

  override async onUpdated(prop: string) {
    if (prop === "search") this.resetPage(); // new filter → back to page 1
  }

  @expose async destroy(id: number) {
    await Post.query().where("id", id).delete();
    this.flash("Post deleted.");
  }

  override async render() {
    const posts = await Post.query()
      .when(this.search, (q) => q.where("title", "like", `%${this.search}%`))
      .latest()
      .paginate(10); // follows this component's page

    return (
      <div>
        <input value={this.search} live placeholder="Search posts…" />

        <ul>
          {posts.data.map((post) => (
            <li key={post.id}>
              {post.title}
              <button onClick={() => this.destroy(post.id)} confirm="Delete this post?">
                Delete
              </button>
            </li>
          ))}
        </ul>

        <Pager paginator={posts} />
      </div>
    );
  }
}
```

Read what is absent. There is no `/api/posts` route. There is no `useEffect` refetching, no `isLoading` boolean, no `setPosts`, no confirm-dialog component imported and wired to local state — `confirm` renders a styled dialog and gates the action behind it. There is not even a page number: `Post.paginate(10)` reads the page this component is on, the `Pagination` mixin contributes `nextPage` / `previousPage` / `gotoPage` as browser-callable actions, and `<Pager>` renders the links. A page change re-renders; the re-render re-queries. Nothing to keep in sync, because there is only one copy.

And `Post.query()` is right there in the component, because the component runs on the server. There is no layer to cross, so there is nothing to serialize, nothing to authorize twice, and nothing to drift.

## Your URL is already state

`@url search = ""` did more than hold a string. That field is synced to the query string — seeded from `?search=` on the first paint, written back as it changes. The page above is **shareable and bookmarkable by construction**: paste the URL to a colleague and they load your exact search on your exact page, because `page` (from the mixin) is `@url`-synced too.

```ts
@url page = 1;                                // ?page=3 — the mixin ships this
@url({ as: "q" }) search = "";                // ?q=typescript
@url({ history: "push" }) tab = "overview";   // the back button steps through tabs
```

The feature you usually postpone until a user complains — "can I link to this filtered view?" — is the default.

## The router hands you your data, loaded

Dynamic pages don't fetch. Name a field after the route segment, and it arrives as the loaded record:

```ts
Router.flow("/posts/:post", PostShowPage);
```

```tsx
export class PostShowPage extends Component {
  @locked post!: Post; // :post — resolved by the router; a missing id 404s before this runs

  @expose async publish() {
    await this.post.fill({ status: "published" }).save();
    this.flash("Published.");
  }

  override async render() {
    return (
      <article>
        <h1>{this.post.title}</h1>
        <button onClick={this.publish}>Publish</button>
      </article>
    );
  }
}
```

No `onMount`, no `findOrFail`, no null check — the router already did the lookup, applying whatever your model declares (`resolveRouteBinding` for slug lookups, published-only scopes, tenant scoping) with **zero Flow-side code**. And here is the part that matters at scale: on every subsequent click, the model is restored from the component's signed snapshot instead of re-queried. A user clicking Publish, then Edit, then Save runs your actions — not three redundant `SELECT`s.

## Instant where it must be instant

The honest objection to server-driven UI is latency: some interactions should never wait for a network round trip. Flow's answer is to make that a syntactic choice rather than an architectural one:

```tsx
<button onClick={this.save}>Save</button>                       {/* server action — round-trips */}
<button onClick={() => (this.open = !this.open)}>Menu</button>  {/* client expression — instant */}
```

A **named method reference** is a server action: it round-trips, runs your TypeScript, and returns a patch.

An **arrow function** is a client expression: the compiler rewrites `this.` to `$flow.`, and it evaluates against the Alpine reactive proxy in the browser with no network involved at all. The new value rides along with your next action, where the server reconciles it and stays authoritative.

So opening a dropdown, toggling a class, or bumping an optimistic counter is instant — and saving a record is a real server call. You express the difference by writing `this.save` or `() => …`. You do not adopt a second technology to get it.

Reactive bindings work the same way. `text={this.count}` and `class={this.count > 5 ? "text-orange-600" : ""}` are evaluated client-side against the store, so they update the moment the value changes, without a render.

## Validation that answers while they type

Attach the rule to the field. Bind the input live. Done:

```tsx
export class RegisterPage extends Component {
  @validate((rule) => rule.required().email()) email = "";
  @validate((rule) => rule.required().min(8)) password = "";

  @expose async register() {
    await this.validate(); // all rules, one call
    await User.create({ email: this.email, password: this.password });
    this.redirect("/dashboard");
  }

  override async render() {
    return (
      <form onSubmit={this.register}>
        <input type="email" value={this.email} flow:model.live />
        <span error={this.errors.email} />

        <input type="password" value={this.password} />
        <span error={this.errors.password} />

        <button>Create account</button>
      </form>
    );
  }
}
```

A `flow:model.live` field is validated on the server **as the user types** — the real rule, not a client-side approximation that disagrees with it — and its error appears and clears per field without touching the others. Fields bound the default (deferred) way validate when the action calls `this.validate()`. Either way the error display is one prop, and there is exactly one set of rules in exactly one language.

## Streaming, without a second endpoint

Here is the feature that usually costs the most infrastructure: a token-by-token AI response, with cancellation.

```tsx
export class Assistant extends Component {
  @expose answer = "";

  @task async ask(prompt: string): Promise<void> {
    for await (const token of llm.stream(prompt)) {
      if (this.cancelled) break;
      this.answer += token;
    }
  }
}
```

```tsx
<p text={this.answer} />
<button onClick={() => $flow.cancel()}>Stop</button>
```

Mark an async method `@task` and just write the field. Flow flushes throttled, field-level diffs while the method runs, so the browser fills in live — no streaming endpoint, no re-render per chunk, and the field remains the snapshot's source of truth so the final render reconciles cleanly.

Cancellation is wired properly rather than cosmetically: the cancel frame is delivered **out-of-band**, past the per-component queue the running task still occupies, and the server aborts the task's `AbortSignal` before dispatch.

## Multiplayer, as a decorator

Because every client of a page holds a socket to the same server, the features that normally mean "add a realtime vendor" are field annotations.

**Who's here** — a `@presence` field stays filled with the live member list, updating on join and leave:

```tsx
export class RoomPage extends Component {
  @locked roomId = "";

  @presence((self) => `room.${self.roomId}`)
  members: PresenceMember[] = [];

  override async render() {
    return <p>{this.members.length} online</p>;
  }
}
```

**Shared state** — a `@shared` field converges across every client in a room, server-authoritative: one user drags the slider, everyone's slider moves. And Flow's events integrate with Zerotal's [broadcasting](/docs/broadcasting), so a queue job finishing on the server can patch a component on someone's screen.

No Pusher account, no socket client, no room bookkeeping. The WebSocket was already there — Flow just lets your fields use it.

## Islands, not a monolith

Components nest, and each child is its own island — its own state, its own snapshot, its own update cycle:

```tsx
<CounterCard label="Likes" />
<CounterCard label="Views" />
<CounterCard label="Shares" />
```

```tsx
class CounterCard extends Component {
  @locked label = "Count"; // ← the prop lands here; "Count" is the default
  @expose count = 0;

  @expose bump() {
    this.count++;
  }
}
```

Props land on same-named fields before any hook runs — no prop-drilling ceremony, no context API. Bumping one card patches that card: not its siblings, not the page. Mark a child `lazy` and it doesn't even mount until it scrolls into view.

## What you stop having to build

Because the server is the source of truth, a long list of things stop being your problem:

- **Loading and dirty states** are directives (`loadingAttr="disabled"`, `showOnLoading`), not booleans you track and forget to reset.
- **File uploads** POST bytes to a signed endpoint, show real progress, and resolve to a `TemporaryUploadedFile` your action can `store()`.
- **Navigation** is patched rather than reloaded — `<Link>` prefetches on hover, layouts persist, audio keeps playing through a `<Persist>` boundary.
- **Session-backed preferences** are a decorator: `@session theme = "light"` reads and writes the same session key your controllers see; `@session({ scoped: true })` keeps a wizard's half-finished state private to its page.
- **Polling, intersection, keyboard, focus-trap, transitions** are props on the element that needs them.
- **Overlays, tabs, tables, comboboxes, calendars** ship in the box — a styled component set plus an accessible headless layer beneath it. And when you want a finished design system, `@zerotal/flow-ui` is a themeable, shadcn-style kit you can import or copy into your app and own outright.

Compose the cross-cutting pieces the same way you compose everything:

```ts
class PostsPage extends ComponentWith(Pagination, FileUploads) {}
```

## What actually happens on the wire

This is not magic, and you should know the mechanism before you trust it with a production app.

`@expose count = 0` marks a field as part of the component's public state. On the first request Flow server-renders the page and embeds a **signed snapshot** of that state.

When you click, the browser sends the action plus that snapshot back. The server rehydrates the component, re-applies your route middleware — your auth guard runs on **every** action, not just page load — runs your method, re-renders, and replies with a patch. The snapshot is **HMAC-verified** on the way in: a client that edits its own state fails verification rather than mutating your server's idea of the world, and repeated forgery attempts are rate-limited by IP. `@locked` fields go further — server-writable, client-readable — so a record can be rendered reactively without ever being something the browser can talk back about.

The patch is deliberately small. Flow sends only the snapshot fields that changed since the client's last one, and omits the re-rendered HTML entirely when it is byte-identical. Actions are serialized per component, so every delta lands on the base it was computed against. A component holding a large `@locked` list does not re-transmit that list because you typed one character into an unrelated search box.

And it is compiled, not interpreted. At boot, Flow's compiler parses your `Component` classes and turns their JSX into string-concatenation render functions — the hot path is not a virtual DOM diff, it is string building. Shipping under a strict Content-Security-Policy? One config key (`cspSafe: true`) swaps in an eval-free client runtime.

Corporate proxy eating WebSockets? Flow falls back to HTTP transport and keeps working.

## The developer experience is the point

```bash
bun zt make:flow Users/Index --crud
```

One command scaffolds a resourceful page — list, create, edit, delete, validation, a form — ready to run under file-based routing. `--child` scaffolds an island; `--layout AppLayout` wraps a page.

Beyond scaffolding:

- **Hot reload that understands Flow** — edit a component and the page patches; a backend edit restarts the server and the build token brings every open tab along.
- **A dev error overlay** — an action that throws renders the stack where you're looking, not in a terminal you've buried.
- **A timeline panel** — inspect the frames and patches of every interaction in dev.
- **Durable pages** — add `static durable` and a component's state survives a full browser refresh, restored from the server and validated like any snapshot. Close the tab mid-wizard, come back, continue.
- **A first-class test harness** — mount a component, call its actions, assert its state and HTML, no browser required.

## What it is not

Flow is not a React replacement, and Zerotal does not ask you to choose.

The same application can serve plain server-rendered JSX for content pages, Flow for interactive ones, and an [Inertia](/docs/inertia) React or Vue SPA where you genuinely want a client-side application. That is a per-project — even per-route — decision, and all three share your models, your auth, and your validation rules.

Flow is the right tool when you want real interactivity without standing up a second codebase to get it. It is the wrong tool for an offline-first client, a heavily animated canvas, or anything that must keep working with the network gone. We would rather say that here than let you find out in week three.

## Try it

```bash
bun create zerotal my-app   # then pick the Flow template at the prompt
```

The [Flow guide](/docs/flow) covers components, routing, decorators, lifecycle hooks, events, forms, uploads, pagination, layouts, transport and testing.

One honest caveat: Flow is currently marked **`experimental`**. The architecture is settled and covered by tests, but the API may still move before it is promoted to `stable` — and its docs say so on every page. If that matters for your timeline, the rest of the framework's stable core does not depend on it.

---

_Flow began life as **Geleza** — isiZulu for "to flow" — and the name turned out to describe the architecture better than anything we could invent: state on the server, interactions flowing up, patches flowing back. Settling on English package names, we translated it rather than replaced it._
