/**
 * What a visitor is told when something on a Flow page throws.
 *
 * An error's message is written for whoever reads the log. It names tables, hosts and file
 * paths, and Flow used to show it to the visitor twice: the default `onError()` flashed it as a
 * toast, and an error thrown outside the action body (a render, `onBoot()`, a middleware) went
 * out as the error frame's message. In development that is what you want. Anywhere else it is a
 * leak, so there the visitor gets one generic sentence and the detail goes to the log and the
 * app's exception handler.
 */
import { config, devSurfacesEnabled } from "@zerotal/core";

/**
 * The sentence shown in place of an error's own message.
 *
 * @internal
 */
export const _GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

// Registered symbols, read by name: an app can hold two copies of core, and an error built by
// one is not an instance of the other's class. Core marks its own errors the same way.
const ABORTED = Symbol.for("zerotal.aborted");
const HTTP_ERROR = Symbol.for("zerotal.httpError");

/**
 * Whether `error` is one the framework raised to answer the client: an `HttpError` (a
 * `ForbiddenError`, a `ConflictError`) or whatever `abort()` threw, with a status below 500.
 * Those are thrown on purpose and their message is written for the person on the page.
 *
 * An error that merely carries a status is not one. An upstream API's 401 or a database
 * driver's error code says nothing about whether its text is fit to show.
 *
 * @param error - What was thrown.
 * @returns `true` when the message was meant for the client.
 * @internal
 */
export function _isClientFacingError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (!(ABORTED in error || HTTP_ERROR in error)) return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && status >= 100 && status < 500;
}

/**
 * Whether error messages are shown to the visitor as they are.
 *
 * `flow.exposeErrorMessages` decides when it is set. Left unset, the answer is yes where the
 * framework's other debug output is on (development, the dev server, a test run) and no
 * everywhere else, so a deployment that never set `APP_ENV` shows nothing.
 *
 * @internal
 */
export function _exposesErrorMessages(): boolean {
  const configured = config.safe<boolean | undefined>("flow.exposeErrorMessages", undefined);
  if (typeof configured === "boolean") return configured;
  // `bun test` sets NODE_ENV for a run that sets nothing else, and a test asserts on the text.
  return devSurfacesEnabled() || Bun.env["NODE_ENV"] === "test";
}

/**
 * The text to show a visitor for `error`: its own message when that is safe, otherwise
 * {@link _GENERIC_ERROR_MESSAGE}.
 *
 * @param error - What was thrown.
 * @returns The message for the page. Never empty.
 * @internal
 */
export function _publicErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message && (_isClientFacingError(error) || _exposesErrorMessages())) return message;
  return _GENERIC_ERROR_MESSAGE;
}
