import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Application, currentApp } from "@zerotal/core";
import { AiManager } from "./AiManager.ts";
import { AiConfig } from "./config.ts";
import { installAiObservability } from "./observability.ts";
import {
  AiCancelledError,
  AiRateLimitError,
  AiRefusedError,
  AiRequestError,
  _failureKind,
} from "./errors.ts";
import type { AiDriver, DriverStatus } from "./drivers/AiDriver.ts";
import type { AiRequest, AiResponse, AiStreamChunk, AiUsage } from "./types.ts";

/**
 * A failure the app expected and handled is not an incident. Every failed generation was logged
 * at ERROR, including the refusal that had just been reported as a warning, the rate limit the
 * caller retried, and the request the caller itself cancelled; the log became a place to stop
 * looking, which is when the one real failure goes unseen.
 */
class Failing implements AiDriver {
  readonly name = "anthropic";
  readonly model = "claude-opus-5";
  constructor(private readonly error: Error) {}

  async text(_request: AiRequest): Promise<AiResponse> {
    throw this.error;
  }
  async *stream(): AsyncIterable<AiStreamChunk> {
    await Promise.reject(this.error);
    yield { type: "text", text: "" }; // never reached; a generator must yield
  }
  async object<T>(): Promise<{ object: T; model: string; usage: AiUsage }> {
    throw this.error;
  }
  async countTokens(): Promise<number> {
    return 1;
  }
  async verify(): Promise<DriverStatus> {
    return { ok: true, model: this.model, detail: "scripted" };
  }
}

type Line = { level: "warn" | "error"; message: string };

/** Fail one call with `error` and return what the log bridge wrote. */
async function logFor(error: Error): Promise<Line[]> {
  const lines: Line[] = [];
  const sink = {
    warn: (message: string) => lines.push({ level: "warn", message }),
    error: (message: string) => lines.push({ level: "error", message }),
  };
  currentApp().container.value("log" as never, sink as never);

  const dispose = installAiObservability(currentApp());
  try {
    const ai = new AiManager(AiConfig({ drivers: { anthropic: { apiKey: "test" } } } as never));
    ai.extend("anthropic", () => new Failing(error));
    await ai.text("hello").catch(() => undefined);
  } finally {
    dispose();
    currentApp().container.registry.delete("log" as never);
  }
  return lines;
}

describe("how a failed generation is logged", () => {
  beforeAll(() => {
    Application._resetInstance();
    Application.create();
  });
  afterAll(() => Application._resetInstance());

  it("logs a refusal once, as the warning it already is", async () => {
    const lines = await logFor(new AiRefusedError("cyber", null));

    expect(lines.map((l) => l.level)).toEqual(["warn"]);
    expect(lines[0]!.message).toContain("refused");
  });

  it("logs nothing for a request the caller cancelled", async () => {
    expect(await logFor(new AiCancelledError())).toEqual([]);
  });

  it("logs a rate limit as a warning, not an error", async () => {
    const lines = await logFor(new AiRateLimitError("slow down", 5));

    expect(lines.map((l) => l.level)).toEqual(["warn"]);
  });

  it("logs a provider outage as a warning too", async () => {
    const lines = await logFor(new AiRequestError("overloaded", 529));

    expect(lines.map((l) => l.level)).toEqual(["warn"]);
  });

  it("still logs an unexpected failure as an error", async () => {
    const lines = await logFor(new AiRequestError("model not found", 404));

    expect(lines.map((l) => l.level)).toEqual(["error"]);
    expect(await logFor(new Error("a bug"))).toEqual([
      { level: "error", message: "AI generation failed" },
    ]);
  });
});

describe("_failureKind", () => {
  it("puts a cancel ahead of transient, though a cancel is transient", () => {
    expect(_failureKind(new AiCancelledError())).toBe("cancelled");
    expect(_failureKind(new AiRefusedError(null, null))).toBe("refused");
    expect(_failureKind(new AiRateLimitError("x"))).toBe("transient");
    expect(_failureKind(new AiRequestError("x", 400))).toBe("failed");
    expect(_failureKind(new TypeError("x"))).toBe("failed");
    expect(_failureKind("a string")).toBe("failed");
  });
});
