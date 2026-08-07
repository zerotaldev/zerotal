import { ZerotalError } from "@zerotal/core";

/**
 * Thrown for any non-2xx HTTP response.
 *
 * `body` is the raw response text. For `422` validation failures the more specific
 * {@link ValidationError} subclass is thrown instead, exposing the parsed field errors.
 */
export class ApiClientError extends ZerotalError {
  /** Response headers, when available (used for `Retry-After`, rate-limit info, etc.). */
  readonly headers: Headers | undefined;

  constructor(
    status: number,
    readonly statusText: string,
    readonly body: string,
    headers?: Headers,
  ) {
    super(
      `[API] ${status} ${statusText}${body ? ": " + body.slice(0, 200) : ""}`,
      "E_API_CLIENT",
      status,
    );
    this.headers = headers;
  }

  /** Parsed `Retry-After` (seconds or HTTP-date) in milliseconds, or `null` when absent. */
  get retryAfterMs(): number | null {
    return parseRetryAfter(this.headers?.get("retry-after"));
  }
}

/**
 * Thrown for `422 Unprocessable Entity` responses whose body matches the framework's
 * validation shape (`{ message, errors: { field: string[] } }`, as produced by
 * `@zerotal/validator`). Use the helpers to read field errors without re-parsing:
 *
 * @example
 * try {
 *   await api.post("/api/users", form);
 * } catch (e) {
 *   if (e instanceof ValidationError) {
 *     setFieldErrors(e.errors);          // { email: ["…"], password: ["…"] }
 *     if (e.has("email")) showError(e.first("email"));
 *   }
 * }
 */
export class ValidationError extends ApiClientError {
  /** Field → messages map (always an array per field). */
  readonly errors: Record<string, string[]>;
  /** The top-level `message` from the response (e.g. "The given data was invalid."). */
  readonly validationMessage: string;

  constructor(
    statusText: string,
    body: string,
    errors: Record<string, string[]>,
    validationMessage: string,
    headers?: Headers,
  ) {
    super(422, statusText, body, headers);
    this.errors = errors;
    this.validationMessage = validationMessage;
  }

  /** True when the given field has at least one error. */
  has(field: string): boolean {
    return (this.errors[field]?.length ?? 0) > 0;
  }

  /** The first error message for a field, or `undefined`. */
  first(field: string): string | undefined {
    return this.errors[field]?.[0];
  }

  /** All field errors. */
  all(): Record<string, string[]> {
    return this.errors;
  }

  /** The names of every field that failed. */
  fields(): string[] {
    return Object.keys(this.errors);
  }
}

/**
 * Build the right error for a non-2xx response — a {@link ValidationError} when the status is
 * 422 and the body carries an `errors` bag, otherwise a plain {@link ApiClientError}.
 */
export function makeApiError(
  status: number,
  statusText: string,
  body: string,
  headers?: Headers,
): ApiClientError {
  if (status === 422) {
    const parsed = _parseValidationBody(body);
    if (parsed) {
      return new ValidationError(statusText, body, parsed.errors, parsed.message, headers);
    }
  }
  return new ApiClientError(status, statusText, body, headers);
}

/** Parse a `{ message?, errors: { field: string | string[] } }` body, or null if it doesn't match. */
function _parseValidationBody(
  body: string,
): { errors: Record<string, string[]>; message: string } | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const raw = (json as { errors?: unknown }).errors;
  if (!raw || typeof raw !== "object") return null;

  const errors: Record<string, string[]> = {};
  for (const [field, val] of Object.entries(raw as Record<string, unknown>)) {
    errors[field] = Array.isArray(val) ? val.map(String) : [String(val)];
  }
  const message = (json as { message?: unknown }).message;
  return { errors, message: typeof message === "string" ? message : "The given data was invalid." };
}

/** Parse an HTTP `Retry-After` header (delta-seconds or HTTP-date) to milliseconds. */
export function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}
