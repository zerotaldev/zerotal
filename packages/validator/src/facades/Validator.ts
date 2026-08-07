import type { Schema, ValidationOutcome, FieldRuleDefinition, Infer } from "../types.ts";
import type { FieldRule } from "../FieldRule.ts";
import { RuleBuilder } from "../RuleBuilder.ts";
import { runValidation } from "../Validator.ts";

type ExtractDefs<S extends Record<string, FieldRule>> = {
  [K in keyof S]: S[K]["_def"];
};

/**
 * Non-HTTP validation — for CLI commands, services, background jobs.
 * Returns { success, data, errors } — never throws, never redirects.
 *
 * @example
 * const result = Validator.check(body, rules => ({
 *   email: rules.string().email(),
 *   age:   rules.number().min(0),
 * }));
 * if (!result.success) console.error(result.errors);
 */
export const ValidatorFacade = {
  check<S extends Record<string, FieldRule>>(
    data: Record<string, unknown>,
    factory: (rules: RuleBuilder) => S,
  ): ValidationOutcome<Infer<ExtractDefs<S>>> {
    const builder = new RuleBuilder();
    const factoryResult = factory(builder);

    const schema: Record<string, FieldRuleDefinition> = {};
    for (const [key, rule] of Object.entries(factoryResult)) {
      schema[key] = rule._def;
    }

    return runValidation(schema as Schema, data) as ValidationOutcome<Infer<ExtractDefs<S>>>;
  },
};
