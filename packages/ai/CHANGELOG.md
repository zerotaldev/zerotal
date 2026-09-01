# Changelog — @zerotal/ai

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `stable`**

## [Unreleased]

## [1.14.1] — 2026-09-01

### Added

- **Prompt-cache breakpoints on messages.** Caching reached exactly one place — the system
  prompt — so a long stable document in the message history could not be cached at all,
  which is the case caching is most worth having for. Mark the last message of a stable
  prefix with `cache: true` and everything up to it is cached.

  On the _last_ message, because a breakpoint caches everything before it: marking each
  message of a prefix spends four breakpoints describing one boundary. Anthropic allows
  four, and a fifth is refused by name here rather than surfacing as a provider 400 about a
  field the caller never wrote.

### Fixed

- **A 1-hour cache write is priced at 2x, not 1.25x.** `estimateCost` multiplied every
  write by the 5-minute rate, underestimating a 1-hour write by 37.5% — in the unsafe
  direction for a spend ceiling, since a limit that under-counts lets spend through rather
  than blocking it. `AiUsage.cacheWrite1hTokens` carries the split, read from the
  `cache_creation` breakdown Anthropic returns when a 1-hour cache was used.

  Optional on the type rather than required: a custom `AiDriver` constructs `AiUsage`, and
  making it required would have broken every one of them for an accounting detail their
  provider probably does not report.

## [1.11.2] — 2026-08-31

### Changed — **BREAKING**

- **`countTokens` returns `number | null`.** Only Anthropic has a counting endpoint, and
  `0` — the old value from the others — is also a real count for an empty prompt, so the
  return value could not distinguish "no tokens" from "cannot count". Callers need a
  `null` check; a custom driver returning `number` still satisfies the contract.

  This shipped in a patch and should have been a minor.

### Changed — **INTERNAL**

- **`toSchema`, `strippedConstraints`, `resetSpend` and `resetStats` are `@internal`.**
  Still exported, still working — no longer promised. This is the surface narrowing that
  had to precede the `stable` promotion, because narrowing after it is itself breaking.

### Changed

