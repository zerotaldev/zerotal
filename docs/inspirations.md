---
title: Inspirations & Attributions
description: The frameworks, runtimes, and tools that shaped Zerotal's design — what it borrowed, adapted, and where it diverged.
---

# Inspirations & Attributions

Zerotal is built on the shoulders of giants. This page acknowledges the frameworks,
runtimes, and tools that shaped its design — what we borrowed, what we adapted, and
where we intentionally diverged.

Zerotal is a full-stack TypeScript framework built natively for the [Bun](https://bun.sh)
runtime, and to get there we drew on the best patterns from across the industry. The
influences below are grouped by the part of the stack they shaped.

## The Runtime & Foundation

### Bun

Bun is not just a runtime dependency — it is the reason Zerotal exists in the form it
does. Without Bun's native primitives there would be no coherent single-package story:

- **`Bun.SQL`** — the native SQLite/PostgreSQL client is the foundation of the ORM.
  No `pg`, no `better-sqlite3`, no driver-abstraction overhead.
- **`Bun.serve`** — the HTTP server. No `http.createServer`, no Express under the hood.
- **`Bun.file` / `Bun.write`** — power the local storage driver and asset pipeline.
- **`Bun.markdown`** — renders this documentation site straight from the `docs/*.md`
  source files.
- **`bun:test`** — the testing helpers (`TestApp`, `TestResponse`, factories) are built
  directly on `bun:test`'s `describe` / `it` / `expect` primitives.
- **Bun plugin API** — `bun-plugin-tailwind` and the JS bundler used by `FlowProvider`
  run inside Bun's native plugin lifecycle.

Where we diverged: Zerotal makes no attempt to also run on Node. Committing fully to one
runtime is what keeps the stack small — one SQL client, one server, one test runner —
instead of abstracting over several.

### Temporal

The TC39 `Temporal` proposal directly underpins `Carbon`, Zerotal's date library. All
date arithmetic uses `Temporal.PlainDate`, `Temporal.ZonedDateTime`, and friends — never
the legacy `Date` object — and `Carbon` is built on Bun's bundled `Temporal`
implementation rather than wrapping `Date`.

Where we diverged: `Carbon` is a thin ergonomic layer over `Temporal`, not a Moment/Day.js
clone — it tracks the proposal toward stable rather than inventing its own date model.

## Architectural Titans

### Laravel

Laravel is the gold standard for developer-friendly full-stack frameworks. Its
influence on Zerotal is pervasive:

- **Active Record ORM** — `BaseModel`, attribute decorators (`@column`, `@belongsTo`,
  `@hasMany`, `@hasOne`), and the query builder API mirror Eloquent's ergonomics.
- **Service providers** — the `onRegister` / `onBooting` / `onBooted` lifecycle
  (through to `onStarting` / `onStarted` / `onStopping` / `onStopped`) maps directly
  to Laravel's provider boot cycle.
- **Artisan-style CLI** — the `zt` command runner and generator scaffolding
  (`make:model`, `make:controller`, `migrate`, …) take heavy cues from Artisan.
- **Mail notifications** — `Notify.send(user, new WelcomeNotification())`, with the
  email built fluently inside `toMail()` (`new MailMessage().subject(...).line(...)`),
  is a conscious homage to Laravel's mail/notification API.
- **Facades** — `Notify`, `Cache`, `Storage`, `Queue`, `Auth`, and `Log` follow the
  static-proxy pattern, resolving a container singleton on each call.
- **Gate / Policy authorization, password broker, and the `validate()` request flow**
  all follow Laravel's shapes.

Where we diverged: Zerotal drops PHP's runtime magic (no dynamic proxies, no
`__get`/`__set` trickery) in favour of explicit TypeScript decorators and genuine
static typing throughout.

### Rails

Before Laravel, Ruby on Rails established the patterns both frameworks inherit: the
**Active Record** model pattern itself, **convention over configuration**, and
**versioned, runnable migrations**. Zerotal's `Model.create()` / `Model.find()` surface
and its migration runner trace their lineage here.

