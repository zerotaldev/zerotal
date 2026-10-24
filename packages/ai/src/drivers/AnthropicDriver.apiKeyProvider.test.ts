import { describe, it, expect } from "bun:test";
import { AnthropicDriver } from "./AnthropicDriver.ts";
import { AiConfig } from "../config.ts";
import { AiConfigError } from "../errors.ts";
import type {
  AnthropicClient,
  AnthropicConstructor,
  AnthropicMessage,
  AnthropicMessagesApi,
} from "./anthropic-sdk.ts";
import type { AnthropicConfigShape } from "../types.ts";

/**
 * An operator can enter the API key on a screen while the app runs. The driver built its SDK
 * client once, with the key it had at construction, so a changed key meant building a new
 * manager and replacing the container binding. `apiKeyProvider` is asked on every request
 * instead.
 */
const BASE: AnthropicConfigShape = {
  apiKey: "key-at-boot",
  model: "claude-opus-5",
  maxTokens: 16000,
  streamMaxTokens: 64000,
  effort: "high",
  thinkingDisplay: "summarized",
  fallbacks: true,
  cacheSystem: true,
  timeout: 600_000,
};

const REPLY: AnthropicMessage = {
  model: "claude-opus-5",
  content: [{ type: "text", text: "ok" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};

/** A constructor that remembers the key each client was built with, and which one answered. */
function sdk() {
  const built: string[] = [];
  const answeredBy: string[] = [];

  class FakeClient {
    constructor(readonly apiKey: string) {}
    messages: AnthropicMessagesApi = {
      create: async () => {
        answeredBy.push(this.apiKey);
        return REPLY;
      },
      stream: () => {
        throw new Error("not used");
      },
    } as AnthropicMessagesApi;
    beta = { messages: this.messages };
  }

  class FakeCtor {
    static APIError = class extends Error {};
    constructor(options: { apiKey: string }) {
      built.push(options.apiKey);
      return new FakeClient(options.apiKey) as unknown as FakeCtor;
    }
  }

  const ctor = FakeCtor as unknown as AnthropicConstructor;
  const first = new FakeClient("key-at-boot") as unknown as AnthropicClient;
  return { ctor, first, built, answeredBy };
}

describe("apiKeyProvider", () => {
  it("is asked on every request, and a changed answer becomes the key that is used", async () => {
    const { ctor, first, built, answeredBy } = sdk();
    let current = "key-one";
    const driver = new AnthropicDriver(
      { ...BASE, apiKeyProvider: () => current },
      { ctor, client: first },
    );

    await driver.text({ prompt: "a" });
    current = "key-two";
    await driver.text({ prompt: "b" });

    expect(answeredBy).toEqual(["key-one", "key-two"]);
    expect(built).toEqual(["key-one", "key-two"]);
  });

  it("does not rebuild the client while the key stays the same", async () => {
    const { ctor, first, built } = sdk();
    const driver = new AnthropicDriver(
      { ...BASE, apiKeyProvider: async () => "steady" },
      { ctor, client: first },
    );

    await driver.text({ prompt: "a" });
    await driver.text({ prompt: "b" });
    await driver.text({ prompt: "c" });

    expect(built).toEqual(["steady"]);
  });

  it("wins over apiKey when both are given", async () => {
    const { ctor, first, answeredBy } = sdk();
    const driver = new AnthropicDriver(
      { ...BASE, apiKey: "static", apiKeyProvider: () => "dynamic" },
      { ctor, client: first },
    );

    await driver.text({ prompt: "a" });

    expect(answeredBy).toEqual(["dynamic"]);
  });

  it("refuses to send a request with no key, and says why", async () => {
    const { ctor, first } = sdk();
    const driver = new AnthropicDriver(
      { ...BASE, apiKeyProvider: () => "" },
      { ctor, client: first },
    );

    await expect(driver.text({ prompt: "a" })).rejects.toBeInstanceOf(AiConfigError);
    await expect(driver.text({ prompt: "a" })).rejects.toThrow(
      "apiKeyProvider returned an empty key",
    );
  });

  it("leaves a driver without a provider exactly as it was", async () => {
    const { ctor, first, built, answeredBy } = sdk();
    const driver = new AnthropicDriver(BASE, { ctor, client: first });

    await driver.text({ prompt: "a" });

    expect(answeredBy).toEqual(["key-at-boot"]);
    expect(built).toEqual([]);
  });
});

describe("AiConfig and apiKeyProvider", () => {
  it("accepts a driver with a provider and no apiKey", () => {
    expect(() =>
      AiConfig({ drivers: { anthropic: { apiKeyProvider: () => "k" } } } as never),
    ).not.toThrow();
  });

  it("still refuses a driver with neither, naming both ways to fix it", () => {
    expect(() => AiConfig({ drivers: { anthropic: {} } } as never)).toThrow(/apiKeyProvider/);
  });

  it("carries the provider through to the resolved config", () => {
    const provider = () => "k";

    const config = AiConfig({ drivers: { anthropic: { apiKeyProvider: provider } } } as never);

    expect(config.drivers.anthropic!.apiKeyProvider).toBe(provider);
  });
});
