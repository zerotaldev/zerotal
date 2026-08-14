---
title: Error Handling
description: Turn any unhandled exception into the right HTTP response for the client and environment.
---

# Error Handling

Zerotal centralises error handling through an `ExceptionHandler` class: every
unhandled exception flows through it, and the framework picks the response format
automatically based on the client type (browser vs. API) and the environment
(dev vs. production).

## Default behaviour

In development, an unhandled error shows a styled stack-trace page in the browser
and a JSON body for API clients. In production, the browser sees a plain
"Internal Server Error" page and API clients get `{ message: 'Internal Server Error' }`
— no internals are leaked.

HTTP errors (`NotFoundError`, `ForbiddenError`, etc.) always produce a
status-code-appropriate response regardless of environment.

> **Note** — The client type is decided by the `Accept` header. A request whose
> `Accept` starts with `application/json` gets JSON; anything that includes
> `text/html` (regular browsers and Inertia XHR) gets the HTML page.

## Built-in HTTP errors

Throw any of these from a controller, middleware, or model and the framework
turns it into the correct HTTP response automatically. Each carries a default
message and a stable `code`:

```typescript
// in a controller
import { NotFoundError, ForbiddenError, UnauthorizedError } from "zerotal";

// 404
throw new NotFoundError();
throw new NotFoundError("Article not found");

// 403
throw new ForbiddenError();
throw new ForbiddenError("You cannot edit this post");

// 401
throw new UnauthorizedError();
```

For any other status, throw `HttpError` directly:

```typescript
// in a controller
import { HttpError } from "zerotal";

throw new HttpError("Payment required", 402, "E_PAYMENT_REQUIRED");
```

The constructor is `new HttpError(message, status, code?, headers?)` — when you
omit `code` it defaults to `E_HTTP_<status>`.

The full set exported from `zerotal`:

| Class                      | Status | Default `code`           |
| -------------------------- | ------ | ------------------------ |
| `BadRequestError`          | 400    | `E_BAD_REQUEST`          |
| `UnauthorizedError`        | 401    | `E_UNAUTHORIZED`         |
| `ForbiddenError`           | 403    | `E_FORBIDDEN`            |
| `NotFoundError`            | 404    | `E_NOT_FOUND`            |
| `MethodNotAllowedError`    | 405    | `E_METHOD_NOT_ALLOWED`   |
| `ConflictError`            | 409    | `E_CONFLICT`             |
| `GoneError`                | 410    | `E_GONE`                 |
| `UnprocessableEntityError` | 422    | `E_UNPROCESSABLE_ENTITY` |
| `TooManyRequestsError`     | 429    | `E_TOO_MANY_REQUESTS`    |
| `ServiceUnavailableError`  | 503    | `E_SERVICE_UNAVAILABLE`  |

> **Tip** — `MethodNotAllowedError(allowed)`, `TooManyRequestsError(retryAfter)`,
> and `ServiceUnavailableError(reason, retryAfter)` populate the `Allow` and
> `Retry-After` response headers for you when you pass those arguments.

## Custom exception classes

Extend `ZerotalError` for domain errors, or `HttpError` for HTTP errors. The
`ZerotalError` constructor is `(message, code, status = 500, context?)`:

```typescript
// app/exceptions/PaymentFailedError.ts
import { ZerotalError, HttpError } from "zerotal";

// Domain error — pass status 402 as the third argument
export class PaymentFailedError extends ZerotalError {
  constructor(public readonly chargeId: string) {
    super(`Payment failed for charge ${chargeId}`, "E_PAYMENT_FAILED", 402);
  }
}

// HTTP shortcut — HttpError takes (message, status, code?)
export class QuotaExceededError extends HttpError {
  constructor() {
    super("Quota exceeded", 429, "E_QUOTA_EXCEEDED");
  }
}
```

```typescript
// in a controller
throw new PaymentFailedError(charge.id);
```

## Custom exception handler

Create a handler in `app/exceptions/Handler.ts` extending `ExceptionHandler`,
then register it in `bootstrap/app.ts` with `app.withExceptionHandler(Handler)`.
The framework calls `report()` first, then `render()`, for every unhandled
exception:

