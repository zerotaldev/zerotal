/**
 * `transient` puts a judgement where the knowledge is.
 *
 * A service that calls a model per row has to latch itself off after a permanent
 * failure, or a laptop with no API key pays the driver's timeout per row, per
 * merchant, per page load — 8s × 12 merchants is ninety seconds of blank page.
 *
 * Writing that latch by hand means classifying eleven error classes, and the mistake
 * is unrecoverable in one direction: call something permanent that is not, and the
 * feature disables itself for the life of the process, silently, because every call
 * site already treats "no answer" as normal. An app classified `AiSchemaError` as
 * permanent and would have turned two features off on their first badly-shaped reply.
 *
 * These tests are that table, written down.
 */
import { describe, it, expect } from "bun:test";
import {
  AiAgentLimitError,
  AiCancelledError,
  AiConfigError,
  AiDriverUnavailableError,
  AiRateLimitError,
  AiRefusedError,
  AiRequestError,
  AiSchemaError,
  AiSpendLimitError,
  UnknownAiDriverError,
} from "./errors.ts";

describe("permanent — this machine cannot do this", () => {
  it("a driver name that does not exist", () => {
    expect(new UnknownAiDriverError("nope", ["anthropic"]).transient).toBe(false);
  });

  it("a configuration problem", () => {
    expect(new AiConfigError("no api key").transient).toBe(false);
  });

  it("a driver whose package is not installed", () => {
    // The case the whole distinction exists for.
    expect(new AiDriverUnavailableError("ollama", "ollama").transient).toBe(false);
  });

  it("a 4xx from the provider, which repeating will not fix", () => {
    expect(new AiRequestError("bad key", 401).transient).toBe(false);
    expect(new AiRequestError("no such model", 404).transient).toBe(false);
  });
});

describe("transient — this call failed", () => {
  it("a rate limit, which names when to come back", () => {
    expect(new AiRateLimitError("slow down", 30).transient).toBe(true);
  });

  it("a spend ceiling, which resets on its window", () => {
    expect(new AiSpendLimitError("over budget").transient).toBe(true);
  });

  it("a badly-shaped answer, because sampling is not deterministic", () => {
    // The one an app got wrong, in the direction that disables a feature forever.
    expect(new AiSchemaError("bad shape").transient).toBe(true);
  });

  it("a refusal, which is about this content and not this machine", () => {
    expect(new AiRefusedError("cyber", null).transient).toBe(true);
  });

  it("an agent hitting its own step ceiling", () => {
    expect(new AiAgentLimitError("too many steps").transient).toBe(true);
  });

  it("a cancellation, where nothing is wrong at all", () => {
    expect(new AiCancelledError("aborted").transient).toBe(true);
  });

  it("a 5xx, 408 or 429 from the provider", () => {
    expect(new AiRequestError("upstream", 500).transient).toBe(true);
    expect(new AiRequestError("upstream", 503).transient).toBe(true);
    expect(new AiRequestError("timeout", 408).transient).toBe(true);
    expect(new AiRequestError("throttled", 429).transient).toBe(true);
  });
});

describe("the latch a caller writes with it", () => {
  it("is one condition, and reads the way the decision does", () => {
    let disabled = false;
    const handle = (error: unknown): void => {
      if (error instanceof Error && "transient" in error && error.transient === false) {
        disabled = true;
      }
    };

    handle(new AiSchemaError("bad shape"));
    expect(disabled).toBe(false); // one bad answer must not disable the feature

    handle(new AiDriverUnavailableError("ollama", "ollama"));
    expect(disabled).toBe(true); // no model on this machine — stop paying the timeout
  });
});
