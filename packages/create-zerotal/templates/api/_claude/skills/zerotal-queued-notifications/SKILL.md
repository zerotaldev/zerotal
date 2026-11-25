---
name: zerotal-queued-notifications
description: "Send an email or other notification from a Zerotal app in the background — the class, queueing it, what survives serialisation, retries, and faking it in tests."
---

<!-- zerotal:arch:generated -->

# Sending a notification in the background

## Sequence

1. `bun zt make:notification <Name>` — classes in `app/notifications/` are found
   automatically, including by the queue worker that rebuilds them.
2. Declare the channels in `via()` and one method per channel. The recipient model composes
   `Notifiable`.
3. Send with `user.notifyLater(new <Name>(...))` or `Notify.queue(user, ...)` from a request.
   `notify()` sends inline and is not retried.
4. Test with `NotificationFake` and `assertQueued`.

## Traps

- **A queued notification is rebuilt from JSON.** Store ids and plain values in it, not model
  instances; a model needs `payload()` and `fromPayload()` to cross. The recipient arrives
  as a snapshot — read its fields, not its methods.
- **A class outside `app/notifications/`** must call `NotificationRegistry.register()`, or the
  worker cannot rebuild it.
- **Something has to run the queue.** `bun zt dev` runs a worker locally. In production a
  persistent driver needs `bun zt queue:work` running, or queued mail is never sent.
- **Failures wait in the failed jobs** after their retries; `bun zt queue:retry` sends them
  again.
- **The fake records, it does not deliver.** Database-channel rows are not written under it.
