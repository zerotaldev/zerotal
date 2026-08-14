import { FrameworkEvents } from "@zerotal/core";
import { AiAgentLimitError, AiCancelledError } from "./errors.ts";
import { AiToolCalled } from "./events.ts";
import { runTool } from "./tool.ts";
import type { AgentOptions, AiDriver } from "./drivers/AiDriver.ts";
import { normalizeMessages } from "./drivers/AiDriver.ts";
import type { AiAgentResult, AiAgentStep, AiMessage, AiRequest, AiUsage } from "./types.ts";

/**
 * The tool-calling loop, written once and shared by every driver.
 *
 * A driver may supply its own `agent()` when the provider runs tools server-side,
 * but none of the built-in three do — they all run *this*, which is the point:
 * an abstraction whose second implementation reuses none of the first is not an
 * abstraction, it is two clients sharing a type. Everything a provider actually
 * differs on lives in `text()`.
 *
 * Two ceilings bound the loop, because a model deciding when to stop is not a
 * termination proof:
 *
 * - **`maxSteps`** caps tool-calling round trips.
 * - **`maxResumes`** caps `pause_turn` restarts — see below, this one bites.
 *
 * @internal
 */
export async function runAgentLoop(
  driver: AiDriver,
  request: AiRequest,
  options: AgentOptions,
): Promise<AiAgentResult> {
  const tools = request.tools ?? [];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const messages: AiMessage[] = [...normalizeMessages(request)];
  const steps: AiAgentStep[] = [];
  const usage: AiUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  let step = 0;
  let resumes = 0;
  let model = driver.model;

  // `prompt` was folded into `messages` above; leaving it set would make the
  // first turn arrive twice on every iteration.
  const { prompt: _prompt, ...base } = request;

  for (;;) {
    if (options.signal.aborted) throw new AiCancelledError();

    const response = await driver.text({ ...base, messages, tools, signal: options.signal });

    model = response.model;
    accumulate(usage, response.usage);
    messages.push(response.assistantTurn);

    // A paused turn is *not* an error and *not* a completion — it is the
    // provider saying "ask me again". Left unhandled it reads as a finished
    // answer, so the user sees a silently truncated response with no warning
    // anywhere. Push the turn back and re-request.
    if (response.stopReason === "pause_turn") {
      if (++resumes > options.maxResumes) {
        throw new AiAgentLimitError(
          `The provider paused the turn ${resumes} times, over the ceiling of ${options.maxResumes}. ` +
            `Raise agent.maxResumes in config/ai.ts if the work genuinely needs it.`,
          { resumes, maxResumes: options.maxResumes },
        );
      }
      continue;
    }

    if (response.stopReason !== "tool_use" || response.toolCalls.length === 0) {
      return { text: response.text, model, usage, steps, stopReason: response.stopReason };
    }

    if (step >= options.maxSteps) {
      throw new AiAgentLimitError(
        `The agent made ${step} tool-calling round trips without finishing, hitting the ceiling of ` +
          `${options.maxSteps}. Raise agent.maxSteps in config/ai.ts, or narrow the task.`,
        { steps: step, maxSteps: options.maxSteps },
      );
    }
    step++;

    // Every call in one assistant turn is answered in one user turn. Splitting
    // them across turns is accepted by the API and quietly teaches the model to
    // stop asking for parallel calls.
    const results = await Promise.all(
      response.toolCalls.map(async (call) => {
        const startedAt = performance.now();
        const tool = byName.get(call.name);

        if (!tool) {
          // Not a crash: naming the mistake back to the model is how it recovers.
          const known = [...byName.keys()].join(", ") || "none";
          return {
            id: call.id,
            content: `No tool named '${call.name}' is available. Available tools: ${known}.`,
            isError: true,
            step,
            call,
            durationMs: performance.now() - startedAt,
          };
        }

        const outcome = await runTool(tool, call.input, { signal: options.signal, step });
        const durationMs = performance.now() - startedAt;

        FrameworkEvents.emit(
          new AiToolCalled(
            driver.name,
            call.name,
            step,
            durationMs,
            !outcome.isError,
            outcome.isError ? outcome.content : undefined,
          ),
        );

        return { id: call.id, ...outcome, step, call, durationMs };
      }),
    );

    for (const result of results) {
      steps.push({
        step: result.step,
        call: result.call,
        result: result.content,
        isError: result.isError,
        durationMs: result.durationMs,
      });
    }

    messages.push({
      role: "user",
      content: "",
      toolResults: results.map((r) => ({ id: r.id, content: r.content, isError: r.isError })),
    });
  }
}

/** Sum a response's usage into the running total. */
function accumulate(total: AiUsage, next: AiUsage): void {
  total.inputTokens += next.inputTokens;
  total.outputTokens += next.outputTokens;
  total.cacheReadTokens += next.cacheReadTokens;
  total.cacheWriteTokens += next.cacheWriteTokens;
}
