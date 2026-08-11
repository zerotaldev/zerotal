# @zerotal/admin

> A Filament-style, server-driven admin panel for Zerotal — built on
> [`@zerotal/flow`](../flow) (reactivity) and [`@zerotal/flow-ui`](../flow-ui) (components).

You declare a **Resource** per model; the panel renders the navigation, the data
table, search, sorting, and pagination for you. Pages are Flow components, so
everything runs on the server and streams over WebSocket — no API layer, no
client store.

The default UI ships with **light + dark mode out of the box**. Styling currently
loads Tailwind via the Play CDN (configured in `theme.ts`); swapping to a real
Tailwind build later only touches that one file.

> **Status:** stable — the public API follows SemVer strictly for the rest of the 1.x
> line. Anything importable without an `@internal` marker is covered, and the surface is
> snapshotted in `api-surface.md`, which CI diffs on every change. You get navigation, list pages (search / sort /
> paginate), a read-only **View** page (infolists), reactive **Create / Edit**
> forms with validation, a **Delete** row action, and a configurable auth
> **guard**. The previous config-driven admin has been retired; it remains
> available in pre-1.1 releases (and on the `admin-legacy` git tag).

## Setup

```ts
// bootstrap/providers.ts
import { FlowProvider } from "@zerotal/flow";
import { AdminProvider } from "@zerotal/admin"; // after FlowProvider

export default [FlowProvider, AdminProvider];
```

```ts
// app/admin.ts  (auto-loaded on boot)
import { Panel, Resource, text } from "@zerotal/admin";
import { User } from "./models/User.ts";

Panel.configure({ brand: "Acme", path: "/admin" });

class UserResource extends Resource {
  static model = User;
  static navigationIcon = "users";
  static navigationGroup = "Access";

  static columns() {
    return [
      text("id").sortable(),
      text("name").searchable().sortable(),
      text("email").searchable(),
      text("role").badge((v) => (v === "admin" ? "primary" : "muted")),
      text("created_at").label("Joined").sortable(),
    ];
  }
}

Panel.register(UserResource);
```

Visit `/admin`. Each resource gets a list page (`/admin/users`), a read-only
detail page (`/admin/users/:id`), and a Delete action on every row.

### Guarding the panel

The panel is public by default — fine locally, not in production. Pass
`middleware` to gate every route (it runs on the list, view, and dashboard):

```ts
import { AuthMiddleware } from "@zerotal/auth";

Panel.configure({
  path: "/admin",
  middleware: [AuthMiddleware.with({ mustVerifyEmail: true })],
});
```

### View page (infolists)

The detail page renders a Filament-style **infolist** — read-only entries grouped
into sections. Define `infolist()` to customize it; omit it and the page falls
back to one section derived from `columns()`.

```ts
import { Resource, section, textEntry, iconEntry } from "@zerotal/admin";

class UserResource extends Resource {
  static infolist() {
    return [
      section("Profile")
        .description("Identity and sign-in details")
        .icon("users")
        .columns(2)
        .schema([
          textEntry("name").weight("semibold").size("lg"),
          textEntry("email").icon("mail").copyable(),
          iconEntry("email_verified_at").label("Email verified"), // ✓ / ✗ boolean
          textEntry("role")
            .badge()
            .color((v) => (v === "admin" ? "primary" : "muted")),
        ]),
      section("Activity")
        .columns(2)
        .schema([
          textEntry("created_at").label("Joined").dateTime(),
          textEntry("created_at").label("Member for").since(),
        ]),
    ];
  }
}
```

Entry API: `.label()`, `.state(fn)`, `.default()`, `.placeholder()`, `.format(fn)`,
`.badge()`, `.color()`, `.icon()`, `.copyable()`, `.url(fn)`, `.weight()`, `.size()`,
`.tooltip()`, `.columnSpan()`, `.limit()`, `.date()` / `.dateTime()` / `.since()`,
`.money()`. `iconEntry(...)` renders a boolean check/cross. Section API:
`.heading()`, `.description()`, `.icon()`, `.columns()`, `.collapsible()`.

