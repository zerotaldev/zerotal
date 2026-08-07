import { ZerotalError } from "@zerotal/core";

/**
 * Base class for all `@zerotal/session` errors; extends the framework's
 * {@link ZerotalError}. Catch this to handle any session failure generically.
 * Defaults: code `E_SESSION`, HTTP status `500`.
 */
export class SessionError extends ZerotalError {
  /**
   * @param message - Human-readable error message.
   * @param code - Machine-readable error code. Default: `"E_SESSION"`.
   * @param status - HTTP status to surface. Default: `500`.
   * @param context - Optional structured context attached to the error.
   */
  constructor(
    message: string,
    code = "E_SESSION",
    status = 500,
    context?: Record<string, unknown>,
  ) {
    super(message, code, status, context);
  }
}

/**
 * Thrown when {@link CookieDriver} is constructed with an empty signing secret.
 * Code `E_SESSION_SECRET_MISSING`, status `500`. Fix by setting
 * `session.secret` in config (e.g. from a `SESSION_SECRET` env var).
 */
export class SessionSecretMissingError extends SessionError {
  constructor() {
    super(
      "[Zerotal Session] CookieDriver requires a non-empty secret. Set session.secret in your config (e.g. from SESSION_SECRET env var).",
      "E_SESSION_SECRET_MISSING",
      500,
    );
  }
}

/**
 * Thrown by {@link CookieDriver.saveSession} when the serialized session cookie
 * would exceed the 4096-byte limit browsers enforce per cookie (RFC 6265 §6.1).
 * Anything larger is silently truncated or dropped by the client — corrupting or
 * losing the session — so the driver refuses to emit it instead. Store bulky
 * data server-side (Redis driver, cache, database) and keep only identifiers in
 * the session. Code `E_SESSION_COOKIE_OVERFLOW`, status `500`; the actual and
 * limit byte counts are attached as context.
 */
export class SessionCookieOverflowError extends SessionError {
  /**
   * @param size - Serialized cookie size in bytes.
   * @param limit - The enforced maximum (4096) in bytes.
   */
  constructor(size: number, limit: number) {
    super(
      `[Zerotal Session] Serialized session cookie is ${size} bytes, exceeding the ${limit}-byte browser limit. ` +
        "Move large values out of the cookie session (use the Redis driver or a server-side store).",
      "E_SESSION_COOKIE_OVERFLOW",
      500,
      { size, limit },
    );
  }
}

/**
 * Thrown by {@link SessionMiddleware} on the first request when no driver was
 * supplied directly and none is registered in the container. Code
 * `E_SESSION_DRIVER_MISSING`, status `500`. Fix by registering
 * {@link SessionProvider} or using `SessionMiddleware.withDriver()`.
 */
export class SessionDriverMissingError extends SessionError {
  constructor() {
    super(
      "[Zerotal Session] No session driver configured. Register SessionProvider or use SessionMiddleware.withDriver().",
      "E_SESSION_DRIVER_MISSING",
      500,
    );
  }
}
