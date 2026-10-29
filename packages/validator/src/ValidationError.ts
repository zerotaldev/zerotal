import { ZerotalError } from "@zerotal/core";
import type { ValidationErrors } from "./types.ts";

/**
 * Thrown by validate() when validation fails and the request's `Accept` does not
 * prefer JSON to HTML: a web form, a browser, or an Inertia visit
 * (`Accept: text/html, application/xhtml+xml`).
 *
 * The global exception handler in @zerotal/core catches this by checking
 * err?.name === 'ValidationRedirectError' and returns a 303 redirect.
 */
export class ValidationRedirectError extends ZerotalError {
  override readonly name = "ValidationRedirectError";

  constructor(
    public readonly redirectTo: string,
    public readonly errors: ValidationErrors,
  ) {
    super("Validation failed", "E_VALIDATION_REDIRECT", 303);
  }
}

/**
 * Thrown by validate() when validation fails and the request's `Accept` prefers
 * `application/json` to `text/html` (by q-value, then by order), with or without
 * an X-Inertia header.
 *
 * The global exception handler in @zerotal/core catches this by checking
 * err?.name === 'ValidationJsonError' and returns a 422 response.
 */
export class ValidationJsonError extends ZerotalError {
  override readonly name = "ValidationJsonError";

  constructor(public readonly errors: ValidationErrors) {
    super("Validation failed", "E_VALIDATION", 422);
  }
}
