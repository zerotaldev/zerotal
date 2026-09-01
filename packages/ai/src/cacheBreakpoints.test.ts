/**
 * Prompt-cache breakpoints on messages, not only on the system block.
 *
 * Reported: caching reached exactly one place — the system prompt — so a long
 * stable document in the message history could not be cached at all, which is the
 * case caching is most worth having for.
 */
import { describe, it, expect } from "bun:test";
import { AnthropicDriver } from "./drivers/AnthropicDriver.ts";
import type {
  AnthropicConstructor,
  AnthropicMessage,
  AnthropicMessagesApi,
} from "./drivers/anthropic-sdk.ts";
import type { AnthropicConfigShape, AiMessage } from "./types.ts";
import { estimateCost } from "./pricing.ts";

const BASE: AnthropicConfigShape = {
  apiKey: "test",
  model: "claude-opus-5",
  maxTokens: 16000,
  streamMaxTokens: 64000,
  effort: "high",
  thinkingDisplay: "summarized",
  fallbacks: true,
  cacheSystem: true,
  timeout: 600_000,
};

const reply: AnthropicMessage = {
  model: "claude-opus-5",
  content: [{ type: "text", text: "ok" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};

/** Capture the request body the driver would send. */
function harness(): { driver: AnthropicDriver; sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  const api = (): AnthropicMessagesApi => ({
    create: async (params) => {
      sent.push(params);
      return reply;
    },
    stream: () => {
      throw new Error("not used");
    },
  });
  const driver = new AnthropicDriver(BASE, {
    ctor: { APIError: Error } as unknown as AnthropicConstructor,
    client: { messages: api(), beta: { messages: api() } },
  });
  return { driver, sent };
}

/** The blocks of one sent message. */
function blocksOf(sent: Record<string, unknown>, index: number): Array<Record<string, unknown>> {
  const messages = sent["messages"] as Array<{ content: unknown }>;
  const content = messages[index]!.content;
  return Array.isArray(content) ? (content as Array<Record<string, unknown>>) : [];
}

describe("cache breakpoints on messages", () => {
  it("marks a message the caller asked to cache", async () => {
    const { driver, sent } = harness();
    const messages: AiMessage[] = [
      { role: "user", content: "a very long stable document", cache: true },
      { role: "user", content: "the question, which changes every time" },
    ];

    await driver.text({ messages });

    expect(blocksOf(sent[0]!, 0)[0]).toMatchObject({
      type: "text",
      cache_control: { type: "ephemeral" },
    });
  });

  it("leaves unmarked messages as plain content", async () => {
    // A cache write costs more than an ordinary input token, so marking
    // everything is strictly worse than marking nothing.
    const { driver, sent } = harness();
    await driver.text({ messages: [{ role: "user", content: "hello" }] });

    const messages = sent[0]!["messages"] as Array<{ content: unknown }>;
    expect(messages[0]!.content).toBe("hello");
  });

  it("puts the marker on the LAST block of a multi-block turn", async () => {
    // A breakpoint caches everything up to and including where it sits, so
    // marking the first block would cache less than the caller asked for —
    // silently, and in the direction that pays for a write without the saving.
    const { driver, sent } = harness();
    await driver.text({
      messages: [
        {
          role: "assistant",
          content: "preamble",
          toolCalls: [{ id: "t1", name: "search", input: {} }],
          cache: true,
        },
      ],
    });

    const blocks = blocksOf(sent[0]!, 0);
    expect(blocks[0]).not.toHaveProperty("cache_control");
    expect(blocks[blocks.length - 1]).toHaveProperty("cache_control");
  });

  it("refuses more breakpoints than the provider allows", async () => {
    // A fifth marker is a provider error, so catching it here names which turns
    // asked rather than surfacing a 400 about a field the caller did not write.
    const { driver } = harness();
    const messages: AiMessage[] = Array.from({ length: 5 }, (_, i) => ({
      role: "user" as const,
      content: `doc ${i}`,
      cache: true,
    }));

    await expect(driver.text({ messages })).rejects.toThrow("cache breakpoints per request");
  });

  it("allows exactly four", async () => {
    const { driver, sent } = harness();
    const messages: AiMessage[] = Array.from({ length: 4 }, (_, i) => ({
      role: "user" as const,
      content: `doc ${i}`,
      cache: true,
    }));

    await driver.text({ messages });
    expect(sent).toHaveLength(1);
  });
});

describe("cache write pricing", () => {
  it("prices a 1-hour write at 2x and a 5-minute one at 1.25x", () => {
    // Sonnet 5: $2/M input. 1M of each write tier, priced separately.
    const fiveMinute = estimateCost("claude-sonnet-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 1_000_000,
    });
    const oneHour = estimateCost("claude-sonnet-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 1_000_000,
      cacheWrite1hTokens: 1_000_000,
    });

    expect(fiveMinute).toBeCloseTo(2.5, 6);
    expect(oneHour).toBeCloseTo(4.0, 6);
  });

  it("treats the 1-hour figure as part of the total, not extra", () => {
    // Half the write long-lived: 0.5M at 1.25x + 0.5M at 2x.
    const mixed = estimateCost("claude-sonnet-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 1_000_000,
      cacheWrite1hTokens: 500_000,
    });
    expect(mixed).toBeCloseTo(0.5 * 2.5 + 0.5 * 4.0, 6);
  });

  it("never returns a negative charge on an inconsistent report", () => {
    // A provider reporting more long-lived writes than total writes would
    // otherwise produce a credit, and an estimator that can go negative is one a
    // ceiling cannot trust.
    const odd = estimateCost("claude-sonnet-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 100,
      cacheWrite1hTokens: 1_000_000,
    });
    expect(odd).toBeGreaterThan(0);
  });
});
