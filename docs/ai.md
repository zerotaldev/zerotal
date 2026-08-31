---
title: AI
description: Text, streaming, structured output, typed tools, and an agent loop behind one provider-agnostic facade.
---

# AI

`@zerotal/ai` gives an application one way to talk to a language model: `Ai.text()`
for a completion, `Ai.stream()` for tokens as they arrive, `Ai.object()` for a value
that satisfies a validator schema, and `Ai.agent()` for a loop that calls your tools
until the model is done. The provider is chosen in `config/ai.ts`, not at each call
site, so moving from Claude to a local model is a config change.

::: warning Experimental
This package is `experimental`. Its API may change in a minor release — treat it as
a preview and pin the version if that matters to you.
:::

## Getting Started

```bash
bun add @zerotal/ai
```

The provider SDKs are **optional peers**, imported lazily. Install only the one you
use:

```bash
bun add @anthropic-ai/sdk    # only for the anthropic driver
```

The OpenAI and Ollama drivers use `fetch` directly and need nothing extra.

## Register the provider

```ts
// bootstrap/providers.ts
import { AiProvider } from "@zerotal/ai";

const providers = [
  // …your other providers
  AiProvider,
];

export default providers;
```

Registering the provider switches on the following:

- `onRegister` — binds an `AiManager` as a lazy singleton on the `"ai"` container key.
- `onBooted` — subscribes the observability bridges, contributes the monitor's **AI**
  section, and registers the `ai:test` and `ai:spend` commands.
- `onStopping` — unsubscribes the bridges.

With no `config/ai.ts` at all, the provider falls back to an Anthropic driver built
from `ANTHROPIC_API_KEY`. That is enough to try the package; everything below assumes
a real config file.

## Configuration

```ts
// config/ai.ts
import { AiConfig } from "@zerotal/ai";

export default AiConfig({
  default: "anthropic",

  drivers: {
    anthropic: {
      apiKey: Bun.env["ANTHROPIC_API_KEY"] ?? "",
      model: "claude-opus-5",
      effort: "high",
    },

    ollama: {
      model: "llama3.2",
      baseUrl: "http://127.0.0.1:11434",
    },
  },

  // Embeddings are their own block with their own driver — see below.
  embeddings: {
    default: "openai",
    drivers: {
      openai: { apiKey: Bun.env["OPENAI_API_KEY"] ?? "" },
    },
  },

  limits: { perRequestUsd: 0.5, perDayUsd: 25 },
});
```

Only the drivers you declare exist. An app that talks to Ollama alone declares no
`anthropic` block, installs no SDK, and needs no API key.

### Why embeddings are configured separately

Anthropic has no embeddings endpoint. If `embed()` hung off the generation driver,
the normal pairing — Claude for generation, something cheaper for vectors — could not
be expressed at all. So `embeddings` is its own block with its own `default`.

### Spend ceilings

`limits.perRequestUsd` is checked **before** the request is sent, from a real token
count, and bounds the blast radius of one runaway prompt.
`limits.perDayUsd` is checked from reported usage as it accumulates.

Both are process-scoped and estimated from public list prices. That is a real
limitation stated plainly: N workers hold N daily ceilings, and an account with
negotiated rates pays less than the estimate. They are a guard against a runaway
loop, not a billing system — the provider's dashboard remains the authority.

A model this package has no price for is never blocked, because a ceiling with
nothing to compare against should stand aside rather than refuse everything. Teach it
a price with `registerModelPrice()`.

## Generating text

```ts fragment
import { Ai } from "@zerotal/ai";

// Just the text.
const summary = await Ai.text(`Summarize in one sentence:\n\n${article}`);

// The text plus the accounting.
const response = await Ai.generate({
  prompt: "Explain event sourcing to a backend developer.",
  system: "You are terse. No preamble.",
  effort: "low",
});

response.text;
response.usage.outputTokens;
response.stopReason; // "end_turn" | "max_tokens" | "tool_use" | …
```

### Effort, not temperature

Current Claude models **reject** `temperature`, `top_p`, and `top_k` with a 400 — a
generic sampling parameter forwarded blindly fails every request. The Anthropic
driver drops `temperature` on those models and warns once.

**On models that accept it, it is sent.** The 4.6 and 4.5 generations take sampling
parameters perfectly well, and there the configured or per-request `temperature`
reaches the API. Ask `modelCapabilities(model)` if you want to know which you are on:

```ts
import { modelCapabilities } from "@zerotal/ai";

const caps = modelCapabilities("claude-haiku-4-5");
// { sampling: true, effort: false, thinking: "budget" }
```

