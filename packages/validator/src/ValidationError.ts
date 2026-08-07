import { ZerotalError } from "@zerotal/core";
import type { ValidationErrors } from "./types.ts";

/**
 * Thrown by validate() when validation fails and the request is an Inertia
 * request (X-Inertia: true) or a web form (Accept: text/html).
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
 * Thrown by validate() when validation fails and the request is a JSON API
 * request (Accept: application/json, no X-Inertia header).
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
