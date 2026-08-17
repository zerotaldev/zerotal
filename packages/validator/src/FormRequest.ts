import { RequestContext, ForbiddenError } from "@zerotal/core";
import type { HttpContext } from "@zerotal/core";
import { safeRedirectPath } from "@zerotal/core";
import type { FieldRule } from "./FieldRule.ts";
import type { FieldRuleDefinition, Infer, Schema } from "./types.ts";
import { RuleBuilder } from "./RuleBuilder.ts";
import { runValidationAsync } from "./Validator.ts";
import { ValidationRedirectError, ValidationJsonError } from "./ValidationError.ts";
import { PrecognitionResponseError } from "./PrecognitionError.ts";

// Maps { title: StringRule; body: StringRule } → { title: StringRuleDef; body: StringRuleDef }
// The same pattern used by the top-level validate() function.
type ExtractDefs<S extends Record<string, FieldRule>> = {
  [K in keyof S]: S[K]["_def"];
};

type SessionLike = {
  set(key: string, value: unknown): void;
  forget(key: string): void;
};

/**
 * Base class for encapsulating validation rules and optional authorization
 * in a reusable, testable class rather than inline in each handler.
 *
 * Define rules via an instance `rules(r)` method. Because it is an instance
 * method, you have full access to `this.context` inside your schema — enabling
 * patterns like unique-except-current-user validation:
 *
 * ```typescript
 * rules(r: RuleBuilder) {
 *   return {
 *     email: r.string().email().unique('users', 'email', this.context.user?.id),
 *     name:  r.string().min(2),
 *   };
 * }
 * ```
 *
 * Type inference: `validate()` uses `ReturnType<T['rules']>` to extract the
 * narrow return type of the concrete subclass's `rules()` method. TypeScript
 * evaluates this against the actual instantiated `T` at the call site — NOT
 * the base class constraint — so the returned data is fully typed.
 *
 * IMPORTANT: Do NOT add an explicit return type to your `rules()` override.
 * Annotating it as `Record<string, FieldRule>` would widen the inferred type
 * and cause `validate()` to return `Record<string, unknown>` instead.
 *
 * @example
 * // app/requests/StorePostRequest.ts
 * export class StorePostRequest extends FormRequest {
 *   authorize() { return !!this.context.user; }
 *
 *   rules(r: RuleBuilder) {
 *     return {
 *       title: r.string().min(3).max(255),
 *       body:  r.string().min(10),
 *     };
 *   }
 * }
 *
 * // In a file-based route or controller:
 * const data = await StorePostRequest.validate();
 * // data.title → string  (fully typed — no casts needed)
 */