That table is also what keeps the driver from sending a model something it rejects.
`effort` is a 400 on the 4.5 generation, and those models want an explicit thinking
budget rather than the adaptive form — so the driver builds a different request for
them rather than one request for everything. Models it does not recognise are treated
as current generation, because the ones that differ are a closed set that ages out
while new models keep arriving.

Reach for `effort` where the model has it. It trades thoroughness against cost and
latency:

| Effort   | Use it for                                               |
| -------- | -------------------------------------------------------- |
| `low`    | Classification, extraction, short latency-sensitive work |
| `medium` | A cost-conscious default                                 |
| `high`   | The default — most intelligence-sensitive work           |
| `xhigh`  | Hard coding and agentic tasks                            |
| `max`    | When correctness matters more than the bill              |

### The thinking stream

A streamed `thinking` chunk carries the model's reasoning as it happens. The API
**omits that text by default** on the current generation, so the driver asks for it:
`drivers.anthropic.thinkingDisplay` defaults to `"summarized"`.

Set it to `"omitted"` to get the API's own default back. The thinking happens — and is
billed — either way; the setting only decides whether you are shown it. Before 1.11.2
the driver never asked, so the documented `thinking` chunk fired forever with
`text: ""` and no error, and a "thinking…" view built against the 4.6 models stopped
working when their users moved to 5 without anything saying so.

### Streaming

```ts fragment
for await (const chunk of Ai.stream({ prompt, signal })) {
  if (chunk.type === "text") process.stdout.write(chunk.text);
  if (chunk.type === "done") console.log(chunk.response.usage);
}
```

The last chunk is always `{ type: "done" }` carrying the assembled response, so a
caller that only wants tokens can ignore it and one that needs usage does not have to
add up the pieces. Pass an `AbortSignal` and a cancelled caller actually stops the
generation. See [Flow](/docs/flow) for streaming straight into a component.

### Structured output

```ts fragment
const review = await Ai.object({ prompt: `Classify this review:\n\n${text}` }, (rule) => ({
  sentiment: rule.string().in(["positive", "neutral", "negative"]),
  summary: rule.string().max(140),
  score: rule.number().min(1).max(5),
}));

review.sentiment; // typed, validated
```

The schema is the same [validator](/docs/validator) schema you use for forms.

The JSON Schema subset these APIs accept is narrow: `additionalProperties: false` is
required on every object, and `minLength` / `maxLength` / `minimum` / `maximum` /
recursive schemas are **not supported**. So constraints the provider cannot express
are stripped from the schema it receives and **re-checked here** against the original
— `max(140)` is enforced by the validator on the way back in, and a violation raises
`AiSchemaError`. A recursive schema has no client-side rescue and is refused when the
schema is defined, not when the request is sent.

`strippedConstraints()` names exactly what the model will not see, if you want to
check that a load-bearing constraint is visible to it:

```ts fragment
strippedConstraints({ title: rule.string().min(3) }); // → ["title: min"]
```

## Tools and the agent loop

```ts fragment
import { Ai, tool } from "@zerotal/ai";

const lookupOrder = tool({
  name: "lookup_order",
  description:
    "Fetch one order by id. Call this whenever the user mentions an order number — " +
    "do not answer from the conversation alone.",
  input: (rule) => ({ id: rule.string() }),
  handle: async ({ id }) => await Order.find(id),
});

const result = await Ai.agent({
  prompt: "Where is order 4821?",
  tools: [lookupOrder],
});

result.text;
result.steps; // every call, its result, and how long it took
```

Say **when** to call a tool, not just what it does — the trigger condition is the half
that moves the call rate.

A handler that throws does not end the run: the error becomes an error-flagged result
the model can react to. A call to a tool that does not exist gets the same treatment,
naming the tools that do.

### Ceilings

Two, because a model deciding when to stop is not a termination proof:

- `agent.maxSteps` (default 25) caps tool-calling round trips.
- `agent.maxResumes` (default 5) caps `pause_turn` restarts.

`pause_turn` is worth knowing about. A provider running a long server-side tool can
end a turn with `stop_reason: "pause_turn"`, meaning "ask me again" — not an error and
not a completion. Left unhandled it reads as a finished answer, so the user sees a
silently truncated response with no warning anywhere. The loop pushes the paused turn
back and re-requests.

### Locking a run

```ts fragment
await Ai.agent({
  prompt: "Refund order 4821 if it shipped over 30 days ago.",
  tools: [lookupOrder, issueRefund],
  lock: "refund:4821",
});
```

