---
title: A Queued Notification, Tested
description: Email a project's owner in the background when the project is marked completed, and prove it in a feature test with NotificationFake and Notify.settle().
---

# A Queued Notification, Tested

When a project is marked completed, its owner gets an email. The request does not send
it: it puts a job on the queue and a worker sends it. At the end of this recipe you
will have the notification class, the queue registered, the route that queues it, and a
feature test that checks it was queued, for whom, and what the email says.

## Before you start

This recipe starts from the React starter. It already has what the notification needs:

- **A `Project` model** whose `status` is `planning`, `active` or `completed`, and an
  edit form at `/projects/:id/edit` that saves it through
  `app/routes/(auth)/(verified)/projects/[project]/index.ts`.
- **`User` composes `Notifiable`**, so a user has `notify()` and `notifyLater()`.
- **`@zerotal/notifications`** is a dependency, its provider is registered, and
  `config/notifications.ts` defaults the mail driver to `log`, which prints each message
  instead of sending it.
- **`tests/support.ts`** has `bootApp()`, which boots the app against an in-memory
  database built by the real migrations.

The queue is not registered, because the starter sends its own mail inline. There is
nothing to install for it: the `zerotal` package bundles the queue along with the ORM,
auth, cache, testing and the rest, and you import it as `zerotal/queue`.

## Register the queue

Configure the queue:

```ts
// config/queue.ts
import { QueueConfig } from "zerotal/queue";

export default QueueConfig({
  // Jobs are stored in the app's own database until a worker runs them.
  driver: "database",
  // Queued notifications go on their own "notifications" queue. List it, or no worker drains it.
  queues: ["default", "notifications"],
});
```

Then register `QueueProvider` in `bootstrap/providers.ts`, before `NotificationProvider`:

```ts fragment
// bootstrap/providers.ts
import { QueueProvider } from "zerotal/queue";

const providers = [
  // …
  AuthProvider,
  QueueProvider,
  NotificationProvider,
  // …
];
```

Without the provider, `notifyLater()` throws. In this recipe it runs after the response
(see below), so the save still succeeds and the server logs the failure instead:

```
[Zerotal] afterResponse callback failed: …
FacadeBindingMissingError: Could not resolve the "queue" facade.
```

The `queues` list matters as much: a queued notification is pushed onto the
`notifications` queue, and a worker that drains only `default` leaves it waiting with
no error anywhere.

## The notification

```bash
# in your project root
bun zt make:notification ProjectCompletedNotification
```

```
Created: app/notifications/ProjectCompletedNotification.ts
```

The generated class sends on the database channel. Replace it with a mail notification:

```ts fragment
// app/notifications/ProjectCompletedNotification.ts
import { config } from "zerotal";
import { MailMessage, Notification } from "@zerotal/notifications";
import { signOff } from "../support/mail";

/**
 * "Your project is complete." Queued, so the worker rebuilds it from JSON: it holds the
 * project's id and name as plain values, not the Project model.
 */
export class ProjectCompletedNotification extends Notification {
  constructor(
    readonly projectId: number,
    readonly projectName: string,
  ) {
    super();
  }

  channels(): string[] {
    return ["mail"];
  }

  toMail(): MailMessage {
    return new MailMessage()
      .subject(`Project completed: ${this.projectName}`)
      .line(`“${this.projectName}” is marked as completed.`)
      .action("Open the project", `${config("app.url")}/projects/${this.projectId}/edit`)
      .salutation(signOff());
  }
}
```

A queued notification is stored as JSON and rebuilt by the worker from its own fields,
so it holds plain values. A `Project` instance would not survive the trip. The fields
are public so the test can read them. `signOff()` is the starter's helper that ends
every email it sends with the app's name.

## Queue it when a project is completed

The route that saves the edit form is the one place that knows a project has just
become completed. Replace `app/routes/(auth)/(verified)/projects/[project]/index.ts`
with:

