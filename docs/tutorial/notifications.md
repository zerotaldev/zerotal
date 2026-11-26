---
title: Send a Queued Notification
description: Milestone 6 of the tutorial — email the assignee when a task is assigned, in the background, with the queue registered and a worker running.
---

# Send a Queued Notification

Milestone 6 of 9 in [Build Your First App](/docs/tutorial).

When a task is assigned, its assignee should hear about it. Sending mail from inside the
request makes the visitor wait for the mail server, and loses the message if the server
is down. Queue it instead: the request stores a job and returns, and a worker sends it.

## The notification

```bash
# in your project root
bun zt make:notification TaskAssignedNotification
```

```ts
// app/notifications/TaskAssignedNotification.ts
import { config } from "zerotal";
import { MailMessage, Notification } from "@zerotal/notifications";

/**
 * "You have a new task." Queued, so it is rebuilt from JSON by the worker: it holds
 * plain values, not the Task model.
 */
export class TaskAssignedNotification extends Notification {
  constructor(
    private readonly title: string,
    private readonly projectId: number,
  ) {
    super();
  }

  channels(): string[] {
    return ["mail"];
  }

  toMail(): MailMessage {
    return new MailMessage()
      .subject(`New task: ${this.title}`)
      .line(`You have been assigned “${this.title}”.`)
      .action("Open the project", `${config("app.url")}/projects/${this.projectId}`);
  }
}
```

A queued notification is stored as JSON and rebuilt by the worker, so it holds plain
values. A model instance does not survive the trip. [Notifications](/docs/notifications)
explains what does, and how a class outside `app/notifications/` is found.

## Send it

`User` already composes `Notifiable`, the mixin behind the starter's verification and
password-reset mail. `notifyLater()` queues; `notify()` would send inline. In the
add-a-task route, after the task is saved:

```ts fragment
// app/routes/(auth)/(verified)/projects/[project]/tasks.ts
import { TaskAssignedNotification } from "@app/notifications/TaskAssignedNotification";

// …in POST, after `await task.save();`:
// Queued: the request does not wait for the mail server.
if (assignee) await assignee.notifyLater(new TaskAssignedNotification(task.title, project.id));
```

## Register the queue

Try it now, and adding an assigned task fails with a 500:

```
FacadeBindingMissingError: Could not resolve the "queue" facade.
```

The starter sends its own mail inline, so it does not register a queue. There is nothing
to install: the queue ships in the `zerotal` package the app already depends on, as
`zerotal/queue`. Configure it and register its provider.

```ts
// config/queue.ts
import { QueueConfig } from "zerotal/queue";

export default QueueConfig({
  // Jobs are stored in the app's SQLite database until a worker runs them.
  driver: "sqlite",
  // Queued notifications go on their own "notifications" queue. List it, or no worker drains it.
  queues: ["default", "notifications"],
});
```

Register the provider in `bootstrap/providers.ts`, before `NotificationProvider`:

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

The `queues` list matters. A queued notification is pushed onto a queue named
`notifications`, and a worker that drains only `default` would leave every one of them
waiting, with no error anywhere. [Queue](/docs/queue) covers the drivers and the
worker.

## Check it

Restart `bun zt dev`: providers are read at boot. Its output now includes a third
process alongside the server and the asset build:

```
[queue ] Processing queue(s) [default, notifications] — Ctrl+C to stop.
```

On a project's page, add a task assigned to `demo@example.com`. The page answers at
once, and a moment later the queue worker prints the message, since mail is logged
rather than sent in development:

```
[queue ] [Mail] 2026-11-26T05:40:18.069Z
[queue ] To:      Demo User <demo@example.com>
[queue ] From:    my-app <hello@example.com>
[queue ] Subject: New task: Review the focus order
[queue ]
[queue ] [Text]
[queue ] Hello,
[queue ]
[queue ] You have been assigned “Review the focus order”.
[queue ]
[queue ] Open the project: http://localhost:3000/projects/12
[queue ]
[queue ] The my-app team
```

The HTML version of the message follows it. `bun zt doctor` still reports that all
checks passed, and now counts one more among them: the queue worker check.

**Next:** [Feature tests](/docs/tutorial/tests).
