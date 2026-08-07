/**
 * The base error type for the framework. Every error Zerotal throws extends this,
 * carrying a machine-readable `code`, an HTTP `status`, and optional structured
 * `context` so handlers can render and log it consistently.
 */

/**
 * Base class for all framework errors.
 *
 * @param code - Stable machine-readable identifier (e.g. `E_BINDING_NOT_FOUND`),
 *   safe to switch on; unlike the message, it is not meant to change.
 * @param status - HTTP status to respond with when this error reaches the handler.
 * @param context - Structured detail attached to logs and error pages.
 */
export class ZerotalError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number = 500,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}