```typescript
// app/exceptions/Handler.ts
import { ExceptionHandler, NotFoundError, ForbiddenError } from "zerotal";
import type { HttpContext } from "zerotal";
import { PaymentFailedError } from "./PaymentFailedError.ts";

export class Handler extends ExceptionHandler {
  // report() runs first — use it to log to Sentry, Datadog, etc.
  override async report(err: unknown, ctx?: HttpContext): Promise<void> {
    if (err instanceof NotFoundError) return; // skip expected errors
    if (err instanceof ForbiddenError) return;

    await Sentry.captureException(err, { extra: { path: ctx?.path() } });

    // Call super to keep the default console logging.
    await super.report(err, ctx);
  }

  // render() turns an error into a Response.
  override async render(err: unknown, ctx: HttpContext): Promise<Response> {
    if (err instanceof PaymentFailedError) {
      if (ctx.wantsJson()) {
        return Response.json({ message: err.message, chargeId: err.chargeId }, { status: 402 });
      }
      ctx.flash("error", "Your payment could not be processed.");
      return new Response(null, { status: 303, headers: { Location: "/billing" } });
    }

    // Fall back to the framework default for everything you don't handle.
    return super.render(err, ctx);
  }
}
```

```typescript
// bootstrap/app.ts
import { Application } from "zerotal";
import providers from "./providers.ts";
import { Handler } from "../app/exceptions/Handler.ts";

export default Application.create({ providers }).withExceptionHandler(Handler);
```

> **Warning** — Always call `super.render(err, ctx)` as the final fallback. If you
> forget it, any error your `render()` doesn't explicitly handle falls through
> without a response.

## Silencing expected errors

`report()` is for errors you want tracked externally. Errors that are normal user
behaviour (404, 403, validation) should not page anyone. The base handler already
silences a few by name — `ValidationRedirectError`, `ValidationJsonError`,
`ValidationError`, `PrecognitionResponse`, and `NotFoundError` — so they never
reach `console.error`.

To silence your own classes, list them on the `dontReport` array instead of
filtering by hand:

```typescript
// app/exceptions/Handler.ts
import { ExceptionHandler, ForbiddenError } from "zerotal";
import { PaymentFailedError } from "./PaymentFailedError.ts";

export class Handler extends ExceptionHandler {
  protected override dontReport = [ForbiddenError, PaymentFailedError];
}
```

> **Tip** — Prefer `dontReport` over a manual `instanceof` chain in `report()`.
> The base `report()` checks it for you, so any error whose class (or class name)
> is in the silent list is skipped before logging.

## Response format by client type

The base handler negotiates the response from the `Accept` header and the
environment:

| Situation              | Browser                       | API client (`Accept: application/json`)               |
| ---------------------- | ----------------------------- | ----------------------------------------------------- |
| `NotFoundError`        | Styled 404 HTML page          | `{ message: 'Not Found', code: 'E_NOT_FOUND' }`       |
| `ForbiddenError`       | Styled 403 HTML page          | `{ message: 'Forbidden', code: 'E_FORBIDDEN' }`       |
| Unhandled error (dev)  | Full stack-trace page         | `{ message: '...', code: 'E_INTERNAL' }`              |
| Unhandled error (prod) | "Internal Server Error" page  | `{ message: 'Internal Server Error' }`                |
| `ValidationError`      | 303 redirect + flashed errors | `{ message: 'Validation failed', errors: {...} }` 422 |

## Validation errors

The validation system throws automatically — you don't catch anything. It throws
`ValidationRedirectError` (a 303 redirect for browser clients) or
`ValidationJsonError` (a 422 JSON body for API clients), and both flow straight
through the handler:

```typescript
// in a controller
// Browser → 303 redirect back with flashed errors
// API     → 422 JSON: { message: 'Validation failed', errors: {...} }
const data = await StorePostRequest.validate();
```

See the [Validator](/docs/validator) guide for details.

## Error codes

Every `ZerotalError` carries a machine-readable `code` string alongside the HTTP
`status`. Use it on the client to distinguish errors that share a status:

```typescript
// the API client receives:
// { "message": "Payment failed for charge ch_xxx", "code": "E_PAYMENT_FAILED" }

if (error.code === "E_PAYMENT_FAILED") {
  showPaymentFailedUI(error.chargeId);
}
```

## afterResponse and errors

Errors thrown inside `ctx.afterResponse()` callbacks are logged but never sent to
the client — the response has already been delivered by the time these fire, so a
failing callback can't crash the request.

## The development error page, and diagnoses

Outside production, an unhandled error renders a full-page overlay: the message, the stack split into application and framework frames, source context around the failing line, the request, and a **Copy for AI** button that puts the whole thing on the clipboard as Markdown.

Some errors are exact about _what_ happened and useless about _what to do_. `no such table: assets` is the canonical one — the message is precise, and every frame in the stack is inside the SQL driver, because that is where the failure surfaced rather than where it came from. The answer is somewhere else entirely: you have migrations you have not run.

So a package that owns an error class can contribute a **diagnosis**, rendered above the stack.

### Missing tables and columns

