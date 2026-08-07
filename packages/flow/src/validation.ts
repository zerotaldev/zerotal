/**
 * Validation glue for Flow.
 *
 * The validation ENGINE lives in `@zerotal/validator` (its fluent `RuleBuilder` schema) — Flow
 * does not roll its own. This module defines the rule-map shape and the `ValidationError` thrown by
 * `Component.validate()` (the WS handler catches it to re-render with the populated error bag).
 */
import { ZerotalError } from "@zerotal/core";
import type { RuleBuilder, FieldRule } from "@zerotal/validator";

/**
 * A per-field rule map built with the framework validator's chain — the explicit-rules form of
 * `this.validate(...)`, mirroring the `@validate` decorator. Keys are field names; each value is a
 * builder callback that turns the fluent {@link RuleBuilder} into a {@link FieldRule}.
 *
 * @example
 * ```ts
 * this.validate({
 *   name:  (rule) => rule.required().min(2).max(50),
 *   email: (rule) => rule.required().email(),
 * } satisfies ValidationRules);
 * ```
 *
 * @category Validation
 */
export type ValidationRules = Record<string, (rule: RuleBuilder) => FieldRule>;

/**
 * Error thrown by `Component.validate()` when one or more fields fail validation.
 *
 * @remarks
 * Extends `ZerotalError` with code `"E_VALIDATION"` and HTTP status `422`. The failing fields are
 * carried on `errors`, a map of field name → array of human-readable messages. The Flow
 * WebSocket handler catches this and re-renders the component with the populated error bag rather
 * than surfacing it as a crash.
 *
 * @example
 * ```ts
 * try {
 *   this.validate();
 * } catch (err) {
 *   if (err instanceof ValidationError) {
 *     // err.errors === { email: ["The email field is required."] }
 *   }
 * }
 * ```
 *
 * @category Validation
 */
export class ValidationError extends ZerotalError {
  /** @param errors - Map of field name to its array of validation error messages. */
  constructor(readonly errors: Record<string, string[]>) {
    super("Validation failed", "E_VALIDATION", 422);
  }
}