Where we diverged: the same convention-over-configuration spirit, expressed through
explicit TypeScript types and decorators rather than Ruby metaprogramming — conventions
you can follow by reading types, not by memorising magic.

## The TypeScript & Node Ecosystem

### NestJS

NestJS demonstrated that a decorator-driven IoC container could feel natural in
TypeScript. Zerotal's dependency-injection story echoes it:

- **Container + decorators** — `@inject(...)` marks a class for auto-wiring,
  declaring its constructor dependencies as explicit tokens the container
  resolves in order.
- **Provider modules** — grouping bindings and boot logic into provider classes
  parallels Nest's module/provider model.

Where we diverged: Zerotal uses standard **TC39 decorators** with no `reflect-metadata`
dependency — dependencies are declared explicitly as `@inject(...)` tokens rather than
inferred from constructor parameter types.

### AdonisJS

AdonisJS proved that a Laravel-flavoured framework could thrive in the JavaScript
ecosystem. Several Zerotal conventions trace back to Adonis:

- **`HttpContext` as the single per-request object** — passing one rich context object
  through the entire pipeline (rather than `req`/`res` pairs) was validated by Adonis.
- **IoC container token conventions** — string-keyed bindings (`'db'`, `'cache'`,
  `'queue'`, `'events'`, `'log'`) alongside class and Symbol tokens follow the pattern
  Adonis popularised.
- **Lucid-inspired query scopes** — named scopes (`Model.scope(...)`,
  `Model.query().withScopes(...)`) and global scopes parallel Lucid's model scopes.

Where we diverged: Zerotal keeps views as typed TypeScript (template literals / JSX)
rather than adopting a dedicated template engine like Adonis's Edge — one less language
to learn, and views type-check against the data you pass them.

### Koa

Zerotal's middleware pipeline is a Koa-style **onion model**, not a Laravel-style
before/after/terminate kernel:

- **`handle(ctx, next)`** — each middleware is a `Pipe` with a single `handle` method
  that receives the `HttpContext` and a `next()` continuation, awaits downstream
  middleware, and can run logic on the way out — exactly Koa's cascading model.
- **Short-circuiting** — a middleware that returns without calling `next()` stops the
  chain, the same way Koa middleware can decline to continue.

Where we diverged: Koa is deliberately minimal — middleware and little else. Zerotal keeps
the onion model but ships a batteries-included stack on top of it, and the context is a
richly-typed `HttpContext` rather than a bare object. Post-response work (Laravel's
`terminate`) is handled via `ctx.afterResponse(...)` callbacks rather than a third phase.

## Reactivity & The Frontend

### Next.js

Next.js normalised several patterns that Zerotal adopted for its front-end story:

- **File-based routing** — a `routes/` directory with `GET`, `POST`, etc. named exports
  mirrors the Next.js App Router file convention.
- **Co-located route handlers** — keeping data-fetching logic next to the route that
  uses it (rather than in a separate controllers directory) is a Next.js-influenced
  option.
- **`_layout.ts`** — a persistent shell that wraps every page in a section of the app
  comes directly from Next.js layouts.

Where we diverged: file-based routing is _one option_, not the whole story — routes can
equally be registered explicitly with `Router.get(...)` — and everything runs
server-side on Bun, with no client bundler or React Server Components coupling.

### Livewire / Alpine.js

Flow — Zerotal's first-party, server-driven reactive component system — draws from the
Livewire mental model:

- **Server-driven reactivity** — component state lives on the server; only diffs are
  sent to the client.
- **`@locked` / `@expose` decorators** — the distinction between server-private and
  client-accessible properties mirrors Livewire's `#[Locked]` and `wire:model` boundary.
- **SPA `navigate` transitions** — Livewire's `livewire:navigate` was the direct
  reference point for Flow's fetch-and-swap page navigation.

Where we diverged: Flow is pure TypeScript with no PHP/Blade runtime — components are
typed classes, and the diffing/transport protocol is Zerotal's own.

