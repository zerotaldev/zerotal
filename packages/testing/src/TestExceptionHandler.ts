import { ExceptionHandler, type HttpContext } from "@zerotal/core";

/**
 * The exception handler {@link TestApp} installs so a request's failure is
 * visible to the test that made it.
 *
 * Without it, an exception inside a route is converted to a response and the
 * original is gone: a test sees `500` and a rendered error page, and finding the
 * actual bug means re-running the route by hand. This records every error it
 * renders, so the failing assertion can quote the stack that caused it.
 *
 * It delegates to whatever handler the application already had, so a suite
 * testing a custom handler still exercises that handler. In capture mode
 * ({@link TestApp.withoutExceptionHandling}) it skips both reporting and
 * rendering and returns a bare `500` instead — the response no longer matters
 * once the test is reading the exception directly, and skipping `report()`
 * keeps expected failures from writing stack traces into the test output.
 *
 * @internal
 */
export class TestExceptionHandler extends ExceptionHandler {
  /** When true, do not report or delegate rendering — capture and return a bare 500. */
  captureMode = false;

  /** The most recent error rendered, cleared by {@link TestApp} before each request. */
  lastError: unknown = undefined;

  /**
   * The handler this one displaced, if the application had registered its own.
   * Assigned after construction because installing this handler is what reveals
   * the previous one.
   */
  inner: ExceptionHandler | undefined = undefined;

  override async report(error: unknown, ctx?: HttpContext): Promise<void> {
    this.lastError = error;
    if (this.captureMode) return;
    if (this.inner) return this.inner.report(error, ctx);
    return super.report(error, ctx);
  }

  override async render(error: unknown, ctx: HttpContext): Promise<Response> {
    this.lastError = error;
    if (this.captureMode) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(`[Zerotal/testing] Uncaught: ${message}`, {
        status: 500,
        headers: { "X-Zerotal-Test-Exception": "1" },
      });
    }
    if (this.inner) return this.inner.render(error, ctx);
    return ExceptionHandler.defaultRender(error, ctx);
  }
}
