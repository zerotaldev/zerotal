# Changelog — @zerotal/ai

All notable changes to this package are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/); this package
follows the Zerotal monorepo's unified versioning.

**Maturity: `experimental`**

## [Unreleased]

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