```ts fragment
// app/routes/(auth)/(verified)/projects/[project]/index.ts
import type { HttpContext } from "zerotal";
import { Gate } from "zerotal/auth";
import type { Project, ProjectStatus } from "@app/models/Project";
import { User } from "@app/models/User";
import { ProjectCompletedNotification } from "@app/notifications/ProjectCompletedNotification";
import { ProjectRequest } from "@app/requests/ProjectRequest";

// PUT /projects/:project
export async function PUT(http: HttpContext<{ project: Project }>): Promise<void> {
  const project = http.params.project;
  Gate.authorize("update", project);
  const data = await ProjectRequest.validate();

  project.fill({
    name: data.name,
    description: data.description || null,
    status: data.status as ProjectStatus,
  });
  // Read before save(), which resets what counts as changed.
  const completed = project.isDirty("status") && project.status === "completed";
  await project.save();

  if (completed) {
    // After the response: the redirect does not wait for the lookup or the queue write,
    // and a failure here is logged without failing a save that already happened.
    http.afterResponse(async () => {
      const owner = await User.find(project.userId);
      await owner?.notifyLater(new ProjectCompletedNotification(project.id, project.name));
    });
  }

  http.flash("success", `“${project.name}” was saved.`);
  http.redirect("/projects", 303);
}

// DELETE /projects/:project
export async function DELETE(http: HttpContext<{ project: Project }>): Promise<void> {
  const project = http.params.project;
  Gate.authorize("delete", project);

  await project.delete();

  http.flash("success", `“${project.name}” was deleted.`);
  http.redirect("/projects", 303);
}
```

Three decisions in that handler:

- **`isDirty("status")` is read before `save()`.** A save records the new values as the
  saved ones, so afterwards nothing is dirty. Checking the change, not just the value,
  means editing a project that was already completed does not email its owner again.
- **The owner is looked up, not assumed.** Today only the owner can edit a project, but
  the notification goes to `project.userId` whoever made the change.
- **The work runs in `http.afterResponse()`.** The callback starts once the response is
  ready, and nothing waits for it. The visitor gets the redirect without waiting on the
  lookup and the queue write, and if queueing fails the error is logged rather than
  turning a save that already happened into a 500.

## The test

```ts fragment
// tests/project-completed.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { NotificationFake, Notify } from "@zerotal/notifications";
import { refreshDatabase, type TestApp } from "zerotal/testing";
import { ProjectCompletedNotification } from "../app/notifications/ProjectCompletedNotification";
import { ProjectFactory } from "../database/factories/ProjectFactory";
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

const form = { name: "Website relaunch", description: "", status: "completed" };

describe("completing a project", () => {
  refreshDatabase();

  test("queues a notification for the project's owner", async () => {
    const owner = await UserFactory.create();
    const project = await ProjectFactory.for(owner).create({ status: "active" });

    (await app.actingAs(owner).putForm(`/projects/${project.id}`, form)).assertRedirect(
      "/projects",
    );
    // The notification is queued after the response; wait for it.
    await Notify.settle();

    notifications.assertQueued(owner, ProjectCompletedNotification);
    notifications.assertSentTo(
      owner,
      ProjectCompletedNotification,
      (n) => n.projectId === project.id && n.projectName === "Website relaunch",
    );
    notifications.assertSentCount(1);
  });

  test("says which project in the email", () => {
    const mail = new ProjectCompletedNotification(7, "Website relaunch")
      .toMail()
      .toPayload({ address: "hello@example.com" }, [{ address: "owner@example.com" }]);

    expect(mail.subject).toBe("Project completed: Website relaunch");
    expect(mail.text).toContain("“Website relaunch” is marked as completed.");
    expect(mail.text).toContain("/projects/7/edit");
  });

  test("does not notify when a completed project is edited again", async () => {
    const owner = await UserFactory.create();
    const project = await ProjectFactory.for(owner).create({ status: "completed" });

    await app.actingAs(owner).putForm(`/projects/${project.id}`, form);
    await Notify.settle();

    notifications.assertNothingSent();
  });
});
```

What each part checks:

- **`NotificationFake.install()`** swaps the app's notification manager for a recorder, so
  nothing is queued or mailed. `restore()` in `afterEach` puts the real one back. The
  fake never touches the queue, so these tests pass whether or not `QueueProvider` is
  registered; "Run it" below is what shows the queue at work.
