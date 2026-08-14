# Changelog — @zerotal/flow

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`** — matching this package's `maturity` field. The public API
follows SemVer strictly: anything importable without an `@internal` marker keeps its
shape for the rest of the 1.x line, and `api-surface.md` is diffed by CI on every
change.

## [Unreleased]

### Changed — BREAKING

- **`redirectRoute(name, params)` takes route params only.** Extra keys used to become
  query-string entries; core's `route()` now treats a key that matches no `:segment` as
  the mistake it usually is and throws, naming it. Route names and params are checked at
  compile time once the app has run `bun zt route:types`. For a redirect that needs a
  query string, build the URL: `this.redirect(route("posts.show", { slug }, { ref }))`.

### Changed

- **The client now says which transport failure it hit.** `[Flow] WebSocket unavailable —
falling back to HTTP requests` was the same line whether the handshake was blocked by a
  proxy, refused by the origin guard, or genuinely unreachable, and the HTTP fallback then
  logged a bare `HTTP 403` that dropped both the status and the server's own explanation.

  A `403` from `/__flow/http` is now reported once, in full, naming the page's origin and
  the config that fixes it — and the connection state drops to **offline**. That is the
  honest state: the origin guard will refuse every retry, so actions queue behind
  `flow:offline` directives instead of being fired at an endpoint that cannot accept them.
  A refused origin was the one failure the fallback could see and was reporting as a
  transient degrade.

- **Flow no longer rebuilds its CSS/JS bundles at boot in production when `public/` is
  read-only.** Same policy as `serve`; see `@zerotal/core`. Build them with
  `bun zt assets:build` as a release step and the service needs no write access to its own
  output tree.

- **`/__flow/ws` is declared at registration**, so a CLI process can name it. That is what
  lets `bun zt doctor --url=…` probe the socket through the real proxy — the check that
  catches an origin guard or an auth gate over the transport before a user does.

### Fixed

- **A keyless child in a list is no longer identified by its position.** The id was
  `<parentId>-<name>-<occurrence index>`, and an index is _position_, not identity:
  remove an item from a list and every row below it inherits the id its neighbour had.
  Because a hydrated parent emits an already-known child as an **empty stub** — on the
  understanding that the client morph will recognise the pairing — every row then
  adopted the previous row's live DOM and the last was left blank. Nothing warned, and
  nothing server-side could see it: SSR, snapshot assertions and `FlowTest` all render
  the full child every time, because they never take the already-mounted branch.

  The id is now derived from the child's **seed props** plus an occurrence counter, so
  the pairing is content-addressed and a shifted row is rendered in full rather than
  crossed with its neighbour. `@reactive` and `@modelable` props are deliberately
  excluded — those exist to change _without_ remounting the child, and hashing them
  would trade this bug for a child that resets on every parent update.

  Two siblings whose props are identical are still, as far as the framework can see,
  the same child. Flow now logs a warning the first time it sees that in development,
  naming the class and the fix. `key` remains the answer, and the docs say so where
  `child()` is documented.

### Added

- **`<ErrorBoundary>` — a failing child costs that child, not the page.** A nested
  component that threw while mounting or rendering took the whole response with it: one
  broken widget blanked the dashboard, and the only defence was to make every child
  defensive from the inside. Wrapped, the child is replaced and everything around it
  renders:

  ```tsx
  <ErrorBoundary fallback={<p class="text-sm text-red-600">Sales data unavailable.</p>}>
    <SalesReport />
  </ErrorBoundary>
  ```

  `fallback` may be a function, which receives the thrown error; `onError` reports it to a
  log or a tracker without changing what renders. Boundaries nest and the innermost one
  wins, and siblings are independent — one failing widget does not affect the other.

  What it covers is child _components_.
  Inline JSX in the same `render()` is evaluated before the boundary is ever called, so a
  throw there cannot be intercepted here — move the risky work into a child component,
  which is where it belongs anyway. Containment is opt-in for the same reason: a child
  outside every boundary still fails the page, so a real bug surfaces instead of rendering
  as blank space forever.

- **`stream` — a slow child no longer holds up the shell.** Mark a child
  `<SalesReport stream />` and the page paints immediately with that child's placeholder;
  the real markup is appended to the _same_ response as it finishes rendering. The browser
  receives a `<template>` carrying the finished markup and a one-line script that swaps it
  in, which runs during parse — so the content appears without a second request, without
  the socket, and without waiting for (or even having) the runtime.

  This is the missing third option next to `lazy` and `defer`. Both of those also paint a
  placeholder first, but the real render happens on a second round trip over the socket,
  which is right for content that may never be needed — a widget below the fold, a tab
  nobody opens. `stream` is for content that is definitely needed and merely slow, where
  the only thing a round trip buys is latency.

  A child that fails mid-stream is replaced with a notice rather than failing the
  response: the shell is already on the wire by then, so there is nothing left to fail.
  Streaming applies to the initial `GET` only — over the socket there is no open response
  to append to, so `stream` degrades to an ordinary inline child. Flow sets
  `X-Accel-Buffering: no`; behind a proxy that buffers anyway the browser simply receives
  the whole document at once, which is correct but not progressive.

- **`<SectionContent>` / `<SectionOutlet>` — a page can fill a region the layout owns.**
  Putting a page-specific button in the layout's toolbar meant threading it through every
  component in between as props, or the layout knowing about every page that might
  contribute. Sections invert that: the component that owns the content declares it, and
  the layout declares a hole.

  ```tsx
  // In the layout
  <SectionOutlet name="toolbar" />

  // In any page — renders nothing here
  <SectionContent name="toolbar">
    <button onClick={this.publish}>Publish</button>
  </SectionContent>
  ```

  Order does not matter. An outlet emits a token and is filled in a final pass over the
  finished document rather than reading a store when it renders — which is what makes the
  usual arrangement work at all, since the layout wraps a page that has already rendered.
  Two components may publish to one name and their content accumulates in render order.
  Outlet children are the default, used when nothing was published.

  Sections resolve once per document render: a WebSocket patch re-renders a component, not
  the layout, so content published during one does not reach an outlet outside the
  component being patched.

- **`<Virtualize>` — a scrolling window over a collection too large for the DOM.** Only
  the visible rows exist as elements; spacers above and below hold the scrollbar at the
  size the full collection implies. As the viewport moves, `onWindow(start, count)` asks
  the server for the window it now needs, so the collection never has to reach the client
  in full — the server-authoritative arrangement, with an
  `ItemsProvider`.

  ```tsx
  <Virtualize
    items={this.rows}
    start={this.windowStart}
    total={this.total}
    itemHeight={36}
    height={480}
    onWindow={this.loadWindow}
  >
    {(row) => <div class="h-9 px-3 leading-9">{row.name}</div>}
  </Virtualize>
  ```

  Rows must be a uniform `itemHeight` — that is what lets a scroll offset become an index
  without measuring anything. `overscan` (default 6) renders extra rows on each side to
  hide fetch latency, and a window request is only made when the needed window actually
  changes, since scroll fires far more often than that. Distinct from `<InfiniteScroll>`,
  which appends and grows the DOM without bound; reach for this when _keeping_ every
  rendered row is the problem.

- **`@zerotal/flow/browser` — drive a real browser against a running app.** The suite
  had 568 tests and could not fail the way production fails: `FlowTest` calls actions
  directly, so it never renders an attribute the client must find, never dispatches a
  DOM event, and never opens the socket. Every silent failure Flow has shipped lived in
  exactly that gap — a `<select>` that lost its binding, a click cancelled by
  `preventDefault`, an action the server refused and mentioned only to `console.error`.
  Depth was never the problem; shape was.

  `FlowBrowser` drives headless Chrome over the DevTools Protocol, so a click is a real
  click travelling through the page's own delegated listener, over a real socket, to the
  real dispatcher, and back as a real patch:

  ```ts
  const page = await FlowBrowser.open(`http://localhost:${port}/counter`);
  await page.click("#increment");
  await page.waitForText("#count", "1");
  expect(page.consoleErrors()).toEqual([]);
  ```

  Console output is captured deliberately rather than incidentally: a refused action is
  reported _only_ there, so a harness that cannot see the console cannot see the
  failure. Waits are polls with timeouts that name what they were waiting for and what
  the console said, so a break reads as a diagnosis instead of a mystery.

  No Puppeteer, no Playwright — it speaks CDP over Bun's own WebSocket and drives a
  browser the machine already has, matching the zero-dependency posture of the telemetry
  tracer and the media image driver. `FlowBrowser.available()` lets a suite skip where no
  browser is installed rather than fail; `CHROME_PATH` pins a binary for CI.

- **A compiled-versus-runtime parity suite.** Flow renders a page one of two ways, and
  when the AOT compiler bails the runtime renderer infers bindings by observing property
  reads instead of reading intent from the AST — necessarily weaker, and the gap between
  them is where the field reports kept finding silent failures. "Weaker mechanism" is not
  the same claim as "different output", so the output is now pinned: each case is written
  once, compiled _and_ imported as a real class, and both paths must emit the same
  bindings. They agree across the corpus, including the two shapes that were reported as
  broken. A case the compiler bails on still has to carry its binding through the
  fallback.

### Fixed

- **`data-flow-connection` is stamped on a page that connects normally.** The attribute
  was only written when the connection state _changed_, and the bridge starts optimistic
  (`_isOnline = true`), so a socket that connected on the first attempt — the normal case
  — left the attribute absent entirely. A stylesheet or a readiness check keyed on
  `[data-flow-connection="online"]` would wait forever on a page that was in fact
  perfectly connected. Found by the browser harness on its first run, which is a fair
  summary of why the harness exists.

### Changed

- **Maturity is now `stable`** — the public API follows SemVer strictly for the rest of
  the 1.x line. Both gates that stood in the way are closed in this release, and neither
  was closed by relabelling:

  - The **bridge is covered by a real browser**, so the layer that produced every silent
    failure Flow has shipped is now exercised by tests that fail when it breaks. The gap
    was never depth — it was that 568 tests all stopped short of the socket.
  - The **two render paths are pinned to the same output**, so the "compiled is stronger
    than runtime" caveat is now a statement about mechanism rather than an unmeasured
    behavioural risk.

  The supporting evidence: the deepest test coverage in the monorepo, correct
  `@internal` discipline across 61 markers, thirteen documentation pages, dependencies
  only on stable packages, and an API surface snapshotted and CI-diffed on every change.
  The one breaking change Flow has ever made was 1.3.0's mixin-composition rename; 1.4.0
  and this release both followed it without one.

  Being honest about what the label does not claim: Flow has less production exposure
  than the core and ORM layers, and the parity suite characterises a corpus of binding
  shapes rather than proving the two renderers identical for every program. What
  `stable` commits to is that the API will not move under you, and that is a promise
  this release can keep.

- **A client expression that writes an `@expose` prop now syncs to the server.**
  `onClick={() => (this.selected = row.id)}` updated the reactive store and nothing
  else — `render()` runs on the server, so a template branch keyed on the write
  (`this.selected === row.id ? <RowDetail /> : null`) never appeared, with no error
  anywhere. Worse, it _worked_ whenever some later action happened to flush the
  pending write, so the mental model "`@expose` state is reactive" was true for
  `flow:model` inputs and intermittently false for expression writes.

  Writes made during a client-expression evaluation are now recorded; when the
  expression dispatches no action on that component itself, one `$rerender` follows —
  the frame's `updates` carry every pending write through the same allowlist and
  `updating()`/`updated()` hooks as any action, and the re-render is patched back.
  No loading state is shown (it is a sync, not a user action), an expression that
  also calls a server action syncs nothing extra (the action's frame already carries
  the writes), and a write that lands back on the canonical value sends nothing.
  State the server should never see belongs in `this.store()`, which stays
  client-only. `$flow.$refresh()` remains for forcing a full `onMount` re-run.

### Fixed

- **The dev timeline pill docks bottom-left, as its own comment always said.** The CSS
  put it at `top: 88px` at maximum z-index — exactly where a left-rail's first
  navigation item lives, which it then covered and swallowed clicks for. It now sits at
  bottom-left with the frame list opening upward, and the corner is configurable via
  `data-flow-tl-corner="top-right"` (any corner) on `<html>` or `<body>`. Only affects
  the standalone fallback pill; the devtools-panel Timeline tab is unchanged.

## [1.4.0] — 2026-08-10

### Fixed

- **`focusOnError` did nothing on a page that rendered through the runtime.** The
  JSX runtime rewrites `-` to `.` inside a `flow:` attribute — right for a
  hand-written `flow:loading-class`, wrong for a name the directive map already
  spells out. `focusOnError` reached the DOM as `flow:focus.error` while the
  bridge only ever queries `[flow\:focus-error]`, so focus-on-error worked on a
  compiled page and silently did not on one the compiler bailed out of (a
  branching `render()`, say). Mapped names now go out verbatim; the kebab→dot
  rewrite still applies to attributes written by hand. `sortGroupId` was affected
  the same way.

- **`flow:navigate` now scrolls, instead of leaving you wherever the last page
  was.** The SPA swap replaced the page under a stationary viewport and never
  touched the scroll offset, so following a link from near the bottom of a long
  list landed you halfway down the next page. Nothing visible changed, which
  reads as the page having failed to load rather than as a scroll problem.

  A navigation now lands at the top of the new page, or at the fragment when the
  href names one (`/docs#install`) — which is what the same link does without the
  SPA swap. Back and Forward restore the position the entry was left at.

  The scroll happens inside the swap, after the root is replaced: the document
  only has its new height (and its fragment targets) at that point, and inside a
  View Transition it is also what the "after" snapshot captures, so the animation
  ends at the right offset rather than sliding to it. It is issued with
  `behavior: "instant"`, so a page whose CSS sets `scroll-behavior: smooth` does
  not animate the whole way up on every visit.

