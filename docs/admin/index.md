---
title: Admin Panel
description: A Filament-style, server-driven admin panel — declare resources as classes and get tables, forms, infolists, actions, relations, dashboards, search, notifications, and auth pages.
---

# Admin Panel

`@zerotal/admin` is a **Filament-style** admin panel for Zerotal. You describe each
model with a `Resource` class — its table columns, form fields, infolist entries,
filters, actions, and relations — and the panel renders fully reactive CRUD pages.

It is **server-driven**: pages are [`@zerotal/flow`](/docs/flow) components and
the UI is built from [`@zerotal/flow-ui`](/docs/components), so sorting, filtering,
inline edits, modals, and live notifications all round-trip over Flow's WebSocket
morph with no client store to maintain. Light + dark mode ship out of the box.

> **Note** — This is the current, class-based admin. The earlier zero-config
> `Admin.register(Model)` panel has been retired; it remains available in
> pre-1.1 releases (and on the `admin-legacy` git tag) if you need to reference it.

## Getting Started

```bash
bun add @zerotal/admin
```

The panel renders with Flow and flow-ui, and reads/writes through your
[`@zerotal/orm`](/docs/orm) models. `@zerotal/auth` is an **optional** peer —
needed only if you enable the built-in auth pages.

## Register the providers

Add `AdminProvider` **after** `FlowProvider` (which installs the `Router.flow()`
macro and the WebSocket runtime the pages depend on):

```ts
// bootstrap/providers.ts
import { FlowProvider } from "@zerotal/flow";
import { AdminProvider } from "@zerotal/admin";

export default [FlowProvider, AdminProvider];
```

On boot the provider auto-discovers `app/admin.ts` (where you configure the panel
and register resources), then mounts the dashboard, search, notifications, and a
List / View / Create / Edit page per resource under the configured `path`.

## Quick start

```ts
// app/admin.ts
import { Panel, Resource, text, textInput } from "@zerotal/admin";
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
      text("email").searchable().copyable(),
      text("role").badge((v) => (v === "admin" ? "primary" : "muted")),
      text("created_at").label("Joined").sortable(),
    ];
  }

  static form() {
    return [textInput("name").required().maxLength(120), textInput("email").email().required()];
  }
}

Panel.register(UserResource);
```

Visit `/admin`. You now have a searchable, sortable, paginated table with Create /
Edit / View / Delete — and the form above on the Create and Edit pages.

> **Danger** — The panel is **unguarded by default** (fine for local exploration).
> Set `middleware` in your config before shipping; see [Securing the panel](/docs/admin/auth#securing-the-panel).

## Configuration

Configure the panel with `Panel.configure(...)` in `app/admin.ts`, or by exporting
an `admin` config object the provider merges on boot.

```ts
Panel.configure({
  path: "/admin",
  brand: "Acme",
  tagline: "Control panel",
  middleware: [AdminGuard], // guard every panel route
  userMenu: {
    // top-bar identity dropdown
    label: "Jane Doe",
    items: [
      { label: "Profile", href: "/admin/profile", icon: "users" },
      { label: "Sign out", href: "/admin/logout", icon: "logout" },
    ],
  },
  theme: {/* see Theming */},
  auth: {/* see Auth pages */},
});
```

| Field        | Default     | Description                                                            |
| ------------ | ----------- | ---------------------------------------------------------------------- |
| `path`       | `"/admin"`  | URL prefix the panel mounts under.                                     |
| `brand`      | `"Zerotal"` | Sidebar + login heading.                                               |
| `tagline`    | `"Admin"`   | Small text under the brand.                                            |
| `middleware` | `[]`        | Middleware guarding every panel route. **Set this before production.** |
| `userMenu`   | —           | Top-bar dropdown: `{ label?, items: [{ label, href, icon? }] }`.       |
| `theme`      | CDN         | Styling source — Tailwind Play CDN or a prebuilt stylesheet.           |
| `auth`       | —           | Built-in login / profile / reset / verify pages.                       |
| `authorize`  | —           | Decide the abilities pages and contributions name.                     |
| `plugins`    | `{}`        | Switch contributing packages off by id, e.g. `{ monitor: false }`.     |

## The rest of the guide

| Page                                            | What it covers                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| [Resources](/docs/admin/resources)              | Declare a resource and get list, create, edit, and view screens for a model.     |
| [Tables](/docs/admin/tables)                    | Columns, filters, sorting, search, and bulk actions on the list screen.          |
| [Forms & Infolists](/docs/admin/forms)          | Build create and edit forms, and lay out the read-only view screen.              |
| [Actions & Relations](/docs/admin/actions)      | Row, bulk, and page actions, related-record managers, and soft-delete handling.  |
| [Panel Structure](/docs/admin/structure)        | Clusters, nested and singular resources, and running more than one panel.        |
| [Dashboard & Navigation](/docs/admin/dashboard) | Widgets, global search, the command palette, notifications, and the nav tree.    |
| [Extending the UI](/docs/admin/extending-ui)    | Custom cells and controls, render hooks, custom data sources, table layouts.     |
| [Operations](/docs/admin/operations)            | History, impersonation, saved views, media, roles, and per-user dashboards.      |
| [Custom Pages & Plugins](/docs/admin/extending) | Add your own pages, and contribute pages or widgets to the panel from a package. |
| [Auth Pages & Theming](/docs/admin/auth)        | The built-in login and profile screens, and how to restyle the panel.            |
| [Testing the Admin Panel](/docs/admin/testing)  | Drive panel screens in tests and assert on what they render.                     |
| [References](/docs/admin/references)            | Every resource, table, form, and action API in one table.                        |

## Next steps

- [Flow](/docs/flow) — the reactivity layer the pages are built on.
- [Components](/docs/components) — the flow-ui kit the panel renders with.
- [ORM](/docs/orm) — the models, relations, and soft-deletes the panel reads.
- [Authentication](/docs/authentication) / [Authorization](/docs/authorization) — the auth pages and `can()` policies.
