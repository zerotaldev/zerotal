import { describe, it, expect } from "bun:test";
import { RuleBuilder } from "@zerotal/validator";
import { AnthropicDriver } from "./drivers/AnthropicDriver.ts";
import { OpenAiDriver } from "./drivers/OpenAiDriver.ts";
import { OllamaDriver } from "./drivers/OllamaDriver.ts";
import { runAgentLoop } from "./agentLoop.ts";
import { tool } from "./tool.ts";
import { AiAgentLimitError, AiRateLimitError, AiRequestError } from "./errors.ts";
import type { AnthropicConstructor, AnthropicMessage } from "./drivers/anthropic-sdk.ts";
import type { AiDriver } from "./drivers/AiDriver.ts";

/**
 * One suite, three drivers.
 *
 * A provider-agnostic surface with one implementation is an Anthropic client
 * with extra indirection. The only way "the abstraction is real" is a claim
 * rather than a hope is to write the assertions once and run them against every
 * driver — so this file describes each turn in neutral terms and lets each
 * factory render it into that provider's own wire format.
 *
 * Nothing here reaches the network, and nothing needs an API key.
 */

// ── The neutral script ──────────────────────────────────────────────────────

interface Turn {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  stop?: "end_turn" | "tool_use" | "pause_turn" | "max_tokens";
  usage?: { input: number; output: number };
}

/** A driver wired to a script, plus the request bodies it produced. */
interface Harness {
  driver: AiDriver;
  requests: Array<Record<string, unknown>>;
}

type Factory = (turns: Turn[]) => Harness;

// ── Anthropic ───────────────────────────────────────────────────────────────

class FakeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
class FakeRateLimitError extends FakeApiError {}
class FakeConnectionError extends FakeApiError {}

/** The error classes the driver maps against — nothing else of the ctor is used. */
const FAKE_CTOR = {
  RateLimitError: FakeRateLimitError,
  APIConnectionError: FakeConnectionError,
  AuthenticationError: FakeApiError,
  NotFoundError: FakeApiError,
  BadRequestError: FakeApiError,
  APIError: FakeApiError,
} as unknown as AnthropicConstructor;

function anthropicMessage(turn: Turn): AnthropicMessage {
  const content: Array<Record<string, unknown>> = [];
  if (turn.text !== undefined) content.push({ type: "text", text: turn.text });
  for (const call of turn.toolCalls ?? []) {
    content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
  }

  return {
    model: "claude-opus-5",
    content: content as AnthropicMessage["content"],
    stop_reason: turn.stop ?? (turn.toolCalls?.length ? "tool_use" : "end_turn"),
    usage: {
      input_tokens: turn.usage?.input ?? 10,
      output_tokens: turn.usage?.output ?? 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
}

const anthropicFactory: Factory = (turns) => {
  const requests: Array<Record<string, unknown>> = [];
  let index = 0;

  const next = (): AnthropicMessage =>
    anthropicMessage(turns[Math.min(index++, turns.length - 1)] ?? {});

  const api = {
    create: async (params: Record<string, unknown>) => {
      requests.push(params);
      return next();
    },
    stream: (params: Record<string, unknown>) => {
      requests.push(params);
      const message = next();
      const text = String(
        (message.content.find((b) => b.type === "text") as { text?: string } | undefined)?.text ??
          "",
      );
      return {
        async *[Symbol.asyncIterator]() {
          for (const word of text.split(/(?<=\s)/)) {
            yield { type: "content_block_delta", delta: { type: "text_delta", text: word } };
          }
        },
        finalMessage: async () => message,
      };
    },
    countTokens: async (params: Record<string, unknown>) => {
      requests.push(params);
      return { input_tokens: 42 };
    },
  };

  const driver = new AnthropicDriver(
    {
      apiKey: "test",
      model: "claude-opus-5",
      maxTokens: 16000,
      streamMaxTokens: 64000,
      effort: "high",
      fallbacks: true,
      cacheSystem: true,
      timeout: 1000,
    },
    { ctor: FAKE_CTOR, client: { messages: api, beta: { messages: api } } },
  );

  return { driver, requests };
};

// ── OpenAI ──────────────────────────────────────────────────────────────────

function openAiBody(turn: Turn): unknown {
  return {
    model: "gpt-4o-mini",
    choices: [
      {
        message: {
          content: turn.text ?? "",
          tool_calls: (turn.toolCalls ?? []).map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.input) },
          })),
        },
        finish_reason: turn.toolCalls?.length ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: turn.usage?.input ?? 10,
      completion_tokens: turn.usage?.output ?? 5,
    },
  };
}

