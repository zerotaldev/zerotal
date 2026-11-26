---
title: In Production
description: Apps running on Zerotal in production today — what they are, which parts of the framework they use, and what building them changed in it.
---

# In Production

These apps run on Zerotal today. Each one is also where much of the framework's
direction comes from: their teams report what they had to build by hand and what got
in their way, and the reports land as releases. The [Release Notes](/docs/changelog)
name the fixes that came from them.

## Trekly

A tourism app at [trekly.co.za](https://trekly.co.za), on Zerotal since 1.7.

- **Built with:** [Inertia](/docs/inertia) pages in Vue, rendered on the server for
  the first paint; the [validator](/docs/validator); file routes with their own
  middleware; mail and database [notifications](/docs/notifications) with failed jobs
  kept for retry; and a release that runs `doctor` and its own `release:check` before
  anything ships ([Deployment](/docs/deployment)).
- **What it changed in Zerotal:** the typed settings store it built by hand, and
  another app built too, became [`@zerotal/settings`](/docs/settings). `zt db:backup`, the release gate's slot
  for an app's own checks, `withConfig()` / `withEnv()`, and `settle()` on the queue
  and notification fakes all started as its reports.

## ExamTutor

A tutoring app at [examtutor.co.za](https://examtutor.co.za): a public home page,
with the app itself behind a password.

## zerotal.dev

This site. The documentation, the blog and its authoring desk are one Zerotal app,
deployed on every release.

- **Built with:** [Flow](/docs/flow) and the [UI kit](/docs/components) for the
  interactive demos and the authoring desk, the [ORM](/docs/orm) on SQLite,
  [authentication](/docs/authentication) for authors, [AI](/docs/ai) for the chat
  demo, and the [agent surface](/docs/arch) for its own `AGENTS.md`.
- **How it ships:** each release is pulled onto a VPS and goes out through
  `deploy:production`: preflight, asset build, migrate and verify, with nothing
  restarted unless every check passes. A scheduled check fails when this site's
  release notes are behind the version on npm.
- **What it shows:** every page here is also plain Markdown at its URL plus `.md`,
  indexed at [`/llms.txt`](/llms.txt), which is the same app serving two formats.
