---
title: Cookbook
description: Short, tested recipes for the things most apps add next — uploads, queued mail, caching, roles, tenancy, settings, AI output and safe migrations — each built on a new starter.
---

# Cookbook

Each recipe adds one thing a real app needs to a new starter, and ends with a test that
proves it works. They are shorter than the [tutorial](/docs/tutorial) and independent of
each other: start from a fresh app or from your own, and pick the one you need.

Every recipe was run, block by block, on a new React starter scaffolded from the packages
this release was cut from. The server code is the same on Vue and Flow; only the page
components differ.

- **[Uploading several files](/docs/cookbook/uploads)** — attach files to a model with
  the media library, and test an upload of more than one at once.
- **[Queued notifications](/docs/cookbook/queued-notifications)** — send mail through the
  queue, and test it with `NotificationFake` and `Notify.settle()`.
- **[Caching a slow read](/docs/cookbook/caching)** — remember an expensive result, and
  forget it when the data behind it changes.
- **[Roles and permissions](/docs/cookbook/roles-and-permissions)** — give users roles,
  gate a page on a permission, and test both sides of the gate.
- **[Tenancy](/docs/cookbook/tenancy)** — scope a model to a tenant, and prove one tenant
  cannot read another's rows.
- **[Settings](/docs/cookbook/settings)** — a typed setting with a default in code, changed
  per user, and tested with `SettingsFake`.
- **[AI structured output](/docs/cookbook/ai-structured-output)** — ask a model for a typed
  object, handle a bad answer, and test it with no network.
- **[Back up before migrating](/docs/cookbook/backup-before-migrating)** — take a backup,
  run the migration, and know how to get back.

## Before you start

You need [Bun](https://bun.sh) 1.3.14 or later and a new app:

```bash
bunx create-zerotal@latest my-app --template=react --yes
cd my-app
bun zt migrate
```

The `zerotal` package the app depends on already includes the cache, media library,
queue, scheduler, storage, testing and validation, imported as `zerotal/cache`,
`zerotal/media` and so on. A recipe that needs anything else says what to install.
