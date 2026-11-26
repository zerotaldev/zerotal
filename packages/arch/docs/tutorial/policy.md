---
title: Write a Policy
description: Milestone 5 of the tutorial — a policy that lets only a project's owner change or delete its tasks, checked on every route that loads one.
---

# Write a Policy

Milestone 5 of 9 in [Build Your First App](/docs/tutorial).

The project routes are already guarded: `ProjectPolicy` lets only a project's owner see
it, add tasks to it or change it. The task routes are not. `/tasks/:task` takes any id,
so anyone signed in can tick off or delete any task in the app. A policy closes that.

## Generate it

```bash
# in your project root
bun zt make:policy TaskPolicy --model Task
```

The generated class allows everything. Replace it:

```ts fragment
// app/policies/TaskPolicy.ts
import { Policy } from "zerotal/auth";
import { Project } from "../models/Project.ts";
import type { Task } from "../models/Task.ts";
import type { User } from "../models/User.ts";

/**
 * Only the owner of a task's project may change or delete the task.
 *
 * Async, because the owner is on the project, not the task. Check it with
 * `Gate.authorizeAsync()`: the synchronous form treats a Promise as a yes.
 */
export class TaskPolicy extends Policy<Task> {
  async update(user: User, task: Task): Promise<boolean> {
    return (await this.ownerOf(task)) === user.id;
  }

  async delete(user: User, task: Task): Promise<boolean> {
    return (await this.ownerOf(task)) === user.id;
  }

  private async ownerOf(task: Task): Promise<number | undefined> {
    return (await Project.find(task.projectId))?.userId;
  }
}
```

There is nothing to register. A class in `app/policies/` named `TaskPolicy` is the
policy for `Task`. [Authorization](/docs/authorization#gate-policies) covers policies
and the `Gate`.

The owner is on the project, so the policy has to load it, which makes its methods
async. That matters at the call site: `Gate.authorize()` is synchronous and treats the
returned Promise as truthy, so it would allow everyone. Use `Gate.authorizeAsync()`.

## Check it on every route

```ts fragment
// app/routes/(auth)/(verified)/tasks/[task].ts
import type { HttpContext } from "zerotal";
import { Gate } from "zerotal/auth";
import type { Task } from "@app/models/Task";

// PATCH /tasks/:task — tick a task off, or back on.
export async function PATCH(http: HttpContext<{ task: Task }>): Promise<void> {
  const task = http.params.task;
  await Gate.authorizeAsync("update", task);

  task.done = !task.done;
  await task.save();

  http.redirect(`/projects/${task.projectId}`, 303);
}

// DELETE /tasks/:task
export async function DELETE(http: HttpContext<{ task: Task }>): Promise<void> {
  const task = http.params.task;
  await Gate.authorizeAsync("delete", task);

  await task.delete();

  http.flash("success", `“${task.title}” was deleted.`);
  http.redirect(`/projects/${task.projectId}`, 303);
}
```

A denial throws, and the exception handler answers it with a 403 and the starter's
error page. The project page and the add-a-task route were already covered by
`ProjectPolicy`'s `view` and `update`.

## Check it

Test the policy on its own. It needs a project in the database, so first a factory for
tasks, to go with the starter's `ProjectFactory` and `UserFactory`:

```bash
# in your project root
bun zt make:factory Task
```

Name the model, not the factory: `make:factory Task` writes `TaskFactory`. Replace the
generated file:

```ts fragment
// database/factories/TaskFactory.ts
import { Factory } from "zerotal/testing";
import { Task } from "../../app/models/Task.ts";

/**
 * A task with a made-up title. Give it a project:
 *
 *   await TaskFactory.for(project).create();
 */
export const TaskFactory = Factory.define(Task, (fake) => ({
  title: fake.sentence(),
  done: false,
}));
```

`done` is listed although the column has a default: the factory's types cannot see a
database default, so they ask for every column that is not optional. `.for(project)`
fills `projectId` from the project. [Factories](/docs/orm/factories) has the rest.

Then the test, next to the starter's `tests/project-policy.test.ts`:

```ts fragment
// tests/task-policy.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { refreshDatabase, type TestApp } from "zerotal/testing";
import { TaskPolicy } from "../app/policies/TaskPolicy";
import { TaskFactory } from "../database/factories/TaskFactory";
import { ProjectFactory } from "../database/factories/ProjectFactory";
import { UserFactory } from "../database/factories/UserFactory";
import { bootApp } from "./support";

let app: TestApp;

beforeAll(async () => {
  app = await bootApp();
});
afterAll(() => app.close());

describe("task policy", () => {
  refreshDatabase();
  const policy = new TaskPolicy();

  test("lets the project's owner change and delete a task", async () => {
    const owner = await UserFactory.create();
    const project = await ProjectFactory.for(owner).create();
    const task = await TaskFactory.for(project).create();

    expect(await policy.update(owner, task)).toBe(true);
    expect(await policy.delete(owner, task)).toBe(true);
  });

  test("refuses everyone else", async () => {
    const owner = await UserFactory.create();
    const stranger = await UserFactory.create();
    const project = await ProjectFactory.for(owner).create();
    const task = await TaskFactory.for(project).create();

    expect(await policy.update(stranger, task)).toBe(false);
    expect(await policy.delete(stranger, task)).toBe(false);
  });
});
```

```bash
# in your project root
bun zt test tests/task-policy.test.ts
```

```
 2 pass
 0 fail
```

The test that sends a stranger's request through the routes, and sees the 403, is part
of the [next-but-one milestone](/docs/tutorial/tests).

**Next:** [A queued notification](/docs/tutorial/notifications).
