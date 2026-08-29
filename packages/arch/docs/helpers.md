---
title: Helpers
description: Small, named, tree-shakeable functions for env, config, control flow, strings, and responses.
---

# Helpers

`@zerotal/core` ships a set of small, focused helper functions for the things you
reach for constantly — reading environment variables, building responses,
massaging strings, and taming control flow. They are **named, tree-shakeable
exports**, never globals: import what you use.

```typescript
// in a controller
import { env, config, tap, pipe, rescue, data_get, Str, collect } from "zerotal";
```

## Environment & paths

### env

Read an environment variable with an optional, type-coerced fallback. This is the
canonical way to read env values — every config file uses it. The return type
follows the fallback's type.

```typescript fragment
// config/app.ts
env("APP_NAME", "Zerotal App"); // string
env("APP_DEBUG", false); // boolean — coerces 'true' / '1'
env("PORT", 3000); // number  — coerces numeric strings
env("APP_KEY"); // string | undefined — no fallback
```

### requireEnv

Read a variable that must exist. Throws a `ConfigError` at boot if it's missing —
use it for secrets your app cannot run without.

```typescript fragment
// config/app.ts
const key = requireEnv("APP_KEY"); // throws ConfigError if unset
```

### basePath

Resolve a path relative to the project root (`process.cwd()`), regardless of which
file calls it. Use it when declaring route files so paths don't depend on the
caller's directory.

```typescript fragment
// bootstrap/app.ts
Application.create({ providers })
  .routing({ web: basePath("routes/web.ts") })
  .fileBasedRouting({ web: basePath("app/routes") });
```

### setAppEnv

Map a CLI command name to `APP_ENV` before the app is created. Called once in the
managed `zt.ts`; you rarely call it yourself. `serve`/`start`/`s` → `web`,
`worker`/`queue:work` → `worker`, anything else → `console`. A no-op if `APP_ENV`
is already a valid runtime mode.

```typescript fragment
// zt.ts
setAppEnv(process.argv[2]);
const { default: app } = await import("./bootstrap/app.ts");
```

## Configuration access

### config

Read (and write) loaded configuration by dot-path, anywhere after boot.

```typescript fragment
// in a controller
config("app.name"); // string — typed from the registered config shape
config("app.port", 3000); // number — fallback must match the path's type
config.require("app.key"); // throws if absent
config.set("mail.driver", "log"); // override at runtime
config.all(); // the whole config map
config.safe("app.cors", {}); // returns the fallback if no app is booted
```

