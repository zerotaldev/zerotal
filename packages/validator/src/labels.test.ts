import { describe, it, expect } from "bun:test";
import { RuleBuilder, runStringRules, runValidation } from "./index.ts";

/**
 * The same field and the same failure read differently depending on which rule syntax produced
 * the message: the fluent API wrote the raw key ("The first_name field"), the pipe-string engine
 * a humanised one ("The first name field"). The fluent API is what `validate()` and every example
 * use, so the snake_case version is the one end users saw, addressed to them in a sentence.
 */
const r = new RuleBuilder();

function fluent(rules: Record<string, { _def: unknown }>, input: Record<string, unknown>) {
  const schema: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(rules)) schema[key] = rule._def;
  return runValidation(schema as never, input).errors as Record<string, string>;
}

describe("a field key in a validation message", () => {
  it("reads as words in the fluent API", () => {
    const errors = fluent({ first_name: r.string().max(3) }, { first_name: "Alexander" });

    expect(errors["first_name"]).toBe("The first name field must not exceed 3 characters.");
  });

  it("reads the same in both engines for the same field and rule", () => {
    const viaFluent = fluent({ id_type: r.string().in(["sa_id", "passport"]) }, { id_type: "x" });
    const viaPipe = runStringRules({ id_type: "x" }, { id_type: "in:sa_id,passport" });

    expect(viaFluent["id_type"]).toBe(viaPipe["id_type"]![0]!);
    expect(viaFluent["id_type"]).toStartWith("The id type field");
  });

  it("reads as words when the field is missing", () => {
    expect(fluent({ last_name: r.string() }, {})["last_name"]).toBe(
      "The last name field is required.",
    );
  });

  it("names the other fields as words too, in a rule that depends on them", () => {
    const errors = fluent(
      { card_cvv: r.string().optional().requiredWith(["card_number"]) },
      { card_number: "4111" },
    );

    expect(errors["card_cvv"]).toBe("The card cvv field is required when card number is present.");
  });

  it("leaves a message the app wrote itself exactly as written", () => {
    const errors = fluent(
      { first_name: r.string().max(3, "Keep first_name short.") },
      { first_name: "Alexander" },
    );

    expect(errors["first_name"]).toBe("Keep first_name short.");
  });
});
