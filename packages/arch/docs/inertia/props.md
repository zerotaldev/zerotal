---
title: Inertia Props
description: Pass data to a page — eager, lazy, deferred, and merged props, plus the shared props every page receives.
---

# Data props

Zerotal implements the full **Inertia v3** server-side data-props protocol. These features let you
control _which_ props are sent, _when_ they're evaluated, and _how_ the client merges them — the
foundation for fast pages, "load more" lists, and deferred content. They work with the stock
`@inertiajs/react` / `@inertiajs/vue3` clients; no extra client setup is required.

Import the helpers directly or use the `Inertia` facade:

```ts
// in a controller
import { inertia, optional, always, defer, merge, deepMerge } from "@zerotal/inertia";
// or
import { Inertia } from "@zerotal/inertia";
```

> **Tip** — Not sure which wrapper to reach for? The short version: a bare value is
> always sent and always evaluated; a `() => …` function is always sent but only
> evaluated when included; `optional()` is sent only when a partial reload asks for it;
> `defer()` loads after first paint; `merge()`/`scroll()` combine new data with what
> the client already has.

## Page props are page source

**A page receives a projection chosen by its route, never a model — unless that model has
declared which of its columns are safe to publish.**

Everything you hand to `inertia()` is serialised into the HTML document, or returned as JSON
on an XHR visit. Anyone who views source reads all of it. That is how the protocol works, and
it is fine right up to the moment a model goes through it:

```ts fragment
// in a controller
return inertia("Trips/Show", { trip }); // ← every column of the row, in the page
```

`trip.toJSON()` ships the whole row. If that row has an internal cost, a margin, a supplier
reference or a note somebody left about the customer, all of it is now on the customer's own
screen. Nothing fails, nothing logs, and the page looks right. This is the one mistake on this
page that does not announce itself.

### Declare the boundary at the model

The ORM's `hidden` and `visible` lists are honoured by `toJSON()`, which is exactly what
serialises a prop — so declaring them once at the model covers every route that ever passes it:

```ts fragment
import { Model, type Columns } from "zerotal/orm";

class Trip extends Model {
  // Never leaves the server, whoever passes this model to whatever page.
  static hidden: Columns<Trip>[] = ["cost_cents", "markup_percent", "internal_notes"];
}
```

`visible` is the allow-list form and takes precedence: state the columns a page may have, and a
column added to the table later is private by default rather than published by default.

In development, passing a model that declares neither list writes a warning naming the model and
the number of fields it is about to publish. It fires once per model class and goes quiet as soon
as either list exists.

### When a route needs its own shape

A `hidden` list is one decision for the whole app. Where two audiences need different columns of
the same model, project per route and keep the dangerous fields out of the client-facing shape
entirely:

```ts fragment
// in a controller
function forCustomer(trip: Trip) {
  return { id: trip.id, title: trip.title, total_cents: trip.total_cents };
}

function forOps(trip: Trip, options: { showCost: boolean }) {
  return {
    ...forCustomer(trip),
    // Absent, not zeroed. A zero looks like a fact; a missing key cannot be misread.
    ...(options.showCost ? { cost_cents: trip.cost_cents } : {}),
  };
}
```

Prefer omitting a field over blanking it. A `cost_cents: 0` in page source reads as "this trip
cost us nothing", and somebody will eventually believe it.

## Partial reloads

On a visit to the _same page_, the client can request a subset of props with `only` / `except`.
The server evaluates and returns just those props; the client keeps the rest. Zerotal reads the
`X-Inertia-Partial-Data` / `X-Inertia-Partial-Except` / `X-Inertia-Partial-Component` headers
automatically — you don't write any special code for the route, you just make props lazy.

```tsx fragment
// client
router.reload({ only: ["users"] });
```

### Lazy evaluation

Wrap optional data in a function so it's only evaluated when actually included:

```ts fragment
// in a controller
return inertia("Users/Index", {
  users: () => User.all(), // evaluated every full visit, and on partial reloads that ask for it
  companies: () => Company.all(),
});
```

