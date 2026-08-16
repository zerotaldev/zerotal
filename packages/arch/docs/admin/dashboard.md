---
title: Admin Dashboard & Navigation
description: Widgets, global search, the command palette, notifications, and the nav tree.
---

# Dashboard widgets

Register widgets with `Panel.widgets(...)`; they render on the dashboard.

```ts
import { Panel, statsWidget, stat, chartWidget, tableWidget } from "@zerotal/admin";

Panel.widgets(
  statsWidget(async () => [
    stat("Users", await User.count())
      .description("+12% this week")
      .color("success"),
    stat("Revenue", "$48k"),
  ]),
  chartWidget("Signups", async () => ({
    type: "line",
    labels: ["Mon", "Tue", "Wed"],
    datasets: [{ label: "Signups", data: [4, 9, 7] }],
  })),
  tableWidget(
    "Latest orders",
    [
      { key: "id", label: "#" },
      { key: "total", label: "Total", align: "end" },
    ],
    async () => await Order.latest().limit(5).get(),
  ),
);
```

Charts use Chart.js via CDN (the dashboard renders once, so there's no morph re-init).

## Widgets on a resource

The dashboard answers "how is the business doing". A resource's own widgets
answer "what is going on in _this_ list" — a pending count above the orders
table, stock value above products:

```ts
export class OrderResource extends Resource {
  static override widgets() {
    return [
      statsWidget(async () => [
        stat("Awaiting payment", await Order.query().where("status", "pending").count()),
      ]).poll("30s"),
    ];
  }
}
```

They render above the table and use the same builders as the dashboard, polling
included — and a polling widget there refreshes the table with it, which is what
someone watching a queue actually wants.

## Polling

A dashboard on a second screen is stale the moment it renders. `.poll()` gives a
widget an interval:

```ts
statsWidget(async () => [
  stat("Awaiting payment", await Order.query().where("status", "pending").count()),
]).poll("30s"),
```

The dashboard refreshes as one unit, at the shortest interval any of its widgets
asked for. That costs a query per tick per viewer, so it is worth it for the
numbers someone actually watches and wasteful on everything else — leave the rest
to render once per navigation.

## Global search & the command palette

Any resource with `.searchable()` columns and a `recordTitleAttribute` joins **global
search** — a top-bar box, a `/search` results page, and a client-side **⌘K / Ctrl-K
command palette** that filters resources and escalates a free query to the search
page.

## Notifications

The admin owns the bell + notifications page UI; your app supplies the data through a
provider (the same split as relations — admin UI, app data):

```ts
import { Panel } from "@zerotal/admin";

Panel.notifications({
  async resolve() {
    return (await Auth.user().notifications().latest().limit(20).get()).map((n) => ({
      id: String(n.id),
      title: n.data.title,
      body: n.data.body,
      href: n.data.url,
      read: n.read_at != null,
      time: n.created_at,
    }));
  },
  async markRead(id) {
    await Notification.find(id)?.markAsRead();
  },
  async markAllRead() {
    await Auth.user().unreadNotifications().markAsRead();
  },
  async unreadCount() {
    return Auth.user().unreadNotifications().count();
  },
});
```

The header bell shows a **live unread badge** (refreshed each navigation). The
notifications page **polls** and listens for **broadcasts**: broadcast a notification
from your app on the `NOTIFICATION_CHANNEL` / `NOTIFICATION_EVENT`
(`admin-notifications` / `.notification.sent`) broadcast channel and the open page
updates live. When no provider is configured, the bell and page stay hidden.

### Database-backed notifications

`Panel.notifications()` takes a provider because "the current user's
notifications" depends on your auth and your schema. When both are the ordinary
ones — `@zerotal/auth` for the user, `@zerotal/notifications`' `DatabaseChannel`
for storage — there is a ready-made one:

```ts
import { databaseNotifications } from "@zerotal/admin";

Panel.notifications(databaseNotifications());
```

Everything is adjustable: `notifiable` says whose notifications to show,
`present` turns a stored row into a title and a link, `table` names the table,
`limit` caps how many the bell holds.

It fails soft throughout. A missing table, an unconfigured database or a
signed-out user yields an empty bell rather than a broken panel — a notification
centre is never worth taking the page down for.

## Navigation

The sidebar is derived from each resource's `navigationGroup`, `navigationSort`,
`navigationIcon`, and `navigationParentItem`. Groups are collapsible (`<details>`),
parent items nest their children, and `navigationBadge()` renders a colored count
pill. The top-bar **user menu** comes from `Panel.configure({ userMenu })`.

Custom pages and anything contributed by a package sit in the same sidebar, sorted
and grouped by the same rules — a page's group heading is just a string, so a page
and a resource that name the same group land together.

## Next steps

- [Admin overview](/docs/admin) — the guide's front page and the rest of the sections.
- [Reference](/docs/admin/references) — the full API surface in one table.