/** OpenAI streams SSE frames; the last one is the literal `[DONE]`. */
function openAiSse(turn: Turn): string {
  const frames = (turn.text ?? "")
    .split(/(?<=\s)/)
    .map((word) =>
      JSON.stringify({ model: "gpt-4o-mini", choices: [{ delta: { content: word } }] }),
    );
  frames.push(
    JSON.stringify({
      model: "gpt-4o-mini",
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
  );
  return `${frames.map((f) => `data: ${f}`).join("\n\n")}\n\ndata: [DONE]\n\n`;
}

const openAiFactory: Factory = (turns) => {
  const requests: Array<Record<string, unknown>> = [];
  let index = 0;

  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push(body);
    const turn = turns[Math.min(index++, turns.length - 1)] ?? {};

    return body["stream"]
      ? new Response(openAiSse(turn), { headers: { "Content-Type": "text/event-stream" } })
      : Response.json(openAiBody(turn));
  }) as unknown as typeof fetch;

  const driver = new OpenAiDriver(
    {
      apiKey: "test",
      model: "gpt-4o-mini",
      maxTokens: 16000,
      baseUrl: "https://api.openai.test/v1",
      timeout: 1000,
    },
    fetchImpl,
  );

  return { driver, requests };
};

// ── Ollama ──────────────────────────────────────────────────────────────────

function ollamaBody(turn: Turn): unknown {
  return {
    model: "llama3.2",
    message: {
      role: "assistant",
      content: turn.text ?? "",
      ...(turn.toolCalls?.length
        ? {
            tool_calls: turn.toolCalls.map((call) => ({
              function: { name: call.name, arguments: call.input },
            })),
          }
        : {}),
    },
    done: true,
    done_reason: "stop",
    prompt_eval_count: turn.usage?.input ?? 10,
    eval_count: turn.usage?.output ?? 5,
  };
}

/** Ollama streams newline-delimited JSON, one object per chunk. */
function ollamaNdjson(turn: Turn): string {
  const lines = (turn.text ?? "")
    .split(/(?<=\s)/)
    .map((word) => JSON.stringify({ model: "llama3.2", message: { content: word }, done: false }));
  lines.push(
    JSON.stringify({
      model: "llama3.2",
      message: { content: "" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 10,
      eval_count: 5,
    }),
  );
  return `${lines.join("\n")}\n`;
}

const ollamaFactory: Factory = (turns) => {
  const requests: Array<Record<string, unknown>> = [];
  let index = 0;

  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push(body);
    const turn = turns[Math.min(index++, turns.length - 1)] ?? {};

    return body["stream"] ? new Response(ollamaNdjson(turn)) : Response.json(ollamaBody(turn));
  }) as unknown as typeof fetch;

  const driver = new OllamaDriver(
    { model: "llama3.2", baseUrl: "http://ollama.test", timeout: 1000 },
    fetchImpl,
  );

  return { driver, requests };
};

// ── The shared suite ────────────────────────────────────────────────────────

const DRIVERS: Array<[string, Factory]> = [
  ["anthropic", anthropicFactory],
  ["openai", openAiFactory],
  ["ollama", ollamaFactory],
];

const rule = new RuleBuilder();