### Added

- **`preserveScroll`** — `<Link href="…" preserveScroll>` and
  `this.navigateCurrent({ query: …, preserveScroll: true })` leave the viewport
  where it is. For a control partway down a page — a sort header, a filter, a tab
  strip — going to the top loses the thing the user was just looking at. Compiles
  to `flow:navigate.preserve` on the anchor.

## [1.3.0] — 2026-08-09

### Fixed

- **An `@expose`d action on a shared page base no longer disappears from the allowlist.** Bun
  1.3.x does not reliably run a method decorator's `addInitializer` callbacks: when a subclass
  declared a decorated field, the base class's method initializers never ran at all. So a page
  base carrying `@expose guard()` lost that action the moment any subclass added one `@expose`
  field — and since the un-`@expose`d action check is fatal, clicking a perfectly legitimate
  button was rejected at runtime with a message pointing at the wrong cause. It reproduced with a
  bare `class Sub extends Base` and no mixin anywhere. `@expose` (methods), `@task`,
  `@renderless`, `@on` and `@computed` were all affected.

  Method and getter decorators now tag the function in the decorator body — which always runs,
  with the right name — and the readers scan the prototype chain for tagged members, registering
  against the **declaring** prototype so inheritance resolves through the existing chain walk.
  Registration no longer requires an instance to have been constructed, so `getExposedMethods()`
  is correct on a class that has never been instantiated.

