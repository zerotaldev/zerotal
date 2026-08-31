# Changelog — @zerotal/ai

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `experimental`**

## [Unreleased]

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