for (const [name, factory] of DRIVERS) {
  describe(`${name} driver — shared surface`, () => {
    it("returns text, model, and usage from a plain generation", async () => {
      const { driver } = factory([{ text: "Hello there." }]);
      const response = await driver.text({ prompt: "hi" });

      expect(response.text).toBe("Hello there.");
      expect(response.model).toBeTruthy();
      expect(response.usage.inputTokens).toBe(10);
      expect(response.usage.outputTokens).toBe(5);
      expect(response.stopReason).toBe("end_turn");
    });

    it("streams chunks that reassemble into the same text, then a done chunk", async () => {
      const { driver } = factory([{ text: "one two three" }]);

      const chunks: string[] = [];
      let done: string | undefined;

      for await (const chunk of driver.stream({ prompt: "hi" })) {
        if (chunk.type === "text") chunks.push(chunk.text);
        if (chunk.type === "done") done = chunk.response.text;
      }

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join("")).toBe("one two three");
      expect(done).toBe("one two three");
    });

    it("parses and re-checks a structured answer", async () => {
      const { driver } = factory([{ text: JSON.stringify({ sentiment: "positive", score: 4 }) }]);

      const result = await driver.object<{ sentiment: string; score: number }>({ prompt: "x" }, {
        sentiment: rule.string().in(["positive", "negative"]),
        score: rule.number().min(1).max(5),
      } as never);

      expect(result.object.sentiment).toBe("positive");
      expect(result.object.score).toBe(4);
    });

    it("re-checks a constraint the provider could not enforce", async () => {
      // score 9 satisfies "a number" — the only thing the wire schema can say —
      // and violates max(5), which only the client-side pass can catch.
      const { driver } = factory([{ text: JSON.stringify({ sentiment: "positive", score: 9 }) }]);

      await expect(
        driver.object({ prompt: "x" }, {
          sentiment: rule.string().in(["positive", "negative"]),
          score: rule.number().min(1).max(5),
        } as never),
      ).rejects.toThrow(/score/);
    });

    it("reports a truncated structured answer as a schema failure, not a crash", async () => {
      const { driver } = factory([{ text: '{"sentiment": "posi' }]);

      await expect(
        driver.object({ prompt: "x" }, { sentiment: rule.string() } as never),
      ).rejects.toThrow(/did not parse as JSON/);
    });

    it("runs the agent loop: tool call, handler, final answer", async () => {
      const { driver } = factory([
        { toolCalls: [{ id: "call-1", name: "add", input: { a: 2, b: 3 } }] },
        { text: "The answer is 5." },
      ]);

      const add = tool<{ a: number; b: number }>({
        name: "add",
        description: "Add two numbers. Call this for any arithmetic.",
        input: (r) => ({ a: r.number(), b: r.number() }),
        handle: ({ a, b }) => String(a + b),
      });

      const result = await runAgentLoop(
        driver,
        { prompt: "what is 2 + 3?", tools: [add] },
        { maxSteps: 5, maxResumes: 3, signal: new AbortController().signal },
      );

      expect(result.text).toBe("The answer is 5.");
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]!.call.name).toBe("add");
      expect(result.steps[0]!.result).toBe("5");
      expect(result.steps[0]!.isError).toBe(false);
      // Usage is summed across every turn of the loop, not just the last.
      expect(result.usage.outputTokens).toBe(10);
    });

    it("tells the model when it asked for a tool that does not exist", async () => {
      const { driver } = factory([
        { toolCalls: [{ id: "call-1", name: "nope", input: {} }] },
        { text: "Sorry about that." },
      ]);

      const add = tool({
        name: "add",
        description: "Add two numbers.",
        input: (r) => ({ a: r.number(), b: r.number() }),
        handle: () => "0",
      });

      const result = await runAgentLoop(
        driver,
        { prompt: "x", tools: [add] },
        { maxSteps: 5, maxResumes: 3, signal: new AbortController().signal },
      );

      expect(result.steps[0]!.isError).toBe(true);
      expect(result.steps[0]!.result).toContain("No tool named 'nope'");
      expect(result.steps[0]!.result).toContain("add");
    });

    it("turns a throwing handler into an error result instead of ending the run", async () => {
      const { driver } = factory([
        { toolCalls: [{ id: "call-1", name: "boom", input: {} }] },
        { text: "I will try something else." },
      ]);

      const boom = tool({
        name: "boom",
        description: "Always fails.",
        input: () => ({}),
        handle: () => {
          throw new Error("the database is on fire");
        },
      });

      const result = await runAgentLoop(
        driver,
        { prompt: "x", tools: [boom] },
        { maxSteps: 5, maxResumes: 3, signal: new AbortController().signal },
      );

      expect(result.steps[0]!.isError).toBe(true);
      expect(result.steps[0]!.result).toBe("the database is on fire");
      expect(result.text).toBe("I will try something else.");
    });

    it("stops at maxSteps rather than looping forever", async () => {
      // Every turn asks for the tool again — the model never converges.
      const { driver } = factory([
        { toolCalls: [{ id: "c", name: "add", input: { a: 1, b: 1 } }] },
      ]);

      const add = tool({
        name: "add",
        description: "Add two numbers.",
        input: (r) => ({ a: r.number(), b: r.number() }),
        handle: () => "2",
      });

      const run = runAgentLoop(
        driver,
        { prompt: "x", tools: [add] },
        { maxSteps: 3, maxResumes: 3, signal: new AbortController().signal },
      );

      // Both ceilings raise AiAgentLimitError, so assert on the message too —
      // otherwise a loop that tripped the *pause* cap would look like a pass.
      await expect(run).rejects.toThrow(AiAgentLimitError);
      await expect(run).rejects.toThrow(/3 tool-calling round trips/);
    });

    it("stops when the caller's signal is already aborted", async () => {
      const { driver } = factory([{ text: "unreachable" }]);
      const controller = new AbortController();
      controller.abort();

      await expect(
        runAgentLoop(
          driver,
          { prompt: "x" },
          { maxSteps: 3, maxResumes: 3, signal: controller.signal },
        ),
      ).rejects.toThrow(/cancelled/i);
    });
  });
}