### Changed — BREAKING

- **`ComponentWith(...)` is replaced by the `Component.using(...)` static.** Mixin composition is
  now a property of the base class rather than a helper shipped alongside it, so there is one
  idiom to learn and nothing extra to import.

  ```tsx
  // before
  import { ComponentWith, Pagination } from "@zerotal/flow";
  class PostsPage extends ComponentWith(Pagination, FileUploads) {}

  // after
  import { Component, Pagination } from "@zerotal/flow";
  class PostsPage extends Component.using(Pagination, FileUploads) {}
  ```

  Run `bun run scripts/codemod-mixin-composition.ts` to rewrite call sites and imports.

  How mixins are **authored** is unchanged — `<T extends Constructor<Component>>(Base: T) => …`
  still works exactly as before, and every shipped mixin keeps its signature. The `Constructor`
  and `Mixin` types are still exported; `Compose` (the type of `Component.using`) joins them.

### Added

- **`using` composes onto any class in the chain, not just `Component`.** An app-level base can
  now carry mixins without being flattened out of the prototype chain — `AdminPage.using(Pagination)`
  keeps `AdminPage` in the lineage. `ComponentWith` hardcoded `Component`, so this previously
  required hand-nesting (`Pagination(AdminPage)`).
- **Composition chains.** The composed class carries `using` itself, so
  `Component.using(a, b).using(c, d)` works past the 8-mixin overload set.

