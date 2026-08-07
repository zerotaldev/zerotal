/**
 * The HTTP error hierarchy. `HttpError` carries a status and optional response
 * headers; the named subclasses below are convenience constructors for the
 * common status codes, each with a default message and a stable error code.
 */
import { ZerotalError } from "./ZerotalError.ts";

/**
 * An error that maps directly onto an HTTP response.
 *
 * @param code - Defaults to `E_HTTP_<status>` when omitted.
 * @param headers - Response headers to merge in (e.g. `Allow`, `Retry-After`).
 */
export class HttpError extends ZerotalError {
  headers?: Record<string, string>;

  constructor(message: string, status: number, code?: string, headers?: Record<string, string>) {
    super(message, code ?? `E_HTTP_${status}`, status);
    if (headers) this.headers = headers;
  }
}

/** 400 Bad Request — the request was malformed or failed basic validation. */
export class BadRequestError extends HttpError {
  constructor(message = "Bad Request") {
    super(message, 400, "E_BAD_REQUEST");
  }
}
/** 401 Unauthorized — authentication is required and has failed or is missing. */
export class UnauthorizedError extends HttpError {
  constructor(message = "Unauthorized") {
    super(message, 401, "E_UNAUTHORIZED");
  }
}
/** 403 Forbidden — authenticated, but not allowed to perform this action. */
export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden") {
    super(message, 403, "E_FORBIDDEN");
  }
}
/** 404 Not Found — no resource matches the request. */
export class NotFoundError extends HttpError {
  constructor(message = "Not Found") {
    super(message, 404, "E_NOT_FOUND");
  }
}
/**
 * 405 Method Not Allowed — the route exists but not for this HTTP method.
 *
 * @param allowed - Methods the route does accept; populates the `Allow` header.
 */
export class MethodNotAllowedError extends HttpError {
  constructor(allowed: string[] = [], message = "Method Not Allowed") {
    super(
      message,
      405,
      "E_METHOD_NOT_ALLOWED",
      allowed.length ? { Allow: allowed.join(", ") } : undefined,
    );
  }
}
/** 409 Conflict — the request conflicts with the current state of the resource. */
export class ConflictError extends HttpError {
  constructor(message = "Conflict") {
    super(message, 409, "E_CONFLICT");
  }
}
/** 410 Gone — the resource existed once but has been permanently removed. */
export class GoneError extends HttpError {
  constructor(message = "Gone") {
    super(message, 410, "E_GONE");
  }
}
/** 422 Unprocessable Entity — well-formed but semantically invalid request. */
export class UnprocessableEntityError extends HttpError {
  constructor(message = "Unprocessable Entity") {
    super(message, 422, "E_UNPROCESSABLE_ENTITY");
  }
}
/**
 * 429 Too Many Requests — the client has exceeded a rate limit.
 *
 * @param retryAfter - Seconds to wait before retrying; populates `Retry-After`.
 */
export class TooManyRequestsError extends HttpError {
  readonly retryAfter?: number | undefined;
  constructor(retryAfter?: number, message = "Too Many Requests") {
    super(
      message,
      429,
      "E_TOO_MANY_REQUESTS",
      retryAfter !== undefined ? { "Retry-After": String(retryAfter) } : undefined,
    );
    this.retryAfter = retryAfter;
  }
}
/**
 * 503 Service Unavailable — the server is temporarily unable to handle the request.
 *
 * @param reason - Appended to the message for context (e.g. "database down").
 * @param retryAfter - Seconds to wait before retrying; populates `Retry-After`.
 */
export class ServiceUnavailableError extends HttpError {
  readonly retryAfter?: number | undefined;
  constructor(reason?: string, retryAfter?: number) {
    super(
      reason ? `Service Unavailable: ${reason}` : "Service Unavailable",
      503,
      "E_SERVICE_UNAVAILABLE",
      retryAfter !== undefined ? { "Retry-After": String(retryAfter) } : undefined,
    );
    this.retryAfter = retryAfter;
  }
}
/**
 * 500 — `RequestContext` was accessed with no active HTTP request in scope
 * (e.g. from module-level code or a background task).
 */
export class ContextOutsideRequestError extends HttpError {
  constructor() {
    super(
      "Attempted to access RequestContext outside of an active HTTP request lifecycle.",
      500,
      "E_CONTEXT_OUTSIDE_REQUEST",
    );
  }
}
