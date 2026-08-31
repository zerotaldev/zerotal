import { describe, it, expect } from "bun:test";
import { AnthropicDriver } from "./AnthropicDriver.ts";
import { AiRefusedError } from "../errors.ts";
import type {
  AnthropicConstructor,
  AnthropicMessage,
  AnthropicMessagesApi,
} from "./anthropic-sdk.ts";
import type { AnthropicConfigShape } from "../types.ts";

/**
 * The details this driver gets wrong quietly.
 *
 * Every case here is something that either fails *every* request (a rejected
 * sampling parameter) or fails in a way that looks like success (a refusal
 * arriving as HTTP 200 with no content). None of them are visible in a test that
 * only asserts "we got some text back".
 */

const BASE: AnthropicConfigShape = {
  apiKey: "test",
  model: "claude-opus-5",
  maxTokens: 16000,
  streamMaxTokens: 64000,
  effort: "high",
  fallbacks: true,
  cacheSystem: true,
  timeout: 600_000,
};

class FakeApiError extends Error {}
const FAKE_CTOR = { APIError: FakeApiError } as unknown as AnthropicConstructor;

function reply(overrides: Partial<AnthropicMessage> = {}): AnthropicMessage {
  return {
    model: "claude-opus-5",
    content: [{ type: "text", text: "ok" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 1, output_tokens: 1 },
    ...overrides,
  };
}

/** A driver over a scripted client, plus the bodies it sent and where it sent them. */
function harness(
  config: Partial<AnthropicConfigShape> = {},
  message: AnthropicMessage = reply(),
): {
  driver: AnthropicDriver;
  requests: Array<Record<string, unknown>>;
  namespaces: string[];
} {
  const requests: Array<Record<string, unknown>> = [];
  const namespaces: string[] = [];

  const api = (namespace: string): AnthropicMessagesApi => ({
    create: async (params) => {
      namespaces.push(namespace);
      requests.push(params);
      return message;
    },
    stream: (params) => {
      namespaces.push(namespace);
      requests.push(params);
      const text = String(
        (message.content.find((b) => b.type === "text") as { text?: string } | undefined)?.text ??
          "",
      );
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "content_block_delta", delta: { type: "text_delta", text } };
        },
        finalMessage: async () => message,
      };
    },
    countTokens: async (params) => {
      namespaces.push(namespace);
      requests.push(params);
      return { input_tokens: 123 };
    },
  });

  const driver = new AnthropicDriver(
    { ...BASE, ...config },
    {
      ctor: FAKE_CTOR,
      client: { messages: api("stable"), beta: { messages: api("beta") } },
    },
  );

  return { driver, requests, namespaces };
}