## [1.1.0] — 2026-08-08

### Fixed

- **A radio group can be bound again.** `_readModelValue` special-cased checkboxes but not radios, so every radio in a group contributed its `value` whether or not it was checked and the last one in DOM order won — a leisure enquiry silently became a corporate one, with no error anywhere. A radio now reports a value only when checked, and the flush, `input` and `flow:model.blur` paths all skip the `undefined` an unchecked radio returns. The blur path was additionally reading `.value` raw, so it sent `"on"` for checkboxes. Server-to-client sync no longer assigns `el.value` on a radio either, which was rewriting every option in a group to the group's current value and destroying the choices.
- **A reactive sibling attribute no longer suppresses a `value` binding.** The getter capture is a single slot and JSX evaluates every prop before `jsx()` runs, so `value={this.destination} disabled={this.notSure}` left the capture on `notSure`, the freshness check failed, and the element rendered with no `flow:model` at all — the field accepted typing and nothing reached the server. The capture now retains the element's reads, so a binding finds the key matching its own value. Only keys genuinely read through a `this.` getter qualify, so a literal that happens to equal state still binds nothing.
- **A radio no longer acquires a binding by coincidence.** Value-identity inference matched whichever single option currently equalled the bound property, so that one radio claimed the whole group's model. Radios are now excluded from binding inference, as `<option>` already was; bind a group explicitly with `{...this.bind('type', optionValue)}`.
- **`flow:click` no longer breaks the control it sits on.** `preventDefault()` was unconditional, which cancels the element's activation behaviour — a radio or checkbox carrying `onClick` never became checked, and no handler could compensate, because the browser restores the pre-click checkedness after listeners run. The default is now cancelled only where it is in the way (anchors, submit buttons and submit inputs), with `.prevent` to force it and `.passive` to opt out.
- **Click handlers carrying a modifier are no longer dead.** Modifiers are emitted into the attribute name (`flow:click.stop`), but the listener looked handlers up with an exact attribute selector — which cannot match that name — so `onClick={flow(this.save).stop}` did nothing at all, silently. Handler lookup now reads both forms and applies `.stop`.
- **`request().ip()` answers inside an action.** The WebSocket dispatcher builds its own `HttpContext`, which has no Bun `Server` behind it, so `ip()` resolved to `null` for every action even though the peer address was captured at upgrade. It is now supplied.

### Added

- **A server action can take arguments from a loop.** `() => this.archive(row.id)` compiles to `flow:click="archive"` plus `data-args`, with the arguments evaluated server-side during the render where `row` exists. Previously the arrow was emitted verbatim, so `row` was undefined in the browser and the click threw a `ReferenceError` into the console and nothing else. An argument that reads `this` still stays a live client expression so it re-evaluates against reactive state.
- `Component.bind(key, optionValue)` — the explicit way to bind one member of a radio group.
- `FlowTest.tolerateErrors()`, `assertErrored()`, `lastError()`, `seed()` and `render()`.

### Changed

- The members `Component` reserves are documented, and pinned by a test so the list cannot drift. A page property colliding with one is a compile error with a clear message, but `title` — taken by the page-title accessor — is an obvious name for a field on a row representing a media item or a review, and there was no list to check.
- **`FlowTest.call()` rethrows.** A `ValidationError` is still an expected outcome, but any other error is routed to `onError()` (as in production) and then rethrown, so a broken action fails its test instead of looking like one that ran and did nothing. Previously it was swallowed — and a throwing `onError` was swallowed too. Call `tolerateErrors()` when the error path is what you are testing.
- **`FlowTest.set()` re-renders.** A test that set a property and then read `html()` was silently asserting against the previous render. `seed()` is the batching form that does not render.
- **A handler pointing at an un-`@expose`d method is a build error.** The allowlist is the exposed methods, so an undecorated method was absent from it — the compiler emitted `flow:click="submit"`, the button rendered enabled, and the click sent a frame the server refused, reporting the refusal only over the WebSocket to `console.error`. Nothing reached the server log and the page did not change. The member table needed to catch this was already built; it is now used.
- **A client expression referencing a name the browser will not have is reported at boot**, naming the identifier and pointing at `data-args`. The page falls back to the runtime renderer rather than failing the build: the check works from a hand-maintained list of globals, and a false positive should not stop a server starting. In CSP-safe mode, where there is no runtime fallback, it is fatal.
- The compiler warns when more than half of a page set falls back to the runtime renderer, naming `ZT_FLOW_COMPILE_LOG=1`. Falling back for a page or two is normal; an entire app doing it silently is not.
- Maturity is stated in the README and npm metadata. It was only ever a `package.json` field npm does not render, and this changelog said `stable` while the manifest said `experimental`.

