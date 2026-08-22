---
title: Testing the Admin Panel
description: Drive panel screens in tests and assert on what they render.
---

# Testing

`@zerotal/admin/testing` mounts a resource's pages on Flow's in-process test
harness and adds assertions phrased in admin terms — columns, fields, actions and
records — so a test reads like a description of the screen rather than a walk
through its markup.

Nothing is served over the network. Mounting a page instantiates the component,
runs its real lifecycle, and renders once, so there is no server to boot and no
WebSocket to connect. Tests stay fast enough to cover every resource you register.

## Mounting a page

Three helpers cover the three screens a resource renders. Each returns a
`FlowTest`, so every assertion in [Flow's testing guide](/docs/flow/testing)
works alongside the admin-specific ones below.

| Helper                             | Screen             | Reach for it to check                            |
| ---------------------------------- | ------------------ | ------------------------------------------------ |
| `AdminTest.list(Resource, props?)` | List page          | Columns, search, sorting, filters, bulk actions  |
| `AdminTest.view(Resource, id)`     | View page          | Infolist entries and header actions for a record |
| `AdminTest.form(Resource, mode?)`  | Create / Edit form | Fields, validation and saving                    |

```ts fragment
// tests/admin/users.test.ts
import { AdminTest, assertHasColumn, assertHasAction } from "@zerotal/admin/testing";
import { UserResource } from "../../app/admin/UserResource.ts";

const list = await AdminTest.list(UserResource);
assertHasColumn(list, UserResource, "email");
assertHasAction(list, "Create");
list.assertSee("ada@example.com");
```

`AdminTest.form()` takes the mode as its second argument — `"create"` (the
default) or `"edit"`. Drive the form through its `form` property, which holds
every field's value:

```ts fragment
const form = await AdminTest.form(UserResource, "create");
assertHasField(form, UserResource, "name");
await form.set("form", { name: "" });
await form.call("save");
form.assertHasErrors("name");
```

## Seeding list state

The List page keeps search, sorting, pagination and filters in `@url` state. Pass
those values as the second argument to `AdminTest.list()` and the page mounts as
though the reader had arrived on that URL — which is how you assert on a filtered
or sorted table without first driving the clicks that would produce it.

```ts fragment
const list = await AdminTest.list(UserResource, {
  search: "ada",
  sortBy: "createdAt",
  sortDir: "desc",
  page: "2",
});
```

| Prop                 | Seeds                            |
| -------------------- | -------------------------------- |
| `search`             | The search box                   |
| `sortBy` / `sortDir` | Sort column and direction        |
| `page` / `perPage`   | Pagination                       |
| `filters`            | Active filter values             |
| `tab`                | The selected tab                 |
| `trashed`            | The soft-delete scope            |
| `group`              | Active grouping                  |
| `cols`               | Column visibility toggles        |
| `locale`             | The locale translated values use |

Every one of these is a string, because they round-trip through the query string.

## Admin assertions

These four take a key from the resource definition and assert against the
_resolved_ label. A test written this way keeps passing when a column is
relabelled through `.label()`, and fails when the column is removed — usually the
change you wanted the test to catch.

| Assertion                               | Passes when                              |
| --------------------------------------- | ---------------------------------------- |
| `assertHasColumn(t, Resource, key)`     | That column's header is rendered         |
| `assertHasField(t, Resource, key)`      | That form field's label is rendered      |
| `assertHasAction(t, label)`             | An action with that label is on the page |
| `assertSeesRecord(t, Resource, record)` | The record's title appears in a row      |

`assertSeesRecord` composes the title through the resource's
`recordTitleAttribute`, so it finds the row however that title is assembled.
`assertHasField` searches through nested layout components, so a field inside a
tab or section is found without naming its container.

## Driving and inspecting the page

The harness inherits Flow's actions and assertions. Two are worth calling out,
because reaching for the wrong one hides bugs:

- **`set(prop, value)`** assigns a property directly and skips the
  `updating`/`updated` hooks. Use it to arrange state before the behaviour you are
  actually testing.
- **`update(prop, value)`** takes the same path a change from the browser does and
  fires those hooks. Use it when the hooks _are_ the behaviour under test — a
  filter that refetches rows, or a field that derives another field.

`call(method, ...args)` invokes an action the way a button would. For assertions,
`assertSee` / `assertDontSee` cover rendered text, `assertHasErrors(field)` and
`assertNoErrors()` cover validation, `assertRedirectedTo(url)` covers a save that
navigates away, and `assertFlashed(level?, message?)` covers the notification a
successful action leaves behind.

When an assertion fails and you need to see why, `html()` returns the rendered
markup, `errors()` the validation bag, and `page()` the live component instance.

## Testing a non-default panel

Every helper accepts a panel as its last argument, defaulting to
`Panel.default()`. Apps that register more than one panel pass the one under test,
so the page resolves that panel's own configuration and navigation:

```ts fragment
const shop = Panel.get("shop");

const list = await AdminTest.list(OrderResource, {}, shop);
const form = await AdminTest.form(OrderResource, "edit", { recordId: "1" }, shop);
```

## Next steps

- [Admin overview](/docs/admin) — the guide's front page and the rest of the sections.
- [Flow testing](/docs/flow/testing) — the harness these helpers are built on.