A function prop is **always sent** on a full visit but only **evaluated when included**, so excluding
it from a partial reload also skips the query.

## Optional and always props

`optional(fn)` — never sent on a normal visit; only when explicitly requested via `only`. Ideal for
expensive data the page can load on demand.

```ts fragment
// in a controller
return inertia("Users/Index", {
  users: optional(() => User.all()), // only when reloaded with only: ["users"]
});
```

`always(value)` — always sent, even when a partial reload's `only`/`except` would exclude it. (The
shared `errors` bag uses this internally.)

| Approach                     | Full visit | Partial reload | Evaluated        |
| ---------------------------- | ---------- | -------------- | ---------------- |
| `User.all()`                 | always     | optionally     | always           |
| `() => User.all()`           | always     | optionally     | only when needed |
| `optional(() => User.all())` | never      | optionally     | only when needed |
| `always(User.all())`         | always     | always         | always           |

> **Tip** — `lazy(fn)` is an alias of `optional(fn)`, kept for parity with Inertia's
> historical name. New code should prefer `optional`.

## Deferred props

`defer(fn)` excludes a prop from the initial render and tells the client to fetch it in a follow-up
request — great for below-the-fold or slow data. Group props to control parallelism (each group is
one request).

```ts fragment
// in a controller
return inertia("Users/Index", {
  users: () => User.all(),
  permissions: defer(() => Permission.all()), // default group
  teams: defer(() => Team.all(), "attributes"), // grouped together…
  projects: defer(() => Project.all(), "attributes"), // …fetched in one request
});
```

The first response carries a `deferredProps` map; the client then partial-reloads each group. On the
client, wrap the UI in `<Deferred>`:

```tsx fragment
// in a page component
import { Deferred } from "@inertiajs/react";

<Deferred data="permissions" fallback={<div>Loading…</div>}>
  <Permissions />
</Deferred>;
```

### Error handling

Pass `{ rescue: true }` so a thrown error is swallowed and the key reported in `rescuedProps` (the
client renders the `<Deferred rescue>` slot) instead of failing the whole response:

```ts fragment
// in a controller
permissions: defer(() => Permission.all(), "default", { rescue: true }),
```

## Merging props

By default a reloaded prop _replaces_ the client value. `merge()` / `deepMerge()` make the client
**combine** the new data with what it already has — the basis for paginated "load more" lists. Merging
only happens on partial reloads (full visits always replace).

```ts fragment
// in a controller
return inertia("Feed", {
  posts: merge(() => Post.paginate(15, page)), // append at root
});
```

Chainable targeting:

```ts fragment
// in a controller
merge(users).append("data").matchOn("data.id"); // append to users.data, replace items matching id
merge(items).prepend(); // prepend at root
deepMerge(chat).matchOn("messages.id"); // deep-merge the whole structure
```

These populate the page object's `mergeProps` / `prependProps` / `deepMergeProps` / `matchPropsOn`,
which the client uses to merge correctly. Use the client's `reset: ["posts"]` option to clear a prop
before merging fresh data (e.g. on a new search) — Zerotal honors the `X-Inertia-Reset` header.

## Infinite scroll

`scroll(paginator)` is purpose-built for the client's `<InfiniteScroll>` component. It merges the
paginator's `data` array and emits a `scrollProps` entry describing the current/next/previous page,
so the client knows when (and which way) to load more:

```ts fragment
// app/controllers/PostController.ts
import { inertia, scroll } from "@zerotal/inertia";

async index(ctx: HttpContext) {
  const page = Number(ctx.query("page", "1"));
  return inertia("Posts/Index", {
    posts: scroll(() => Post.paginate(15, page)),         // merges posts.data, emits scrollProps
    // scroll(() => Post.paginate(15, page), { pageName: "p", dataPath: "data" })
  });
}
```

This produces a page object like:

```json
{
  "mergeProps": ["posts.data"],
  "scrollProps": {
    "posts": { "pageName": "page", "previousPage": null, "nextPage": 2, "currentPage": 1 }
  }
}
```

