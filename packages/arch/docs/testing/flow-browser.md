---
title: FlowBrowser
description: Drive a real page against a real server inside bun test, and assert on the WebSocket bridge itself.
---

# FlowBrowser

`FlowBrowser` runs a headless browser against your app inside `bun test`, so a test
can assert on the thing `FlowTest` cannot reach: the WebSocket bridge.

```ts
import { FlowBrowser } from "@zerotal/testing/browser";

const browser = await FlowBrowser.serve(() => import("../bootstrap/app.ts").then((m) => m.default));
const page = await browser.visit("/settings");

await page.waitForConnection();
await page.click('[flow\\:click="save"]');
await page.waitForPatch();

expect(await page.text("#status")).toBe("Saved");
```

## Why this exists

[`FlowTest`](/docs/flow/testing) mounts a component and drives its server-side
lifecycle. It never opens a socket, so it renders the full markup every time and
every assertion passes — which is exactly the problem. The failures Flow ships have
one shape: **the HTML is fine and the transport is dead.** SSR renders, snapshot
assertions pass, the suite is green, and the app does nothing in a browser.

Those failures are invisible to every server-side test by construction. `FlowBrowser`
is the harness that can see them.

Reach for `FlowTest` first: it is faster, needs no browser, and covers component
logic. Reach for `FlowBrowser` when the thing under test only happens after
hydration.

## Requirements

