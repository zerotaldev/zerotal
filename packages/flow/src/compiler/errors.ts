/**
 * The compiler's fatal error, kept apart from `transform.ts` so that code which only needs to
 * throw or recognise it does not load the TypeScript parser that module brings with it.
 */

import { ZerotalError } from "@zerotal/core";

/**
 * Thrown by the pre-compilation validation pass.
 * Unlike ordinary compile failures (which bail to runtime), this is FATAL —
 * the orchestrator rethrows it so the server refuses to start with invalid code.
 */
export class FlowValidationError extends ZerotalError {
  constructor(message: string) {
    super(message, "E_PULSE_VALIDATION", 500);
    this.name = "FlowValidationError";
  }
}
