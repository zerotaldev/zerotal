---
title: Release Notes
description: What changed in each tagged Zerotal release, and the steps needed to upgrade.
---

# Release Notes

Releases are recorded below, newest first. The `@zerotal/*` packages share a
single version line and follow [semantic versioning](/docs/upgrade#versioning).
Each package also keeps a detailed `CHANGELOG.md` of its own; this page is the
summary across the suite.

> **Tip** — For the mechanics of moving between versions — bumping packages, running migrations, and re-checking config — see the [Upgrade Guide](/docs/upgrade).

## How to read these notes

Each version lists changes under three headings:

- **Added** — new features and APIs (safe to adopt incrementally).
- **Changed** — behavior changes; **breaking** ones are called out explicitly, in
  bold, as **BREAKING**.
- **Fixed** — bug fixes.

Breaking changes belong in major releases, and while the 1.x line is young they may
also land in a minor or a patch — always labelled, always with migration steps. Read
the section for every version you cross and apply its migration notes, not only the
majors. [Releases and versioning](/docs/support-policy#releases-and-versioning) explains
when that carve-out ends.

## 1.13.3 — 2026-08-31

Two things an app cannot see about itself, from two field reports. Both are the same
shape as most of this month's work: state that is real, consequential, and invisible from
inside the process that would want to know it.

### Added

- **A site gate — maintenance, and private preview.**
  [Guide](/docs/site-gate) · `zt down` · `zt preview` · `zt up` · `zt gate:status`

  Proposed by a team running a hand-edited `basic_auth` block in their reverse proxy,
  deliberately kept out of version control so it could not be deployed and forgotten into
  a live shop. That precaution is the feature request: the gate belongs where the app can
  reason about it.

  Two states that look alike and are not. **Maintenance** means the site is down —
  everyone refused, staff included, because the usual reason a site is down is that its
  database is being changed underneath it. **Private preview** means the site is up and
  working, for the people invited to it, for weeks.

  The details that make it framework work rather than app work:

  - **Maintenance is always `503` with `Retry-After`, and is not configurable.** A
    maintenance page served at `200` tells a search engine the apology is your homepage,
    and it will index it as such.
  - **A preview token is stripped from the URL on first use**, by redirecting to a
    cookie. Left in the address bar it travels into `Referer` on every outbound link,
    into analytics, and into screenshots.
  - **Webhook paths must be declared** in `gate.allow`. A payment provider posting a
    settlement into a maintenance window otherwise gets a 503 — a retry, a dropped
    callback, or a payment your books never learn about.
  - **The state is a file, and the token is stored hashed.** A flag in the database is
    unreadable exactly when the database is what you are working on; a token in a file
    is a credential in something every backup copies.
  - **It covers `Router.raw()` routes.** Found by running it: this framework's own docs
    site serves every `/docs/*` page from a raw route, so an early build gated the front
    page — which is what a person checks — and left all the content public.
  - **The state file is gitignored** by the scaffold, which is the entire point.

- **Worker liveness — `zt doctor` can tell whether anything is running your background
  work.** [Schedules](/docs/scheduler#is-anything-actually-running-them) ·
  [Queue](/docs/queue#is-a-worker-running)

  An app could say what it _registered_ and nothing could say whether any of it ever
  _ran_. The reported failure: a team shipped to production with no worker process, and
  every scheduled task silently did not execute for weeks. No hold was released, no
  reminder was sent, nothing logged — from the web process's point of view nothing was
  wrong, and they found it by going looking.

  ```
  ✖ Scheduler — 3 schedule(s) registered, and no worker has ever checked in.
    Nothing is running them.
      fix: Start the worker process: `bun zt worker`.
  ```

  The beat lives in the **cache**, because the process reading `doctor` is not the process
  running the work and often not the same machine — and your cache driver already decides
  what shared state can see. On `memory`, which is private to each process, the check
  **says it cannot tell** rather than reporting a missing worker: a check that cried wolf
  on every app using that driver is one people would learn to skip, and then it would not
  be there for the case it exists for.

  `@zerotal/core/heartbeat` exposes the primitive if you want the same signal on an ops
  page.

### Fixed

- **`secureHeaders: false` no longer empties the kernel middleware.** It set the layer to
  `[]`, which was the same thing as removing the headers right up until the site gate
  joined it — at which point opting out of security headers would silently have taken the
  gate with it. One feature's opt-out disabling another's is precisely what the gate is
  otherwise about.

### Documented

- **Minting `APP_KEY` without the code.** `key:generate` is part of the application, so it
  exists only once a release is installed — awkward when preparing `.env` first, since
  `migrate` wants the file and the file wants a key. `openssl rand -base64 32` produces
  exactly what `key:generate` writes; the [deployment guide](/docs/deployment) now says so.

## 1.13.2 — 2026-08-31

From a production field report at 1.12.0 — an Inertia + React app on SQLite, 117 routes,
1256 tests, live behind Caddy. Six items, of which one was still open. The other five had
been closed between 1.10.0 and 1.13.0 and are listed at the end, because a report that
carries items forward is worth answering precisely rather than generally.

### Fixed

- **`Inertia.stream()` honours `X-Inertia`.** It answered every request with `text/html`,
  including the XHR a running Inertia client sends. So the obvious way to adopt server
  rendering — point a route at `stream` — broke client-side navigation _to_ that route.

  The shape of the failure is the reason it survived: the first load looks perfect, which
  is what a person checks. The second click does nothing. It fails only for somebody
  already in the app, silently, and only once the route otherwise works.

  `render` and `stream` now share the branch that writes the page object rather than one
  of them having it, which is precisely how they came apart. An app that wrote a header
  check in front of the call can delete it; it does no harm either way.

### Verified, not changed

Five of the six items were already closed. Each was re-checked against this release rather
than taken on trust, because the report carried them forward from 1.9.0:

- **STARTTLS on port 587** — fixed in 1.11.0, with `SmtpStartTls.test.ts` covering it. The
  cause was that a write issued before the handshake completes is dropped.
- **`intended_url` across `Auth.attempt()`** — fixed in 1.11.0. `attempt` delegates to
  `login`, `regenerate()` deliberately carries the data bag, and only privilege markers are
  swept. `intendedFlow.test.ts` runs the three steps in order against a real session,
  including the ID rotation.
- **`bun install --ignore-scripts`** — documented in the
  [deployment guide](/docs/deployment).
- **A default test timeout** — `zt test` has passed `--timeout=30000` for some time, and
  [the testing guide](/docs/testing#bun-test-vs-bun-zt-test) already names the two
  alternatives that do not work: `bunfig.toml`'s `[test] timeout`, and
  `setDefaultTimeout()` in a preload.
- **`postForm` refusing a `File`** — it has thrown, naming `multipart()`, since 1.0.2.

The report's other upload concern — that `http.file()` consumes the multipart stream, so a
later `body()` reads empty — **does not reproduce**: `_parseFormData()` caches, and reading
the file first is safe. A test now pins that, since nothing had covered that order.

## 1.13.1 — 2026-08-31

One addition, found by sizing a job rather than doing it.

The 2.0 ledger carries an entry to prefix every `@internal` export with `_` — 270 symbols,
filed as mechanical. Three of them are `Job` classes, and a job class name is not a source
symbol: `JobRegistry` keys on it and that string is written into the persisted queue payload,
so a job enqueued yesterday is resolved by today's process. Renaming one invalidates every job
already in the queue, at deploy time rather than at change time, and no test sees it because a
test enqueues and runs in the same process.

The rename is re-scoped. The hazard it exposed is fixed here.

### Added

- **`Job.jobName`** — a declared name for the queue payload, so renaming a job class is free:

  ```ts
  export class SendWelcomeEmail extends Job {
    static override jobName = "SendWelcomeEmail"; // survives a class rename
    async handle(): Promise<void> {}
  }
  ```

  It defaults to the class name, so a job that declares nothing behaves exactly as before.
  This is the same tool [`Migration.id`](/docs/upgrade#1-10-to-1-11) is for a migration's
  filename, shipped in 1.11.0 for the same reason: an identity the framework derived from a
  name someone was free to change, with no way to say otherwise.

  It also decouples the queue from a build that mangles names. `zt compile` does not minify
  today, so that is not a live hazard — but nothing in the registry said it depended on that,
  and an assumption worth relying on is worth writing down.

## 1.13.0 — 2026-08-31

Three retirements, taken together on purpose. Each is a small migration, and three minors
each asking an app to move costs more than one that asks properly — so this is one crossing
and one `zt upgrade` run.

```bash
bun zt upgrade --to 1.13.0
```

### Removed — BREAKING

- **Flow's `Component.client(…)`.** Use the `` this.$`…` `` tagged template.

  This is a security fix wearing an ergonomics change's clothes, which is why it did not wait
  for 2.0. `client()` took a **string** and queued it to be evaluated in the browser, so the
  caller owned the escaping — and its own docblock had to warn _never interpolate unescaped
  user input_. A method whose documentation has to tell you not to hold it that way is a
  footgun with a label on. `$` is a tagged template, so every `${…}` is encoded as a JS
  literal before it reaches the page.

  ```ts
  // before — escaping was yours to remember
  this.client(`toast(${JSON.stringify(this.search)})`);

  // after — encoded for you
  this.$`toast(${this.search})`;
  ```

  The codemod rewrites a call whose argument is a single literal. **One whose argument is a
  variable or a concatenation is reported rather than rewritten**: those are precisely the
  ones the warning was about, and wrapping a finished string as `` $`${expr}` `` would encode
  it as a string literal and stop running it as code. A codemod that quietly did that would
  leave an app compiling, running, and no longer doing anything where it used to run a script.

  Removing it also frees `client` as a property name on a component — the same benefit
  removing `title` gave in 1.7.3.

### Changed — BREAKING

- **`LockDriver.extend()` is required.** Only affects a custom lock driver; all three
  built-in drivers already implement it.

  It shipped optional in 1.5.0 with `acquire(key, owner, ttl)` as the fallback, and that
  fallback was correct only by coincidence. `acquire` happens to be an owner-guarded refresh
  on every built-in driver, and nothing in the interface ever said it had to be — so a
  third-party driver whose `acquire` takes a _free_ lock, which is the ordinary reading of
  the word, would have had `refresh()` silently take a lock another holder owned. That is the
  one thing a lock exists to prevent. Requiring the method turns an assumption the contract
  never stated into something a driver has to answer.

- **`routes:types` and `serve --dev` are retired**, in favour of `route:types` and `dev`.
  Both are rewritten by the codemod.

  `serve --dev` **fails with a message** rather than being ignored, and the flag is still
  declared for that reason alone. Flag parsing runs non-strict, so simply deleting it would
  have left `serve --dev` starting a plain server — no watcher, no rebuild, no explanation. A
  retired flag that silently changes what a command does is worse than one that is still
  there.

### Added

- **The `client-tagged-template` codemod**, which is what makes the first item above a
  migration rather than a search.

## 1.12.0 — 2026-08-31

One change, deliberately alone: the minor exists to carry it.

A field report from an app running in production found a feature flag reading as
enabled for every record that had it turned off. Nothing errored, nothing logged, and
the database was doing exactly what it had been asked to.

### Changed — BREAKING

- **A boolean written to a column declared to hold text is refused.**

  A bare `@column()` resolves to `{ type: "string" }` — the right default for the
  common case, and the wrong one for a boolean. A text column has text affinity, so
  `false` was stored as the string `"0"`, and `"0"` is truthy in JavaScript. Every
  `if (model.flag)` on such a column took the wrong branch for a stored `false`, on
  every row, silently.

  There is no correct coercion. `0` becomes `"0"`; `"false"` is truthy too. The value
  cannot survive the round trip, so the only honest options were to refuse the write or
  to keep letting a stored `false` read back as `true`. It now raises
  `ColumnTypeError`, naming the property and the fix:

  ```
  [Zerotal ORM] Widget.active is declared as a `string` column and was given a boolean.
  A text column stores that as "0"/"1", and "0" is truthy in JavaScript — so a stored
  `false` would read back as true and every `if (…)` on it would take the wrong branch.
  Declare the column's type instead: `@column("boolean")`.
  ```

  The decorator cannot pick for you: `declare active: boolean` erases the TypeScript
  type at runtime, so the property looks identical to a decorator whether it holds a
  boolean or a string. Declaring the type is the only signal there is — which is why
  the mistake is worth refusing loudly rather than guessing at.

  An explicit `@column({ type: "string", cast: "boolean" })` is still honoured. That is
  someone stating what they meant; the guard is for the column that says nothing.

### Before you upgrade

- **Find the boolean properties whose `@column()` declares no type.** Nothing can find
  them for you, for the reason above — a search of your models for a bare `@column()`,
  read against the property types beside them, is the reliable way.
- **The rows you already wrote are still text.** This stops new bad writes; it does not
  migrate old ones. Those rows keep reading truthy until they are converted. The
  [upgrade guide](/docs/upgrade#1-11-to-1-12) has the statement.

### Added

- **`ColumnTypeError`** — exported, so an app can catch it by class.

## 1.11.2 — 2026-08-31

`@zerotal/ai` is `stable`, and the release that promotes it is the one that fixes five
bugs its first production users found. That ordering is the point: a `stable` promise
about an API nothing has pushed against is a promise nobody has tested.

Also here: two gates that were not doing their job, one of which had let two releases
publish over a red build.

A patch. Nothing here breaks — `@zerotal/ai`'s surface was narrowed _before_ the label,
while narrowing was still free.

### `@zerotal/ai` — the review, answered

The package shipped `experimental` with a stated precondition — _it graduates in the
release after its first real users_ — and a review date of 1.11.0 enforced by the
package linter rather than by a promise. Its first production users, running it against
Anthropic, sent a field review of the driver. So the precondition was met rather than
waived, and the answer is **promote**.

**Fixed, all from that review:**

- **Sonnet 5 was priced as Sonnet 4.6** — 3/15 rather than 2/10, 50% high. The same
  table feeds `limits.perRequestUsd` and `perDayUsd`, so an app on that model was
  refused requests comfortably inside its budget by an error that said "spend limit"
  and sent it to its config rather than to the row. `AiSpendLimitError` now quotes the
  rate it priced with and names `registerModelPrice()`, so a wrong table is legible
  from the refusal and correctable without waiting for a release.

- **`effort` and `thinking` are model-aware.** Both went on every call. `effort` is a
  400 on the 4.5 generation and those models want an explicit thinking budget rather
  than the adaptive form — so the package listed `claude-haiku-4-5` in its pricing
  table while the driver could not successfully call it. `modelCapabilities()` answers
  what a model takes, and the driver builds the request that model accepts.

- **`temperature` never reached the API, on any model.** Not in the review — it turned
  up while testing the item below. The driver warned about dropping `temperature` and
  had no branch that set it, so the configured default and `AiRequest.temperature` were
  both inert everywhere, including on the models that accept them. The old predicate
  warned for almost every model, which is exactly what made the silence look deliberate
  on the few it did not.

- **The streamed `thinking` chunk was always empty.** The API omits thinking text by
  default on the current generation, so a documented chunk type fired forever with
  `text: ""` and no error — and a "thinking…" view built against the 4.6 models, where
  it defaulted on, stopped working when users moved to 5 with nothing to say so.
  `drivers.anthropic.thinkingDisplay` defaults to `"summarized"`.

- **An app with no AI configured now boots.** `AiConfig` threw when no driver was
  declared and threw again on an empty `apiKey`, so a deployment with no key could not
  express itself either way. One app declared an Ollama server it did not run purely to
  satisfy the validator, with a comment explaining that the config was lying. "AI is
  off" is a coherent deployment and is now expressible; the first call raises
  `AiDriverUnavailableError`, whose `transient` is already `false`.

- **`countTokens` returns `null` where a provider cannot count**, rather than `0`. Only
  Anthropic has a counting endpoint, and `0` is also a real count for an empty prompt.

**How it was promoted**, because the order is the part that matters:

The surface was narrowed **first** — narrowing after `stable` is itself a breaking
change. `toSchema`, `strippedConstraints`, `resetSpend` and `resetStats` are `@internal`
now: still exported, so nothing breaks at runtime, but no longer promised.
`translateSchema` stayed public despite having no caller outside the package, for the
same reason `AiDriver` is public — the point of a driver contract is that someone else
implements it, and implementing structured output means translating a schema.
`AiDelivery` stayed too, being the element type of `recentGenerations()`.

Then the two modules it would have been embarrassing to freeze untested: the SSE
parser, which reads a remote provider's framing off the network, and prompt redaction,
which is the only thing between a user's prompt and a log that outlives the request.
Both hold up — the parser reassembles a frame whose terminator is split across chunks
and a UTF-8 sequence cut mid-character.

#### **BREAKING** — `countTokens` can return `null`

`Ai.countTokens()` and `AiDriver.countTokens()` return `number | null` rather than
`number`. Only Anthropic has a counting endpoint; the other drivers returned `0`, which
is also a real count for an empty prompt, so the old value was a number you could divide
by and budget against without ever being told it meant "unsupported".

```ts
// before
const tokens = await Ai.countTokens(prompt);
if (tokens > 1000) shorten();

// after
const tokens = await Ai.countTokens(prompt);
if (tokens !== null && tokens > 1000) shorten();
```

A custom `AiDriver` implementation compiles unchanged — returning `number` still
satisfies `Promise<number | null>`. It is callers who need the check.

**This should have been a minor.** It shipped in a patch, which the versioning scheme
says cannot carry a break; see [the note in the upgrade guide](/docs/upgrade#1-11-2).

#### **INTERNAL** — four `@zerotal/ai` exports left the promised surface

`toSchema`, `strippedConstraints`, `resetSpend` and `resetStats` are `@internal`. They
are still exported and still work, so nothing breaks — they are simply no longer
covered by the compatibility promise, which is the narrowing that had to happen before
the package could be promoted at all. Reach for `AiFake` where a test used `resetSpend`
or `resetStats`; it is the seam built for that.

### Fixed — the gates

- **The release workflow ran three checks; the pull-request workflow ran fifteen.** So
  every convention, surface and documentation gate guarded the cheap, reversible action
  and not the permanent one. 1.11.0 and 1.11.1 both published over a CI that had been
  red since the first of them, and nothing in the release objected, because nothing in
  the release looked. `release.yml` now runs the same set.

- **One failing check hid eleven others.** When the `@zerotal/ai` review fell due, the
  package-conventions step failed and every later step in that job was skipped —
  reported as "skipped", which reads like "not applicable" rather than "never ran".
  Each check is now guarded so it reports its own result.

## 1.11.1 — 2026-08-31

Two things the framework could not do, both reported by teams who had already
worked around them.

A patch, not a minor: nothing here breaks. Under
[the versioning scheme](/docs/upgrade#versioning) a minor is reserved for a
breaking change and a patch carries everything else, features included — so this
is safe to take from any 1.11.x.

### Added

- **`zt version`** — which Zerotal, which Bun, which app.

  ```
  Zerotal  1.11.1
  Bun      1.3.14
  App      my-app 0.1.0
  ```

  It was an unknown command, so the version had to be dug out of `package.json` or
  `node_modules` — both of which report what is _installed_ rather than what is
  _running_, and those differ for any process that has been up since before an
  upgrade. It reports the running one.

  `--version` and `-v` answer earlier still, ahead of the runtime check, the config
  load and the app import, because those are the things someone is asking the version
  _about_: a config that no longer validates and an app that will not boot are the two
  moments the question stops being idle. A version flag that only works when
  everything else already works answers a question nobody has.

  Add `--json` for a script, and prefer `zt --version --json` over
  `zt version --json` there — the application's boot log is written to stdout, so the
  second form puts a log line ahead of the JSON while the first never boots at all.
  The output carries no colour, unlike every other command's, because it gets pasted
  into bug reports and piped into parsers more than it is read on a terminal.

- **`MailMessage.header()` and `MailPayload.headers`** — set a header the mail driver
  does not build itself.

  ```ts
  new MailMessage()
    .subject("Your weekly digest")
    .header("List-Unsubscribe", `<https://app.test/unsubscribe/${token}>`)
    .header("List-Unsubscribe-Post", "List-Unsubscribe=One-Click");
  ```

  `MailPayload` had `to`, `from`, `subject`, `text`, `html`, `cc`, `bcc`, `replyTo`
  and `attachments`, and no way to add anything else — so a team that wanted
  `List-Unsubscribe` had to patch a vendored copy of the package, and shipped a footer
  link instead.

  Those are not substitutes for one another. Gmail and Yahoo draw their native
  unsubscribe control from the header, and a recipient who cannot find a control marks
  the message as spam instead — a judgement that attaches to the sending domain and
  degrades delivery of everything else it sends, including the mail people asked for.
  Send `List-Unsubscribe-Post` alongside it: alone, the first leaves a link to follow,
  and only the pair produces the one-click control both providers now expect.

  Wired through all three drivers. SMTP writes them into the message, Resend sends
  them as the API's `headers` object, and the log driver prints them — that last one
  deliberately, because the reason to set a header is that a mail client does
  something with it, and the log driver is where that gets checked before anything is
  sent for real.

  Names the drivers build themselves are refused rather than sent twice: a second
  `Subject` is an ambiguous message, not an override, and which copy a client believes
  is its own business. The list is exported as `RESERVED_MAIL_HEADERS`, with
  `resolveHeaders()` beside it for anyone writing a custom transport. CR and LF in a
  value are folded to a space — left raw they end the header and let the remainder be
  read as further headers, which is how a `Bcc` arrives courtesy of whoever supplied a
  tracking ID.

## 1.11.0 — 2026-08-30

Two production reports, from teams taking apps live on 1.9.0 — one shipping a
household-finance app to a VPS, one migrating a webmail platform from Flow to Inertia
and cutting it over to live traffic. Between them, nineteen findings.

The character of the list is the thing worth naming. Almost none of it is a crash.
Most of it fails silently or fails open: a release gate that always passes, a
`cascadeOnDelete` that deletes nothing, an `.env.example` carrying the key the project
actually runs with, a fake that agrees with whatever it is handed. Building an app
finds loud bugs quickly because somebody is watching. Deploying one finds the quiet
ones, months later, when nobody is.

**This is the first release under the versioning scheme in
[the upgrade guide](/docs/upgrade#versioning): a minor carries breaking changes, a
patch never does, and majors are annual.** So a `^1.10.0` range will pull this in.
Read the two items below before you take it.

### Two things to do before upgrading

- **SQLite now enforces foreign keys.** Run `bun zt db:check-foreign-keys` first. It
  lists any row whose parent is missing — legal before, a constraint violation now —
  and exits non-zero, so a release script can gate on it.
- **If you have ever renamed a migration file**, `migrate` will now stop rather than
  re-run it. That is the intended behaviour and the message says what to do; see
  [the upgrade guide](/docs/upgrade#1-10-to-1-11).

### Changed — BREAKING

- **SQLite enforces foreign keys.** `database.sqlite.foreignKeys` defaults to `true`.
  SQLite ignores foreign keys unless the connection asks it not to, and it is the only
  supported dialect that does — so `constrained()` and `cascadeOnDelete()` in a
  migration described behaviour the database would not perform. Deleting a parent left
  its children, silently, and every child had to be removed by hand in the right order
  by application code that remembered to. An app's data-erasure path swept fifteen
  tables and missed three, two of them holding uploaded files, so an account erasure
  left the paperwork on disk. `zt db:check-foreign-keys` and `zt doctor` both report
  the rows that enforcement would now reject; `sqlite: { foreignKeys: false }` takes
  the old behaviour back while you fix them.

- **A renumbered migration is refused rather than re-run.** A migration is recorded
  under its filename, so renaming one made an applied migration look pending — the
  runner tried it again and failed on `table already exists`, a failed boot whose
  error named a table rather than the rename. An app renumbered `001_` to `0001_` to
  match this framework's own scaffold convention and would have made all nine of its
  production migrations look unrun. `migrate` now recognises that shape, refuses, and
  prints both spellings and the fix.

### Fixed

- **`.env.example` no longer ships the key the project runs with.** Both files got the
  same rendered content, so every scaffolded project committed a live, working
  `APP_KEY` — `.gitignore` covers `.env` and not `.env.example`. And
  `cp .env.example .env` is the first line of every deployment guide, so the published
  key went on to sign production sessions. No strength check can catch it: as a string
  the value is perfectly strong.

- **`.gitignore` covers the SQLite sidecars.** `*.sqlite` does not match
  `db.sqlite-wal` or `db.sqlite-shm`, and WAL mode is on by default, so both exist in
  every project and the write-ahead log holds rows not yet checkpointed. An app found
  both in its first commit on a public host.

- **A command can fail without throwing.** `CommandRunner` ran `process.exit(0)` the
  moment `run()` returned and never read `process.exitCode` — the idiomatic way to
  fail a CLI without an exception. A release gate printed six blockers, set the code,
  and exited `0`. `zt deploy` gates on the same value, so its own preflight had the
  hole too: a gate that could not fail, failing open.

- **A Bun the project never asked for is a warning, not a refusal.**
  `bun-plugin-tailwind` declares `bun` as a required peer, so `bun install` fetches a
  second runtime and the guard refused to boot. An app took two outages on it. The
  guard now asks whether the project _declared_ `bun`; if not, it warns and names both
  the fix that works and the one that cannot.

- **SMTP submission and TLS verification.** STARTTLS on 587 completed its handshake
  and sent nothing — a write issued before the handshake finishes is dropped. And
  `rejectUnauthorized` is not enforced by the runtime on either transport, so TLS was
  encrypted and would have accepted that encryption from anyone in the path.

- **Migration names no longer carry the platform that recorded them.** `Bun.Glob`
  yields native separators, so on Windows the whole joined path went into the
  `migrations` table. A database moved between platforms re-ran every migration.

- **React SSR emits the page's `<Head>` tags**, and `ctx.session.intended()` reads the
  URL `AuthMiddleware` stored — the two APIs used different session keys, so an app
  that mixed them was silently sent to `/` after every sign-in.

- **An empty string is an answer.** `required` treats `""` as absent, which is right
  for a form and wrong for structured model output, where `""` is how a prompt asks a
  model to say "this does not apply". A whole feature returned nothing because of it —
  and shipped green, because `AiFake` never checked its canned object against the
  schema. One half made the mistake; the other made it invisible.

- **`MonitorStore` no longer overwrites its own defaults with `undefined`**, and
  `zt inertia:build` fails when it produces no files rather than serving a page with
  no script.

### Added

- **`zt db:check-foreign-keys`** — the rows enforcement would reject, by table and
  rowid, exiting non-zero.
- **`Migration.id`** — a declared identity, so renaming a migration file is free.
- **`@zerotal/inertia/testing`'s `renderPage()`**, and a page-render test in the React
  scaffold. An app shipped a blank page with 614 passing tests: every one asserted a
  value or a status code, so a page could throw on its first paint and the suite
  stayed green.
- **`AiError.transient`** — `true` for _this call failed_, `false` for _this machine
  cannot do this_, so a service can latch itself off without classifying eleven error
  classes by hand.
- **`assertRedirectContains()`**, and **`assertRedirect()` now compares paths
  exactly** — it used `includes()`, so `assertRedirect("/login")` passed on
  `/login-as-someone-else`.
- **`database.sqlite.foreignKeys`**, a doctor check for a `notifications` table that
  is not the framework's, and a doctor check for a production `mail.driver` of `log`.

### Changed

- **`config/session.ts` is scaffolded environment-aware**, so the first production
  deploy no longer fails on the config validator's (correct) refusal.
- **Tailwind and its plugin move to `dependencies`** and the plugin is pinned — a
  `--production` install that then builds on the server had neither.
- **The notification database channel is built on first use**, so an app that never
  routes there never touches the table.
- **`@column({ type: "integer" })` compiles.** The object form took six type names
  while the string form took twelve.
- **`--success` meets WCAG AA** at the contrast it is actually drawn at.

### Documented

- [Persistent layouts](/docs/inertia/rendering#persistent-layouts), which failed only
  in a browser and were documented nowhere;
  [which Inertia redirects are covered](/docs/inertia/middleware#which-redirects-are-covered);
  [pages render](/docs/testing#pages-render); the middleware names the framework
  occupies; why `X-Forwarded-For` is counted from the right; and how to authenticate a
  test when identity is not a row.

## 1.10.0 — 2026-08-30

A second report from the team building on Zerotal, and the things it found. Most of this
release is failures that were silent by construction — mail delivered nowhere, a page
shared as a grey rectangle, a schedule that never fired, a rate limiter with one bucket
for everybody. None of them logged anything.

**Three things to know before upgrading.**

- **React apps using SSR now need `@inertiajs/react` installed.** It is the same adapter
  your browser entry point already uses; the server renders through its `<App>` so
  `<Head>` works. A missing one is a named error rather than a silent omission.
- **`scheduler.timezone` does something now.** It was documented as informational and read
  by nothing. Its default moved from the literal `"UTC"` to **the system zone**, so an app
  that never set the key keeps doing exactly what it did — but an app that set it now gets
  what it asked for. If you set it to `"UTC"` on a server that is not on UTC, your
  schedules will move. See [the upgrade guide](/docs/upgrade#1-9-to-1-10).
- **Named rate limiters need `.trustedProxies(n)` behind a proxy.** `.byIp()`, `.byUser()`
  and `.byApiKey()` now ignore `X-Forwarded-For` unless told how many proxies sit in
  front, which is the same rule `ThrottleMiddleware` already followed. `zt doctor` reports
  any that need it.

### Added

- **`zt assets:prune`** — removes the chunks an earlier release left behind, on the machine
  that never ran a build. `assets:build --clean` cleans the directory it _builds into_,
  which does nothing for the usual release shape: build here, tar the output, extract it
  over `public/` there. Extracting merges, so every deploy adds another set of
  content-hashed chunks and none are ever removed. One app reached 225 chunk files for the
  49 its entry point references. Ship `.zerotal/` with the release and this removes what
  the build record does not claim. See [Deployment](/docs/deployment#assetsprune--clearing-up-after-the-extract-instead-of-before-it).

- **`zt deploy:<env> --check`** — the preflight gate on its own, for the point in a release
  script where the new code is on disk and the service has not restarted. Exit 0 and
  restart; exit non-zero and keep serving the previous release. Everything that can refuse
  already runs by the end of preflight and none of it mutates, so stopping there is a
  complete answer rather than half a deploy.

- **`RateLimiter.trustedProxies(n)`** on the fluent builder, and
  **`res.assertInertiaRedirect(url)`** in `@zerotal/testing` — the assertion that checks
  what actually breaks on an Inertia redirect, which is the `X-Inertia` marker rather than
  the status and `Location` a normal redirect assertion already covers.

- **`@zerotal/core/runtime`** (`zerotal/runtime`) — the runtime checks as exports, so a
  script or a test can make the same assertion `zt` makes: `runtimeBelowFloor`,
  `declaredBunFloor`, `runtimeMismatch`, `bunBinary` and the messages that go with them.

- **`definedOnly()` and `Resolved<T>`** on `@zerotal/core/helpers`, for merging an options
  bag over defaults without an explicit `undefined` overwriting one.

- **Scheduler timezone helpers** — `wallClockIn`, `isValidTimeZone`,
  `CronExpression.matchesIn` and `CronExpression.nextRunAfterIn`, plus `SchedulerError` and
  `UnknownTimeZoneError`.

- **A boot line when a convention is skipped in this environment.** An env-restricted
  concern is skipped by _not looking_, which is correct and completely silent: an app ran
  for weeks in production with `app/schedules` full and no worker process, and nothing
  logged anything because from a web process's point of view nothing existed.

### Changed

- **Optional properties in public option shapes are declared `?: T | undefined`.** The
  generated `tsconfig.json` enables `exactOptionalPropertyTypes`, under which
  `image?: string` refuses a key that is present and holds `undefined` — so
  `{ image: candidate ?? undefined }`, the most ordinary thing there is, did not compile
  and every conditionally-absent field had to be spelled `...(x ? { x } : {})`. 438
  properties across 115 files. Nothing changes for a reader: an absent optional property
  already read as `undefined`.

- **`scheduler.timezone` is honoured**, and its default is the system zone rather than the
  literal `"UTC"`. See the note above.

- **`mail.driver: "log"` fails `zt doctor` in production** when `mail.from.address` has been
  configured, and warns when it is still the placeholder. Mail written to a log file is
  delivered to nobody and says so nowhere.

### Fixed

- **React SSR emitted no `<Head>` tags at all.** The React branch rendered the page
  component directly, and `<Head>` renders nothing — it reports its children to a head
  manager it reads from context, and rendering the component alone puts none there. So
  every page served the template's `<head>`: no title, no description, no card. Nothing
  failed and nothing logged, because the page is perfect in a browser, where React has run.
  Only the readers that do not run JavaScript saw it — which is every link-preview scraper
  and every `curl`.

- **SMTP submission on port 587 sent nothing.** The STARTTLS handshake completed and then
  the client's `EHLO` was dropped: `upgradeTLS()` returns the new socket while the
  handshake is still in flight, and a write issued in that window is lost — not buffered,
  not an error, gone. Port 465 was unaffected, so mail worked on the port nobody documents
  and the 587 every provider _does_ document produced silence: no error, no bounce, no log
  line, and password resets that never arrived.

- **TLS certificates were not actually verified, on either SMTP transport.**
  `rejectUnauthorized` is not enforced by the runtime — it reports a self-signed
  certificate as authorized and puts the real reason beside it — so the connection was
  encrypted and would have accepted that encryption from anyone in the network path. The
  driver reads the handshake result itself now and fails closed.

- **A scheduled task with a `timezone` took the whole scheduler down.** `Bun.cron`'s options
  form throws, and it throws during registration, so the worker died on boot and
  restart-looped: one task with a timezone stopped every task in the app. Zerotal evaluates
  the zone itself now, and a task that cannot register takes only itself out.

- **Named rate limiters ignored `trustedProxies`, and `zt doctor` was told not to look.**
  `.byIp()`, `.byUser()` and `.byApiKey()` used a resolver that read the socket address and
  fell back to the leftmost `X-Forwarded-For` entry with no proxy count. Behind a reverse
  proxy every visitor keyed on the proxy's own address and shared one bucket, so a `login`
  limiter of five attempts a minute was five attempts a minute for the entire user base and
  one attacker locked everybody out. The doctor check written to catch this exempted any
  custom `keyResolver`, which is what all three are.

- **`ctx.session.intended()` could not read what `AuthMiddleware` stored.** It used the key
  `intended` while the middleware and `redirect().intended()` used `intended_url`. Each pair
  was internally consistent and separately tested, so every test passed — and an app that
  mixed them, which the documentation invited, was silently sent to `/` after every sign-in.

- **`MonitorStore` overwrote its own defaults with `undefined`.** It applied `?? …` defaults
  and then spread `...opts` after them, and spread copies own properties even when they
  hold `undefined` — so an unset config put `undefined` back over the retention window and
  `prune()` computed a `NaN` cutoff, pruning nothing and reporting nothing.

- **`engines.bun` is enforced.** Every generated app writes a floor and nothing read it.
  `Intl` output moves between Bun releases, so a suite with currency or date assertions goes
  red on a runtime that is otherwise fine and the failures name the code they touch rather
  than the binary.

- **The asset build record is portable.** Its filename was hashed from the output
  directory's _absolute_ path, so a record shipped with a release matched nothing at the
  other end and moving a checkout silently orphaned it.

- **The React SSR root is marked `data-server-rendered`**, so the client hydrates the markup
  instead of discarding it and rendering the page a second time. `POST /__ssr` returns the
  same body shape as the Vue branch.

### Documented

- **["What a crawler sees"](/docs/inertia/ssr#what-a-crawler-sees)** — `inertia()` does not
  server-render the component, which is the normal Inertia arrangement and worth saying out
  loud: the served document is a `<title>` and a JSON blob. Which readers run JavaScript,
  which do not, and the three ways to give the second group something to read.

- **[Which Inertia redirects are covered](/docs/inertia/middleware#which-redirects-are-covered)**
  — all of them, because `useOnce()` registers the middleware globally. Written down because
  the opposite belief is what keeps an app's own workaround on every request forever.

- **[`bun test` vs `bun zt test`](/docs/testing#bun-test-vs-bun-zt-test)** — the 30-second
  timeout (the `bunfig.toml` key is ignored by Bun and `setDefaultTimeout()` in a preload
  reaches only the first file, so the flag is the only mechanism that works), the runtime
  check, and the fact that configuration resolves once per process — so a test that mutates
  the environment in `beforeAll` is testing whichever file booted first.

- **[Timezones](/docs/scheduler#timezones)** in the scheduler, **[the middleware names the
  framework occupies](/docs/middleware#names-the-framework-already-occupies)**, and why
  `X-Forwarded-For` is [counted from the right](/docs/rate-limiting#trustedproxies).

## 1.9.0 — 2026-08-29

The gaps an app was filling in for itself: one Bun per project, a database backup that is not
`cp`, a release gate the pipeline will actually call, a boundary between a model and a page
prop, and helpers that work on both sides of the wire.

**Two things to know before upgrading.** Both are new refusals or new noise, and both are quiet
if they do not apply to you.

- **`zt` now refuses to run when a project has two Bun runtimes in it** — the shell's `bun` and
  a different one in `node_modules`. If it fires, pick one: `bun update bun` moves the installed
  copy to match your shell, or run everything through `node_modules/.bin/bun`. To boot anyway
  while you sort it out, set `ZT_ALLOW_RUNTIME_MISMATCH=1`. Most projects never see this,
  because most have no `bun` in `node_modules` to disagree with.
- **Passing an ORM model straight into an Inertia page prop now warns in development**, once per
  model class, if that model declares neither `hidden` nor `visible`. Declaring either silences
  it — and is the fix, not the silencer. Production is unaffected.

### Added

- **One project, one Bun.** `engines.bun` is a floor and nothing enforced it, so an app could be
  served by one runtime and tested on another — the shell's `bun` and a `node_modules/bun` put
  there by a transitive peer dependency nobody declared. A green suite is then evidence about a
  binary the app is not served by. `startZerotal()` refuses on a mismatch, and `zt test` spawns
  the binary running it rather than a name `PATH` resolves.

- **`zt db:backup`** — a verified snapshot of the SQLite database, using `VACUUM INTO` rather
  than `cp`. Copying a live SQLite file can capture a half-written page and produce a backup
  that restores as a corrupt database, months later, from the one file you were relying on.
  Every snapshot is opened and integrity-checked as it is written, `--require-rows` fails a
  backup whose business tables are empty, `--rehearse` performs the actual restore, and every
  failure path exits non-zero — a backup timer that reports success while writing nothing is
  worse than no timer at all. See [Deployment](/docs/deployment#back-up-the-database).

- **`DeployTarget.preflight`** — a slot for the app's own release gate, run after the config
  validators and `doctor` and before anything is built or migrated. A command named
  `release:check` is found by convention, with nothing to wire up. A declared name that is not
  registered **fails** the deploy rather than being skipped: a gate nothing calls is a comment.

- **`zerotal/shared`** — the helpers with no server in them, importable from a browser bundle:
  `pluralize`, `Str`, and new `formatMoney` / `formatNumber` / `formatDate`. A total that reads
  `R 39 147` on screen and `R39,147.00` on the invoice looks like two different numbers to the
  person paying it, and maintaining that in two files is how it happens. See
  [Helpers](/docs/helpers#sharing-helpers-with-the-browser--zerotalshared).

- **`<form data-enhance>`** — a plain server-rendered page, with no Flow component on it, can
  submit without the page flashing. It posts through `fetch` and the matching form in the
  response replaces it in place, so a validation error lands where the person is looking. Its
  own dependency-free bundle at `/__flow/enhance.js`, added with `flowEnhanceTag()` in the
  layout. Every path degrades: a network failure re-submits natively, a redirect is followed and
  `pushState`d, and no JavaScript at all is an ordinary form post.

- **Three new `doctor` checks.** A rate limiter that cannot tell two people apart behind a proxy
  — where the socket address is the proxy's for every request, so one attacker can lock out
  everybody. Auth columns missing from a table a migration built without them, which otherwise
  surfaces as `no such column` in tests that have nothing to do with email. And migrations that
  have not run, named, before a request finds out.

### Changed

- **A model reaching Inertia page props says what it is safe to publish.** Page props are page
  source, and `return inertia("Trips/Show", { trip })` ships every column of the row — the
  internal cost, the margin, the note about the customer, on the customer's own screen. The
  ORM's `hidden` / `visible` lists were already honoured and nothing said so. See the upgrade
  note above and [Inertia props](/docs/inertia/props#page-props-are-page-source).

- **A bound field the model will not accept says so.** `flow:model` on a column missing from
  `fillable` was dropped in silence: the form submitted, nothing was written, nothing failed.
  The drop stays — the same path receives whatever a browser sends — but a developer's typo no
  longer produces the same silence as a hostile payload. Development only, once per field.

- **INTERNAL: 116 exports leave the recorded API surface** across `core`, `orm`, `flow`,
  `admin`, `flow-ui` and `monitor`. **Nothing is removed and nothing breaks** — they are still
  exported and still work; what changes is the promise. The dev orchestrator, the ORM's
  connection wiring and dialect layer, the admin panel's page machinery and Flow's
  wire-protocol frame types are not things an app constructs, and naming them in a `stable`
  surface implied a guarantee about a protocol that is free to change. Each package's own
  changelog lists its share.

- **A minor breaks nothing that can wait.** The roadmap used to say a minor never breaks
  anything, which was false when written — three breaks had already shipped in minors, each
  deliberately, each with a note, exactly as the [support policy](/docs/support-policy) has
  always described. An absolute rule the project knowingly broke is worse than an honest one.

### Documented

- **Every promised export is documented — 100%, up from 60%.** `maturity: stable` means an
  export keeps its shape for the rest of the 1.x line, and the gate measuring how much of that
  promise was written down stood at 798 gaps. It is zero.

  Four features turned out to have shipped and been invisible. **Passkeys** — `PasskeyService`
  has been here since 1.7.0 with no page at all, including that `requireUserVerification`
  defaults to `true` because that is what makes a passkey a second factor rather than one.
  **`@zerotal/core/env`**, a typed environment schema that reports every bad variable at once
  rather than one per restart. **The outbound `Http` client**, which the testing guide had been
  linking to a page that did not describe it. And **`@zerotal/monitor`'s Export JSON**, where the
  button was documented and the forty-odd row types it hands you were not.

  Also named for the first time: `@zerotal/flow-ui`'s sixty-one component prop types, which a
  wrapper component cannot be written without.

  The gate itself could not see `.tsx` files: with `jsx` unset, TypeScript declines to pull such
  a module into the program rather than failing to parse it, so every symbol in one was
  invisible. It had been inflating exactly the TSX-heavy packages.

### Fixed

- **A rebuilt Inertia bundle no longer 404s on a chunk the browser asks for.**
  `resources/js/app.tsx` builds to `/assets/app.js` under that name every time, while
  `splitting: true` names each chunk after its content. A rebuild therefore rewrites `app.js` to
  import `chunk-NEW.js` and prunes `chunk-OLD.js` — and a browser holding a cached `app.js` asks
  for the pruned one:

      GET /assets/chunk-hrnspqda.js  status=404

  from a page that renders and a server that is healthy, with nothing in that line leading back
  to the template.

  The template hardcodes `/assets/app.js` rather than calling `asset()`, so the version token the
  rest of the framework appends never reached it — and cache-busting had only ever been
  implemented for `serve --dev`. It now applies in every environment: the file's mtime in dev,
  where a rebuild happens without a restart, and the boot-derived asset version otherwise. An
  unchanged asset keeps a stable URL and stays cached, which is why the token is derived rather
  than random.

## 1.8.1 — 2026-08-26

DevTools showed you the wrong request, accurately.

### Fixed

- **A page keeps the DevTools panel while its own assets load.** Opening `/login` selected
  `/login`, then `/favicon.ico` a few milliseconds later, then `/css/app.css`. Live mode
  selected every trace as it arrived and a page's sub-resources arrive right behind it, so the
  bar named a request nobody asked about, the detail below described that request's headers
  and its empty session, and the page you were inspecting had scrolled into the list. Nothing
  shown was wrong; it was all about the wrong request.

  Traces are now classified into three kinds rather than two, because "not the document" would
  have suppressed the form post and the Inertia visit — the requests most worth watching. What
  gets skipped over is narrower: a sub-resource the browser fetched on its own initiative. The
  browser is asked rather than the URL, since an app may serve an API from a `.js` route and a
  build that hashes its asset names has no extension to read; what was actually served is the
  fallback, so a page fetched by `curl` still reads as a page. Anything unclassifiable counts
  as app traffic, never as an asset — being wrong there decides whether a request is skipped,
  and skipping the wrong one is how the panel stops showing what you came to see.

  An asset still takes the selection when nothing else has it, so a panel opened mid-load
  shows a request rather than an empty pane. A paused panel still counts assets toward its
  pending badge.

### Added

- **A `kind` facet on the DevTools All tab**, beside method and status. Assets were never the
  problem, only their claim on the selection, so they are not hidden: pick `page` and `api`
  for a list without fifty stylesheet fetches in it, or `asset` alone for what the browser
  pulled in, what it cost and which of it 404'd — which was not visible anywhere before.

## 1.8.0 — 2026-08-24

The first render mode, the codemod runner 2.0 depends on, and five failures that
each looked like something other than what they were.

### Added

- **`static interactive = false` — the first rung of Flow's render modes.** Every component
  until now was maximally interactive: rendered on the server, dehydrated into a snapshot,
  tracked by the client, reachable over a socket. Right for a counter, wasteful for a nav rail.
  A static component is rendered in full by its parent and nothing else — no `onDehydrate`, no
  snapshot, no `<script type="application/json">`, no entry in the client's registry, and no
  `data-flow-root`, which would freeze it at its first render since its only route to an update
  is the parent re-rendering it. It takes no place in `_childIds` and does not shift its
  interactive siblings' ids, so no sibling remounts and loses its state when a static one
  appears above it. `lazy`, `defer` and `stream` throw rather than being ignored: each waits
  for the client to ask for the real render, and a static child never registers to do the
  asking.

  Opt-in — nothing existing changes. `this.isInteractive` reports the mode from inside the
  component, and being a new public member it takes that name away from applications; it is on
  the documented reserved list. See [Static children](/docs/flow/layouts#static-children).

- **`zt upgrade` — the codemod runner.** The 2.0 ledger's rule is that every entry that can
  have a codemod has one before 2.0 ships, and until now nothing had been built, which made
  the ledger a list of changes nobody could afford to make.

  **Dry by default**, which is backwards from most tools and deliberate: it rewrites source
  across a whole project, and the first run should be something you can read and disagree with.
  `--write` applies it. Nothing is written until the whole plan is known, so a run that fails
  halfway leaves no half-upgraded tree, and `--dry` exercises the same code path as the real
  thing rather than a parallel one that can drift from it. Codemods see each other's output,
  because two of them touching one file across a version range is ordinary.

  **What it could not do is the headline.** A codemod that walks past what it does not
  understand is worse than none, since the changes it _did_ make imply the job is finished. So
  every codemod returns two lists and the runner prints the second last and loudest, with file,
  line and a reason. The first codemod covers the deprecated aliases — `BaseModel` → `Model`,
  `routes:types` → `route:types`, `serve --dev` → `dev`. See [Commands](/docs/commands).

- **`--clean` on `assets:build` and `inertia:build`.** Pruning is conservative by default:
  chunk-shaped filenames, plus whatever the last build on this machine recorded in `.zerotal/`.
  That cannot recognise output some other naming produced. `--clean` needs no record — the
  output directory belongs to the build, and what the build did not write does not belong in
  it. It refuses `public/` and the project root, where deleting what was not rebuilt takes the
  app's images and favicon with it, which is the one failure here that building again cannot
  undo. Pruning stays the default; only you can say the directory holds nothing else.

- **Agent skills, from `@zerotal/arch`.** `AGENTS.md` is short because every prompt it lands
  in pays for its whole length, so it points rather than teaches. That has a cost: an agent
  gets a map and no detail, and the detail is where the expensive mistakes live. A skill is a
  file with a one-line description that costs nothing until an agent decides it is relevant,
  so a procedure can be written out in full. Two ship — one on changing the schema (who owns
  it in your app, the mixin columns nothing declares, and why an unguarded `ALTER TABLE`
  collides during a release's `migrate`) and one on shipping a release (naming your own deploy
  steps, replacing the asset directory rather than merging into it, `trustedProxies` behind a
  proxy, and the pipe that hides a test suite's exit status).

  Written to `.agents/skills`, plus `.claude/skills` when that agent is detected. To replace
  one this ships, edit it and delete its marker line — a `SKILL.md` without the marker is
  yours and is never rewritten. `ArchConfig({ skills: false })` turns the feature off. Run
  `zt arch:update` to install them.

- **`zt doctor` reports agent instructions that no longer describe your project.** Every fact
  in the generated block moves without anyone thinking about the file: add a migrations
  directory, turn `synchronize` off, install a package. It goes on reading as current while
  describing the app you used to have, and guidance that is confidently out of date gets
  followed rather than questioned. Skills rot the same way and are easier to miss, since
  nothing reads one until an agent decides it is relevant — by which point it is being acted
  on. The check regenerates both and compares, and names `zt arch:update` as the fix. A
  warning, not a failure: it misleads a reader, it does not stop the app working.

### Changed

- **A Flow page with nothing interactive on it opens no socket.** Every page connected at
  boot, unconditionally — so a marketing page, a docs article or a rendered report held a
  WebSocket per visitor, open on both ends for the life of the visit, to carry nothing. Both
  paths that write to the socket take a `FlowComponent`, so with none registered there was not
  a frame that _could_ be sent. The connection is made when something needs it now: after the
  initial scan, after an SPA navigation, after a patch registers a child. `<Link navigate>`
  fetches over HTTP, so a static page with links stays disconnected. A routed page honours the
  same static, which is the half that matters — a page is a component, and one whose children
  are static but which is interactive itself still connects.

- **The `@zerotal/arch` agent block describes how your app is set up, not only what it
  installed.** A package list answers "what is available here", which is not the question that
  decides what an agent should write: the framework's contracts are not uniform across
  projects, and the places they differ are the places where guessing wrong compiles cleanly and
  fails at runtime. `AGENTS.md` now states the four facts that change an instruction — who owns
  the schema, whether route names are typed, whether `exactOptionalPropertyTypes` or
  `noUncheckedIndexedAccess` are on, and whether there are tests to run. Read off disk rather
  than from a booted app, because a project that will not boot is often why the agent surface
  is being installed. `.env` is deliberately not among the files read: this output is committed
  and pasted into prompts, and a detector that reads secrets is one refactor away from emitting
  them. Re-run `zt arch:update` to pick it up.

### Fixed

- **No mail could be sent over port 587.** A STARTTLS upgrade hands back a new socket and
  leaves the old one attached, still firing its callbacks — and what that one delivers from
  then on is the undecrypted TLS stream. Both sets of handlers appended to a single reply
  buffer, so handshake records and ciphertext sat in the middle of the server's replies and no
  line in the buffer matched a reply any more: the driver waited out its timeout without ever
  parsing the `250`, and the server logged a connection lost after STARTTLS. Measured, 1,737
  bytes of ciphertext went into the discarded socket's handler while the TLS handler received
  the replies.

  `close` and `error` were worse than `data`. The plaintext socket ending is a normal part of
  handing over to TLS, and it marked the live connection closed — rejecting whatever was
  waiting on the session that had just replaced it. Each set of callbacks now captures the
  generation it was installed for, and an upgrade bumps it.

- **An Inertia `303` redirect left the browser doing nothing at all.** `X-Inertia: true` was
  set inside the 302-to-303 conversion, so it only ever reached a redirect that arrived as a
  301 or 302 from a non-GET handler. A handler returning the 303 the protocol asks for skipped
  the only line that marked its response — and `redirect(to, 303)` is what
  [Authentication](/docs/authentication) tells people to write, in eight places. The form
  submitted, the row was written, the mail went out, and the fields stayed filled in: a hang
  from both ends, which is the worst shape a failure can take. Marking now happens for every
  redirect status on an Inertia request, with the conversion a separate decision on top of it.
  `307` and `308` are marked but left alone, since preserving the method is the whole reason to
  choose them.

- **Answering the busy-port menu killed `serve --dev` on the spot.** The banner printed, then
  `exited with code 1`, and nothing said why. Reading a prompt locks Bun's stdin stream, and
  the lock is deliberately held for the life of the command so a second prompt can still read —
  so the dev deck taking the terminal over threw `ReadableStream is locked`. It died inside the
  alternate screen buffer, and restoring the terminal on the way out erased the error along
  with everything else drawn there, which is why this was reported as "it just exits" rather
  than as the error it was. The prompt hands stdin back where it took it; a deck that still
  cannot have stdin degrades to streaming rather than dying, and a dev-mode failure stops the
  deck before it reports.

- **Two builds sharing an output directory deleted each other's files.** Nothing forbids
  `inertia:build` and `assets:build` writing to the same place, and the defaults invite it: one
  writes to `public/assets`, `app.assets.outDir` often names the same directory, and the
  default release pipeline runs them one after the other. The record of what to prune was one
  flat list per directory, so each build read the other's files as its own previous build and
  removed them. The release ended with whichever ran last and nothing reported a problem — the
  build that lost still said "Build complete" on its way out, and the page it served then 404'd
  its own script. The record is keyed by entry point now: a file another build claimed is not
  this one's to remove, while chunks nobody claims are still swept.

- **`zt doctor` failed a schema configuration that works.** Sync on plus migrations present
  read as "the schema needs exactly one source of truth", which misses the documented
  arrangement where sync builds the schema from the models so a fresh clone runs without a
  migration step, and `synchronize` is an expression that is false in production, where the
  deploy runs `migrate`. The two never apply in the same environment. It fails in production
  now, where the deploy really does run both, and warns elsewhere. A check that cries wolf
  against a correct configuration is what stops `zt doctor` ever being trusted to gate a
  deploy.

### Documented

- **Replace a release directory, do not merge into it.** Chasing 195 orphaned chunks on a
  server showed the build was never the problem — ten releases of a code-split app into one
  directory hold steady at the build's own output, and every one of the reporting app's 68
  chunks is referenced. What accumulates is the _release_: the archive is extracted over the
  running directory, so every file in it is written and every file not in it is left alone, and
  nothing on that machine ever runs a build. They stay publicly fetchable at their
  content-hashed URLs, which is how copy that was taken down went on being served.
  [Deployment](/docs/deployment) now gives the two spellings that replace the directory.

## 1.7.5 — 2026-08-23

Two bugs that shipped to every deployed app, a package promoted to `stable`, and
the gates that would have caught both.

### Changed

- **`@zerotal/arch` is `stable`.** Reviewed ahead of its 1.9.0 date. The API follows
  SemVer strictly from here, and that promise covers the **MCP tool contract** — tool
  names, their arguments, and the shape of what they return. That is what an agent
  client is configured against, and nothing type-level can see it: `archTools` has the
  same signature however the tools are named. `mcp-surface.md` records all nine and CI
  diffs it on every change. The protocol revision the server speaks is not covered; it
  follows the protocol.

- **INTERNAL — the writers behind `arch:install` are no longer public API.**
  `detectAgents`, `applyMcpConfig`, `applyBlock`, `buildGuidelines` and the rest are
  `@internal`: still exported, still working, no longer promised. Their only caller is
  the install command, and freezing them would have committed the shape of `.mcp.json`
  writing to the rest of the 1.x line on behalf of a caller who never arrived.

- **INTERNAL — `api-surface.md` honours `@internal` across every package.** The
  contract has always read "anything importable without an `@internal` marker keeps its
  shape", and the generator did not read the tag — so symbols already marked internal
  were recorded as though promised. 374 entries across 13 packages are omitted now,
  every one verified marked. Nothing changes at runtime or in the types; the file
  listing the promises now lists the promises.

- **A modal locks the page behind it.** `<Modal>` and `<Drawer>` trapped focus
  correctly while the page underneath kept scrolling, which on a phone reads as the
  dialog having broken the page.

- **Flow marks the active nav link for everyone.** `<Link navigate>` set
  `data-current`, which styles a link, and nothing that announces it. It sets
  `aria-current="page"` alongside now, so a screen reader can tell which of thirty nav
  items is the current page.

### Fixed

- **Assets were cache-busted in development and not in production.** `asset()` appended
  `?v=` only when a dev version was set, so every deployed Zerotal app served the
  previous build's JavaScript and CSS to anyone with a warm cache — indefinitely, since
  the URL never changed. The version is now derived from the built files themselves, so
  it is stable across restarts and moves when the files do.

- **DevTools mounted on production pages.** The provider is gated on the environment, so
  the endpoints are absent outside development — and the client took that to mean it
  could start anyway, pinning a floating panel to the page whose tabs read
  `Could not read the map — HTTP 404`. It now mounts only when the server half says it
  is there, via a `<meta>` the middleware writes, and makes no request at all on a
  public hostname.

- **Browser tests drove an unstyled site.** `Router.static("/", public)` is registered
  only for the `web` environment, and a test app is not one — so every `FlowBrowser`
  suite served pages without their stylesheet. Invisible to assertions that read text;
  fatal for anything measuring layout.

### Documented

- **Every TypeScript example in the documentation is compiled against the real
  packages**, on every pull request. 1,593 blocks. The gate found examples importing
  symbols that do not exist (`currentUser`, `Layout` from the wrong package), calling
  methods that were renamed (`Cache.put`), and configuring fields with `env()` where the
  type is a literal union. Blocks deliberately written as fragments say so in their
  fence and are recorded by key, so a new one is a deliberate act rather than a silent
  exemption.

- **A break cannot ship without a release note.** `api:surface:check` demands a
  regenerated snapshot when an export changes and then goes quiet, so the changelog was
  defended by remembering — and 1.7.3 shipped the removal of Flow's `this.title(…)` with
  no BREAKING entry. That entry is now in 1.7.3's notes, the support policy counts three
  breaks rather than two, and `breaking:check` reads the snapshot diff so the next one
  cannot pass silently.

- **A maturity label falls due.** The review release for a package below `stable` lives
  in its `package.json` as `maturityReview`, and the package-conventions gate fails once
  the version reaches it.

## 1.7.4 — 2026-08-21

A debug panel that was reaching production, a column type MySQL would not index, and
2,060 icons.

### Fixed

- **DevTools no longer appears on a production page.** The provider is gated on the
  environment, so in production its routes are absent — and the browser client took that as
  permission to start anyway and "connect to nothing". It did not: it mounted the panel first
  and discovered the absence afterwards, so an app calling `DevTools.start()` unconditionally
  served a floating DevTools bar to every visitor, its tabs reading
  `Could not read the map — HTTP 404`.

  `start()` now probes for the routes and builds nothing unless they answer — no shell, no
  shadow root, no `EventSource`, no listeners. Any failure (404, offline, CSP) is read as
  absent. **If your app calls `DevTools.start()`, take this release.**

- **A string column could not carry an index on MySQL.** `table.string()` compiled to `TEXT`
  on every engine and discarded its `length`, and MySQL refuses to key a TEXT column without
  a prefix length — so `table.string("email").unique()` failed at `CREATE TABLE`. MySQL now
  gets `VARCHAR(length)`; SQLite and PostgreSQL keep `TEXT`. `char()` had the same bug and the
  same fix. Found by the new MySQL suite on its first run against a real server.

### Added

- **`<Icon name="inbox" />` — 2,060 icons, bundled, typed by name.** The set ships inside
  `@zerotal/flow-ui`, so there is nothing to install and no generator to run: a fresh app gets
  autocomplete over every name and a compile error on a typo. Rendered on the server as inline
  SVG, so there is no icon font, no sprite, no request per glyph, and nothing for a strict CSP
  to block. Four icons are drawn for sign-in flows the set has no name for — `passkey`,
  `two-factor`, `otp`, `magic-link` — and three brand marks ship for the social-login providers
  `@zerotal/auth` supports. See [Icons](/docs/flow/icons).

- **The ORM suite runs against MySQL 8 in CI, and the job blocks merges.** The same smoke
  suite that covers PostgreSQL — schema DDL and `ALTER`, identity columns, CRUD, type
  round-trips, unique and NOT NULL enforcement, row locks, transaction rollback. MySQL moves
  from _experimental_ to _supported, hardening_; see the
  [Support Policy](/docs/support-policy).

### Changed

- **The starters link by route name.** Every hard-coded `href="/about"` in the React and Vue
  templates now goes through `route()`, and the templates ship the generated route table so a
  freshly scaffolded app type-checks before its first `zt dev`.

### Documented

- **The HTTP client guide is one page.** Eight pages became one, written from where the
  package is used — your app calling somebody else's service — with straight URLs instead of
  a route map threaded through every example. See [HTTP Client](/docs/client).

- **`route()` in Inertia**, for links and for form submissions, including the one thing Inertia
  adds: a page renders in two processes, so `defineRoutes()` has to run in the SSR entry too.
  See [Building URLs](/docs/inertia/rendering#building-urls-with-route).

- **Every package changelog has the release headings it was missing.** `[Unreleased]` had
  accumulated four releases of shipped work — `@zerotal/flow-ui`'s newest heading read
  `[1.5.0]` while 1.7.3 was on npm. Cutting a release now moves them.

## 1.7.3 — 2026-08-20

Two fields that accepted input and threw it away, a CI job that was testing nothing, and a
name given back to applications.

### Changed

- **BREAKING — `this.title(…)` is removed from Flow components.** Declare `static title`
  instead, as a string or a function of the component:

  ```ts fragment
  // Before
  override async mount(): Promise<void> {
    this.title(`Search: ${this.query}`);
  }

  // After
  static title = (c: SearchPage) => (c.query ? `Search: ${c.query}` : "Search");
  ```

  The instance method held a name four separate components wanted for their own data — a
  media row, a guide, a review, an issue — for a one-line accessor that belongs on the class.
  The static form is also the better one: it is resolved on the server for every render and
  every patch, so a title that depends on state follows it without an action remembering to
  update it.

  A call to `this.title(…)` on a component that declares its own `title` field now sets that
  field instead of the document title, which is silent. Search your components for
  `this.title(` before upgrading; every hit is either a migration or was already shadowed.

### Fixed

- **A boolean column could not hold a boolean on PostgreSQL.** `table.boolean()` compiled to
  `INTEGER` on every engine — right for SQLite, which has no boolean type, and rejected by
  PostgreSQL, which has a real one:

  ```text
  column "active" is of type integer but expression is of type boolean   (42804)
  ```

  Every insert of `true` failed, and so did every `where("active", true)`. The storage type
  now comes from the dialect, as the auto-increment column already did. SQLite and MySQL are
  unchanged — MySQL's `BOOLEAN` is a synonym for `TINYINT(1)` and `INTEGER` takes 0/1 either
  way, so there was nothing broken there to fix.

  **Existing PostgreSQL tables keep their integer columns.** New tables get `BOOLEAN`; a table
  already created needs an `ALTER` if you want the column converted:

  ```sql
  ALTER TABLE posts ALTER COLUMN active TYPE boolean USING active <> 0;
  ```

- **A bound password field discarded every keystroke.** Flow's client-writable set was
  `fillable` minus `hidden`, which conflates two allow-lists answering different questions:
  `fillable` governs what may be _written_, `hidden` governs what may be _shown_. A password
  is in both, so subtracting made it unwritable — `<input type="password"
value={this.user.password} blur />` accepted typing and dropped it on arrival.

  `hidden` is no longer subtracted. It is still never sent: the stored hash does not leave the
  server and the field arrives empty. A hidden value **the client supplied** survives until
  save; one **the server produced** is never echoed back, and a half-typed one is stripped
  from the durable snapshot before it is persisted.

### Changed

- **The PostgreSQL CI job blocks merges.** It had been running the ORM suite beside a Postgres
  container without connecting to it, so it reported success without testing anything. A smoke
  suite now exercises schema DDL, identity columns, CRUD, type round-trips, row locks and
  transaction rollback against a real PostgreSQL 16, and a failure fails the build. The
  boolean defect above is what it found on its first real run.

### Documented

- **Flow pages take their model from the route, not from a query.** The docs opened every
  model example by fetching the record in `onMount()`, which predates a route being able to
  hand a component the record. `models.md` leads with the bound form; `lifecycle.md` no longer
  presents the old id-plus-`onHydrate`-re-query as the correct pattern. The old shape still
  works — it is simply two fields and a query doing what one field now does.

## 1.7.2 — 2026-08-18

Realtime that works without being wired up, and three ways a socket could go quiet without
saying so.

### Changed

- **BREAKING — Flow's `@on` broadcast listeners use a `socket:` prefix.** `echo:`,
  `echo-private:` and `echo-presence:` are now `socket:`, `socket-private:` and
  `socket-presence:`; the browser global is `window.Socket`, not `window.Echo`. There is no
  alias — an unrenamed listener never matches, and never subscribes.

  ```diff
  - @on("echo-private:issues.5,CommentPosted")
  + @on("socket-private:issues.5,CommentPosted")
  ```

  Shipped in a patch release deliberately, on the judgement that the old prefix has no
  meaningful use in the wild. If you are on it, the upgrade is a find-and-replace of `echo:`
  → `socket:` in your `@on` listeners and `window.Echo` → `window.Socket` in any client code.

### Added

- **Flow bundles the socket client into its runtime.** A page that declares a `socket:`
  listener is live with no script of your own. Flow apps own no bundle entry, so the contract
  used to be "publish `window.Socket` yourself" — and when you didn't, the listeners were
  _silently inert_: no error, no warning, no subscription, so a live feature with no script
  looked exactly like a live feature that was never written. An app that needs a configured
  client still assigns `window.Socket` before the runtime loads and that one is used as-is; a
  page with no listeners opens no connection at all.

### Fixed

- **A patch no longer writes back into a file input.** A file input's `value` belongs to the
  user agent, and assigning anything but `""` throws `InvalidStateError`. The write was legal
  while the bound property was empty and threw on the very patch carrying an upload's result
  — and the throw escaped the frame handler, so the DOM never updated _and_ the action's ack
  never resolved. Since frames are chained per component, every later action queued behind a
  promise that would never settle: the page rendered correctly and ignored every click for
  the rest of its life.

- **WebSocket connections get an explicit 120s `idleTimeout`.** Bun closes an idle socket
  after 10 seconds; the client pings every 30. A connection that was merely quiet got cut
  before it had reason to speak, taking its channel subscriptions with it — so anyone who had
  been reading a page for more than ten seconds silently stopped receiving broadcasts.

## 1.7.0 — 2026-08-16

The agent surface, a DevTools panel that shows the framework and not just the last request,
and the repayment of four things the 1.x line had promised without delivering.

### Added

- **`@zerotal/arch` — an MCP server that hands a coding agent the framework's own truth.**
  Not a documentation search over prose about an API: `api_surface` returns the exact
  TypeScript signature of every export, read from the version installed in your project and
  diffed by CI on every change. Alongside it, `search_docs` over the documentation that
  shipped with that same version, `routes` and `schema` read from the live router and the
  models' own metadata, `logs`/`last_error` from the app's structured trail, `baselines`, and
  `doctor` — the one an agent is meant to finish a task with, because every finding carries
  its fix.

  ```bash
  bun add -d @zerotal/arch
  bun zt arch:install          # writes .mcp.json, AGENTS.md, and a CLAUDE.md shim
  ```

  Re-running is safe: every generated region is marker-fenced, so `arch:update` on your next
  upgrade replaces what it wrote and leaves anything you added around it alone. Ships `beta`.
  See [Agent Surface](/docs/arch).

- **DevTools grew an App section.** Every surface until now read the request stream — what one
  request did. Six new tabs behind a **Requests | App** switch answer what the app _is_:
  routes, resolved config with secrets masked, container bindings and which provider bound
  each, provider boot cost, event listeners, and console commands with scheduled tasks. Every
  location in the panel is now a link into your editor.

- **Security headers cover static files.** Files under `public/` are handed to Bun as
  pre-registered responses and served without entering JavaScript, so no middleware ever ran
  for them — every asset went out with no `X-Content-Type-Options: nosniff`, the response
  class sniffing protection exists for. The header set is baked into the compiled response, so
  Bun still serves the file natively.

- **`zt doctor --url` reports security headers sent twice.** A header your app sets and your
  proxy also sets is invisible from inside the process. Conflicting values fail the check —
  browsers do not agree which copy applies, so the control is enforced inconsistently —
  and identical duplicates warn.

- **`DeepPartial<T>`**, exported from the kernel. `deepMerge` does a deep merge and its
  parameter said `Partial<T>`, which only makes the top level optional — so overriding one
  field of a nested config block was a type error against a merge that handles it perfectly.

### Fixed

- **Migrations are now actually transactional.** The runner wrapped each `up()` in a
  transaction and the docblock promised all-or-nothing, but the wrapper governed nothing:
  `Schema` resolved the _global_ connection, so a migration's DDL ran on a pooled connection
  and committed independently. On PostgreSQL, a migration failing on its third statement left
  the first two behind and the `ROLLBACK` had nothing to undo. DDL now joins the enclosing
  transaction, the tracking-table row is written inside it, and rollback carries the same
  guarantee. MySQL has no transactional DDL, so the runner no longer opens one there and
  `zt migrate` says so before it starts. See
  [Migrations → What happens when a migration fails](/docs/migrations#what-happens-when-a-migration-fails).

- **`BaseMiddleware.with()` type-checks its options.** Its options type was inferred from the
  object literal it was handed rather than from the middleware class, so the literal was
  checked against itself: every callback parameter arrived implicitly `any`, and a misspelled
  option was accepted in silence.

- **SPA navigation no longer leaks the outgoing page's state script.** The swap removed the
  first `flow-state-*` element in document order, which on any page with a child island was
  the island's, not the page's. The orphans accumulated one per navigation for as long as the
  tab stayed open.

### Changed

- **DDL issued inside `DB.transaction()` now joins that transaction.** Previously
  `Schema.create()` and friends resolved the global connection and committed separately. This
  is the fix above, and it applies to any code — not only migrations — that issues DDL inside
  a transaction.

- **`Component._skipMount` is gone** (`@internal`). It was written by `hydrate()` and read by
  nothing; mount-skipping is structural, and `$refresh`/`$mount` deliberately re-mount a
  hydrated page, so honouring the flag would have broken both. `hooks.test.ts` pins the real
  guarantee — mount runs exactly once per session.

## 1.6.3 — 2026-08-15

Two guards against the same failure: an upgrade sitting on disk while something older keeps
running, with nothing on screen to say so.

### Added

- **`serve --dev` reports a framework upgrade it has not picked up.** A running dev server
  holds the code it imported at boot, so `bun add zerotal@latest` in another terminal changes
  `node_modules` and nothing else — a save restarts only the worker, against the same
  in-memory framework. The upgrade therefore appears to do nothing. The supervisor now names
  both versions and says to restart, and the dev banner carries the version it is running:
  `Zerotal v1.6.3 › dev`.

- **`create-zerotal` says when it is not the published scaffolder.** `bun create zerotal` can
  serve a copy cached from an earlier run, and a stale scaffolder stamps the dependency ranges
  _it_ shipped with — so a brand-new project is created against versions that are no longer
  current, while the install log shows today's framework resolving inside those ranges. It now
  checks the registry and names the fix: `bunx create-zerotal@latest <name>`. Advisory only —
  offline, firewalled and slow all mean "no answer", and no answer never stops anyone creating
  an app.

## 1.6.2 — 2026-08-15

### Fixed

- **`serve --dev` now stops its worker on Windows instead of killing it.** Restarting sent
  `SIGTERM`, which Windows has no way to deliver — there the call terminates the process
  where it stands, so on every save no provider drained, no open response was finished and
  no database handle was closed. The supervisor asks over an IPC channel now and only kills
  if that goes unanswered. Nothing changes on macOS or Linux beyond the mechanism.

- **The devtools panel no longer fills the console with network errors.** Its event stream
  was abandoned on shutdown rather than closed, leaving the browser with a truncated
  response and a `net::ERR_INCOMPLETE_CHUNKED_ENCODING` for every reload. The stream is
  closed properly now, and a heartbeat keeps an idle one from being dropped with nothing
  written for either end to notice by.

## 1.6.1 — 2026-08-15

### Fixed

- **The Inertia DevTools panel said the app was not in dev mode**, and suggested starting a
  Vite dev server — advice that cannot be followed in a Zerotal app. The cause was real
  though: the Inertia adapter turns its client-side hooks on from a `dev` option that
  defaults to `import.meta.env.DEV`, a Vite convention that Bun's bundler leaves alone, so
  it survived into the bundle and evaluated to `false` on every build.

  Zerotal now defines `import.meta.env` — `DEV`, `PROD` and `MODE` — for every bundled
  browser build. Nothing to configure and no `dev` option to pass by hand; rebuild and the
  panel works. See [Inertia DevTools](/docs/inertia/devtools).

### Changed

- **New React and Vue apps scaffold Inertia 3.** The panel's client half — visit options,
  prefetch-cache entries, and the grouping that tells a poll apart from a navigation — exists
  only in the version 3 adapters, and neither template needed a single edit to build against
  it. Existing apps are unaffected; `bun add @inertiajs/react@^3` (or `@inertiajs/vue3@^3`)
  is the whole upgrade if you want the client half.

## 1.6.0 — 2026-08-15

### Added

- **`route()` works in the browser.** The typed helper now has a twin at `zerotal/routes`.
  Hand it the table `bun zt route:types` already generates, once, at your entry point, and
  `route("posts.show", { slug })` works in a component exactly as it does in a controller.
  `hasRoute(name)` answers the conditional-link question without a try/catch.

  The two are one implementation, not two that agree today: param encoding, catch-all
  handling and every error message live in a shared builder, and only the table lookup
  differs — the live router on the server, the generated map in the browser. A parity test
  asserts they emit byte-identical URLs and identical error text. See
  [Routing](/docs/routing).

- **`$route()` in Flow's Alpine expressions** — `<a :href="$route('posts.show', { slug })">`,
  with nothing to install. Inertia apps import their table; `/__flow/runtime.js` is built by
  the framework rather than your app, so the runtime handler serialises the table onto the
  bundle it serves instead. Same builder as the server, so a link written in an Alpine
  expression and one written in JSX cannot disagree about encoding.

- **Inertia DevTools.** A server-side recorder for the Inertia DevTools browser extension:
  requests, resolved props, and which wrapper produced each one. Off unless the process
  already exposes dev surfaces — the same gate as the stack-trace error page — and an app
  that enables it without saying who may read it gets a 403 rather than an open endpoint.
  Redaction runs before storage, so a withheld value is never written down. See
  [Inertia DevTools](/docs/inertia/devtools).

### Fixed

- **Ten more places asked `APP_ENV` a question it cannot answer**, found by auditing every
  reader rather than waiting for the next report. `APP_ENV` holds the runtime mode once the
  app has booted, so a check comparing it against a deployment name was asking whether
  `"web"` is production. The consequences were real:

  - **auto-`synchronize` was never hard-off in production** — the only thing between a
    production database and boot-time schema sync was the config default;
  - **the Flow client bundle was never minified in production**, shipping ~183 KB
    unminified to every visitor;
  - **`forceState()`** did not refuse to run on live data;
  - **environment-scoped scheduled tasks never ran** — `.environments(["production"])`
    matched nothing, silently;
  - the admin environment badge showed `web` on every screen, so the one mistake it exists
    to prevent — editing production believing it is staging — was exactly what it could not
    prevent.

  All read the deployment name now, and every one still fails closed. Reading `APP_ENV`
  directly is a lint error from this release, because fourteen instances of one mistake
  across seven packages were each found separately.

- **`useOnce()` no longer demands a cast.** Registering middleware from a provider required
  `useOnce(Middleware as never)` in all eight packages that do it — a cast the framework was
  asking for. Twelve of them are gone, and the casting-debt baseline came down with them.

## 1.5.1 — 2026-08-15

### Fixed

- **Development surfaces were switching themselves off.** A scaffolded app with
  `APP_ENV=development` in its `.env` got **production error pages** from `bun zt serve`, and
  **DevTools never appeared at all** — in any app, in any mode. The admin panel's development
  bypass and the monitor's open-by-default access were dead for the same reason.

  All of them asked `APP_ENV` whether this was a development environment, but `setAppEnv()`
  replaces that variable with the runtime mode (`web`, `console`, `worker`) before the app is
  created — so the question being asked was whether `"web"` is development. They read the
  preserved deployment name now. Production and staging are unaffected: every one of these
  gates still fails closed, and an unset environment still fails closed.

  If you upgrade and suddenly see the DevTools panel, that is the fix, not a new feature.

## 1.5.0 — 2026-08-15

The largest release of the 1.x line: a new package, three features, a batch of
production-hardening work that came out of a real deployment, and the last of the
packages reaching `stable`. Of the 26 published packages, **25 are `stable` and one
is `experimental`** (`@zerotal/ai`); none is `beta`.

### Added

- **`bun zt deploy:<env>` — a release that refuses to finish when something is wrong.**
  Four phases, ordered so that **everything that can refuse runs before anything that
  mutates**: preflight (is this really that environment, would this config refuse a
  production boot, does `zt doctor` pass), build, migrate, verify. It exits non-zero and
  does not restart your service — systemd or your container runtime owns that, and this
  gives it a gate to restart behind. Every environment gets its own command;
  `production` and `staging` exist without configuration, and `config/deploy.ts` declares
  more. The target name is checked against the deployment the process was started as, so
  `deploy:production` on a staging box stops before it migrates the wrong database.
  `--dry-run`, `--skip-migrations` and `--probe` are there. See
  [Deployment](/docs/deployment).
- **`zt doctor` checks CORS and HSTS.** `app.cors.origin: "*"` lets any site read your
  responses out of a visitor's browser; `app.secureHeaders.secure` gates HSTS and
  defaults to off. Both now fail on a production-like deployment.
- **`@zerotal/ai` — a typed agent loop, shipping `experimental`.** One loop shared by every
  driver, so switching models is a config change rather than a rewrite. A `pause_turn` is
  resumed rather than mistaken for an answer; a refusal is a typed outcome checked before
  anything reads the content; schema translation decides what a provider can express instead
  of hoping. Named agent runs take a refreshable lock, spend ceilings and prompt redaction are
  first-class, and `AiFake` makes the whole thing testable without a network. It ships
  `experimental` deliberately — the surface is expected to move inside 1.x, and the
  [support policy](/docs/support-policy) says what that means. See [AI](/docs/ai).
- **Typed route names — `bun zt route:types`.** The command boots the app, reads the routes it
  actually registered, and writes `types/routes.generated.ts`. With it, `route("psots.show")` is
  a compile error and `route("posts.show", {})` names the `slug` it wants. Params come from the
  pattern, so adding a segment updates every call site. It boots rather than scanning `routes/`
  because a route name comes from three places and only one of them is a file path. See
  [Routing](/docs/routing).
- **Typed Inertia pages.** `Inertia.render(component, props)` is checked against the page
  component's own props, and the prop wrappers (`defer`, `optional`, `always`) are generic, so a
  renamed or retyped prop fails at the render call rather than in the browser. See
  [Inertia](/docs/inertia).
- **The development error page can say what to do, not just what broke.** `no such table: assets`
  is exact about the failure and useless about the cause — every frame in its stack sits inside
  the SQL driver. `registerErrorDiagnoser()` lets the package that owns an error contribute a
  diagnosis above the stack; `@zerotal/orm` registers the first one, turning a missing table into
  the list of migrations that have not run, with a button to run them. See [Errors](/docs/errors).
- **`bun zt dev` — the server and every companion process in one terminal**, with the Deck, a
  tabbed dev UI that adds no dependency. The queue worker runs as its own tab. A service provider
  contributes its own checks through `doctorChecks()`. See [Devtools](/docs/devtools).
- **Flow: `<ErrorBoundary>`, `stream`, `<SectionContent>` / `<SectionOutlet>`, and `<Virtualize>`.**
  A failing child now costs that child rather than the page; a slow child no longer holds up the
  shell; a page can fill a region its layout owns; and a collection too large for the DOM gets a
  scrolling window over it. `@zerotal/flow/browser` drives a real browser against a running app,
  and a compiled-versus-runtime parity suite keeps the two renderers honest. See
  [Flow](/docs/flow).
- **ORM: `migrate:refresh`, and `--seed` on `migrate` / `migrate:fresh`.** See
  [Migrations](/docs/migrations).
- **Queue: debounced jobs.** `debounce` on a `Job` collapses repeated dispatches into one run.
  See [Queue](/docs/queue).
- **Scheduler: durable run history**, so the monitor panel survives a restart. See
  [Scheduler](/docs/scheduler).
- **Media: `allowEnlargement` on a conversion, and `@zerotal/media/testing`.** `ImageDriver` is
  frozen, with its growth rule written down. See [Media](/docs/media).

### Changed

Most of this section is one body of work: the response to a Flow field report, hardening the path
from a local machine to a deployed box.

- **`app.allowedOrigins` is declared config and defaults to the origin of `app.url`.** The
  common deployment no longer needs to configure it at all, and the setting is visible where the
  rest of the app's URL configuration lives rather than being implied.
- **`bun zt doctor --url=…` probes a deployed transport from the outside.** It reports what each
  transport path actually answers over the wire, which is the question a failing WebSocket
  upgrade in production actually raises. `Application.declareWebSocketPath()` / `webSocketPaths()`
  let a package declare its own path so the probe covers it, and Flow declares `/__flow/ws` at
  registration. See [Deployment](/docs/deployment).
- **`serve` no longer rebuilds assets at boot in production**, and Flow no longer rebuilds its
  CSS/JS bundles at boot, when the output directory is read-only. A read-only tree is normal for
  a container image, and building at boot turned it into a crash. `bun zt assets:build` is the
  explicit build step to run before deploying. See [Assets](/docs/assets).
- **The Flow client says which transport failure it hit** rather than failing the same way for
  every cause, and `data-flow-connection` is stamped on a page that connected normally — so
  "is it live?" is answerable from the DOM.
- **`route()` takes query values as a third argument** — `route(name, params, query)` — and
  `route.dynamic(name, params?, query?)` covers a name that is not known at compile time.
- **`ctx.user` is typed as `UserModel`**, the same interface `Auth.user()` returns.
- **`SessionContract.get` and `pull` take an optional `<T>`.**
- **`withoutOverlapping`'s cross-process lock defaults to 5 minutes, not 24 hours.** A worker
  killed mid-run used to block its own schedule for the rest of the day.
- **`app/commands/` is auto-discovered**, and boot warns about a `routes/` directory nothing
  routes.
- **Thirteen packages reached `stable`** — `admin`, `audit`, `broadcasting`, `devtools`, `flow`,
  `flow-ui`, `i18n`, `inertia`, `media`, `monitor`, `notifications`, `telemetry` and `tenancy`
  — each after documenting its remaining exports and marking its plumbing `@internal`. The
  component reference now documents all 53 `flow-ui` components and cannot drift again.

### Fixed

- **Flow: a decorator could be registered against the wrong component.** Field decorators cannot
  see their own class, so each registration is buffered and matched to a class afterwards — and
  the match searched one flat buffer by field name. A component that declares a field and is never
  rendered leaves its entry there for the life of the process, so an unrelated component with a
  field of the same name could claim it and never receive its own. It showed up as `@reactive`
  silently failing to register, which remounts the child on every parent-pushed change rather than
  updating it in place. Matching is now per declaring class, and on the fields a class declares
  rather than everything on an instance.
- **Flow: a keyless child in a list was identified by its position.** Reordering a list without
  keys reused the wrong DOM node, so state attached to a row followed the position rather than
  the row.
- **Flow: a client expression that writes an `@expose` prop now syncs to the server.**
- **ORM: a `Date` in a query-builder write was silently discarded.**
- **ORM: altering a Postgres column silently dropped its `NOT NULL` and `DEFAULT`**, and SQLite
  now refuses an impossible `dropColumn` before applying anything rather than partway through.
- **ORM: the N+1 detector reads the bindings, not just the SQL text**, so it stops missing
  queries that differ only in their parameters.
- **Cache: stampede protection survives a compute slower than 30 seconds.**
- **Media: `fit: "cover"` works on the default driver**, `fit: "inside"` returns the dimensions
  it promised, and `fit: "fill"` with a single dimension behaves as `inside`. Both shipped
  drivers are held to one parity suite.
- **`serve --dev` built a Flow app's bundles three times on every start**, and dev asset builds
  are now skipped when nothing changed.
- **A weak `APP_KEY` never refused a production boot**, and **N+1 detection ran in
  production**. Both asked `Bun.env.APP_ENV` whether this was production — but that
  variable holds the runtime mode (`web`, `console`, `worker`) by the time anything
  reads it, so both always got "no". The deployment name is now preserved and read
  back through `deployEnv()`.
- **`staging` was production for some things and not others** — config validation
  refused an insecure staging boot, while assets went out unminified and were rebuilt
  at boot, which is exactly the combination that restart-loops on a hardened unit.
- **`app.secureHeaders` only allowed `frameOptions` to be configured**, so there was
  no supported way to turn HSTS on. Every option the middleware reads is now typed.
- **`setAppEnv("dev")` resolved to `console` rather than `web`.**

## 1.4.0 — 2026-08-10

### Added

- **ORM: encrypted columns.** A column can hold ciphertext at rest and plaintext on the model,
  keyed by `APP_KEY` with AES-256-GCM — `@column("encrypted") idNumber?: string`, or
  `static encryptable = ["idNumber", "passportNumber"]` for several at once. Unlike `hashable`
  this is reversible and does not touch the instance, so the property still reads as plaintext
  after `save()`. `where()` on an encrypted column throws rather than matching nothing (a fresh
  IV per write means the ciphertext never repeats), and a value the key cannot open fails the
  read rather than arriving somewhere as ciphertext. See [Casts & Mutators](/docs/orm/casts).
- **Auth: `TwoFactor.getQrCodeSvg()`** renders the two-factor enrolment QR code as an inline
  `<svg>`, drawn in-process. The `otpauth://` URI carries the TOTP secret, so the previous advice
  — hand it to a QR image service — posted the second factor to a third party. `encodeQr()` and
  `qrSvg()` are exported for drawing the symbol yourself. See [Roles & 2FA](/docs/roles-and-2fa).
- **Flow: `preserveScroll`** on `<Link>` and `navigateCurrent()`, for a sort header, filter or tab
  strip partway down a page that should not jump to the top.

### Fixed

- **Flow: `flow:navigate` did not scroll.** The SPA swap replaced the page under a stationary
  viewport, so following a link from near the bottom of a long list landed you halfway down the
  next page — which reads as the page having failed to load. A navigation now goes to the top (or
  to the URL's fragment), and Back and Forward restore where you were.
- **Flow: `focusOnError` did nothing on a runtime-rendered page.** The JSX runtime rewrote the
  hyphen in `flow:focus-error` to a dot, so the attribute never matched the selector the client
  looks for. It worked on a compiled page and silently did not on one the compiler bailed out of.
  `sortGroupId` was affected the same way.
- **Docs: two column examples named the wrong TypeScript type.** `@column("date")` hydrates a
  native `Date`, not a `Carbon`, and `decimal:N` surfaces as a `string` — the ORM overview typed
  both the other way, which `tsc` cannot catch because the decorator does not constrain the
  property type.

## 1.3.0 — 2026-08-09

### Changed — BREAKING

- **Mixin composition is now a static on the base class.** `ComponentWith(...)` and
  `BaseModelWith(...)` are removed; write `Component.using(Pagination)` and
  `Model.using(Authenticatable, Roles)` instead. A codemod ships in the repository
  (`scripts/codemod-mixin-composition.ts`) that rewrites call sites and imports. How mixins are
  _authored_ is unchanged. `using` also composes onto intermediate bases
  (`AdminPage.using(Pagination)`) and chains (`.using(a).using(b)`), neither of which the old
  helpers could express.
- **`Model` is the canonical ORM base-class name.** `BaseModel` remains exported as an alias for
  the same class, so existing code keeps working; docs and scaffolding now say
  `class User extends Model`.

### Added

- **`@zerotal/media`** — attach files to models with `Model.using(Media)`: collections with
  acceptance rules and retention, image conversions on `Bun.Image` (or `sharp`), responsive
  `srcset()` ladders with inline placeholders, queued conversion jobs, `MediaFake` test
  assertions, and `media:clean` / `media:regenerate` commands. See [Media Library](/docs/media).

### Fixed

- **Flow: an `@expose`d action on a shared page base could vanish from the action allowlist**
  (and be fatally rejected at runtime) whenever a subclass declared a decorated field — a Bun
  1.3.x decorator defect, worked around in the framework. `@expose`, `@task`, `@renderless`,
  `@on` and `@computed` were all affected.

## 1.1.0 — 2026-08-08

### Changed

- `FlowTest.call()` rethrows action errors and `FlowTest.set()` re-renders, so tests fail on
  broken actions instead of passing silently. A handler pointing at an un-`@expose`d method is
  now a build error (fatal at boot in CSP-safe mode).
- `@column("text")` maps to a real `TEXT` type rather than `VARCHAR` — affects newly generated
  tables and migrations only.

### Fixed

- Radio-group binding, reactive sibling attributes suppressing `value` bindings, modifier click
  handlers, `request().ip()` inside actions, a data-corrupting `json` cast on numeric-looking
  strings, and an unparseable `make:model` stub.

## 1.0.4 — 2026-08-07

- Fixed the Flow starter rendering unstyled (stylesheet path mismatch) and its missing favicon.

## 1.0.3 — 2026-08-06

- Re-released so npm build provenance resolves against the renamed repository.

## 1.0.2 and earlier — 2026-08-06

- First published versions of Zerotal.

## Next steps

- [Upgrade Guide](/docs/upgrade) — apply the migration notes for a new release.
- [Contributing](/docs/contributing) — how changes land before they reach this list.