describe("AnthropicDriver — request shape", () => {
  it("sends adaptive thinking and the configured effort", async () => {
    const { driver, requests } = harness();
    await driver.text({ prompt: "hi" });

    // `display` joined this in 1.11.2: without it the API omits thinking text on
    // every current model, so the documented `thinking` stream chunk fired forever
    // with text: "".
    expect(requests[0]!["thinking"]).toEqual({ type: "adaptive", display: "summarized" });
    expect(requests[0]!["output_config"]).toEqual({ effort: "high" });
  });

  it("never sends temperature, which current models reject with a 400", async () => {
    const { driver, requests } = harness();
    await driver.text({ prompt: "hi", temperature: 0.2 });

    expect(requests[0]).not.toHaveProperty("temperature");
    expect(requests[0]).not.toHaveProperty("top_p");
    expect(requests[0]).not.toHaveProperty("top_k");
  });

  it("uses the streaming token ceiling only when streaming", async () => {
    const { driver, requests } = harness();

    await driver.text({ prompt: "hi" });
    expect(requests[0]!["max_tokens"]).toBe(16000);

    for await (const _chunk of driver.stream({ prompt: "hi" })) {
      /* drain */
    }
    expect(requests[1]!["max_tokens"]).toBe(64000);
  });

  it("opts into the server-side fallback through the beta namespace", async () => {
    const { driver, requests, namespaces } = harness();
    await driver.text({ prompt: "hi" });

    expect(requests[0]!["fallbacks"]).toBe("default");
    expect(requests[0]!["betas"]).toEqual(["server-side-fallback-2026-07-01"]);
    expect(namespaces[0]).toBe("beta");
  });

  it("uses the stable namespace and sends no beta keys when fallbacks are off", async () => {
    const { driver, requests, namespaces } = harness({ fallbacks: false });
    await driver.text({ prompt: "hi" });

    expect(requests[0]).not.toHaveProperty("fallbacks");
    expect(requests[0]).not.toHaveProperty("betas");
    expect(namespaces[0]).toBe("stable");
  });

  it("marks a long system prompt cacheable", async () => {
    const { driver, requests } = harness();
    await driver.text({ prompt: "hi", system: "x".repeat(5000) });

    expect(requests[0]!["system"]).toEqual([
      { type: "text", text: "x".repeat(5000), cache_control: { type: "ephemeral" } },
    ]);
  });

  it("leaves a short system prompt as a plain string — a breakpoint below the minimum never pays", async () => {
    const { driver, requests } = harness();
    await driver.text({ prompt: "hi", system: "Be terse." });

    expect(requests[0]!["system"]).toBe("Be terse.");
  });

  it("lets providerOptions override anything this surface models", async () => {
    const { driver, requests } = harness();
    await driver.text({
      prompt: "hi",
      providerOptions: { anthropic: { thinking: { type: "adaptive", display: "summarized" } } },
    });

    expect(requests[0]!["thinking"]).toEqual({ type: "adaptive", display: "summarized" });
  });

  it("drops the response ceiling and beta keys when counting tokens", async () => {
    const { driver, requests } = harness();
    const count = await driver.countTokens({ prompt: "hi" });

    expect(count).toBe(123);
    expect(requests[0]).not.toHaveProperty("max_tokens");
    expect(requests[0]).not.toHaveProperty("output_config");
    expect(requests[0]).not.toHaveProperty("fallbacks");
  });

  it("replays an assistant turn verbatim rather than rebuilding it from text", async () => {
    const { driver, requests } = harness();
    const blocks = [
      { type: "thinking", thinking: "" },
      { type: "text", text: "earlier answer" },
    ];

    await driver.text({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "earlier answer", raw: blocks },
        { role: "user", content: "second" },
      ],
    });

    const sent = requests[0]!["messages"] as Array<{ role: string; content: unknown }>;
    // The thinking block survives — rebuilt from `content` it would be gone, and
    // the provider rejects a turn whose blocks it does not recognise.
    expect(sent[1]!.content).toEqual(blocks);
  });
});

describe("AnthropicDriver — refusals", () => {
  const refusal = reply({
    content: [],
    stop_reason: "refusal",
    stop_details: { type: "refusal", category: "cyber", explanation: "Declined." },
  });

  it("raises a typed error instead of crashing on empty content", async () => {
    const { driver } = harness({}, refusal);

    // The HTTP call succeeded — the failure is entirely in `stop_reason`, which
    // is why reading content[0] first is the bug this guards.
    await expect(driver.text({ prompt: "x" })).rejects.toThrow(AiRefusedError);
  });

  it("carries the provider's category and explanation", async () => {
    const { driver } = harness({}, refusal);

    try {
      await driver.text({ prompt: "x" });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(AiRefusedError);
      expect((error as AiRefusedError).category).toBe("cyber");
      expect((error as AiRefusedError).explanation).toBe("Declined.");
    }
  });

  it("keeps the partial text when the refusal arrives mid-stream", async () => {
    const partial = reply({
      content: [{ type: "text", text: "Here is how you " }],
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber" },
    });
    const { driver } = harness({}, partial);

    const seen: string[] = [];
    try {
      for await (const chunk of driver.stream({ prompt: "x" })) {
        if (chunk.type === "text") seen.push(chunk.text);
      }
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(AiRefusedError);
      // The caller already received real tokens; the error says so, so they can
      // discard a partial answer knowingly instead of shipping a truncated one.
      expect((error as AiRefusedError).partialText).toBe("Here is how you ");
      expect(seen.join("")).toBe("Here is how you ");
    }
  });

  it("refuses on the object() path too", async () => {
    const { driver } = harness({}, refusal);
    await expect(driver.object({ prompt: "x" }, {} as never)).rejects.toThrow(AiRefusedError);
  });
});