// ── pause_turn: Anthropic-only, because only Anthropic emits it ─────────────

describe("agent loop — pause_turn", () => {
  it("resumes a paused turn instead of returning a silently truncated answer", async () => {
    const { driver, requests } = anthropicFactory([
      { text: "Working…", stop: "pause_turn" },
      { text: "Finished." },
    ]);

    const result = await runAgentLoop(
      driver,
      { prompt: "long job" },
      { maxSteps: 5, maxResumes: 3, signal: new AbortController().signal },
    );

    expect(result.text).toBe("Finished.");
    expect(requests).toHaveLength(2);
    // The paused turn is pushed back so the provider can continue it.
    const second = requests[1]!["messages"] as Array<{ role: string }>;
    expect(second).toHaveLength(2);
    expect(second[1]!.role).toBe("assistant");
  });

  it("caps the resumes rather than pausing forever", async () => {
    const { driver } = anthropicFactory([{ text: "Working…", stop: "pause_turn" }]);

    await expect(
      runAgentLoop(
        driver,
        { prompt: "long job" },
        { maxSteps: 5, maxResumes: 2, signal: new AbortController().signal },
      ),
    ).rejects.toThrow(/paused the turn/);
  });
});

// ── Error mapping ───────────────────────────────────────────────────────────

describe("error mapping", () => {
  it("maps the Anthropic SDK's rate-limit class, not its message text", async () => {
    const throwing = {
      create: async () => {
        throw new FakeRateLimitError("429 rate limited", 429);
      },
      stream: () => {
        throw new FakeRateLimitError("429 rate limited", 429);
      },
    };

    const driver = new AnthropicDriver(
      {
        apiKey: "test",
        model: "claude-opus-5",
        maxTokens: 100,
        streamMaxTokens: 200,
        effort: "high",
        fallbacks: false,
        cacheSystem: false,
        timeout: 1000,
      },
      { ctor: FAKE_CTOR, client: { messages: throwing, beta: { messages: throwing } } },
    );

    await expect(driver.text({ prompt: "x" })).rejects.toThrow(AiRateLimitError);
  });

  it("maps an OpenAI 429 to a rate-limit error and a 500 to a request error", async () => {
    const status = (code: number): AiDriver =>
      new OpenAiDriver(
        {
          apiKey: "t",
          model: "gpt-4o-mini",
          maxTokens: 10,
          baseUrl: "https://api.openai.test/v1",
          timeout: 1000,
        },
        (async () => new Response("boom", { status: code })) as unknown as typeof fetch,
      );

    await expect(status(429).text({ prompt: "x" })).rejects.toThrow(AiRateLimitError);
    await expect(status(500).text({ prompt: "x" })).rejects.toThrow(AiRequestError);
  });

  it("names Ollama's likely cause when the server is not running", async () => {
    const driver = new OllamaDriver(
      { model: "llama3.2", baseUrl: "http://ollama.test", timeout: 1000 },
      (async () => {
        throw new TypeError("Unable to connect");
      }) as unknown as typeof fetch,
    );

    await expect(driver.text({ prompt: "x" })).rejects.toThrow(/ollama serve/);
  });
});