`next`/`previous` page are derived from the paginator (`currentPage`/`page`, `lastPage`, or
`total`+`perPage`). When the user scrolls **up**, the client sends
`X-Inertia-Infinite-Scroll-Merge-Intent: prepend` and Zerotal prepends the new page instead of
appending — no controller change needed. On the client:

```tsx fragment
// in a page component
import { InfiniteScroll } from "@inertiajs/react";

<InfiniteScroll data="posts">
  {posts.data.map((post) => (
    <Post key={post.id} post={post} />
  ))}
</InfiniteScroll>;
```

## Once props

Chain `.once()` onto an optional/merge/defer prop so it's resolved a single time and remembered by the
client across navigations. The client sends `X-Inertia-Except-Once-Props` with the keys it already
holds; the server skips re-resolving them.

```ts fragment
// in a controller
return inertia("Billing/Plans", {
  plans: optional(() => Plan.all()).once(),
});
```

## History encryption

Encrypt the current page's browser history state (so sensitive data isn't readable from
`window.history` after logout), or clear it:

```ts
// in a controller
import { Inertia } from "@zerotal/inertia";

Inertia.encryptHistory(); // encrypt this page's history entry
Inertia.clearHistory(); // e.g. in your logout action
```

Set a global default in config:

```ts
// config/inertia.ts
import { InertiaConfig } from "@zerotal/inertia";

export default InertiaConfig({ encryptHistory: true });
```

> **Danger** — Without history encryption, sensitive props remain readable from
> `window.history` after a user logs out. Call `Inertia.clearHistory()` in your logout
> action (or set `encryptHistory: true`) for pages that render private data.

## External & fragment redirects

`Inertia.location(url)` performs a full-page visit to an external URL — a `409` with
`X-Inertia-Location` for Inertia requests, a `302` otherwise:

```ts fragment
// in a controller
return Inertia.location("https://billing.stripe.com/session/abc");
```

Redirects whose target carries a URL fragment (`/page#section`) are automatically converted to a
`409` + `X-Inertia-Redirect` on Inertia requests, so the client performs an Inertia visit that
preserves the fragment.

## Precognition

Precognition lets a form validate against the server's real rules **without running the controller's
side effects** — perfect for live, inline validation. Register `PrecognitionMiddleware` and use a
`FormRequest`; when the client sends `Precognition: true`, `FormRequest.validate()` short-circuits
with a `204` (valid) or `422` (errors), optionally limited to the fields in `Precognition-Validate-Only`.

```ts fragment
// bootstrap — register PrecognitionMiddleware globally
import { PrecognitionMiddleware } from "@zerotal/inertia";

// app/controllers/PostController.ts — unchanged; validate() becomes precognition-aware automatically
async store(ctx: HttpContext) {
  const data = await StorePostRequest.validate();
  // ...only runs on a real (non-precognition) submit
}
```

The middleware itself only stamps `Vary: Precognition` on precognitive responses; the validation
short-circuit happens inside `FormRequest.validate()`. On the client, use the `@inertiajs/react`
precognition `useForm().validate(...)` helpers as usual.

## Page object reference

