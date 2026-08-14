# @zerotal/ai

> Text, streaming, structured output, typed tools, and an agent loop — behind one provider-agnostic facade.

One way to talk to a language model: `Ai.text()` for a completion, `Ai.stream()` for tokens as they arrive, `Ai.object()` for a value that satisfies a validator schema, and `Ai.agent()` for a loop that calls your tools until the model is done. The provider is chosen in `config/ai.ts`, not at each call site.

Part of the [Zerotal](../../README.md) framework. Requires **Bun ≥ 1.3.14**.

**Maturity: `experimental`** — the API may change in a minor release.

## Installation

```bash
bun add @zerotal/ai
```

Provider SDKs are optional peers, imported lazily. Install only the one you use:

```bash
bun add @anthropic-ai/sdk    # only for the anthropic driver
```

The OpenAI and Ollama drivers use `fetch` directly and need nothing extra.

## Setup

Register the provider in `bootstrap/providers.ts`:

```ts
import { AiProvider } from "@zerotal/ai";
```

Then configure it:

```ts
// config/ai.ts
import { AiConfig } from "@zerotal/ai";

export default AiConfig({
  default: "anthropic",
  drivers: {
    anthropic: { apiKey: Bun.env["ANTHROPIC_API_KEY"] ?? "" },
  },
  limits: { perRequestUsd: 0.5, perDayUsd: 25 },
});
```

## Usage

```ts
import { Ai, tool } from "@zerotal/ai";

// A completion.
const summary = await Ai.text(`Summarize in one sentence:\n\n${article}`);

// Tokens as they arrive, cancellable.
for await (const chunk of Ai.stream({ prompt, signal })) {
  if (chunk.type === "text") process.stdout.write(chunk.text);
}

// A value that satisfies a validator schema — the same schema you use for forms.
const review = await Ai.object({ prompt }, (rule) => ({
  sentiment: rule.string().in(["positive", "neutral", "negative"]),
  score: rule.number().min(1).max(5),
}));

// A tool-calling loop, exclusive for the work it names.
const lookupOrder = tool({
  name: "lookup_order",
  description: "Fetch one order by id. Call this whenever the user mentions an order number.",
  input: (rule) => ({ id: rule.string() }),
  handle: async ({ id }) => await Order.find(id),
});

const result = await Ai.agent({
  prompt: "Where is order 4821?",
  tools: [lookupOrder],
  lock: "order:4821",
});
```

## Testing

```ts
import { AiFake } from "@zerotal/ai";

const ai = AiFake.install();
ai.respondWith("A one-sentence summary.");

await service.summarize(article);

ai.assertPrompted(/Summarize/);
ai.restore();
```

No API key, no network. The suite for this package passes with neither.

## Commands

| Command               | What it does                                             |
| --------------------- | -------------------------------------------------------- |
| `zt ai:test [driver]` | Reach the provider once and print the **resolved model** |
| `zt ai:spend`         | This process's token spend today, by model               |

## Documentation

Full documentation: [zerotal.dev/docs/ai](https://zerotal.dev/docs/ai).

## License

MIT
