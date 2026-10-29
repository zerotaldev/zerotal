import type { HttpContext } from "@zerotal/core";
import { safeRedirectPath } from "@zerotal/core";
import type { Schema, Infer, FieldRuleDefinition } from "./types.ts";
import type { FieldRule } from "./FieldRule.ts";
import { RuleBuilder } from "./RuleBuilder.ts";
import { runValidationAsync } from "./Validator.ts";
import { ValidationRedirectError, ValidationJsonError } from "./ValidationError.ts";
import { _readRequestBody, _requestOrigin } from "./requestBody.ts";

type SessionLike = {
  set(key: string, value: unknown): void;
  forget(key: string): void;
};

// Maps a factory-schema (Record<string, FieldRule>) to raw FieldRuleDefinitions.
// Used to drive Infer<> type inference from the narrow _def types on each rule class.
type ExtractDefs<S extends Record<string, FieldRule>> = {
  [K in keyof S]: S[K]["_def"];
};

/**
 * Validate the HTTP request body against the given schema.
 *
 * On success: returns the validated, typed data object (only schema fields).
 * On failure (Inertia or web form): stores errors in session + throws
 *   ValidationRedirectError → global handler converts to 303 redirect.
 * On failure (JSON API): throws ValidationJsonError → global handler → 422.
 */
export async function validate<S extends Record<string, FieldRule>>(
  ctx: HttpContext,
  factory: (rules: RuleBuilder) => S,
): Promise<Infer<ExtractDefs<S>>> {
  const builder = new RuleBuilder();
  const factoryResult = factory(builder);

  // Convert FieldRule objects → raw FieldRuleDefinitions for runValidation
  const schema: Record<string, FieldRuleDefinition> = {};
  for (const [key, rule] of Object.entries(factoryResult)) {
    schema[key] = rule._def;
  }

  const body = await _readRequestBody(ctx);

  const result = await runValidationAsync(schema as Schema, body);

  if (!result.success) {
    const errors = result.errors;
    const session = (ctx as unknown as { session?: SessionLike }).session;

    session?.set("errors", errors);
    session?.set("old", body);

    const isInertia = ctx.request.headers.get("X-Inertia") === "true";
    const accept = ctx.request.headers.get("Accept") ?? "";
    const isJson = accept.includes("application/json") && !isInertia;

    if (isJson) {
      throw new ValidationJsonError(errors);
    } else {
      // Referer is attacker-controllable and this is a redirect target, so it must go
      // through the same origin check every other redirect in the framework uses. Without it,
      // a plain <a href="https://app.com/search"> on an attacker's page bounced the victim
      // straight back off-site under the app's own domain — no CSRF token involved.
      const back = safeRedirectPath(ctx.request.headers.get("Referer"), _requestOrigin(ctx)) ?? "/";
      throw new ValidationRedirectError(back, errors);
    }
  }

  const session = (ctx as unknown as { session?: { forget(key: string): void } }).session;
  session?.forget("errors");
  session?.forget("old");

  return result.data as Infer<ExtractDefs<S>>;
}