A Chrome or Chromium install. Nothing else — no extra dependency is added to
`@zerotal/testing`, because [`Bun.WebView`](https://bun.sh/docs) drives the browser
and reads the transport through the DevTools Protocol.

The harness reaches a browser two ways:

| Mode        | When                                         |
| ----------- | -------------------------------------------- |
| **spawn**   | Default. Launches its own headless instance. |
| **connect** | When `ZT_BROWSER_CDP_URL` is set.            |

> **Windows** — Bun cannot currently spawn Chrome on Windows: it reports
> `Failed to spawn Chrome` even when the binary is present, because the spawn path
> uses `--remote-debugging-pipe`. Use connect-mode there. Start a browser once:
>
> ```bash
> chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/zt-chrome
> ```
>
> then read `webSocketDebuggerUrl` from `http://127.0.0.1:9222/json/version` and set
> `ZT_BROWSER_CDP_URL` to it.

## Skipping, and why CI must not

`FlowBrowser.availability()` reports whether a browser can be reached, and it is
resolved by actually opening one — a binary that exists but cannot start is the
failure worth catching, and `which chrome` cannot see it.

The two environments differ deliberately. **A browser suite that skips itself in CI
is worse than no suite**, because it reports green for exactly the failures it exists
to catch. So pair the skip with a guard that runs regardless:

```ts
import { FlowBrowser, browserAvailability, browserRequired } from "@zerotal/testing/browser";

const availability = await browserAvailability();

test("a browser is reachable, so this suite is not silently skipped", () => {
  if (!browserRequired()) return; // a developer's machine may legitimately lack one
  expect(availability.available).toBe(true);
});

describe.skipIf(!availability.available)("checkout", () => {
  // …
});
```

`browserRequired()` is true when `CI` is set. `browserAvailability()` resolves a
`BrowserAvailability` — `{ available, mode, reason }`, where `mode` is `"spawn"`,
`"connect"` or `"none"` and `reason` is the sentence to print when skipping.

`CDP_URL_ENV` is exported as the name of the connect-mode variable, so a test helper
that sets it does not have to hard-code the string.

## Serving the app

```ts
const browser = await FlowBrowser.serve(bootstrap, options?);
```

`bootstrap` is the same callback [`createTestApp`](/docs/testing/http) takes, so the
app under test is configured the way the rest of your suite configures it rather than
through a second bootstrap that can drift. The server binds an OS-assigned port.

`options` is a `FlowBrowserOptions`:

| Option    | Meaning                                                       |
| --------- | ------------------------------------------------------------- |
| `timeout` | Milliseconds every `waitFor*` allows. Default `5000`.         |
| `setup`   | Register routes before the server starts — for fixture pages. |

Call `await browser.stop()` in `afterAll`: it closes every page it opened, then stops
the server.

```ts
let browser: FlowBrowser;
beforeAll(async () => {
  browser = await FlowBrowser.serve(bootstrap);
});
afterAll(async () => {
  await browser.stop();
});
```

## Driving a page

`browser.visit(path)` returns a `BrowserPage`. Open one per test.

**Reading**

| Method                      | Returns                                  |
| --------------------------- | ---------------------------------------- |
| `text(selector)`            | Trimmed `textContent`, or `null`         |
| `html(selector)`            | `innerHTML`, or `null`                   |
| `count(selector)`           | How many elements match                  |
| `attribute(selector, name)` | One attribute, or `null`                 |
| `connection()`              | `"online"`, `"offline"`, or `null`       |
| `url()`                     | Path and query, for asserting a redirect |
| `evaluate<T>(expression)`   | Anything, as a real JS value             |

`evaluate` takes an **expression**, not statements — wrap a block in an IIFE. Only one
evaluation runs at a time per page, so never wrap these in `Promise.all`.

**Acting**

`click(selector)`, `type(selector, text)` and `press(key)` fire real trusted events.
`type` clicks the field first, because the browser types into whatever holds focus.

**Waiting**

Never sleep. Every wait is on an observable signal, and every one throws on timeout
with the connection state in the message.

| Method                      | Waits for                                   |
| --------------------------- | ------------------------------------------- |
| `waitForPatch()`            | A WebSocket frame caused by the last action |
| `waitForConnection()`       | The bridge to report `online`               |
| `waitForCount(selector, n)` | At least `n` matches                        |
| `waitFor(expression)`       | Any in-page expression to be truthy         |

`waitForPatch()` is the primitive. The received-frame count is captured when the
action is dispatched and this waits for it to rise, so an assertion cannot race the
transport. A harness that raced it would produce flaky tests, and a flaky browser
suite gets deleted.

## Asserting on the transport

`page.transport()` reports what Chrome saw on the wire — which the page cannot lie
about. A client that degraded silently still shows zero upgraded sockets here.

```ts
expect(page.socketUpgraded()).toBe(true);
expect(page.transport().statuses).toContain(101);
expect(await page.connection()).toBe("online");
```

It returns a `TransportReport`:

| Field      | Meaning                                      |
| ---------- | -------------------------------------------- |
| `created`  | Sockets the page opened                      |
| `upgraded` | Handshakes that answered `101`               |
| `statuses` | Every handshake status that arrived          |
| `errored`  | Chrome reported a frame-level failure        |
| `frames`   | An `ObservedFrame[]` — direction and payload |

> **Assert that a `101` was seen — never that the status was not something else.**
> A refused upgrade does not arrive as a handshake response at all: Chrome reports a
> frame error instead. A test asserting `statuses` does not contain `403` passes
> vacuously, because that event never fires.

`frames` carries the payloads, which is how you assert on what actually crossed the
wire rather than on what the DOM ended up showing:

```ts
const sent = page.transport().frames.filter((f) => f.direction === "sent");
expect(sent.some((f) => f.payload.includes(`"method":"save"`))).toBe(true);
```

## What this cannot cover

**The origin guard.** The harness talks to `http://127.0.0.1:<port>`, which is the
app's own origin, so `allowedOrigins` is satisfied trivially and no test here can
catch a misconfigured one. That failure only appears behind a reverse proxy, where
the browser sends the public origin and the app compares it against the loopback
address it bound to.

That case has its own tool — `bun zt doctor --url=https://your-site` sends a real
handshake through the real proxy. See [Deployment](/docs/deployment). Do not read a
green browser suite as coverage of it.

## Next steps

- [Flow testing](/docs/flow/testing) — `FlowTest`, for everything that does not need a browser.
- [HTTP Tests](/docs/testing/http) — `createTestApp`, the bootstrap this shares.
- [Browser Tests](/docs/testing/browser) — Playwright, for cross-browser end-to-end work beyond Flow.