Naming a run makes it exclusive **for that name** — two workers cannot refund the same
order, while unrelated runs proceed in parallel. A shared key would serialize every
agent run in the app, which is why the lock is opt-in and named rather than automatic.

The lock refreshes for as long as the loop runs, so `agent.lockTtl` (default 120s)
stops meaning "how long the job might take" — unanswerable — and becomes "how long
after a crash before another worker may take over". If the lock is ever lost the
loop's signal aborts, because at that point somebody else may be doing the same work.
See [Locking](/docs/lock) for the mechanism.

## Refusals

A provider's safety classifiers can decline a request. That arrives as a **successful
HTTP 200** with empty or partial content — so code that reads `content[0]` without
checking crashes on a response the API considers fine.

This package checks the stop reason first and raises a typed error:

```ts fragment
import { AiRefusedError } from "@zerotal/ai";

try {
  await Ai.text(prompt);
} catch (error) {
  if (error instanceof AiRefusedError) {
    error.category; // "cyber" | "bio" | … | null
    error.partialText; // whatever arrived before a mid-stream decline
  }
}
```

The Anthropic driver ships `fallbacks: "default"` on by default, which re-runs a
declined request on the provider's recommended fallback model server-side. Turn it off
with `drivers.anthropic.fallbacks: false`.

## Embeddings

```ts fragment
const { embeddings } = await Ai.embed(["first chunk", "second chunk"]);
```

One vector per input, in input order.

## Background generation

A queued generation is serialized, so its completion handler is registered by **name**
— a closure cannot survive the trip to a worker process:

```ts fragment
// in a service provider's onBooted(), so the worker registers it too
Ai.onGenerated("summarize-ticket", async (response, meta) => {
  await Ticket.query().where("id", meta.ticketId).update({ summary: response.text });
});

// anywhere
await Ai.queue({ prompt }, { handler: "summarize-ticket", meta: { ticketId } });
```

`tools` and `signal` are stripped at dispatch rather than silently arriving as
`undefined` — a queued generation is a one-shot completion, and `Ai.agent()` stays
in-process where its tools are.

## Testing

`AiFake` replaces the container binding and answers from a script. No API key, no
network, no flakiness:

```ts fragment
import { AiFake } from "@zerotal/ai";

const ai = AiFake.install();
ai.respondWith("A one-sentence summary.");

await service.summarize(article);

ai.assertPrompted(/Summarize/);
ai.assertPromptCount(1);

ai.restore(); // in afterEach
```

The assertions are about **what your application asked for** — the part you wrote and
the part that can be wrong. Whether the model's prose is good is not a unit test.

`ai.refuse()` makes the next call decline, which is worth exercising deliberately: a
refusal is an HTTP 200, so that handling path is the one most likely never to have run.

### An empty string is an answer

`required` treats `""` as absent, which is right for a form — an empty text input
submits `""`, and a user who typed nothing supplied nothing. It is **not** how
structured output works. There, `""` is the conventional way to say _"this field does
not apply"_, and it is what a prompt naturally asks for:

> A month must be YYYY-MM. Use an empty string when the question names no month.

So `rule.string()` accepts `""` on the AI path, and only there. Absence is still a
failure — the field has to be present — and every other constraint still applies:

```typescript fragment
// in a service
await Ai.object(prompt, (rule) => ({
  month: rule.string(), //          "" is an answer; missing is not
  category: rule.string().min(3), // "" fails min(3), because that is your rule
  score: rule.number(), //           "" is a malformed answer, not a convention
}));
```

That difference is worth knowing because the failure it caused was silent: an app's
questions mostly named no month, the model returned `""` in three seconds every time,
the answer was rejected as malformed, and the page said _"either no model is
configured, or it was not about your money"_ — while a model was configured and had
answered.

### `AiFake` checks what you script it with

Pass the same schema to the fake that production passes, and a canned object that the
real driver would reject fails the test instead:

```typescript fragment
// in a test
const ai = AiFake.install();
ai.respondWithObject({ month: "" });

// Validated against this schema, exactly as a driver would validate a real answer.
await service.answer("what did I spend");
```

This matters more than it sounds. A fake that returns whatever it is handed makes a
suite _less_ informative than no suite: eleven tests passed on a `{ month: "" }` the
live path rejected every time, so the feature shipped green and answered nothing. The
permissive fake is what made the schema bug invisible; they were the same defect from
both ends.

Omit the schema and nothing is checked, because there is nothing to check against.

### Deciding whether to give up: `transient`

Every `AiError` carries `transient` — `true` for _this call failed_, `false` for _this
machine cannot do this_:

```typescript fragment
// in a service
try {
  return await Ai.object(prompt, schema);
} catch (error) {
  if (error instanceof AiError && !error.transient) this.disabled = true;
  return null;
}
```

A service calling a model per row needs that latch, or a machine with no API key pays
the driver's timeout per row, per merchant, per page load — eight seconds times twelve
merchants is ninety seconds of blank page.

| Permanent — stop asking                     | Transient — try again                   |
| ------------------------------------------- | --------------------------------------- |
| `AiConfigError`, `AiDriverUnavailableError` | `AiRateLimitError`, `AiSpendLimitError` |
| `UnknownAiDriverError`                      | `AiSchemaError`, `AiRefusedError`       |
| `AiRequestError` with a 4xx                 | `AiRequestError` with 5xx, 408 or 429   |
|                                             | `AiAgentLimitError`, `AiCancelledError` |

**`AiSchemaError` is transient**, and that is the one worth checking your own code
against. Sampling is not deterministic, so a model that shaped one answer badly may
shape the next correctly — an app classified it as permanent and would have disabled
two features on their first imperfect reply. The permissive mistake in this direction
is unrecoverable, because every call site already treats "no answer" as normal, so a
feature that switches itself off never says so.

## Observability

Every generation emits `AiGenerated` on the framework event bus, and a decline also
emits `AiRefused`. With `@zerotal/monitor` installed, the **AI** section shows spend
against the daily ceiling, tokens in and out, cache reads, latency percentiles per
model, and the refusal rate.

**Prompts are redacted by default.** A prompt is user data, and the observability path
is the one place it would otherwise be durably kept — so what is recorded is a shape,
`[redacted 38 chars]`, not the text. Set `redact: false` to record a truncated preview
instead.

## Commands

| Command               | What it does                                             |
| --------------------- | -------------------------------------------------------- |
| `zt ai:test [driver]` | Reach the provider once and print the **resolved model** |
| `zt ai:spend`         | This process's token spend today, by model               |

`ai:test` exists because AI configuration fails in ways unit tests cannot reach: a key
with no access to the model, a model id that 404s because someone appended a date
suffix, a gateway that rewrites the base URL.

## Adding a provider

Implement `AiDriver` — `text`, `stream`, `object`, `countTokens`, `verify` — and
register it:

```ts fragment
// in a service provider's onBooted()
const ai = app.container.makeSync("ai");
ai.extend("bedrock", () => new BedrockDriver(config));
```

Nothing else is needed. Spend ceilings, redaction, telemetry, the lock, and the agent
loop all live above the driver, so a new provider is a translation layer and nothing
more. `agent()` is optional on the interface and none of the built-in three implement
it — they all run the same shared loop.

## Reference

Every exported name, grouped by the job it belongs to. The behaviour is in the
sections above; this is the index.

### Requests and responses

| Name                | Description                                                                    |
| ------------------- | ------------------------------------------------------------------------------ |
| `AiRequest`         | What every generation call takes. `prompt` and `messages` are interchangeable. |
| `AiResponse`        | A finished, non-streaming generation.                                          |
| `AiStreamChunk`     | One event from a streaming generation.                                         |
| `AiObjectResponse`  | A structured-output generation: the parsed value plus the usual accounting.    |
| `AiMessage`         | One turn of a conversation.                                                    |
| `AiRole`            | Who said it. Tool results ride inside a `user` turn, as the providers expect.  |
| `AiUsage`           | Token accounting for one request. Fields a provider does not report stay 0.    |
| `AiStopReason`      | Why generation stopped. `refusal` is a successful HTTP response, not an error. |
| `AiEffort`          | How hard the model should work before answering. Mapped per-driver.            |
| `AiProviderOptions` | Per-driver escape hatch, keyed by driver name and passed through untouched.    |
| `AiEmbedRequest`    | A vector embedding request.                                                    |
| `AiEmbedResponse`   | Embeddings, one vector per input, in input order.                              |

### Tools and the agent loop

| Name             | Description                                                                            |
| ---------------- | -------------------------------------------------------------------------------------- |
| `AiToolCall`     | A tool call the model asked for, lifted out of whatever block shape the provider used. |
| `AiToolResult`   | The answer to one `AiToolCall`.                                                        |
| `AiToolContext`  | What a tool handler is told about the turn that invoked it.                            |
| `AiToolCalled`   | Emitted once per tool call inside an agent run.                                        |
| `AiAgentRequest` | An agent run, plus the two things only the caller can decide.                          |
| `AgentOptions`   | What the agent loop needs from the caller, beyond the request itself.                  |
| `AiAgentResult`  | The result of running the agent loop to completion.                                    |
| `AiAgentStep`    | One tool call and its result within an agent run.                                      |