`@zerotal/orm` registers one. When a query fails because a table or column does not exist, the overlay checks the migration state and answers one of two ways:

- **Migrations are pending** — it names them and offers a **Run migrations** button. Pressing it runs exactly what `bun zt migrate` would, then reloads the page.
- **Nothing is pending** — it offers **no button**, because running every pending migration when there are none changes nothing and leaves you back where you started. Instead it says whether any migration on disk so much as mentions the missing name: if none does, the migration that would create it was probably never written.

It works on SQLite, PostgreSQL and MySQL — matched on the driver's error code where there is one (`42P01`, `42703`, `1146`, `1054`) and on the message otherwise.

> **The button exists only in development.** The endpoint behind it refuses unless [`devSurfacesEnabled()`](/docs/deployment) is true, and that gate **fails closed**: an unset `APP_ENV` does not qualify. The route is not even registered otherwise.
>
> It also requires a single-use token minted into the page, and passes the same origin check the WebSocket endpoints use. A dev server on `localhost:3000` is reachable by any site you have open in another tab, and "run every pending migration" is not something a random page should be able to trigger.

### Writing your own

`registerErrorDiagnoser` takes a function that either recognises an error or returns `null`. Register it from a provider's `onRegister()`:

```typescript
import { registerErrorDiagnoser } from "zerotal";

registerErrorDiagnoser((error) => {
  if (!/ECONNREFUSED .*:6379/.test(error.message)) return null;
  return {
    title: "Redis refused the connection.",
    detail:
      "The cache and queue drivers are both configured to use it. Start it with `docker compose up redis`, or switch `cache.driver` to `memory` while you work.",
    items: ["cache.driver = redis", "queue.driver = redis"],
  };
});
```

The function is an `ErrorDiagnoser`, and what it returns is an `ErrorDiagnosis`.

Diagnosers run in registration order and the **first** one to return a result wins, so recognise only errors you genuinely own — a diagnoser that claims an error it cannot explain replaces a real stack trace with a wrong answer. One that throws is skipped rather than taking the error page down with it.

| Field    | Meaning                                                             |
| -------- | ------------------------------------------------------------------- |
| `title`  | One line: what is actually wrong.                                   |
| `detail` | A short paragraph: why, and what to do.                             |
| `items`  | Supporting specifics — file names, config keys. Rendered as a list. |
| `action` | A button. See below.                                                |

An `action` is a `DiagnosisAction`: a `label`, a same-origin `url` to `POST` to, a `token`, and an optional `pendingLabel`.

> **An `action` changes server state from a page rendered by a GET.** Whoever registers the endpoint owns its safety, and the type only carries the values to the page. The endpoint must refuse outside development _on its own terms_ rather than trusting that the overlay is dev-only, require the token, and check the origin. If you cannot do all three, ship the diagnosis without a button — a `title` and `detail` that name the fix are most of the value.

Offer a button only when you are confident it helps. A button that runs and changes nothing is worse than no button, because it teaches people not to trust the panel.

## References

`ExceptionHandler` is the class you subclass; the named errors are exported from
`zerotal`.

| Member         | Signature                                                   | Description                                                                        |
| -------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `report`       | `report(err: unknown, ctx?: HttpContext): Promise<void>`    | Called first; log or forward the error. Override to add tracking.                  |
| `render`       | `render(err: unknown, ctx: HttpContext): Promise<Response>` | Turns an error into a `Response`. Override per error class, call `super`.          |
| `dontReport`   | `protected dontReport: Array<new (...args) => unknown>`     | Error classes to skip in `report()`.                                               |
| `ZerotalError` | `new ZerotalError(message, code, status = 500, context?)`   | Base framework error with a `code`, `status`, and optional `context`.              |
| `HttpError`    | `new HttpError(message, status, code?, headers?)`           | Error mapped directly onto an HTTP response; `code` defaults to `E_HTTP_<status>`. |

| Method (on `HttpContext`) | Signature                 | Description                                               |
| ------------------------- | ------------------------- | --------------------------------------------------------- |
| `wantsJson`               | `wantsJson(): boolean`    | `true` when the client expects a JSON response.           |
| `path`                    | `path(): string`          | The request path, handy for error context.                |
| `flash`                   | `flash(key, value): void` | Stash data for the next request (e.g. before a redirect). |

## Next steps

- [Validator](/docs/validator) — the validation errors that flow through the handler.
- [Logger](/docs/logger) — where `report()` writes by default.
- [HTTP context](/docs/context) — the `ctx` passed to `report()` and `render()`.
- [Telemetry](/docs/telemetry) — forward reported errors to an external tracker.