### Create / Edit forms

Declare `form()` to get reactive Create (`/admin/users/create`) and Edit
(`/admin/users/:id/edit`) pages. Fields bind two-way over Flow's WebSocket
runtime and validate on save — no API layer, no client store.

```ts
import { Resource, textInput, textarea, select } from "@zerotal/admin";
import { Hash } from "@zerotal/auth";

class UserResource extends Resource {
  static form() {
    return [
      textInput("name").required().minLength(2).maxLength(120),
      textInput("email").email().required(),
      select("role").options({ admin: "Admin", member: "Member" }).required(),
      // Hash on save; only ask for it when creating.
      textInput("password")
        .password()
        .required()
        .minLength(8)
        .visibleOn("create")
        .mutate((v) => Hash.make(String(v))),
    ];
  }
}
```

Field API: `textInput` / `textarea` / `select` / `checkbox`; type modifiers
`.email()`, `.password()`, `.numeric()`, `.url()`, `.tel()`; `.label()`,
`.placeholder()`, `.helperText()`, `.default()`, `.required()`, `.minLength()` /
`.maxLength()` / `.min()` / `.max()`, `.confirmed()`, `.options()`, `.rows()`,
`.columnSpan()`, `.disabled()`, `.rule(fn)`, `.mutate(fn)` (transform before
save, e.g. hashing), and `.visibleOn()` / `.hiddenOn()` to vary a field by page.

## Column API (Phase 1)

```ts
text("name")
  .label("Full name")     // header text (defaults to a title-cased key)
  .sortable()             // clickable, URL-driven sort header
  .searchable()           // included in the list search box
  .align("end")           // "start" | "center" | "end"
  .format((v) => …)       // custom value formatter
  .badge((v) => "success" | "primary" | "muted" | "destructive" | null)
```

## Theming / dark mode

`theme.ts` defines the shadcn-style design tokens (the same ones flow-ui
components consume) for both `:root` and `.dark`, plus a no-flash init script.
The toggle in the top bar persists the choice to `localStorage`. To rebrand,
edit the `--primary` (and friends) HSL values in `theme.ts`.

## Listing: tabs + default sort