### Errors

| Name                       | Description                                                                 |
| -------------------------- | --------------------------------------------------------------------------- |
| `AiError`                  | Base class for all `@zerotal/ai` errors.                                    |
| `AiConfigError`            | Thrown at boot, or on first use, for a config combination that cannot work. |
| `AiRequestError`           | Thrown for any other non-2xx from the provider, carrying its status.        |
| `AiRateLimitError`         | Thrown when the provider rate-limits. The SDKs already retried.             |
| `AiSpendLimitError`        | Thrown when a request would breach a configured spend ceiling.              |
| `AiAgentLimitError`        | Thrown when the agent loop hits its step or resume ceiling.                 |
| `AiCancelledError`         | Thrown when the caller's `AbortSignal` fired before the call finished.      |
| `AiDriverUnavailableError` | Thrown when a driver's optional peer package is not installed.              |
| `UnknownAiDriverError`     | Thrown for a driver name the manager does not know.                         |

### Configuration

| Name                    | Description                                                                   |
| ----------------------- | ----------------------------------------------------------------------------- |
| `AiConfigInput`         | What `AiConfig()` accepts — every key optional, all the way down.             |
| `AiConfigFromEnv`       | The zero-config fallback: an Anthropic driver built from `ANTHROPIC_API_KEY`. |
| `AiLimitsConfigShape`   | Spend ceilings, enforced before the request leaves.                           |
| `AiAgentConfigShape`    | How the agent loop behaves.                                                   |
| `AnthropicConfigShape`  | Anthropic driver settings.                                                    |
| `OpenAiConfigShape`     | OpenAI driver settings.                                                       |
| `OllamaConfigShape`     | Ollama driver settings — a local server, so no key.                           |
| `EmbeddingsConfigShape` | Embeddings are their own block with their own driver.                         |

### Drivers and pricing

| Name                     | Description                                                                  |
| ------------------------ | ---------------------------------------------------------------------------- |
| `AnthropicDriver`        | The Anthropic driver.                                                        |
| `OpenAiDriver`           | The OpenAI driver — Chat Completions over `fetch`, no SDK.                   |
| `OllamaDriver`           | The Ollama driver — a local model server, so no API key and no billing.      |
| `EmbeddingsDriver`       | What an embeddings provider implements.                                      |
| `OpenAiEmbeddingsDriver` | OpenAI embeddings over `fetch`. No SDK, no dependency.                       |
| `OllamaEmbeddingsDriver` | Ollama embeddings — a local server, so no key and no per-token cost.         |
| `DriverStatus`           | What `zt ai:test` prints for one driver.                                     |
| `ModelPrice`             | USD per million tokens.                                                      |
| `modelPrice`             | The price for a model, or `undefined` when we have none.                     |
| `estimateCost`           | Estimated USD for one request's usage. Returns 0 for an unpriced model.      |
| `modelRejectsSampling`   | Whether a Claude model rejects `temperature` / `top_p` / `top_k` with a 400. |
| `modelCapabilities`      | What a model accepts: sampling, `effort`, and which thinking shape.          |
| `ModelCapabilities`      | The three answers `modelCapabilities` returns.                               |

### Spend and statistics

| Name                 | Description                                               |
| -------------------- | --------------------------------------------------------- |
| `spentToday`         | USD recorded so far today, in this process.               |
| `resetSpend`         | Reset the ledger. Tests, and the `ai:spend --reset` path. |
| `AiDelivery`         | One recorded generation.                                  |
| `modelStats`         | Per-model roll-up over everything still in the buffer.    |
| `ModelStat`          | Rolled-up figures for one model.                          |
| `recentGenerations`  | The most recent generations, newest first.                |
| `refusalRate`        | Share of recorded calls that the provider declined, 0–1.  |
| `resetStats`         | Reset the buffer. Tests.                                  |
| `CapturedGeneration` | One recorded call, as `AiFake` captures it.               |

### Queued generation

| Name             | Description                                  |
| ---------------- | -------------------------------------------- |
| `AiQueueOptions` | What `Ai.queue()` needs beyond the request.  |
| `AiQueueHandler` | What a queued generation's handler receives. |

### Structured-output schemas

| Name              | Description                                                                 |
| ----------------- | --------------------------------------------------------------------------- |
| `SchemaInput`     | Either shape callers have on hand: the builder map, or the raw definitions. |
| `toSchema`        | Normalise either input shape to raw definitions.                            |
| `translateSchema` | Translate a validator schema into the JSON Schema the providers accept.     |
