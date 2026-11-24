import type { HttpContext } from "zerotal";
import { ValidationJsonError, ValidationRedirectError } from "zerotal/validator";

/**
 * Fail a form the way `validate()` does — field messages in the shared `errors` prop,
 * the visitor sent back to the form — for a check `validate()` cannot make: a wrong
 * password, an address already taken, a code that did not match.
 *
 * Throws, so nothing after it runs. The framework turns it into the redirect (or a 422
 * for a client that asked for JSON), and it is not logged as an error: it is the
 * visitor's mistake, not the app's.
 */
export function rejectInput(
  http: HttpContext,
  errors: Record<string, string>,
  redirectTo: string,
): never {
  http.session?.set("errors", errors);
  if (http.wantsJson()) throw new ValidationJsonError(errors);
  throw new ValidationRedirectError(redirectTo, errors);
}
