---
title: Admin Custom Pages & Plugins
description: Add your own pages, and contribute pages or widgets to the panel from a package.
---

# Custom pages

A resource is the right shape when you're editing rows in a table. When you aren't
— a settings screen, a report, an ops console — extend `AdminPage` instead. It's a
Flow component with some extra statics, so `@expose` state, actions and the
WebSocket round-trip all behave exactly as they do on a resource page.

```ts
import { AdminPage, Panel } from "@zerotal/admin";

class ReportsPage extends AdminPage {
  static override slug = "reports";
  static override title = "Reports";
  static override navigationIcon = "chart";
  static override navigationGroup = "Insights";
  static override ability = "reports.view";

  override async render() {
    return <div>…</div>;
  }
}

Panel.pages(ReportsPage);
```

The statics drive everything: `slug` becomes the route under the panel path,
`title` the heading and the sidebar label (override with `navigationLabel`), and
`ability` decides who sees it. Set `showInNavigation = false` for a page that
should be reachable but not listed — a drill-in, say — and `routeParams` to hang
extra segments off the same page, so `routeParams = [":section"]` serves both
`/admin/reports` and `/admin/reports/revenue`.

## Abilities

Every custom page, contributed widget, nav entry and search provider names an
ability, and the panel checks it twice: once to decide whether to draw the entry,
and again in the route guard to decide whether to serve it. Both checks run the
same resolver, so the sidebar and the router can't drift — what you cannot see,
you cannot open by typing the URL.

Three things can answer an ability check, in order:

| Source                           | Use it when                                                          |
| -------------------------------- | -------------------------------------------------------------------- |
| `authorize` in `config/admin.ts` | The app models permissions itself.                                   |
| The `gate` binding               | You use `@zerotal/auth` — policies and abilities answer directly.    |
| Neither                          | Development only. Every ability is denied outside a dev environment. |

That last row is the important one. A panel with no authorization wired stays
closed in production, the same posture the panel guard already takes, which is
what makes it safe for a package to add pages without the app asking.

```ts
// config/admin.ts
export default {
  authorize: (ability) => currentUser()?.permissions.includes(ability) ?? false,
};
```

Resources are the exception: they authorize through their own
`Resource.can("viewAny")`, because record-level checks need context an ability
string can't carry. See [Authorization](/docs/admin/resources#authorization) above.

## Extending the panel from a package

The panel is a **host**. It publishes a write surface, binds it into the container
as `admin.panel`, and names no contributor at all — so packages add pages, widgets,
navigation and search results to the admin without the admin knowing they exist,
and without depending on `@zerotal/admin`.

A contributing provider resolves the binding in its `onBooting` and pushes:

```ts
// packages/queue/src/admin.ts
interface AdminHost {
  enabled(id: string): boolean;
  page(c: { slug: string; page: unknown; title: string; ability: string }): void;
}

export function installQueueAdmin(app: Application): void {
  const panel = app.container.tryMake("admin.panel") as AdminHost | undefined;
  if (!panel?.enabled("queue")) return;
  panel.page({ slug: "jobs", page: JobsPage, title: "Jobs", ability: "queue.view" });
}
```

Declaring the host's shape locally rather than importing it is the point: the
package compiles and ships with no dependency on the admin, and an app that runs
the queue without the panel pulls in nothing extra — the binding simply isn't
there and the function returns.

This is the same inversion the observability sinks use, so there is one extension
idiom across the framework rather than a bespoke plugin API here.

### What a package can contribute

| Surface            | Adds                                                    |
| ------------------ | ------------------------------------------------------- |
| `console()`        | A tabbed table page with actions, described as data.    |
| `page()`           | A route under the panel path, plus a sidebar entry.     |
| `widget()`         | A dashboard widget.                                     |
| `navItem()`        | A sidebar link to somewhere the panel doesn't mount.    |
| `searchProvider()` | A source of global-search results beyond the resources. |
| `topbarSlot()`     | A status pill or control in the top bar.                |
| `userMenuItem()`   | An entry in the account dropdown.                       |

### Consoles: pages described rather than built

Most packages want the same page — some tables, a few buttons, no bespoke layout.
`console()` lets a package describe that instead of rendering it, so it needs no
JSX, no `@zerotal/flow` dependency and no build configuration. The panel owns
the markup, which also means every console looks like the rest of the admin
without trying to.

```ts
panel.console({
  slug: "jobs",
  title: "Jobs",
  ability: "queue.view",
  navigationBadge: async () => (await Queue.failed()).length || null,
  tabs: [
    {
      key: "failed",
      label: "Failed",
      columns: [
        { key: "id", label: "ID", mono: true },
        { key: "className", label: "Job" },
        { key: "error", label: "Error", mono: true, format: firstLine },
      ],
      rows: () => Queue.failed(),
      rowActions: [{ key: "retry", label: "Retry", icon: "undo", run: (row) => retry(row) }],
      headerActions: [
        { key: "clear", label: "Clear failed", danger: true, confirm: "Sure?", run: clearAll },
      ],
    },
  ],
});
```

An action returns a string to flash on success, or throws to flash an error;
either way the table re-reads afterwards so it shows what the action just did.
Tabs carry their own `badge()` count, and the console as a whole can carry a
`navigationBadge()` that puts a number beside its sidebar entry.

The console's ability is re-checked on every dispatched action, not just when the
page renders — these are `@expose`d methods reachable from a client frame, so
drawing the button and running it are separately enforced.

Choose between the two doors on layout, not size: reach for `page()` when the
page genuinely needs its own component — charts, a custom arrangement, its own
reactive state — and `console()` for everything that is a table and some buttons.

Contributed pages keep their own class. The panel hosts a subclass carrying its
layout rather than assigning one onto the class it was handed, so a package that
also mounts the page in its own standalone panel is unaffected.

### Switching a contributor off

Contributions are automatic — installing both providers is enough. To keep a
provider installed but drop what it adds to the panel, name it in `plugins`:

```ts
// config/admin.ts
export default {
  plugins: { monitor: false },
};
```

This belongs in `config/admin.ts` rather than `app/admin.ts` because it has to be
in place before contributors ask whether they're enabled, and only the config file
is read early enough.

### Plugins written by the app

Application code can name the panel directly, so it doesn't need the container
dance. Group a set of related contributions behind an `AdminPlugin`:

```ts
await Panel.plugin({
  id: "billing",
  install: (panel) => {
    panel.page({
      slug: "invoices",
      page: InvoicesPage,
      title: "Invoices",
      ability: "billing.view",
    });
    panel.userMenuItem({ label: "Billing", href: "/admin/invoices", ability: "billing.view" });
  },
});
```

Use `Panel.pages()` for a single page, an `AdminPlugin` when a feature adds
several things at once and you want one switch (`plugins: { billing: false }`) to
control them together.

## Next steps

- [Admin overview](/docs/admin) — the guide's front page and the rest of the sections.
- [Reference](/docs/admin/references) — the full API surface in one table.