## [1.0.3] — 2026-08-07

### Changed

- Re-released from a rebuilt repository so the build provenance resolves. The
  1.0.2 attestation names a repository that was renamed away, which leaves the
  signature valid but the trace back to source dangling. No code changed.

### Fixed

- **A session mutated inside a WebSocket action is now saved.** `SessionMiddleware` does not write its cookie inline — it registers a finalizer through `ctx.onResponseReady()` and saves from there, so a session set before a throw still reaches the client. The HTTP dispatcher ran those finalizers; the WebSocket dispatcher never did. Any action that changed the session therefore produced no `Set-Cookie`, so the session-relay frame carried no token and the change was lost the moment the browser navigated. Signing in was the loudest case — the login succeeded, redirected, and bounced straight back to the login screen — but flashes and `@session` props set during an action were dropped the same way. The WS dispatcher now runs `ctx._responseFinalizers` before reading `Set-Cookie`, matching the HTTP path including its log-and-continue on a failing finalizer.
- **Route middleware on a Flow page no longer crashes the action pipeline.** The WebSocket dispatcher passed the request's `ScopedResolver` where `Pipeline.via()` expects the container. A `ScopedResolver` has no `bound()`/`makeSync()`, so the moment a page's route middleware needed _resolving_ rather than plain construction, the action failed with `container.bound is not a function`. It now passes the container, as the HTTP router already did; the `as never` cast that hid the mismatch is gone.

## [1.0.0] — 2026-08-05

_First public release._

### Added