// Merged with the empty interface below — the app-augmentable seam for typed fields.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class FormRequest {
  /**
   * Access the current request's HttpContext from within instance methods.
   * Pulled from AsyncLocalStorage — no constructor injection needed.
   *
   * @example
   * authorize() {
   *   return !!this.context.user;
   * }
   */
  protected get context(): HttpContext {
    return RequestContext.get();
  }

  /**
   * Authorize the request before validation.
   * Return true to allow (default), false to deny with 403.
   * Access the current request via `this.context`.
   *
   * @example
   * authorize(): boolean {
   *   return !!this.context.user;
   * }
   */
  authorize(): boolean | Promise<boolean> {
    return true;
  }

  /**
   * Define the validation rules for this request.
   * Override in subclasses WITHOUT an explicit return type so TypeScript infers
   * the narrow schema shape and `validate()` produces a fully-typed result.
   *
   * You have full access to `this.context` inside this method — use it for
   * rules that depend on the current user, route params, or session state.
   *
   * @example
   * rules(r: RuleBuilder) {
   *   return {
   *     email: r.string().email().unique('users', 'email', this.context.user?.id),
   *     name:  r.string().min(2).max(100),
   *   };
   * }
   */

  rules(_r: RuleBuilder): Record<string, FieldRule> {
    throw new Error(`${this.constructor.name}.rules() is not implemented.`);
  }

  /**
   * Normalise the raw body before the rules see it. Default: unchanged.
   *
   * This is where the shape of the *transport* gets reconciled with the shape of
   * the rules. An HTML form has no way to say `null`: an unselected `<select>`
   * posts `""`, so a `r.number().nullable()` field fails on the one input the
   * browser can actually produce for "nothing". A client-side form can patch
   * that up before it posts; a plain `<form method="post">` cannot, and a rule
   * only reachable from a build with JavaScript is not a shared rule.
   *
   * Runs after `authorize()` and after the body is parsed, so it sees exactly
   * what arrived. Return the object to validate — mutating and returning the
   * argument is fine.
   *
   * @example
   * override prepareForValidation(body: Record<string, unknown>) {
   *   if (body["assigneeId"] === "") body["assigneeId"] = null;
   *   return body;
   * }
   */
  prepareForValidation(body: Record<string, unknown>): Record<string, unknown> {
    return body;
  }

  /**
   * Attach a helper method to all FormRequest instances at runtime.
   * Designed for framework packages (e.g. @zerotal/auth) that expose
   * convenience methods like `this.user()` or `this.auth()`.
   *
   * Pair with a declaration merge on the exported `FormRequest` interface for
   * TypeScript autocomplete on the added method.
   *
   * @example
   * // In @zerotal/auth's provider:
   * FormRequest.macro('user', function(this: FormRequest) {
   *   return this.context.user;
   * });
   */
  static macro(name: string, fn: (this: FormRequest, ...args: unknown[]) => unknown): void {
    (FormRequest.prototype as unknown as Record<string, unknown>)[name] = fn;
  }

  /**
   * Validate the HTTP request against this class's rules.
   *
   * The return type is fully inferred from the concrete `rules()` override —
   * no manual type assertions needed in the caller. TypeScript resolves
   * `ReturnType<T['rules']>` against the actual `T` at the call site, not the
   * base class constraint. HttpContext is pulled from per-request
   * AsyncLocalStorage automatically (zero arguments).
   *
   * On success: returns the validated, typed data object.
   * On failure: throws ValidationRedirectError (Inertia / web form) or
   *   ValidationJsonError (JSON API), and stores errors in the session.
   *
   * @example
   * const data = await StorePostRequest.validate();
   * data.title // string — not unknown
   */
  static async validate<T extends FormRequest>(
    this: new () => T,
  ): Promise<Infer<ExtractDefs<ReturnType<T["rules"]>>>> {
    const ctx = RequestContext.get();
    const instance = new this();

    // Authorization check before touching the request body
    const authorized = await instance.authorize();
    if (!authorized) {
      throw new ForbiddenError("This action is not authorized.");
    }

    // Parse request body
    let body: Record<string, unknown> = {};
    try {
      const ct = ctx.request.headers.get("Content-Type") ?? "";
      if (ct.includes("application/json")) {
        body = (await ctx.request.json()) as Record<string, unknown>;
      } else if (
        ct.includes("application/x-www-form-urlencoded") ||
        ct.includes("multipart/form-data")
      ) {
        const fd = await ctx.request.formData();
        fd.forEach((val, key) => {
          body[key] = val;
        });
      }
    } catch {
      body = {};
    }

    if (ctx.request.method === "GET") {
      ctx.url.searchParams.forEach((val, key) => {
        body[key] ??= val;
      });
    }

    // Build schema from the instance rules() method — same pipeline as validate()
    const builder = new RuleBuilder();
    const fieldRules = instance.rules(builder);
    const schema: Record<string, FieldRuleDefinition> = {};
    for (const [key, rule] of Object.entries(fieldRules)) {
      schema[key] = rule._def;
    }

    // The transport's shape reconciled with the rules' shape, before the rules
    // run. See `prepareForValidation` for why an HTML form needs this at all.
    body = instance.prepareForValidation(body);

    const result = await runValidationAsync(schema as Schema, body);
    const session = (ctx as unknown as { session?: SessionLike }).session;

    // Precognition: validate without running controller side effects, then short-circuit with a
    // 204 (no errors) or 422 (errors, optionally filtered to the requested fields).
    if (ctx.request.headers.get("Precognition") === "true") {
      const validateOnly = (ctx.request.headers.get("Precognition-Validate-Only") ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      let errors = result.success ? {} : result.errors;
      if (validateOnly.length) {
        errors = Object.fromEntries(
          Object.entries(errors).filter(([key]) => validateOnly.includes(key)),
        );
      }

      throw Object.keys(errors).length
        ? new PrecognitionResponseError(422, errors)
        : new PrecognitionResponseError(204);
    }

    if (!result.success) {
      session?.set("errors", result.errors);
      session?.set("old", body);

      const isInertia = ctx.request.headers.get("X-Inertia") === "true";
      const accept = ctx.request.headers.get("Accept") ?? "";
      const isJson = accept.includes("application/json") && !isInertia;

      if (isJson) {
        throw new ValidationJsonError(result.errors);
      } else {
        // Same origin check as validate() — see the note there. Referer is client input.
        const back = safeRedirectPath(ctx.request.headers.get("Referer"), ctx.url.origin) ?? "/";
        throw new ValidationRedirectError(back, result.errors);
      }
    }

    session?.forget("errors");
    session?.forget("old");

    return result.data as Infer<ExtractDefs<ReturnType<T["rules"]>>>;
  }
}

/**
 * Open interface for declaration merging.
 * Framework packages (e.g. @zerotal/auth) augment this to expose typed helpers
 * injected at runtime via FormRequest.macro().
 *
 * @example
 * // In @zerotal/auth/src/types.ts:
 * declare module '@zerotal/validator' {
 *   interface FormRequest {
 *     user(): AuthenticatedUser | undefined;
 *   }
 * }
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface FormRequest {}