Each feature contributes fields to the JSON [page object](https://inertiajs.com/docs/v3/core-concepts/the-protocol#the-page-object).
Zerotal emits these automatically; you never build them by hand. Fields are omitted when empty.

| Field                                            | Set by                                              |
| ------------------------------------------------ | --------------------------------------------------- |
| `component`, `props`, `url`, `version`           | always (core)                                       |
| `deferredProps`                                  | `defer()` — `{ group: [keys] }` on first load       |
| `rescuedProps`                                   | a rescued `defer()` prop that threw                 |
| `mergeProps` / `prependProps` / `deepMergeProps` | `merge()` / `.prepend()` / `deepMerge()`            |
| `matchPropsOn`                                   | `.matchOn(...)`                                     |
| `scrollProps`                                    | `scroll()` — infinite-scroll pagination config      |
| `onceProps`                                      | `.once()`                                           |
| `encryptHistory` / `clearHistory`                | `Inertia.encryptHistory()` / `clearHistory()`       |
| `sharedProps`                                    | keys registered via `Inertia.share()` (+ built-ins) |

### Request headers Zerotal reads

`X-Inertia`, `X-Inertia-Version`, `X-Inertia-Partial-Data`, `X-Inertia-Partial-Except`,
`X-Inertia-Partial-Component`, `X-Inertia-Reset`, `X-Inertia-Except-Once-Props`,
`X-Inertia-Error-Bag`, and `Precognition` / `Precognition-Validate-Only`.

## Shared props

Shared props are merged into **every** Inertia page automatically, so common data
like the authenticated user and flash messages are always available to your
components without each controller passing them explicitly.

```ts
// in a controller
import { sharedProps } from "@zerotal/inertia";
```

`inertia()` calls `sharedProps()` internally and spreads the result **under** your
controller's props (`{ ...sharedProps(), ...props }`), so a prop you pass with the
same key wins.

### What's provided

```ts fragment
// the shared bag sharedProps() returns
{
  auth: {
    user: ctx.user ?? null,   // reduced to plain scalars — never a live ORM model
  },
  flash: {
    success: session.get("success") ?? null,
    error:   session.get("error")   ?? null,
  },
  errors: always(session.get("errors") ?? {}),  // from a validation redirect
  old:    session.get("old")    ?? {},          // previous form input
}
```

`errors` is wrapped in [`always()`](#optional-and-always-props) so it survives
[partial reloads](#partial-reloads) — the Inertia client always expects an
`errors` bag. When the request carries an `X-Inertia-Error-Bag` header, errors are namespaced under
that bag. The other shared props (`auth`/`flash`/`old`) are ordinary props, so a partial reload's
`only`/`except` filter applies to them, matching Inertia's semantics.

Every page component can read these without the controller passing them:

```tsx fragment
// resources/js/pages/Page.tsx
import { usePage } from "@inertiajs/react";

export default function Page() {
  const { auth, flash, errors } = usePage<{
    auth: { user: { name: string } | null };
    flash: { success: string | null; error: string | null };
    errors: Record<string, string>;
  }>().props;

  return (
    <>
      {flash.success && <div className="toast">{flash.success}</div>}
      {auth.user ? <span>{auth.user.name}</span> : <a href={route("login")}>Sign in</a>}
    </>
  );
}
```

#### Why auth.user is a plain object

`sharedProps()` serializes the authenticated user to **scalar fields only** — it
skips methods and array-valued properties. This is deliberate: a live model with an
unloaded `@hasMany` relation throws when `JSON.stringify` touches the relation getter.
The plain object is always safe to send. If a page needs related data, load it
explicitly in the controller and pass it as a normal prop.

> **Warning** — Don't pass a live ORM model as a prop expecting all its relations.
> `JSON.stringify` triggers relation getters, which throw if the relation wasn't
> eager-loaded. Eager-load (`.with(...)`) or map to a plain shape first.

### Adding custom shared props

#### Register with Inertia.share

Register props once — typically in a provider's boot or in middleware — and they're merged into
every page. Values may be plain values, factory functions (evaluated lazily per request), or any
[prop wrapper](#data-props):

```ts fragment
// in a provider's boot or middleware
import { Inertia } from "@zerotal/inertia";

// Single key, or a map:
Inertia.share("appName", "Acme");
Inertia.share({
  appName: "Acme",
  year: () => new Date().getFullYear(), // evaluated per request
  flags: Inertia.optional(() => FeatureFlag.all()), // only on partial reloads
});
```

Shared props are subject to partial-reload filtering just like page props (except `errors`, which is
`always()`), and they appear in the page object's `sharedProps` list so the client can carry them
over during instant visits.

#### Merge in the controller

```ts fragment
// in a controller
return inertia("Dashboard", {
  notifications: await Notification.query().where("user_id", user.id).unread().get(),
  // auth, flash, errors, old are merged automatically — no need to repeat them
});
```

#### Share from middleware via the context

When several pages need the same extra data, set it on the context in a middleware
and read it back in the controller — keeping the controller body clean:

```ts fragment
// in a middleware:
ctx.setInternal("unreadCount", await Notification.unreadCount(ctx.user!.id));

// in the controller:
return inertia("Layout", {
  unreadCount: ctx.getInternal<number>("unreadCount"),
});
```

This pattern pairs well with a persistent [layout](/docs/inertia/build#generating-a-page) that
displays the value on every page.

## Typed props

The props a controller passes are checked against the props the page component
declares:

```tsx fragment
// resources/js/pages/Posts/Show.tsx
interface Props {
  post: Post;
  related: Post[];
  stats?: { views: number }; // optional — it arrives after first paint
}
export default function Show({ post, related, stats }: Props) { … }
```

```ts fragment
// in a controller
return Inertia.render("Posts/Show", {
  post,
  related: [],
  stats: defer(() => computeStats()),
});

Inertia.render("Posts/Shwo", { … }); // ✗ not a page
Inertia.render("Posts/Show", { post }); // ✗ Property 'related' is missing
Inertia.render("Posts/Show", { post, relatd: [] }); // ✗ Did you mean 'related'?
```

Nothing is annotated to make this work. The component already declares its props,
and `resources/js/pages.generated.ts` already holds an `import()` thunk per page —
and an `import()` thunk carries the module's full type. The registry is written
with `satisfies`, so those types survive, and one type-only line in that same file
hands them to the server. Rebuild it with `bun zt inertia:build` (or just run
`zt dev`, which rebuilds it on every change).

The check runs in the direction that costs nothing: the **component** declares
the shape and the **controller** is checked against it.

### Wrappers are unwrapped

The two sides genuinely differ — the controller passes `merge(() => posts)` and
the component receives `Post[]` — so each prop accepts its value, a factory for
it, or a wrapper carrying it, and the wrapper's payload is checked against the
prop it fills:

```ts fragment
Inertia.render("Posts/Show", { post, related: merge(() => [1, 2]) });
// ✗ number[] is not Post[]
```

> **Warning** — `optional()` and `defer()` are only accepted where the component
> declares the prop as optional. They are _absent on first paint_ by definition,
> so a component that types such a prop as required is wrong about its own
> contract. Types that accepted it anyway would launder that bug into something
> the compiler had signed off on. Add the `?` — and handle the undefined.

### Shared props are never required

`auth`, `flash`, `errors` and `old` are merged into every page, so a controller
never has to pass them — even when the page component declares them. Props you
register yourself with `Inertia.share()` are a runtime call that nothing can
generate, so declare them once:

```ts
// resources/js/types.ts (next to the interface your pages read with usePage)
declare module "@zerotal/inertia" {
  interface SharedProps {
    appName: string;
    flags: Record<string, boolean>;
  }
}
```

They then become optional-but-accepted in every `Inertia.render` call: a page may
still override one, and no page is forced to pass it.

### What is not checked

- **A page name only known at runtime** — an error page chosen by status code, a
  component from config — has nothing to check against. Use
  `Inertia.render.dynamic(name, props)`, which takes any name and any props.
- **Vue pages.** A `.vue` SFC resolves through a `declare module '*.vue'` shim
  that types the default export as `DefineComponent<{}, {}, any>`, so its props
  are not visible to TypeScript unless `vue-tsc` is in your typecheck path. Those
  pages fall back to accepting any props rather than failing on a shape nobody
  can see. The page **name** is still checked; only its props are not.
- **A component wrapped in `React.memo()`** (or anything else that returns an
  object rather than a function) falls back the same way.
- **Before you rebuild the registry**, every name and every prop bag compiles, as
  it always did.

## Types

`PageObject` is what Inertia serialises into the page — component, props, url and version.
`MergeConfig` and `ScrollConfig` configure `merge()` and `scroll()`, and `PaginatorLike` is what
`scroll()` accepts from a paginator so the ORM's own and a hand-built one both work.

## Next steps

- [Inertia overview](/docs/inertia) — the guide's front page and the rest of the sections.
- [Reference](/docs/inertia/references) — the full API surface in one table.
