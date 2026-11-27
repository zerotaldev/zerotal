---
title: Write Feature Tests
description: Milestone 7 of the tutorial — feature tests for every task action, the queued notification faked, and the test that proves a stranger is refused.
---

# Write Feature Tests

Milestone 7 of 9 in [Build Your First App](/docs/tutorial).

The policy test from milestone 5 checks the policy. A feature test checks the app: it
sends a request through the router, middleware, validation, policy and database, and
asserts on the response and on what was stored. `tests/projects.test.ts` is the
starter's; this is the same thing for tasks.

## The tests

```ts fragment
// tests/tasks.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { NotificationFake } from "@zerotal/notifications";
import {
  assertDatabaseHas,
  assertDatabaseMissing,
  refreshDatabase,
  type TestApp,
} from "zerotal/testing";
import { Task } from "../app/models/Task";
import { TaskAssignedNotification } from "../app/notifications/TaskAssignedNotification";
import { ProjectFactory } from "../database/factories/ProjectFactory";
import { TaskFactory } from "../database/factories/TaskFactory";
import { UserFactory } from "../database/factories/UserFactory";
import { bootApp } from "./support";

let app: TestApp;
let notifications: NotificationFake;

beforeAll(async () => {
  app = await bootApp();
});
afterAll(() => app.close());
beforeEach(() => {
  app.actingAsGuest();
  notifications = NotificationFake.install();
});
afterEach(() => notifications.restore());

describe("tasks", () => {
  refreshDatabase();

  test("shows a project with its tasks", async () => {
    const user = await UserFactory.create();
    const project = await ProjectFactory.for(user).create();
    await TaskFactory.for(project).create({ title: "Write the launch post" });

    (await app.actingAs(user).get(`/projects/${project.id}`))
      .assertOk()
      .assertInertia("projects/show");
  });

  test("adds a task to a project", async () => {
    const user = await UserFactory.create();
    const project = await ProjectFactory.for(user).create();

    const res = await app
      .actingAs(user)
      .postForm(`/projects/${project.id}/tasks`, { title: "Write the launch post", assignee: "" });

    res.assertRedirect(`/projects/${project.id}`);
    await assertDatabaseHas("tasks", { title: "Write the launch post", project_id: project.id });
    notifications.assertNothingSent();
  });

  test("rejects a task without a proper title", async () => {
    const user = await UserFactory.create();
    const project = await ProjectFactory.for(user).create();

    const res = await app
      .actingAs(user)
      .postForm(
        `/projects/${project.id}/tasks`,
        { title: "x", assignee: "nobody@example.com" },
        { Referer: `${app.baseUrl}/projects/${project.id}` },
      );

    res.assertRedirect(`/projects/${project.id}`);
    res.assertInvalid(["title", "assignee"]);
    await assertDatabaseMissing("tasks", { title: "x" });
  });

  test("queues a notification for the assignee", async () => {
    const owner = await UserFactory.create();
    const assignee = await UserFactory.create();
    const project = await ProjectFactory.for(owner).create();

    await app
      .actingAs(owner)
      .postForm(`/projects/${project.id}/tasks`, { title: "Review", assignee: assignee.email });

    await assertDatabaseHas("tasks", { title: "Review", assignee_id: assignee.id });
    notifications.assertQueued(assignee, TaskAssignedNotification);
    notifications.assertNotSentTo(owner, TaskAssignedNotification);
  });

  test("ticks a task off", async () => {
    const user = await UserFactory.create();
    const project = await ProjectFactory.for(user).create();
    const task = await TaskFactory.for(project).create();

    (await app.actingAs(user).patch(`/tasks/${task.id}`, {})).assertRedirect(
      `/projects/${project.id}`,
    );

    expect((await Task.find(task.id))?.done).toBeTruthy();
  });

  test("refuses anyone but the project's owner", async () => {
    const owner = await UserFactory.create();
    const stranger = await UserFactory.create();
    const project = await ProjectFactory.for(owner).create();
    const task = await TaskFactory.for(project).create({ title: "Private" });

    (await app.actingAs(stranger).get(`/projects/${project.id}`)).assertForbidden();
    (
      await app.actingAs(stranger).postForm(`/projects/${project.id}/tasks`, { title: "Sneaky" })
    ).assertForbidden();
    (await app.actingAs(stranger).patch(`/tasks/${task.id}`, {})).assertForbidden();
    (await app.actingAs(stranger).delete(`/tasks/${task.id}`)).assertForbidden();

    const unchanged = await Task.find(task.id);
    expect(unchanged?.done).toBeFalsy();
    await assertDatabaseMissing("tasks", { title: "Sneaky" });
  });
});
```

What each part relies on:

- **`bootApp()`** from `tests/support.ts` boots the app from its own bootstrap against an
  in-memory database built by the real migrations. **`refreshDatabase()`** runs each test
  in a transaction that is rolled back, so every test starts from the same empty tables.
- **`app.actingAs(user)`** signs the next request in as that user;
  **`actingAsGuest()`** in `beforeEach` keeps one test's user out of the next.
- **`NotificationFake`** records notifications instead of sending them. Install it before
  each test and restore it after. `assertQueued()` checks the notification went through
  `notifyLater()`, not `notify()`.
- **`assertInvalid()`** reads the field errors a failed `validate()` stored, so the test
  names the fields that failed without matching their wording.

[Testing](/docs/testing) and [HTTP Tests](/docs/testing/http) cover every assertion.

> **On Flow** — a Flow page is HTML, not an Inertia response. Replace
> `assertInertia("projects/show")` with `assertPage(res, project.name)` from
> `tests/support.ts`, which checks the page's title and returns the page, then read it the
> way a visitor does, by role and name: `page.getByRole("list", { name: "Tasks" })` finds a list
> labelled "Tasks". `tests/projects.test.ts` shows the pattern. Everything else is the same.

## The refusal test

The last test is the one that matters most and gets written least. It signs in as
someone who does not own the project and tries everything: open the page, add a task,
tick one off, delete one. Every request must be refused, and nothing may change.

Make sure it can fail. Comment out the `authorizeAsync` line in the `PATCH` handler of
`tasks/[task].ts` and run the file:

```
error: Expected HTTP 403 but got 303.
(fail) tasks > refuses anyone but the project's owner
 5 pass
 1 fail
```

The stranger's request went through and redirected, as a successful one does. Put the
line back.

## Check it

```bash
# in your project root
bun zt test tests/tasks.test.ts
```

```
 6 pass
 0 fail
```

Then the whole suite, which now includes the policy test:

```bash
# in your project root
bun zt test
```

It ends with `0 fail`.

**Next:** [Teams](/docs/tutorial/multi-tenancy).
