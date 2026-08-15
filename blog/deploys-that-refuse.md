---
title: "The Deploy That Refuses"
description: "Zerotal 1.5.0 ships bun zt deploy:<env> — a release pipeline ordered so that everything able to refuse runs before anything that mutates. Plus typed route names, a new AI package, and per-component error boundaries and streaming in Flow."
date: 2026-08-15
category: Announcements
order: 1
---

# The Deploy That Refuses

The worst production failure is not the one that pages you. It is the one that does not.

The page renders. Every status code is 200. The health check is green. And every button is dead, because the app is behind a proxy and the origin allowlist is empty, so every action a browser sends comes back 403 with nothing in the logs. You find out from a user.

Zerotal **1.5.0** is out, and its headline is a command built around that shape of failure:

```bash
APP_ENV=production bun zt deploy:production
```

## Everything that can refuse runs first

The pieces already existed. `zt doctor` finds silent misconfigurations. Config validators refuse an insecure production boot. `assets:build` builds a release. `migrate` applies the schema. What was missing was an **order**, and the order is the whole point:

| Phase         | What happens                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| **Preflight** | Is this process really that environment? Would this config refuse a production boot? Does the doctor pass? |
| **Build**     | `assets:build`, and the Inertia build if the app has one                                                   |
| **Migrate**   | Pending migrations — skip with `--skip-migrations`                                                         |
| **Verify**    | The doctor again, now that the schema has one story                                                        |

A wildcard CORS origin stops the release while the previous one is still serving — not after the migration has run and the new process is live and inert. Nothing mutates until everything that could object has had its turn.

It exits non-zero and **does not restart your service**. That is deliberate. Your process manager already owns lifecycle; this gives it a gate to restart behind:

```bash
bun zt deploy:production && systemctl restart my-app
```

Every environment gets its own command. `production` and `staging` exist without configuration, and `config/deploy.ts` declares more:

```ts
import { DeployConfig } from "zerotal/config";

export default DeployConfig({
  targets: {
    production: { url: "https://example.com" },
    staging: { url: "https://staging.example.com" },
  },
});
```

The target name is checked against the deployment the process was actually started as — so `deploy:production` on a staging box stops on the first line instead of migrating the wrong database.

There is a `--dry-run` that prints the plan and runs none of it, and a `--probe` that opens a real WebSocket handshake against the deployed site afterwards, the way a browser would.

## The doctor learned two things worth knowing

`zt doctor` now checks two settings that are easy to leave at their defaults and expensive to leave at their defaults.

**`app.cors.origin: "*"`** tells every site on the internet that it may read your app's responses out of a visitor's browser. That is right for a public read-only API and wrong for almost everything else.

**`app.secureHeaders.secure`** gates HSTS. Left off, no `Strict-Transport-Security` header is sent at all, and the first request of every visit stays downgradeable. It is now declarable in config alongside the rest of the header block — `hstsMaxAge`, `hstsIncludeSubDomains`, `contentSecurityPolicy` and the others were always read by the middleware, and are now typed so you can write them down.

Both fail on a production-like deployment and stay quiet locally, where a wildcard origin is what makes a second dev server work.

## Route names the compiler checks

```bash
bun zt route:types
```

boots the app, reads the routes it actually registered, and writes a typed map. After that, `route("psots.show")` is a compile error, and `route("posts.show", {})` tells you it wants a `slug`. Parameters come from the pattern, so adding a segment updates every call site.

It boots rather than scanning `routes/`, because a route name comes from three places and only one of them is a file path — the file router's convention, a route file's exported `meta`, and programmatic registrations including a package's. A scanner sees the first and quietly misses the other two.

The same idea reaches Inertia: `Inertia.render(component, props)` is now checked against the page component's own props, and the prop wrappers (`defer`, `optional`, `always`) are generic — so a renamed prop fails at the render call rather than in the browser.

## Flow: failures that cost one component

Three additions, all with the same theme — a page should not be all-or-nothing.

**`<ErrorBoundary>`** means a failing child costs that child, not the page. **`stream`** means a slow child no longer holds up the shell. **`<Virtualize>`** gives you a scrolling window over a collection too large for the DOM. And `@zerotal/flow/browser` drives a real browser against a running app, because the failures that matter here were never visible from the server.

## `@zerotal/ai`, shipping experimental

A typed agent loop, with one loop shared by every driver — so changing model is configuration, not a rewrite. A pause is resumed rather than mistaken for an answer. A refusal is a typed outcome checked before anything reads the content. Named runs take a refreshable lock, spend ceilings and prompt redaction are first-class, and `AiFake` makes the whole thing testable without a network.

It ships **`experimental`** on purpose. The surface is expected to move inside 1.x, and the [support policy](https://zerotal.dev/docs/support-policy) says exactly what that means. Everything else in the suite — twenty-five packages — is `stable`.

## Also in 1.5.0

- **`migrate:refresh`**, and `--seed` on `migrate` and `migrate:fresh`.
- **Debounced jobs** — `debounce` on a `Job` collapses repeated dispatches into one run.
- **Durable scheduler history**, so the monitor panel survives a restart.
- **`bun zt dev`** — the server and every companion process in one terminal, with a tabbed dev UI and no new dependency.
- **The development error page can say what to do**, not just what broke. A missing table now offers to run the migration that would create it.
- **Thirteen packages reached `stable`**, each after documenting its remaining exports.

Full details in the [release notes](https://zerotal.dev/docs/changelog).

## Getting it

```bash
bun add zerotal@1.5.0
```

or start fresh:

```bash
bun create zerotal my-app
```

New apps scaffold with same-origin CORS rather than a wildcard, and with the HSTS setting written down where you can find it.

Then, when you go to ship it, there is a command that will tell you no.
