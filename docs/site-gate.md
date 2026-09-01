---
title: Site gate
description: Maintenance mode and private preview — take a site down correctly, or open it only to the people you invite.
---

# Site gate

Two states a site can be in that are not "serving the public", and they are not the
same thing.

**Maintenance** — the site is _down_. Nobody may use it, staff included, because the
usual reason a site is down is that its database is being changed underneath it, and
letting one person in is letting them into that. Minutes, not weeks. Every request is
answered `503` with `Retry-After`.

**Private preview** — the site is _up and working perfectly_, for the people invited to
it. Not down, not broken, not public yet. Weeks. An invited visitor gets the real site
at `200` and can transact on it; the public gets a holding page.

Building one and calling it both is the usual mistake, and it is why a pre-launch site
ends up behind a `503` that search engines take seriously.

## Turning it on

```bash
bun zt down --retry=120          # maintenance
bun zt preview                   # private preview; prints the link
bun zt preview --until=2026-09-30
bun zt up                        # open again
bun zt gate:status               # what is it doing
```

`zt preview` generates the token when you do not pass one, because a token typed by a
person is the only thing between the public and an unlaunched site and nothing
rate-limits guesses at it. **Keep the link it prints** — only a hash is stored, so the
token cannot be read back.

These four commands need no application and are registered in every environment. A
maintenance command that only works when the app boots is one you cannot reach at the
moment you need it.

## From your own console

The framework's job is the primitive; the button is yours.

```ts
import { Gate } from "@zerotal/core/gate";

await Gate.preview({ token, until: "2026-09-30", by: user.name });
await Gate.maintenance({ retryAfter: 120, by: user.name });
await Gate.open();

Gate.status(); // { mode, since, until, by, expired } — never the token
```

## Getting in

**A secret link.** `https://example.com/?preview=<token>`. The gate recognises the
token, sets a signed `HttpOnly` `SameSite=Lax` cookie, and **redirects to the same URL
with the parameter removed.**

That redirect is not tidiness. A token left in the address bar travels into `Referer`
on every outbound link, into analytics, into screenshots, and into the message where
somebody shares "the page I was looking at". Stripping it on first use leaves the
secret in a cookie and nowhere else.

**A signed-in staff account.** A request whose authenticated user holds a role on the
allowlist is admitted without a token, so an app that already has staff accounts does not
need a second secret for the same people. It defaults to `["admin"]`:

```ts
// config/gate.ts
export default { staffRoles: ["admin", "editor"] };
```

An **allowlist**, and it matters. 1.13.3 shipped the inverse — "anyone whose role is not
`customer`" — which in an app whose roles are `user` and `admin` admitted every signed-in
visitor and let the public straight through. A gate that fails open is worse than no gate,
because it reports success while doing nothing. An app whose staff role is named something
this does not list gets no bypass and notices, which is the safe direction to be wrong in.

The cookie lasts seven days. A preview cookie with no lifetime means an ex-tester keeps
access to a site that has since gone live with real customer data.

**Rotating revokes.** `zt preview --token=<new>` invalidates every cookie issued under
the previous token, because the way a preview leaks is a tester forwarding the link to
somebody who has left.

## What stays reachable

These are open whatever the gate is doing:

| Path                                           | Why                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/__zerotal/*`                                 | The health endpoint. Otherwise the uptime monitor pages the on-call about a planned window, and a deploy gate that polls health fails its own release. |
| `/css/*`, `/js/*`, `/assets/*`, `/favicon.ico` | A maintenance page that 503s its own stylesheet is an unstyled apology.                                                                                |

**Your webhooks are not on that list, and this is the one that costs money.**

A payment provider posting a settlement into a maintenance window gets a `503`, and
depending on the provider that is a retry, a dropped callback, or a payment your books
never learn about. Nothing can infer which of your routes a third party calls, so it
has to be declared:

```ts
// config/gate.ts
export default {
  allow: ["/webhooks/", "/api/callbacks/"],
};
```

## What the public gets during a preview

`200` with a holding page by default, which is right for a pre-launch site collecting
an email address. Set `publicResponse: "notFound"` when the site's existence is itself
not public:

```ts
// config/gate.ts
export default { publicResponse: "notFound" };
```

Both are legitimate and the framework does not pick. **Maintenance is always `503`** and
is not configurable, because that one is not a preference: a maintenance page served at
`200` tells a search engine that "we will be back shortly" is the content of your
homepage, and it will index it as such. Sites have lost their rankings to a two-hour
window served at the wrong status code.

## Where the state lives

`storage/framework/gate.json`, not the database.

A flag in the database is unreadable exactly when the database is the thing you are
working on, so a maintenance mode kept there works only on the days you did not need
it. The file is also why the gate survives a restart — an in-memory flag would be
lifted by the very deploy it was supposed to run behind.

The preview token is stored as a **hash**. The file sits on disk, readable by anything
on the box and copied by every backup, and putting a live credential in it would be the
same mistake as an `.env.example` carrying a working key.

A file the gate cannot parse reads as **open**, deliberately. Failing closed would take
a site down because a JSON file lost a brace, and "the site is up" is the safer error
for a mechanism whose whole purpose is to be turned off again.

## It covers raw routes too

`Router.raw()` bypasses the middleware pipeline by design — that is what it is for. It
does **not** bypass the gate.

A gate that covered only the pipeline would be the worst kind, because it gates the
homepage and therefore looks like it works. This framework's own documentation site
serves every `/docs/*` page from a raw route: with an early build of the gate on, the
front page said "coming soon" and every page of content stayed public.

Raw routes get no staff bypass, since no session has been resolved by then — the token
cookie is the only way through.

## `zt doctor` reports it

A gate is the most reversible thing in the framework and the easiest to forget, because
when it is working nothing complains: the people who would notice are the ones being
kept out, and they have no way to tell you.

- **Maintenance in production** is reported as a failure. It is an outage.
- **A preview in production** is a warning naming who set it and when, since a
  pre-launch gate is usually deliberate.
- **A preview whose `until` has passed** is its own warning: the file says the site is
  gated and it is not, so what a reader believes and what visitors get have come apart.

## Reference

| Name                 | Description                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| `Gate`               | Read and write the gate: `maintenance()`, `preview()`, `open()`, `status()`. |
| `GateStatus`         | What `Gate.status()` returns. Never includes the token.                      |
| `MaintenanceOptions` | `retryAfter`, `by`.                                                          |
| `PreviewOptions`     | `token`, `until`, `by`.                                                      |
| `GateMiddleware`     | The kernel middleware that answers for a closed site.                        |
| `GateState`          | The shape written to `storage/framework/gate.json`.                          |
| `GateMode`           | `"maintenance"                                                               | "preview"`. |
| `readGate`           | Read the state file, or `null` when the site is open.                        |
| `gateExpired`        | Whether a preview's `until` has passed.                                      |
| `GATE_FILE`          | Path of the state file, relative to the project root.                        |
| `GATE_COOKIE`        | Name of the cookie the gate issues.                                          |
| `GATE_QUERY`         | The query parameter that carries a token — `preview`.                        |
| `bun zt down`        | `DownCommand` — maintenance on.                                              |
| `bun zt preview`     | `PreviewCommand` — private preview on, prints the link.                      |
| `bun zt up`          | `UpCommand` — open the site.                                                 |
| `bun zt gate:status` | `GateStatusCommand` — what the gate is doing.                                |