Paths are type-aware: each resolves to the type declared by the owning package's
config shape, with autocomplete. Unknown paths fall back to `unknown`. See
[Configuration → Typed dot-paths](/docs/config-system#typed-dot-paths).

> **Tip** — `config.safe()` is the no-throw variant — handy in library code that
> may run before an application exists.

### request

Reach the current request's `HttpContext` from anywhere in the async call chain —
no thread-through required. With a key, it reads a single merged input value (route
params, then parsed body, then query string).

```typescript fragment
// in a controller
request(); // the HttpContext
request("email"); // string | undefined — input named 'email'
request<number>("page", 1); // typed input with a fallback
```

> **Warning** — `request()` throws if called outside an active HTTP request.
> Body resolution is synchronous: it only sees body data already parsed and cached
> (e.g. via a `FormRequest` or `await ctx.body()`).

## Control flow

### tap / tapAsync

Run a side effect on a value and return the value unchanged — perfect for emitting
an event or logging in the middle of a chain without breaking it.

```typescript fragment
// in a controller
return tap(await User.create(data), (user) => Events.emit(new UserRegistered(user.id)));

return await tapAsync(await User.create(data), async (user) => {
  await Notification.send(user, new WelcomeEmail());
});
```

### pipe / pipeAsync

The sibling of `tap` — pass a value through a transformer and return the _result_.
Use `pipe` when the value should change, `tap` when it shouldn't.

```typescript fragment
// in a controller
const slug = pipe(post.title, (t) => t.toLowerCase().replace(/\s+/g, "-"));
const hashed = await pipeAsync(password, (p) => Hash.make(p));
```

### rescue / rescueSync

Run a callback and fall back to a value (or a function of the caught error) instead
of throwing. `rescue` awaits; `rescueSync` is for hot paths that can't await
(JSON parsing, attribute decoding).

```typescript fragment
// in a controller
const price = await rescue(() => stripe.getPrice(id), 0);
const user = await rescue(
  () => User.findOrFail(id),
  (e) => {
    log(e);
    return null;
  },
);

const payload = rescueSync(() => JSON.parse(raw), {});
```

### data_get

Safely read a deeply nested value by dot-notation, returning a default when any
segment is absent. Built for untyped JSON — webhooks, third-party API responses —
where optional chaining gets unwieldy. Numeric segments index into arrays.

```typescript fragment
// in a webhook handler
data_get(payload, "user.address.city"); // 'Cape Town' or undefined
data_get(payload, "items.0.price", 0); // first item's price, or 0
```

## Strings — Str

`Str` is a namespace of pure string utilities. The common case-conversions are
also exported individually (`camelCase`, `snakeCase`).

```typescript fragment
// in a controller
Str.camelCase("user_id"); // 'userId'
Str.snakeCase("userId"); // 'user_id'
Str.pascalCase("user-id"); // 'UserId'
Str.kebab("UserId"); // 'user-id'
Str.slugify("Hello, World!"); // 'hello-world'
Str.titleCase("hello world"); // 'Hello World'
Str.capitalize("hello"); // 'Hello'
Str.lcfirst("Hello"); // 'hello'
Str.truncate(text, 50); // 'long text...' (custom suffix optional)
Str.words(text, 10); // first 10 words + suffix
Str.squish("  a   b  "); // 'a b'
Str.start(path, "/"); // ensure leading '/'
Str.finish(path, "/"); // ensure trailing '/'
Str.after(s, ":"); // substring after first ':'
Str.before(s, ":"); // substring before first ':'
Str.afterLast(s, "/"); // substring after last '/'
Str.beforeLast(s, "/"); // substring before last '/'
Str.contains(s, "x"); // boolean
Str.replaceFirst(s, a, b);
Str.replaceLast(s, a, b);
Str.padLeft(s, 5, "0"); // '00042'
Str.reverse(s);
Str.random(32); // random alphanumeric string
Str.isAlphanumeric(s); // boolean
```

Extend it with your own helper via `Str.macro(name, fn)`.

### Inflection & naming

These power the ORM's table-name convention and are exported directly:

```typescript
// in a controller
import { pluralize, singularize, tableNameFor } from "zerotal";

pluralize("category"); // 'categories'
singularize("people"); // 'person'
tableNameFor("BlogPost"); // 'blog_posts'
```

## Sharing helpers with the browser — `zerotal/shared`

Importing `zerotal` into a client bundle drags the server in behind it. So the helpers that
have no server in them are also published on their own entry point:

```tsx
// resources/js/pages/Trips/Index.tsx — a browser bundle
import { pluralize, formatMoney, Str } from "zerotal/shared";
```

Everything reachable from `zerotal/shared` is pure — no `node:` imports, no `Bun` globals, no
config, no container, no request context. Importing it pulls in these functions and nothing
else, and a test in the framework's own suite bundles the entry point for the browser to keep
that true.

It carries `pluralize`, `singularize`, `snakeCase`, `camelCase`, `tableNameFor`, the whole
`Str` namespace, and the formatters below.

**Why it matters more than convenience.** Without it, a page that needs `pluralize` gets a
second implementation written by hand — and the second copy is always the worse one, because
the irregulars and the inflect-only-the-last-word rule are exactly what someone re-deriving
it leaves out. `pluralize("supplier line")` is `"supplier lines"`; the naive rule gives
`"suppliers line"`. One import removes the divergence rather than managing it.

### Formatting both sides can agree on

`Intl` is in both runtimes and does the work; the risk is that a server helper and a browser
helper make the same decision twice. A total that reads `R 39 147` on screen and `R39,147.00`
on the invoice looks like two different numbers to the person paying it.

```typescript
import { formatMoney, formatNumber, formatDate } from "zerotal/shared";

// Minor units by default — how a column that must not lose a cent stores it.
formatMoney(3_914_700, { currency: "ZAR", locale: "en-ZA" });
formatMoney(39_147, { currency: "USD", locale: "en-US", minorUnits: false });

formatNumber(39147.5, { locale: "en-GB", maximumFractionDigits: 1 }); // '39,147.5'

formatDate("2026-08-28T21:30:00Z", { locale: "en-ZA", timeZone: "Africa/Johannesburg" });
```

Pass `locale` explicitly wherever the two sides must match. Left off, it is the machine's on
the server and the reader's in the browser, and those are not the same. Pass `timeZone` for
the same reason: a machine on UTC and a reader in Cape Town disagree about which _day_ an
11pm booking happened on, and that is the shape the bug takes.

Each formatter takes its own options interface, all extending `FormatOptions` (which carries
`locale`):

| Interface       | Used by        | Adds                                                                   |
| --------------- | -------------- | ---------------------------------------------------------------------- |
| `FormatOptions` | — (the base)   | `locale`                                                               |
| `MoneyOptions`  | `formatMoney`  | `currency` (required), `minorUnits` (default `true`), `fractionDigits` |
| `NumberOptions` | `formatNumber` | `minimumFractionDigits`, `maximumFractionDigits`                       |
| `DateOptions`   | `formatDate`   | `dateStyle`, `timeStyle`, `timeZone`                                   |

`formatDate` returns an empty string for an unparseable value rather than `Invalid Date`, so
a bad timestamp renders as a blank rather than as words in the middle of a page.

## Outbound HTTP — Http

`Http` is the fluent client for calling another service. It is `fetch` with the things you would
otherwise write around every call — auth, timeout, retry, JSON — already there, and one place to
intercept in a test:

```typescript fragment
import { Http } from "zerotal/http";

const response = await Http.withToken(apiKey).timeout(5_000).retry(3).post("/charges", { amount });

if (response.ok) {
  const charge = await response.json<{ id: string }>();
}
```

Every verb — `get`, `post`, `put`, `patch`, `delete`, `head` — returns a `PendingRequest`, which
is awaitable _and_ chainable: `withHeaders`, `withToken`, `withBasicAuth`, `acceptJson`,
`timeout`, `retry`, `withJson`, `withFormData`. Awaiting it gives an `HttpClientResponse` with
`status`, `ok`, `headers`, `json()`, `text()` and `blob()`.

**A failed response is not a thrown error by default.** A 404 is an answer, and an integration
that treats every non-2xx as an exception cannot tell "no such customer" from "the service is
down". Call `.throw()` on the response when you do want the non-2xx to raise — it throws
`HttpClientError`, which carries the response so a handler can still read the status.

```typescript fragment
// Let a 404 be a value, and anything else be a problem.
const response = await Http.get(`/customers/${id}`);
if (response.status === 404) return null;
return response.throw().json<Customer>();
```

In tests, `Http.fake()` intercepts all of it — see [Mocking](/docs/testing/mocking#outbound-http).

`Http` is a class rather than a facade, so a request is made with the same import everywhere.
`QueryInput` is what a query object may hold, and `PaginatedData` the shape of a paginated body
when the other end returns one.

## Objects — deepMerge

Recursively merge an override object onto a base, lodash-style: nested plain
objects merge key-by-key, while arrays, primitives, and class instances replace
wholesale. `undefined` values in the override are ignored. Neither argument is
mutated, and the result shares no mutable plain structure with either — every plain
object and array in the result is a fresh copy, so mutating a merged config can
never corrupt the module-level `defaults` it was built from. Prototype-polluting
keys (`__proto__`, `constructor`, `prototype`) are skipped, so it is safe to merge
untrusted input such as env files or parsed JSON. This is what makes the
`*Config({ ... })` factories preserve untouched defaults at every depth.

```typescript
// in a config factory
import { deepMerge } from "zerotal";

deepMerge(
  { smtp: { host: "localhost", port: 1025, secure: false } },
  { smtp: { host: "mail.example.com" } },
);
// → { smtp: { host: 'mail.example.com', port: 1025, secure: false } }
```

### `DeepPartial<T>` — the shape an override may take

`deepMerge` accepts a `DeepPartial<T>`: every key optional, all the way down. A plain
`Partial<T>` only makes the _top_ level optional, which would make the commonest override
anyone writes a type error:

```typescript
// in a config factory
import { deepMerge } from "zerotal";
import type { DeepPartial } from "zerotal";

interface MailConfigShape {
  smtp: { host: string; port: number; secure: boolean };
}

// Overriding one field of a nested block, without restating the others.
const override: DeepPartial<MailConfigShape> = { smtp: { host: "mail.example.com" } };
```

Arrays, `Date`s, `Map`s, `Set`s and functions are left whole rather than made partial,
matching the merge itself — those replace wholesale, so asking for a partial of one would
describe something `deepMerge` never does. An explicit `undefined` is allowed too, because
the merge documents it as _skipped_ rather than blanking a default.

Write your own config factory's parameter as `Partial<XConfigShape>` when the shape is
flat, and `DeepPartial<XConfigShape>` when it nests — both satisfy the package linter's
`config-partial` rule.

### Arrays replace — they do not merge

An array in the override replaces the base array entirely. It is **never**
concatenated, de-duplicated, or merged element-by-element:

```typescript fragment
// in a config factory
deepMerge({ hosts: ["a", "b"] }, { hosts: ["c"] });
// → { hosts: ['c'] }   (not ['a','b','c'], not ['c','b'])
```

This is deliberate — there is no surprise-free universal rule for combining two
arrays. When you design a config or middleware option shape, pick the model that
matches how you want overrides to behave.

**Which model should I use?**

- **List the user should be able to extend** → expose a plain array and document
  that setting it replaces the default. Have callers spread the default in
  themselves: `SomeConfig({ hosts: [...DEFAULT_HOSTS, "extra"] })`.
- **Keyed, extensible sub-config** → model it as a nested **object** keyed by name
  (like `cache.stores` or `storage.disks`) instead of an array. Objects merge, so a
  user can add one entry without losing the built-ins.

> **Note** — The replacement array is deep-cloned, so mutating the merged result
> never reaches back into the value the caller passed in. Class instances (e.g. a
> configured `driver`) are replaced by reference — they keep their prototype and are
> never merged into.

## Fluent wrappers

### fluent

Wrap any value to chain `.pipe()` transforms and `.tap()` side effects, then unwrap
with `.get()`. Useful for readable builder-style code over a plain value.

```typescript fragment
// in a controller
const user = fluent(await User.find(id))
  .tap((u) => log(`loaded ${u.email}`))
  .get();
```

### collect

Wrap an array in a `Collection` for chainable, immutable transformations — `map`,
`filter`, `reduce`, `groupBy`, `pluck`, `sum`, `first`, `unique`, and more — a
fluent collection pipeline.

```typescript fragment
// in a controller
const topNames = collect(orders)
  .filter((o) => o.paid)
  .pluck("customerId")
  .unique()
  .toArray();
```

> **Note** — `groupBy()` returns a plain `Record<string, T[]>`, not a `Collection`.
> Re-wrap a group with `collect(group)` if you need to keep chaining over it.

## Responses

These build and send the HTTP response for the current request. The terminal
helpers (`json`, `view`, `html`, `markdown`, `file`) set `ctx.response` directly;
`redirect()` and `redirectTo()` return a chainable `ResponseBuilder`.

```typescript fragment
// in a controller
import { json, view, html, markdown, redirect, redirectTo, abort } from "zerotal";

json({ user }); // 200 application/json
json({ error: "Nope" }, 422); // custom status
html("<h1>Hi</h1>"); // 200 text/html
view(Welcome, { title: "Hi" }); // render a view component + props
markdown("# Title\n\nBody"); // render markdown → HTML

redirect("/dashboard"); // 302 by default
redirect("/login", 301); // custom status
redirect().back(); // back to the referrer
redirect().intended("/home"); // to the originally-requested URL
redirectTo("posts.show", { id }); // redirect to a named route
```

`redirect()` and `redirect().back()` return a `ResponseBuilder` that lets you flash
data and messages onto the redirect:

```typescript fragment
// in a controller
return redirect("/posts").withSuccess("Post created.").with("highlight", post.id);

return redirect().back().withErrors({ title: "Title is required." });
```

> **Tip** — Call `redirect()` with no arguments to pick the destination fluently:
> `redirect().to("posts.show", { id })`, `redirect().back()`, or
> `redirect().intended("/")`. The builder also exposes `withError`, `withWarning`,
> and `withInfo` alongside `withSuccess` and `withErrors`.

`abort()` throws a framework error that the exception handler renders:

```typescript fragment
// in a controller
abort("Something went wrong."); // → 500 with a message
abort(403, "You can't do that."); // status + message
abort(NotFoundError); // a ZerotalError subclass
```

## Dates — Carbon

Date and time get their own helper, `Carbon`, an immutable wrapper over the
`Temporal` API. It has its own page: [Carbon](/docs/carbon).

```typescript
// in a controller
import { Carbon } from "zerotal/carbon";

Carbon.now().addDays(7).toDateString();
```

## References

| Helper                  | Signature                                                               | Description                                             |
| ----------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| `env`                   | `env(key: string, fallback?: string \| boolean \| number)`              | Read an env var, coerced to the fallback's type.        |
| `requireEnv`            | `requireEnv(key: string): string`                                       | Read a required env var; throws `ConfigError` if unset. |
| `basePath`              | `basePath(...segments: string[]): string`                               | Resolve a path from `process.cwd()`.                    |
| `setAppEnv`             | `setAppEnv(command?: string): void`                                     | Map a CLI command to `APP_ENV` before boot.             |
| `config`                | `config(path: string, fallback?): unknown`                              | Read config by dot-path (typed for known paths).        |
| `config.set`            | `config.set(path: string, value): void`                                 | Override a config value at runtime.                     |
| `config.require`        | `config.require(path: string): unknown`                                 | Read config; throws when the path is absent.            |
| `config.all`            | `config.all(): Record<string, unknown>`                                 | Return the whole config map.                            |
| `config.safe`           | `config.safe(path: string, fallback): unknown`                          | Read config without throwing when no app is booted.     |
| `request`               | `request<T>(key?: string, fallback?: T): HttpContext \| T \| undefined` | Active `HttpContext`, or one merged input value.        |
| `tap` / `tapAsync`      | `tap<T>(value: T, cb: (v: T) => void): T`                               | Run a side effect, return the original value.           |
| `pipe` / `pipeAsync`    | `pipe<T, R>(value: T, fn: (v: T) => R): R`                              | Transform a value, return the result.                   |
| `rescue` / `rescueSync` | `rescue<T>(cb, fallback: T \| ((e) => T)): Promise<T>`                  | Run a callback, fall back instead of throwing.          |
| `data_get`              | `data_get(target, key: string, defaultValue?): unknown`                 | Read a nested value by dot-notation, with a default.    |
| `deepMerge`             | `deepMerge(base, override)`                                             | Recursively merge objects; arrays/instances replace.    |
| `fluent`                | `fluent<T>(value: T): Fluent<T>`                                        | Chainable `.pipe()` / `.tap()` / `.get()` wrapper.      |
| `collect`               | `collect<T>(items: T[]): Collection<T>`                                 | Chainable, immutable array transformations.             |
| `json`                  | `json(data: unknown, status = 200): void`                               | Send a JSON response.                                   |
| `view`                  | `view(component, props?, status = 200): void`                           | Render a view component (or markup) as the response.    |
| `html`                  | `html(markup, status = 200): void`                                      | Send a raw HTML response.                               |
| `markdown`              | `markdown(content, options?, status = 200): MarkdownBuilder`            | Render markdown → HTML; chain `.withLayout()`.          |
| `file`                  | `file(path, options?): Promise<void>`                                   | Stream a file from disk; throws if missing.             |
| `redirect`              | `redirect(url?, status = 302): ResponseBuilder \| RedirectBuilder`      | Redirect; no-arg form picks a destination fluently.     |
| `redirectTo`            | `redirectTo(name: string, params?, status = 302): ResponseBuilder`      | Redirect to a named route.                              |
| `abort`                 | `abort(status \| message \| ErrorClass, message?): never`               | Throw a framework HTTP error the handler renders.       |

## Next steps

- [Configuration](/docs/config-system) — where `env()` and `config()` get their values.
- [Responses](/docs/responses) — the response layer in depth.
- [Carbon](/docs/carbon) — the date-time helper.
- [HTTP Context](/docs/context) — what `request()` reaches for in the async tree.