describe("AnthropicDriver — the optional SDK", () => {
  it("names the package to install when it is missing", async () => {
    // No injected client, so the driver tries the real dynamic import. The SDK is
    // an optional peer and this repo does not install it — which is the case.
    const driver = new AnthropicDriver(BASE);
    await expect(driver.text({ prompt: "x" })).rejects.toThrow(/bun add @anthropic-ai\/sdk/);
  });
});

describe("AnthropicDriver — model-aware request shape", () => {
  it("sends effort and adaptive thinking to a current model", async () => {
    const { driver, requests } = harness({ model: "claude-opus-5" });
    await driver.text({ prompt: "hi" });

    expect(requests[0]!["output_config"]).toEqual({ effort: "high" });
    expect(requests[0]!["thinking"]).toEqual({ type: "adaptive", display: "summarized" });
  });

  it("sends neither to a 4.5 model, which 400s on both", async () => {
    // The package priced claude-haiku-4-5 while the driver could not call it.
    const { driver, requests } = harness({ model: "claude-haiku-4-5" });
    await driver.text({ prompt: "hi" });

    expect(requests[0]).not.toHaveProperty("output_config");
    // Not omitted — the shape that model actually takes.
    expect(requests[0]!["thinking"]).toEqual({ type: "enabled", budget_tokens: 8000 });
  });

  it("drops thinking entirely when the ceiling cannot hold a legal budget", async () => {
    const { driver, requests } = harness({ model: "claude-haiku-4-5", maxTokens: 512 });
    await driver.text({ prompt: "hi" });

    // Better no thinking than a budget the API rejects outright.
    expect(requests[0]).not.toHaveProperty("thinking");
  });

  it("sets display so the thinking stream is not empty forever", async () => {
    // The API omits thinking text by default on current models, so the documented
    // `thinking` chunk fired with text: "" and no error.
    const { driver, requests } = harness({ model: "claude-sonnet-5" });
    await driver.text({ prompt: "hi" });

    expect((requests[0]!["thinking"] as Record<string, unknown>)["display"]).toBe("summarized");
  });

  it("honours an explicit thinkingDisplay of omitted", async () => {
    const { driver, requests } = harness({ model: "claude-sonnet-5", thinkingDisplay: "omitted" });
    await driver.text({ prompt: "hi" });

    expect((requests[0]!["thinking"] as Record<string, unknown>)["display"]).toBe("omitted");
  });

  it("keeps a temperature the model accepts", async () => {
    const { driver, requests } = harness({ model: "claude-haiku-4-5" });
    await driver.text({ prompt: "hi", temperature: 0.5 });

    // The old regex dropped this and then advised `effort`, which 400s here.
    expect(requests[0]!["temperature"]).toBe(0.5);
  });
});

describe("AnthropicDriver — temperature actually reaches the wire", () => {
  it("sends the configured default on a model that accepts sampling", async () => {
    const { driver, requests } = harness({ model: "claude-sonnet-4-6", temperature: 0.3 });
    await driver.text({ prompt: "hi" });

    expect(requests[0]!["temperature"]).toBe(0.3);
  });

  it("lets the request override the configured default", async () => {
    const { driver, requests } = harness({ model: "claude-sonnet-4-6", temperature: 0.3 });
    await driver.text({ prompt: "hi", temperature: 0.9 });

    expect(requests[0]!["temperature"]).toBe(0.9);
  });

  it("still drops it on a model that rejects it", async () => {
    const { driver, requests } = harness({ model: "claude-opus-5" });
    await driver.text({ prompt: "hi", temperature: 0.5 });

    expect(requests[0]).not.toHaveProperty("temperature");
  });

  it("sends nothing when neither config nor request sets one", async () => {
    const { driver, requests } = harness({ model: "claude-sonnet-4-6" });
    await driver.text({ prompt: "hi" });

    expect(requests[0]).not.toHaveProperty("temperature");
  });
});
