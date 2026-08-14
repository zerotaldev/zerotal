import { RuleBuilder } from "@zerotal/validator";
import type { FieldRule } from "@zerotal/validator";
import { recheckAgainstSchema, translateSchema, type SchemaInput } from "./schema.ts";
import type { AiTool, AiToolContext } from "./types.ts";

/**
 * Define a tool the model can call, with its input described by the validator
 * you already use for forms.
 *
 * The schema is translated to JSON Schema for the provider and re-checked on the
 * way back in, so the handler receives input that has actually been validated —
 * not merely input the provider promised to shape. Constraints the provider
 * cannot express (`min`, `regex`, …) are enforced by that second pass; see
 * `schema.ts` for why that is the deal.
 *
 * @example
 * const lookupOrder = tool({
 *   name: "lookup_order",
 *   description:
 *     "Fetch one order by its id. Call this whenever the user refers to an order " +
 *     "number — do not answer from the conversation alone.",
 *   input: (rule) => ({ id: rule.string().uuid() }),
 *   async handle({ id }) {
 *     return await Order.find(id);
 *   },
 * });
 *
 * await Ai.agent({ prompt: "Where is order 2f1c…?", tools: [lookupOrder] });
 */
export function tool<I extends Record<string, unknown> = Record<string, unknown>>(options: {
  /** Snake_case, specific: `lookup_order` beats `orders`. */
  name: string;
  /**
   * What it does *and when to call it*. The trigger condition is the half that
   * moves the call rate — a description that only states what the tool does
   * leaves the model guessing about when it applies.
   */
  description: string;
  /** The input shape, as a validator schema. */
  input: ((rule: RuleBuilder) => Record<string, FieldRule>) | SchemaInput;
  /** Runs when the model calls the tool. Return anything JSON-serializable. */
  handle: (input: I, ctx: AiToolContext) => Promise<unknown> | unknown;
}): AiTool {
  const schema: SchemaInput =
    typeof options.input === "function" ? options.input(new RuleBuilder()) : options.input;

  return {
    name: options.name,
    description: options.description,
    inputSchema: translateSchema(schema),
    handler: (raw, ctx) => options.handle(recheckAgainstSchema<I>(schema, raw), ctx),
  };
}
// The return is `AiTool`, not `AiTool<I>`, on purpose. `I` appears in a
// parameter position, so `AiTool<{a, b}>` is *not* assignable to
// `AiTool<Record<string, unknown>>` — and `tools: [add]` would be a type error
// at the one call site every user writes. The narrowing still happens: `handle`
// receives `I`, validated by `recheckAgainstSchema`, and only the stored
// signature is widened.

/**
 * Run a tool's handler and turn whatever it returns — or throws — into the
 * string the provider expects back.
 *
 * A throwing handler must not end the run: the model is perfectly capable of
 * trying something else once it is told the call failed, and killing the turn
 * denies it that. So the error becomes an error-flagged result instead.
 *
 * @internal
 */
export async function runTool(
  t: AiTool,
  input: Record<string, unknown>,
  ctx: AiToolContext,
): Promise<{ content: string; isError: boolean }> {
  try {
    const value = await t.handler(input, ctx);
    return { content: stringifyToolResult(value), isError: false };
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}

/** Strings pass through; everything else is JSON. Undefined becomes a stated no-op. */
function stringifyToolResult(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "(no output)";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    // A cycle or a BigInt. Better a named failure the model can react to than a
    // thrown error that ends the turn.
    return "(tool output could not be serialized to JSON)";
  }
}
