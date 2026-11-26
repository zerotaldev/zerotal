---
title: Build Your First App
description: A nine-milestone tutorial that takes a new Zerotal app from scaffold to deploy — tasks inside projects, with validation, a policy, queued mail, tests and teams.
---

# Build Your First App

This tutorial builds one feature end to end, in nine milestones. Each one ends with
something you can see or run: a page, a passing test, a command's output.

The starter you scaffold already has a working example resource, **Projects**: a model,
a policy, a form request, a factory, pages and tests. You will not rebuild it. You will
add **Tasks inside a project** next to it, using it as the pattern, and then grow the
app around them:

1. **[Scaffold and run](/docs/tutorial/scaffold)** — a new app on your machine, signed in
   as the demo user.
2. **[A model and a migration](/docs/tutorial/model)** — a `tasks` table and the `Task`
   model.
3. **[Routes and pages](/docs/tutorial/routes-and-pages)** — a page per project that
   lists its tasks, with a form to add one.
4. **[Validation](/docs/tutorial/validation)** — what a task must contain, and the errors
   the form shows when it does not.
5. **[A policy](/docs/tutorial/policy)** — only the project's owner can change or delete
   its tasks.
6. **[A queued notification](/docs/tutorial/notifications)** — an email to whoever a task
   is assigned to, sent in the background.
7. **[Feature tests](/docs/tutorial/tests)** — every action, and the test that proves a
   stranger is refused.
8. **[Teams](/docs/tutorial/multi-tenancy)** — `@zerotal/tenancy`, so each team sees
   only its own projects and tasks.
9. **[Deploy](/docs/tutorial/deploy)** — the release gate, the production checklist, and
   the app running in production mode.

## Before you start

You need [Bun](https://bun.sh) 1.3.14 or later, and nothing else: the starter uses SQLite,
and mail is printed to the terminal until you configure a real driver. The
[Getting Started](/docs/getting-started) page covers installation in more depth.

Every command and every file in this tutorial was run on an app scaffolded from
`create-zerotal@1.18.0`. If you are on a later version, the steps still apply; the
[Release Notes](/docs/changelog) say what changed.

## React, Vue or Flow

The main path uses the **React** starter. Everything on the server — models, migrations,
routes that handle forms, validation, policies, notifications, tests and tenancy — is
the same in all three. Where a step differs, a short **On Vue** or **On Flow** note says
how:

- **Vue** differs only in the page components, which are `.vue` files.
- **Flow** renders its pages on the server as components registered in `routes/web.ts`,
  so its page steps differ more. Its form handlers are the same files as React's.

[Choosing a frontend](/docs#choosing-a-frontend) explains the difference between them.

## Working with a coding agent

The starter ships `AGENTS.md`, an MCP config and skills for the same tasks this tutorial
covers: adding a resource, queued notifications, feature tests and tenancy. The tutorial
does each step by hand so you know what the agent is doing when it does them for you.
See [Agent Surface](/docs/arch).