- **`assertQueued()`** proves the route called `notifyLater()`, not `notify()`: the email
  goes through the queue rather than holding up the request.
- **`assertSentTo()` with a filter** proves it went to the owner, about this project.
  `assertSentCount(1)` proves nobody else got one.
- **The second test reads the email itself.** `toMail()` builds the message, and
  `toPayload()` renders it, given a default sender and a fallback recipient, into the
  subject and text a mail driver would send.
- **The third test is the one a change is most likely to break**: a project that was
  already completed is saved again, and nothing is sent.

### Why the test calls `Notify.settle()`

`notifyLater()` runs inside the `afterResponse()` callback, which the framework starts
when the response is ready and does not wait for. `putForm()` resolves when the response
reaches the test, and nothing guarantees the callback's lookup and `notifyLater()` have
run by then. They usually have, because the response still has to travel to the test
client, so the first test may well pass without `settle()`. That is timing, not a
guarantee, and the third test is worse off: `assertNothingSent()` passes trivially if it
runs before a wrong send has happened.

`Notify.settle()` closes that gap. With the fake installed, `Notify` is the fake, and
`settle()`:

1. waits for every send or queue call that has started and not finished;
2. then lets one full turn of the event loop pass;
3. goes round again if anything new was sent in that turn, and resolves once a turn
   passes with nothing new.

So a send that starts after a short `await`, such as the owner lookup here, is waited
for, and an assertion after `settle()` sees everything the request set off. A send that
fails does not make `settle()` reject; the code that started it owns that error.

It does not wait for timers or slow I/O. If after-response work sleeps or calls another
service before it notifies, `settle()` can resolve first. Keep that work to a lookup and
the queue call, as here.

`Notify.settle()` is not `Queue.settle()`. The first waits for notifications to be handed
over; the second runs queued jobs. With the fake installed nothing reaches the queue, so
there is nothing for `Queue.settle()` to run.

## Run it

```bash
# in your project root
bun zt test tests/project-completed.test.ts
```

```
 3 pass
 0 fail
```

Then the whole suite:

```bash
# in your project root
bun zt test
```

It ends with `0 fail`.

To see the email, restart `bun zt dev`, since providers are read at boot. It now runs a
queue worker beside the server, in a `queue` tab of its own. The output below is from
`bun zt dev --stream`, which prefixes each line with the process that printed it:

```
[queue ] Processing queue(s) [default, notifications] — Ctrl+C to stop.
```

Sign in as `demo@example.com` (`bun zt db:seed` creates it), edit an active project, set
its status to Completed and save. The page redirects at once, and a moment later the
worker prints the message:

```
[queue ] [Mail] 2026-11-26T15:39:42.994Z
[queue ] To:      Demo User <demo@example.com>
[queue ] From:    app <hello@example.com>
[queue ] Subject: Project completed: Mobile onboarding
[queue ]
[queue ] [Text]
[queue ] Hello,
[queue ]
[queue ] “Mobile onboarding” is marked as completed.
[queue ]
[queue ] Open the project: http://localhost:3000/projects/2/edit
[queue ]
[queue ] The app team
[queue ] [HTML]
…
```

`app` is the starter's default `APP_NAME`; yours shows your app's name. Save the same
project again and nothing more is printed.

In production the server does not run the worker. Run `bun zt queue:work` as its own
long-running process, or the notifications wait in the queue.

## See also

- [Notifications](/docs/notifications#queued-notifications) — what a queued notification
  carries, and how it is rebuilt.
- [Mocking](/docs/testing/mocking#mail-sent-fire-and-forget-notifysettle) —
  `NotificationFake` and `Notify.settle()`.
- [Queue](/docs/queue#processing-jobs) — drivers, workers and `Queue.settle()`.
- [Request Context](/docs/context#after-response-callbacks) — `afterResponse()`.
- [Send a Queued Notification](/docs/tutorial/notifications) — the tutorial's version,
  for a task's assignee.