### Inertia.js

Zerotal's first-party Inertia adapter (`@zerotal/inertia`) is built on Inertia.js
itself. The adapter layer follows the same server-side adapter conventions established
by the official Laravel and Rails adapters.

Where we diverged: the adapter ships first-party and is versioned with the framework,
rather than living as a separately-maintained community package.

### shadcn/ui

`@zerotal/flow-ui` follows the model shadcn/ui established, and the debt is worth naming
plainly:

- **You own the code** — `bun zt flow:add button` copies the source into your app rather
  than adding a dependency you can only configure from the outside. `flow:add` is the
  same idea as `npx shadcn add`, down to the registry manifest behind it.
- **Tokens over props** — re-theming happens by overriding CSS variables, not by
  threading a theme object through every component. The default token names
  (`background`, `card`, `primary`, `muted`, `accent`, `destructive`, `border`, `input`,
  `ring`) are shadcn's, so a palette written for one drops into the other.
- **Styled wrappers over headless primitives** — shadcn styles Radix; flow-ui styles
  Flow's own headless layer, which fills the same role.
- **The catalogue** — the component list was chosen by working through shadcn's and
  asking which entries a Zerotal application would actually reach for.

Where we diverged: components render on the server and return HTML rather than React
elements, so there is no client component tree; the `Chart` component draws SVG on the
server instead of wrapping a charting library; and the AI-chat components have no
equivalent here.

## Tooling, Data & Telemetry

### Zod

The validator's API is shaped by Zod's fluent, inferable schemas:

- **Chained rule builders** — `r.string().min(3).max(255)`, `r.number().integer()`,
  `r.array(r.string()).optional()` read like Zod schemas.
- **Type inference** — `Infer<>` derives the fully-typed result of a schema, so
  validated data needs no manual casts — the same payoff as Zod's `z.infer`.

Where we diverged: Zerotal's validator is wired into the HTTP request lifecycle
(`FormRequest`, the `validate(ctx, …)` helper, automatic 422/redirect handling) rather
than being a standalone parsing library.

### Monolog

Zerotal's logger borrows Monolog's channel architecture (by way of Laravel's logging):

- **Named channels with per-channel level thresholds** — `console`, `single`, `daily`,
  `stack`, `null`, each filtering below its configured minimum level.
- **Stack channels** — fan a single entry out to several channels at once.
- **Daily rotation with retention** — date-stamped files pruned after `days`.

Where we diverged: the logger is a lean, five-driver reimplementation — there is no PHP
handler/processor ecosystem to port, just the channel model that earns its keep.

### Laravel Telescope / Pulse

Zerotal's devtools (`@zerotal/devtools`) take their cue from Telescope and Pulse:

- **Per-request traces** — queries, cache operations, mail, jobs, and logs captured for
  each request and streamed live to an in-browser dashboard.
- **Slow-query and N+1 detection** — surfaced automatically, the way Telescope flags
  slow queries.

Where we diverged: rather than each domain package depending on devtools, everything is
captured through the synchronous **`FrameworkEvents`** instrumentation bus in
`@zerotal/core` — devtools (and the logger, and any metrics layer) simply subscribe, so
the domain packages never import their observers. See [Events](/docs/events).

### Prisma / Drizzle

The class-based migration format (`export default class extends Migration` with `up()`
and `down()` methods) and the `migrate` / `migrate:fresh` CLI commands were shaped by
observing what Prisma and Drizzle got right.

Where we diverged: migrations stay as ordinary TypeScript you can read and run — no
schema DSL, no generated client step — keeping the database layer transparent rather
than hidden behind a code-generation pipeline.

If you see your work reflected here and feel it is misrepresented or missing, please
open an issue or pull request — attribution matters.

## Next steps

- [Getting started](/docs/getting-started) — scaffold your first Zerotal app.
- [Application](/docs/application) — how the framework is wired together.
- [Contributing](/docs/contributing) — help shape the framework.
