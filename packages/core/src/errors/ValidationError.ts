/**
 * The error raised when request input fails validation. Carries the per-field
 * messages so the handler can render them back to the client (422).
 */
import { HttpError } from "./HttpError.ts";

/**
 * Raised when input validation fails.
 *
 * @param errors - Field name → list of messages for that field.
 */
export class ValidationError extends HttpError {
  constructor(
    message: string,
    public readonly errors: Record<string, string[]>,
  ) {
    super(message, 422, "E_VALIDATION_FAILED");
  }
}