- **Promoted to `stable`.** The public API now follows the compatibility promise in
  [the support policy](https://zerotal.dev/docs/support-policy): anything importable
  without an `@internal` marker is covered.

  The precondition was met rather than waived. This package shipped `experimental`
  with a stated one — _it graduates in the release after its first real users_ — and
  its first production users sent a field review of the driver running against
  Anthropic. Five bugs came back with it, all fixed below. A `stable` promise about an
  API that nothing has pushed against is a promise nobody has tested.

  **The surface was narrowed first**, because narrowing after `stable` is itself a
  breaking change. `toSchema`, `strippedConstraints`, `resetSpend` and `resetStats` are
  `@internal` — still exported, so nothing breaks at runtime, but no longer promised.
  `translateSchema` stayed public despite having no caller outside this package, for
  the same reason `AiDriver` is public: the point of a driver contract is that someone
  else implements it, and implementing structured output means translating a schema.
  `AiDelivery` stayed too — it is the element type of `recentGenerations()`, and
  marking the return type of a public function internal would be the exact lie the
  review is meant to prevent.

  Then the two modules it would have been embarrassing to freeze untested: the SSE
  parser, which reads a remote provider's framing off the network, and prompt
  redaction, which is the only thing between a user's prompt and a log that outlives
  the request.

- **An app with no AI configured now boots.** `AiConfig` threw when no driver was
  declared, and threw again on an empty `apiKey`, so a deployment with no key could
  not express itself either way — one app declared an Ollama server it did not run
  purely to satisfy the validator, with a comment explaining that the config was lying.
  Declaring no driver is now legal and means AI is off; the first call raises
  `AiDriverUnavailableError`, whose `transient` is already `false`, so a caller that
  latches itself off on a permanent error gets the right behaviour for free. Declaring
  a driver still means you want it, so an incomplete one is still refused at boot.

- **`countTokens` returns `null` where a provider cannot count**, rather than `0`. Only
  Anthropic has a counting endpoint; `0` is also a real count for an empty prompt, so
  the old return value was a number you could divide by and budget against without ever
  being told it meant "unsupported".

### Fixed

- **Sonnet 5 was priced as Sonnet 4.6** — 3/15 instead of 2/10, 50% high. The same
  table feeds `limits.perRequestUsd` and `perDayUsd`, so a Sonnet 5 app was refused
  requests comfortably inside its budget and the daily ceiling tripped a third early.
  The error said "spend limit", which sends someone to their config rather than to the
  row that is wrong. `AiSpendLimitError` now quotes the rate it used and names
  `registerModelPrice()`, so a bad table is legible from the refusal and correctable
  without waiting for a release.

- **`effort` and `thinking` are model-aware.** Both were sent on every call. `effort`
  is a 400 on the 4.5 generation, and those models want an explicit thinking budget
  rather than `{ type: "adaptive" }` — so the package advertised `claude-haiku-4-5` in
  its pricing table while the driver could not successfully call it. `modelCapabilities()`
  now answers what a model takes, and the driver builds the request that model accepts.

  The table lists the models that _differ_ and treats anything unrecognised as current
  generation. An allowlist would need an edit every time a model ships and would treat
  each new one as legacy until that edit landed; the models that differ are a closed
  set that ages out.

- **`temperature` never reached the API, on any model.** The driver warned about
  dropping it and had no branch that set it, so `AiRequest.temperature` and the
  configured default were both inert everywhere — including on the 4.6 models, which
  accept it. The old sampling predicate hid this by warning for almost every model,
  which made the silence look deliberate on the few it did not warn for. Sampling
  parameters are now sent where the model takes them.

- **`modelRejectsSampling` was too broad**, reading as "every Claude model except 4.6",
  which is wrong for the 4.5 generation. It compounded with the above: on Haiku 4.5 the
  driver dropped a legal `temperature` and advised `effort` instead — the one parameter
  guaranteed to fail there. The advice is now only given where `effort` exists, in the
  driver and in `validateAiConfig` alike.

- **The streamed `thinking` chunk was always empty.** The API omits thinking text by
  default on the current generation, so a documented stream chunk fired forever with
  `text: ""` and no error — and a "thinking…" view built against the 4.6 models, where
  it defaulted to on, silently stopped working as users moved to 5.
  `drivers.anthropic.thinkingDisplay` defaults to `"summarized"`; set `"omitted"` for
  the API's own default. The thinking happens and is billed either way.

### Added

- **`modelCapabilities()` and `ModelCapabilities`** — what a model accepts: sampling,
  `effort`, and which of the three thinking shapes it takes.
- **`drivers.anthropic.thinkingDisplay`** — whether a streamed `thinking` chunk carries
  text.

## [1.11.0] — 2026-08-31

### Fixed

- **An empty string is an answer.** `required` treats `""` as absent, which is right
  for an HTML form — an empty text input submits `""` — and wrong for structured
  model output, where `""` is the conventional way to say _"this field does not
  apply"_ and is what a prompt naturally asks for. So `rule.string()` rejected the
  answer a prompt had requested, and the whole feature returned nothing: an app's
  questions mostly named no month, the model replied `""` in 3.3 seconds every time,
  and the page said "either no model is configured, or it was not about your money"
  while a model was configured and had answered.

  `""` now counts as present on a **string** field in the AI path only. Absence is
  still a failure, every other constraint still applies (a `min(3)` still rejects
  `""`), and a non-string field is untouched — `""` for a number is a malformed
  answer, not a convention.

- **`AiFake` validates what it is scripted with.** `respondWithObject()` handed the
  canned value back unexamined, so a fake answer the real driver would reject passed
  every test. An app scripted `{ month: "" }`, eleven tests passed on it, and the live
  path rejected the identical value every time — the feature shipped green and
  answered nothing. The permissive fake is what made the bug above invisible; they are
  the same defect from both ends.

  `AiFake.object()` now takes the schema `AiManager.object()` takes, and checks the
  scripted object through the same `recheckAgainstSchema` a driver uses. Omit the
  schema and nothing is checked, because there is nothing to check against.

### Added

- **`AiError.transient`** — `true` for _this call failed_, `false` for _this machine
  cannot do this_. A service calling a model per row has to latch itself off after a
  permanent failure, or a machine with no API key pays the driver's timeout per row,
  per merchant, per page load — 8s × 12 merchants is ninety seconds of blank page.

  Writing that latch meant classifying eleven error classes by hand, and the mistake
  is unrecoverable in one direction: call something permanent that is not, and the
  feature disables itself for the life of the process, silently, because every call
  site already treats "no answer" as normal. An app classified `AiSchemaError` as
  permanent and would have turned two features off on their first badly-shaped reply.
  **It is transient** — sampling is not deterministic. Only this package knows what a
  new error class means, so the judgement now lives here.

## [1.5.0] — 2026-08-15

### Added

- **The package.** `Ai.text()`, `Ai.stream()`, `Ai.object()`, `Ai.agent()`, and
  `Ai.embed()` behind one facade, with the provider chosen in `config/ai.ts`
  rather than at each call site. Three drivers ship: Anthropic (via the optional
  `@anthropic-ai/sdk` peer), OpenAI, and Ollama (both over plain `fetch`).

- **One agent loop, shared by every driver.** `AiDriver.agent()` is optional and
  none of the three implement it — they all run the same loop over `text()`. An
  abstraction whose second implementation reuses none of the first is not an
  abstraction, and the shared suite in `drivers.test.ts` runs the same
  assertions against all three so that stays true.

- **`pause_turn` is resumed, not mistaken for an answer.** A provider running a
  long server-side tool can end a turn with `stop_reason: "pause_turn"`, meaning
  "ask me again". It is neither an error nor a completion, so an unhandled one
  reads as a finished answer and the user sees a silently truncated response
  with no warning anywhere. The loop pushes the paused turn back and re-requests,
  capped by `agent.maxResumes`.

- **Refusals are typed, and checked before the content is read.** A declined
  request arrives as a **successful HTTP 200** with empty or partial content, so
  code that reads `content[0]` first crashes on a response the API considers
  fine. `AiRefusedError` carries the provider's category and, for a mid-stream
  decline, the partial text — so a caller can discard a truncated answer
  knowingly. Anthropic's server-side `fallbacks: "default"` is on by default.

- **Schema translation that decides, rather than hoping.** Structured output
  accepts a narrow JSON Schema subset — `additionalProperties: false` required on
  every object, no length or numeric bounds, no recursion — and rejects anything
  else at _request_ time. So `translateSchema()` strips what it cannot express
  and `recheckAgainstSchema()` re-applies it with the validator we already own;
  a recursive schema, which has no client-side rescue, is refused at definition
  time instead. `schema.test.ts` pins the exact output for every supported rule.

- **A refreshable lock on named agent runs.** `Ai.agent({ lock: "refund:4821" })`
  is exclusive for that name, refreshes for as long as the loop runs, and aborts
  the loop's signal if the lock is ever lost. Opt-in and named on purpose: a
  shared key would serialize every agent run in the app.

- **Spend ceilings, prompt redaction, and a monitor section.**
  `limits.perRequestUsd` is checked before the request is sent, from a real token
  count via the provider's own tokenizer — never `tiktoken`, which undercounts
  Claude by 15–20%. Prompts are redacted in logs and the monitor by default,
  because a prompt is user data and observability is where it would otherwise be
  durably kept. The monitor's **AI** section shows spend against the ceiling,
  tokens, latency percentiles per model, and the refusal rate.

- **`AiFake`** — `respondWith()`, `respondWithObject()`, `refuse()`, and
  `assertPrompted()` / `assertPromptCount()` / `assertSystemPrompted()`. The
  assertions are about what the application asked for, which is the part that can
  be wrong. The suite passes with no API key set.

- **Commands.** `zt ai:test [driver]` reaches the provider once and prints the
  resolved model; `zt ai:spend` reports this process's token spend by model.

### Notes

- `temperature` is accepted on the request surface but **dropped** by the
  Anthropic driver, because current Claude models reject it with a 400 and a
  parameter forwarded blindly would fail every request. `validateAiConfig()`
  warns when a configured model rejects it. Use `effort` instead.
- The daily spend ceiling is in-process: N workers hold N ceilings, and the
  figures are estimated from public list prices. It is a guard against a runaway
  loop, not a billing system.