Add filter **tabs** (Filament's `getTabs()`) above the table, each scoping the
query with an optional count badge, and set a **default sort**:

```ts
import { Resource, tab } from "@zerotal/admin";

class UserResource extends Resource {
  static defaultSort = { column: "created_at", direction: "desc" as const };

  static tabs() {
    return [
      tab("all").label("All").badge(),
      tab("verified")
        .label("Verified")
        .badge()
        .badgeColor("success")
        .modifyQuery((q) => q.whereNotNull!("email_verified_at")),
      tab("unverified")
        .label("Unverified")
        .badge()
        .modifyQuery((q) => q.whereNull!("email_verified_at")),
    ];
  }
}
```

`tab(key)` API: `.label()`, `.icon()`, `.badge(value?)` (no arg = live count),
`.badgeColor(tone)`, `.modifyQuery(q => q)`. The active tab lives in the URL
(`?tab=…`) and composes with search, sort, and pagination.

Badge **counts are cached** per resource and invalidated automatically whenever
one of its records is created / updated / deleted (via the ORM's `ModelChanged`
event), so the `COUNT(*)` per tab runs only after a write — not on every list
view. Caching is best-effort: with no cache driver bound, counts are computed
each render.

## Relationships

Three pieces, mirroring Filament's relationship support:

```ts
class PostResource extends Resource {
  static model = Post;
  static eager = ["author"]; // eager-load relations for the table/view

  static columns() {
    return [
      text("title").searchable().sortable(),
      // BelongsTo column — read the loaded relation
      text("author")
        .label("Author")
        .format((author) => author?.name ?? "—"),
    ];
  }

  static form() {
    return [
      textInput("title").required(),
      // BelongsTo <select> — options loaded from the related model
      select("userId")
        .label("Author")
        .required()
        .optionsUsing(async () =>
          (await User.all()).map((u) => ({ value: String(u.id), label: u.name })),
        ),
    ];
  }
}

class UserResource extends Resource {
  static model = User;
  // HasMany relation manager — the user's posts, as a linked table on the View page
  static relations() {
    return [hasMany(PostResource, "user_id").title("Posts")];
  }
}
```

- `static eager: string[]` — relations to eager-load for list + view (so a column
  or entry can read `row.author.name`).
- `select(key).optionsUsing(async () => …)` — async option source for a BelongsTo
  picker. FK columns should be cast (`@column("integer")`) so they match the
  parent key type when the ORM resolves the relation.
- `relations()` + `hasMany(RelatedResource, foreignKey)` — renders the children as
  a table on the parent's View page, linking into their own resource for full CRUD.

## Custom pages

Anything that isn't a model to edit — a settings screen, a report, an ops console
— extends `AdminPage`. It's a Flow component with statics describing where it
belongs, so the panel mounts the route and adds the sidebar entry for you.

```ts
import { AdminPage, Panel } from "@zerotal/admin";

class ReportsPage extends AdminPage {
  static override slug = "reports";
  static override title = "Reports";
  static override navigationGroup = "Insights";
  static override ability = "reports.view";

  override async render() {
    return <div>…</div>;
  }
}

Panel.pages(ReportsPage);
```

`ability` is checked twice: once to draw the sidebar entry, once in the route
guard. Both run the same resolver, so a link the user can't see is a URL they
can't open. Abilities resolve through `authorize` in `config/admin.ts`, then the
`gate` binding when `@zerotal/auth` is installed — and with neither configured
they're denied outside a development environment, so an unwired panel stays closed
in production.

## Extending the panel from a package

The panel is a host. It publishes a contribution surface as the `admin.panel`
container binding and names no contributor, so another package can add pages,
widgets, navigation and search results without depending on this one:

```ts
// In a contributing provider's onBooting()
const panel = app.container.tryMake("admin.panel") as AdminHost | undefined;
if (!panel?.enabled("queue")) return;
panel.page({ slug: "jobs", page: JobsPage, title: "Jobs", ability: "queue.view" });
```

Contributors declare the host's shape locally rather than importing it, so nothing
links the two packages at build time. Contributions are automatic — installing
both providers is enough — and `plugins: { queue: false }` in `config/admin.ts`
switches one off without uninstalling it.

See [the admin guide](../../docs/admin/extending.md) for the full contribution surface.

## Structuring a larger panel

Six resources need no structure. Past that:

- **Clusters** give a group of resources a shared URL segment and one sidebar
  entry — `static cluster = ShopCluster` puts a resource at `/admin/shop/products`.
- **Nested resources** move a resource inside its parent's records:
  `static parent = { resource: () => PostResource, foreignKey: "post_id" }` gives
  `/admin/posts/7/comments`, scoped to that post.
- **Singular resources** back a single row — `static singular = true` collapses
  list, view and edit into one route.
- **Multiple panels** serve a second audience: `Panel.make("console", { path: "/app" })`
  gets its own registry, guard and branding.

See [Panel Structure](../../docs/admin/structure.md) for the details.

## Scaffolding

```bash
bun zt make:admin-resource Product
bun zt make:admin-resource Comment --parent=Post --foreign-key=post_id
bun zt make:admin-resource Setting --singular
```

Or start a whole project from the panel: `bun create zerotal my-admin` and choose
the **Admin** template.

## Not yet covered

Multi-tenancy and the 2FA challenge step.

> **Design note:** the List and View pages are generated as one subclass per
> resource and are **URL-driven** — search, sort, pagination, and tabs live in
> `@url` props that re-seed from the query string on every navigation, so they
> work for any number of resources. The Create/Edit page is different: it binds a
> client-reactive `@expose form` object over the WebSocket, which Flow's
> field-decorator registration ties to a single prototype, so it's a single
> shared class that resolves the resource from the route slug.