- **`make:flow` scaffolding command.** The flagship server-driven layer previously had no generator — every `Component` was hand-written (the audit's #1 DX gap). `bun zt make:flow Name` emits a ready-to-run class with the JSX pragma, imports, and an `@expose`/`render` skeleton: `--child` scaffolds a child component (with `setup(props)`), `--crud` a resourceful page (list + create/edit/delete + `@validate` + a form), and `--layout Foo` wraps a page in a layout (with the correct relative import depth for nested names like `Users/Index`). The target directory is auto-detected (`app/flow/pages` for pages, `app/flow/components` for children) or set with `--dir`; since Flow uses file-based routing the page is served automatically, and the command also prints the explicit `Router.flow(...)` line. Registered lazily by `FlowProvider` in console mode, so it's available in any app that registers the provider.
- **HTTP fallback for WebSocket-blocked networks (Tier 1).** A client circuit breaker: after `HTTP_FALLBACK_AFTER` (3) failed socket handshakes the bridge stops waiting on the WebSocket and sends action frames as plain `POST /__flow/http` requests, which run the _exact same_ server pipeline (hydrate → dispatch → render → patch) over a collecting fake connection and return the frames as a JSON array the client applies — so actions, validation, flashes, redirects, events, and offline-queue replay all keep working behind strict proxies/firewalls that drop WS upgrades, with no component change. It's a graceful degrade, not a configured mode: WS reconnection keeps running and the client upgrades back automatically the moment the socket succeeds (`onopen` resets the failure count and exits HTTP mode). `this.cancel()` POSTs an out-of-band `$cancel` in HTTP mode too. Trade-offs while degraded: no server-pushed frames (so `@task` arrives as one batched update, not token-by-token) and no broadcast-driven `@presence`/`@shared`/`@on("echo:…")` (those ride the separate broadcasting socket); everything driven by the user's own actions still works. Nothing is sent over HTTP until the socket has actually failed.
- **Reactive lists (`<For>`) + optimistic collections.** `<For each={this.items} keyBy="id">{(item) => …}</For>` compiles to an Alpine `<template x-for>`, so any client change to the array re-renders the list instantly (server patches still keep it authoritative) — the missing piece that made optimistic list ops impossible while `.map()` renders to static HTML. The item template supports element structure, static attrs, `class`/`className` (→ `:class`), reactive attrs, `on*` arrow handlers (→ Alpine `@event`, `this.`→`$flow.`), and `{item.field}` text (→ `x-text`); anything else is a clear compile error pointing at a raw `x-for` escape hatch. On top of it, `this.appendOptimistic(prop, item)` / `this.removeOptimistic(prop, match)` mutate the array before the server confirms: the change shows at once, **survives interim (broadcast/event) patches** (pending ops are re-applied over each server merge), and is **reconciled when the owning action's patch resolves** — server list on success, automatic rollback on failure. Pure reconciliation core in `client/optimistic.ts`; new `For`/`ForProps` exports.
- **Dev error overlay.** Under `serve --dev`, an unexpected throw — in a server action **or** the initial `GET` render (`onMount`/`render`) — pops a full-screen overlay (Vite/Next style) with the error class, message, and stack, naming the action + component and dimming framework/`node_modules` frames so app frames stand out. Dismiss with Esc or a backdrop click; after an action error the patch still reconciles underneath, so you return to a live page (pairs with the time-travel timeline). The detail is attached **only under the dev worker** — production sends none (an action flashes; an initial-render error returns a normal 500). Only unexpected throws overlay: validation errors and **intended HTTP errors** (auth `401`/`403`, `404`, redirects — anything carrying a numeric `status`) pass straight through to their normal handling. New module `client/errorOverlay.ts`; the error frame gained optional dev-only `name`/`stack`/`action` fields; the initial-render error rides an embedded `flow-boot-error` script the bridge reads on load.
- **Type-safe real-time events (Tier 1).** An app-augmentable `FlowEvents` contract maps event names to payload types; `dispatch`/`dispatchTo`/`dispatchSelf` are now generic over it, so a known event's payload is type-checked at every dispatch site (server actions and client expressions alike) — wrong shape, missing payload, or a payload on a `void` event all fail to compile — while unknown names stay untyped (a `string` fallback keeps `echo:…` and gradual adoption compiling, no breakage). `@on` autocompletes to known names; annotate handlers with `EventPayload<K>`. No codegen. An optional runtime guard (`registerFlowEvent(name, guard)`) throws from `dispatch` on a malformed payload — for the untrusted client-originated path the types can't cover. New module `events.ts`; exports `registerFlowEvent`, `FlowEvents`, `EventName`, `EventPayload`.

- **`@presence` — multiplayer "who's here" (Tier 1).** Binds a property to a broadcast presence channel (static or a `(self) => string` resolver) and keeps it filled with the live member list, refreshed on join/leave via a new `$presence` built-in. The resolved channel is server-derived and carried signed in the snapshot; the prop is server-controlled (locked). Client-only cursor/typing whispers ride the same channel via `this.whisper(event, data)` / `this.onWhisper(event, cb)`. Broadcasting is an optional peer — resolved through a dynamic import, a no-op when absent — so flow takes no new hard dependency.
- **Time-travel devtools (Tier 1).** Under `serve --dev`, the client records the signed snapshot stream it already receives — one frame per applied patch plus the initial mount — into a capped ring buffer, and can scrub back to any frame: a jump re-applies that frame's snapshot + HTML to the live component (client-only, no server round-trip), restoring state and DOM exactly. It surfaces as a **Timeline tab in the `@zerotal/devtools` panel** (registered via that package's new `window.__zerotalDevtools` extension API) so all the framework's tooling is unified; when devtools isn't present it falls back to a standalone ⏱ panel. Frames list by action + changed fields + time with click-to-jump and a ⏵ Resume-live button; a `window.__flow.timeline` console API (`frames`/`framesFor`/`jump`/`live`) mirrors it. Dev-gated via the `dev` flag on the WS `ready` frame — production ships none of it. The recording core is a DOM-free module (`client/timeline.ts`); the DOM apply step is injected from the bridge, and the patch morph was extracted to a shared `_morphComponent` reused by both a patch and a jump.
- **Durable / resumable snapshots (Tier 1).** Opt a component in with `static durable = true` (or `{ ttl, scope }`) and its signed snapshot is persisted server-side after every request, keyed by user (or session) + route. On a fresh GET a valid stored snapshot is restored and `onHydrate()` runs instead of `onMount()`, so an in-progress flow resumes exactly across a full reload, tab close/reopen, device switch, or reconnect after the held client snapshot is gone — nothing stored in the browser. HMAC verification + identity keying isolate users and reject tampered/rotated-key entries (graceful fresh mount). `this.clearDurable()` forgets the entry on flow completion. The store is pluggable via `setDurableStore()` (default in-process TTL store; swap a `@zerotal/cache`/Redis-backed `{ get, set, delete }` for redeploy survival). `scope: "user"` keys by the authenticated user (session fallback when anonymous); `scope: "session"` keys per-device.
- **`@task` — streaming, cancellable actions (Tier 1).** Mark an async method `@task` (implicitly `@expose`) and write a field in a loop — while the action runs the framework flushes throttled **field-level** snapshot diffs (the changed fields only, no HTML, no per-chunk re-render), so a reactive binding of the field (`text={this.answer}`, `x-text`, a reactive `:attr`) streams to the browser live as `this.answer += token` runs. The field stays the source of truth (no `flow:stream` element, no double-write); the final patch re-renders once to reconcile any static template positions. The triggering control keeps its loading state for the whole run (partial patches don't clear it; only the final patch does). `this.signal` (a standard `AbortSignal`) + `this.cancelled` give cooperative cancellation; the client's `this.cancel()` sends an out-of-band `$cancel` frame (bypassing the per-component send queue the running task occupies), which the server handles before dispatch to abort the task's controller. Implemented via a `partial` patch flag and a chained delta base (each streaming patch is delta-encoded against the previous one the client received).
- **`@shared` — convergent multiplayer state (Tier 1).** Binds a property to server-authoritative shared state on a channel: mutating it in an action writes to a per-channel **room store** and broadcasts to the channel, so every other subscriber re-reads and converges via a new `$shared` built-in. Before each action the prop is refilled from the store (read-latest); after, changed props are written back and broadcast (`toOthers`). The resolved channel is signed in the snapshot (`SnapshotMemo.shared`) and the prop is server-controlled (locked). The store is pluggable via `setSharedStore()` (default in-process; swap a Redis-backed `{ get, set, has }` for multi-instance). Same optional-peer broadcasting as `@presence` — without it, state still converges within a single window's round-trips. v1 semantics: last-write-wins.
- **Delta transport.** WebSocket patches carry only the changed snapshot fields (rebuilt client-side against the copy it holds, still HMAC-verified) via `encodeSnapshotDelta`/`applySnapshotDelta`, and omit `html` when the re-render is byte-identical to the last patch on that connection. `ZT_FLOW_TRANSPORT_LOG=1` logs delta-vs-full sizes.
- **JSX-native layouts.** Override `Component.layout(page)` to wrap the rendered root in any component — named regions are plain props. `static layout` still works; the method wins when both are present. Nav-persistence uses a `data-flow-layout` marker (declared on the shell, else derived from the wrapper source).
- **Named slots on child components.** `slots={{ … }}` + `this.slot(name)` / `this.hasSlot(name)`; slot HTML is carried, signed, in the child snapshot (`SnapshotMemo.slots`).
- **Compiler prop parity.** `transition`, the `flow:offline` family (`showOnOffline`/`hideOnOffline`/`offlineClass`/`offlineAttr`), `sortItem`, and `loadingTarget`/`dirtyTarget` (`flow:target`) now compile to their directives; the AOT `directives.ts` map and the runtime `PULSE_PROP_MAP` were reconciled.
- **Stateful fast refresh in dev.** Editing a component under `serve --dev` now re-renders each mounted component from its held, still-valid snapshot with the newly-compiled code — **preserving state** — instead of a full reload, and refetches the stylesheet so new classes apply. Implemented as a `$rerender` built-in (a no-op re-render that skips `onMount`), gated to the dev worker via a `dev` flag on the WS `ready` frame, triggered by the flow WS reconnect; falls back to a one-shot full reload if the held snapshot is incompatible with the new code.
- **Tier 2 interaction polish.** `<Skeleton>` pulsing placeholder (+ `<Loading skeleton>` and lazy `placeholder()` use); **hover-prefetch** for `navigate hover` links (fetch-on-hover cache so the click swaps instantly — the prop existed but was unimplemented); and **optimistic-UI failed state** via `showOnError`/`hideOnError` (driven by an `actionError` flag the server sets when an action or a rejected `onUpdating` write throws). Rollback itself was already a property of snapshot reconciliation. `lazy`/`defer` are now typed on component JSX props.

### Changed

- **Loading indicators wait out a short delay by default (no flash on fast actions).** `showOnLoading`, `hideOnLoading`, `loadingClass`, and `<Loading>` now reveal only after ~200ms in flight, so an action that finishes inside that window shows nothing — no spinner flash. `loadingAttr` (e.g. `loadingAttr="disabled"`) stays **immediate**, so a submit button still guards against a double-click even on a sub-100ms action. Previously only the opt-in `<Loading delay>` / `flow:loading.delay` was delayed; `delay` is now the default and kept for back-compat. Cleared instantly on resolve, so a just-over-threshold action barely blips.
- **`live` text inputs debounce their server sync (~150ms) by default.** A `live` text/textarea input no longer fires a WebSocket `$set` on every keystroke — it debounces ~150ms, so real-time validation and reactive server state update when you pause, not per character. Discrete controls (checkbox, radio, `<select>`, range) still sync immediately. The DOM and client-reactive bindings update on every keystroke regardless; only the server round-trip waits, and no value is ever lost (local state is current and any action flushes the full snapshot).
- **WebSocket actions serialize per component.** At most one action per component is in flight; the next waits for the previous patch to apply. Required by delta transport (deltas are order-dependent — a pipelined patch computed against a stale base would corrupt the client snapshot and trip the invalid-request rate limit). Offline replay runs through the same serial queue; a 15s ack timeout prevents wedging.

### Fixed

- **`@expose`/`@locked` on a getter now fails loudly.** A getter (a `@computed`, or any accessor) has no writable snapshot storage, so exposing or locking one would serialize a value the framework then tries to write back on the next update — clobbering the getter. TypeScript already rejects it (the decorators' Stage 3 context types exclude getters), but Bun transpiles without typechecking, so the decorator would still run and silently misregister. The `@expose`/`@locked`/`@url`/`@session`/`@transient`/`@reactive`/`@modelable` decorators now throw at class definition on a getter/setter/accessor, with a message pointing to `@computed` (for a derived value) or an `@expose` field (for client-writable state).
- **`@computed` getters compile in a text child.** The AOT compiler only knew about `@expose`/`@locked`, so `{this.uptime}` for a `@computed` getter failed validation and the whole page silently fell back to the runtime renderer. The compiler now recognises `@computed` (it sits on a getter, which the member scan previously skipped) and allows it wherever a text child emits a **static** value (`{this.x}`, `{String(this.x)}`) — matching how `@expose`/`@locked` text children already render (static, updates on the next server patch). Reactive sites still reject it correctly (a `@computed` isn't in the snapshot, so `text={this.x}` / reactive `:class` can't bind to it) — now with a message that says so and points to `{this.x}` or `@expose`. Also corrected the docs claim that `@computed` is "reactive on the client": it renders a static server-evaluated value, not a client-reactive binding.
- **Removed two dead binding-resolution defences.** The runtime resolver's "brute-force own-property scan" and the twin `hasOwnProperty(hint)` fallback existed to recover `@locked` props "whose decorator registration failed to land" — but `getExposedProps`/`getLockedProps` now drain the prototype chain first, so every decorated prop is reliably registered before the value-scan. Verified across the full suite + the showcase that the brute-force branch never fired; it could only ever match a _non-decorated_ field (a false positive), so removing it also removes that footgun.
- **Component bindings resolve statically (compile-time bind-name injection).** The AOT string compiler bails on any function component, so component-heavy pages render through the runtime `jsx()` path, where TSC's jsx transform has already discarded the `show`→`sheetOpen` prop→key mapping. That made value-based bind resolution fragile: a bound child clobbered the getter capture, and props sharing a value (two `false`s) couldn't be told apart, so an overlay-with-a-bound-form could render **unbound** (with only a `console.warn`). A new pass (`buildBindInjectedRender`) reprints a bailed page's `render()` with `__flowBinds={{ show: "sheetOpen" }}` added to every component that binds `show`/`bind`/`query` to `this.<key>`; the component reads it via `_injectedBindKey(props, attr)` (before `name=`/value resolution), so the bound prop is resolved from the source **statically and unambiguously**. The reprint is otherwise identical to the source (behaviour unchanged apart from robust binding), runs through the existing cache as a `.tsx` entry, and falls back to the untouched runtime render on any failure. Wired for every overlay (`Modal`/`Drawer`/`Dialog`/`Sheet`), form control (`Switch`/`Checkbox`/`Select`/`RadioGroup`/`Listbox`), and `Combobox` (`bind` + `query`). `__flowBinds` is stripped by `jsx()` and never emitted as an HTML attribute. (Applies to pages the compiler sees — file-based routes automatically; `Router.flow` pages once their `__sourceFile` is set.) Audit of the other seams: `_resolveValueBind` (`value=`/`checked=`) is already value-identity-guarded and only applies to leaf inputs (no children to clobber the capture); `error=`/`<ErrorMessage>` carries a self-describing sentinel — neither is ambiguous.
- **`text={this.x}` binds to its own property, not a sibling binding's.** On the runtime (non-AOT) render path, `_resolveBindName` trusted a single-slot getter capture — but every prop of a JSX element is evaluated before `jsx()` runs, so a later binding like `class={"row " + this.accent}` overwrote the capture that `text={this.count}` had set. The element then emitted `flow:text="accent"` and rendered the accent string in place of the count. The resolver now value-guards the capture (only trusts it when the captured property's current value is the one being resolved) and falls back to value-identity + the hint, so `text` (and `show`) always resolve to their own property regardless of other bindings on the same element. `value=`/`checked=` were already value-checked and unaffected.
- **`<Head>` content survives SPA navigation.** On a same-layout `navigate`, `_processHead` only ever re-read the live `document` — but the initial hoist removes each `<template data-flow-head>` from the DOM, and a persistent-layout swap carries only the page root (not the shell's `<Head>`). So the managed head was cleared and never restored: a stylesheet or fonts declared in a JSX-native layout's `<Head>` vanished on the first navigation (the page rendered unstyled), and page-level `<title>`/`<meta>` were dropped too. `navigate` now re-applies head from the **incoming** parsed document (which still carries every head template — shell stylesheet and page meta alike), deduping by identity so an unchanged stylesheet is left in place rather than removed-and-re-added (no unstyled flash between visits).
- **`lazy`/`defer` on a child component in JSX now actually defer.** `<Widget lazy />` passed `lazy` through as a component _prop_ instead of a `child()` option, so the child mounted eagerly (blocking on its `onMount`) and never showed its placeholder. The JSX runtime now routes `lazy`/`defer` to the child-loading options.
- **Browser Back to the first page did nothing.** SPA `navigate` only re-rendered on `popstate` when the history entry carried the `flowNavigate` marker, which a fresh page load's initial entry lacked — so pressing Back to the first visited page changed the URL but left the page in place. The initial entry is now stamped at startup.
- **`transition` prop.** Was typed but absent from `PULSE_PROP_MAP`, so it emitted an inert `transition` attribute instead of `flow:transition`.
- **`children`/`slots` on components type-check.** Added to `JSX.IntrinsicAttributes` so passing children or a `slots` prop to a `Component` no longer errors.

### Notes

- Conforms to the Zerotal package conventions (provider in `src/provider/`, PascalCase config factory, `ZerotalError`-based errors, test coverage).
