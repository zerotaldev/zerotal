---
title: Inertia DevTools
description: Record every Inertia request — component, props, timing, and headers — and read it in the Inertia DevTools browser extension.
---

# Inertia DevTools

The [Inertia DevTools](https://inertiajs.com/docs/v3/advanced/devtools) browser
extension shows a timeline of every Inertia request: which component rendered,
which props it received, which of those were deferred or shared, and how long the
server took. Zerotal implements the server half of that — the recorder and the
read API the extension talks to.

It is on by default in development and off everywhere else, so there is normally
nothing to configure.

## What you get

Install the extension, run `bun zt dev`, and open the Inertia panel. Each request
becomes one entry carrying:

- The **component** that rendered and the **route** that matched, by name.
- Every **prop**, tagged with the wrapper that produced it — `defer` (and its
  group), `optional`, `always`, `merge` (and its direction), `once`, `scroll` —
  plus which props came from `share()`.
- The **resolved values**, with sensitive keys removed.
- **Request and response headers**, with sensitive ones removed.
- **Status, method, URL, and server time**.

Follow-up requests are grouped with the navigation that caused them, so a page
whose deferred props arrive in three later requests reads as one batch rather
than four unrelated rows.

### The same data, without the extension

The recorder also feeds Zerotal's own [DevTools](/docs/devtools) panel, on an
**Inertia** tab, whenever that package is installed. Nothing to configure and no
extension to add — the entry is recorded against the same request as everything
else, so one row shows the component and its prop tree _and_ the SQL that
produced them. A visit and the deferred loads it triggers fold into one entry on
that panel's All tab, keyed on the same batch the extension groups by.

This is a fan-out, not a replacement: the read API below is a published contract
and keeps serving the extension either way. Neither package depends on the other
— the panel is found through the container, and its absence is the ordinary case.

### The client half needs Inertia 3

Two independent halves feed the panel. The **server recorder** is this package,
and it works on any supported Inertia version. The **client hooks** — visit
options, prefetch-cache entries, and the grouping that tells a poll apart from a
navigation — live in the Inertia adapter, and only in **version 3 or later**.

On an older adapter the panel still fills with requests, but reports that the app
is not running in dev mode and suggests starting a Vite dev server. That advice
does not apply here — there is no Vite in a Zerotal app — and the fix is the
adapter version:

```bash
# in your project root
bun add @inertiajs/react@^3   # or @inertiajs/vue3@^3
```

Apps scaffolded from Zerotal 1.6.1 onwards already pin it. The React adapter
requires React 19, which the template has always pinned.

Nothing else is needed. The adapter's `dev` option defaults to `import.meta.env.DEV`,
a Vite convention that Bun's bundler does not define on its own — so Zerotal
defines it for every Inertia build, development and production alike. You do not
set `dev` yourself, and there is no Vite server to run.

## Turning it on and off

The recorder follows the same gate as the stack-trace error page: on when this
process is a development process, off otherwise. A production deploy records
nothing and registers no endpoints — there is nothing there to probe.

To override, set the environment variable:

```bash
INERTIA_DEVTOOLS_ENABLED=false   # off, even in dev
INERTIA_DEVTOOLS_ENABLED=true    # on — see the warning below
```

Or configure it:

```typescript fragment
// config/inertia.ts
import { InertiaConfig } from "zerotal/inertia";

export default InertiaConfig({
  devtools: {
    enabled: null, // null = follow the dev-surface gate (default)
    maxEntries: 200,
  },
});
```

> **Running it outside development.** Entries contain request headers and
> resolved props for real users' requests. If you enable the recorder on a shared
> environment, set a `gate` — without one the read API refuses every request
> rather than defaulting to open.

## Configuration

All keys live under `devtools` in `config/inertia.ts`, typed as
`InertiaDevtoolsConfig`.

| Key             | Default | What it does                                                                   |
| --------------- | ------- | ------------------------------------------------------------------------------ |
| `enabled`       | `null`  | `null` follows the dev-surface gate; `true`/`false` decides explicitly.        |
| `maxEntries`    | `200`   | How many entries to keep before the oldest is dropped.                         |
| `redact`        | `[]`    | Extra prop/body key patterns to withhold, on top of the built-in list.         |
| `redactHeaders` | `[]`    | Extra header names to withhold, on top of the built-in list.                   |
| `except`        | `[]`    | Path prefixes never recorded.                                                  |
| `gate`          | `null`  | `(request) => boolean` authorising the read API outside a development process. |

### Redaction

Values are redacted **before** an entry is stored, so a withheld value is never
written down in the first place.

Redacted out of the box: any key containing `password`, `secret`, `token`,
`authorization`, `api_key`, `apikey`, `credit_card`, `card_number`, `cvv`, `ssn`,
or `private_key`, and the `authorization`, `cookie`, `set-cookie`,
`proxy-authorization`, `x-api-key`, `x-csrf-token`, and `x-xsrf-token` headers.
Matching is a case-insensitive substring, so `password` also covers
`password_confirmation` and `currentPassword`.

Add your own:

```typescript fragment
// config/inertia.ts
export default InertiaConfig({
  devtools: {
    redact: ["national_id", "account_number"],
    redactHeaders: ["x-internal-signature"],
  },
});
```

Uploaded files are summarised rather than inlined, and a prop graph containing a
cycle is recorded with `[Circular]` in place of the loop instead of failing the
request.

### Keeping noise out

The read API never records itself. Add anything else that would bury the
timeline:

```typescript fragment
// config/inertia.ts
export default InertiaConfig({
  devtools: { except: ["/health", "/metrics"] },
});
```

### Gating a shared environment

```typescript fragment
// config/inertia.ts
export default InertiaConfig({
  devtools: {
    enabled: true,
    gate: (request) => request.headers.get("X-Debug-Key") === Bun.env["DEBUG_KEY"],
  },
});
```

The gate is never consulted on a development machine — a gate that can lock you
out of your own laptop is a gate that gets switched off.

## How it works

`InertiaProvider` registers `InertiaDevtoolsMiddleware` and the read API when the
recorder is enabled, so an app adds nothing to its middleware stack.

Each response carries the id of the entry it produced, and the first full-page
load also embeds it in a script tag so the extension can find the entry before
any XHR happens. The extension then reads the entry from
`/_inertia/devtools/entries` (`DEVTOOLS_API_PREFIX`), which serves
`DevtoolsEntry` objects newest-first and accepts `component`, `type`, `exclude`,
`offset`, and `limit` filters.

Entries are kept in memory in the process that recorded them, capped at
`maxEntries`. They do not survive a restart — which under `bun zt dev` happens on
every save anyway, and which keeps recording off the disk and out of the request
path.

`devtoolsEnabled()` reports whether the recorder is currently active, if you need
to branch on it yourself.

## Next steps

- [Props](/docs/inertia/props) — the wrappers the panel reports on.
- [Middleware & Versioning](/docs/inertia/middleware) — the rest of the Inertia middleware stack.
- [DevTools](/docs/devtools) — Zerotal's own in-browser panel for SQL, logs, mail, and jobs.
