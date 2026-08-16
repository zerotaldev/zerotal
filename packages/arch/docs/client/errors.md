---
title: Client Error Handling
description: What a failed request throws, and how to tell the failure modes apart.
---

# Error handling

Non-2xx responses throw `ApiClientError`:

```ts
// in any frontend module
import { ApiClientError } from "@zerotal/client";

try {
  await api.post("/api/users", { name: "", email: "bad" });
} catch (err) {
  if (err instanceof ApiClientError) {
    console.log(err.status); // 422
    console.log(err.statusText); // 'Unprocessable Entity'
    console.log(err.body); // raw response text (the error message truncates it to 200 chars)
  }
}
```

## Telling the failure modes apart

Two very different things can go wrong, and only one of them produces an
`ApiClientError`:

| What happened                    | What is thrown                      |
| -------------------------------- | ----------------------------------- |
| The server answered with non-2xx | `ApiClientError`                    |
| A 422 in the validator's shape   | `ValidationError`                   |
| The circuit breaker is open      | `CircuitBreakerOpenError`           |
| No answer at all                 | The platform's own error, unwrapped |

That last row is the one worth internalising. A DNS failure, a dropped connection,
a CORS rejection, or an aborted request never reaches the point where a status
exists, so `fetch` rejects with its own error and the client passes it through
untouched. An `instanceof ApiClientError` check therefore does _not_ catch an
offline user — and a `catch` block that assumes `err.status` exists throws a second
error while handling the first.

```ts
try {
  await api.get("/api/users");
} catch (err) {
  if (err instanceof ValidationError) showFieldErrors(err.errors);
  else if (err instanceof ApiClientError) showStatus(err.status);
  else showOffline(); // no response: network, CORS, timeout, or abort
}
```

Timeouts and cancellations land in that final branch too, since both abort the
request rather than producing a response.

## Reading response headers

`ApiClientError` carries the response headers when there were any, which is where
rate limiters and throttles put the information you need to react well:

```ts
// in any frontend module
if (err instanceof ApiClientError && err.status === 429) {
  const waitMs = err.retryAfterMs; // parsed Retry-After, or null
  if (waitMs !== null) scheduleRetry(waitMs);
  console.log(err.headers?.get("X-RateLimit-Remaining"));
}
```

`retryAfterMs` handles both forms the header takes — a delta in seconds and an
HTTP-date — and returns milliseconds, or `null` when the header is absent or
cannot be parsed.

## Global handlers

The `onError` callback fires for every non-2xx response before the error is thrown.
Use it for global side-effects (toasts, logging) without needing try/catch at every
call site:

```ts
// app/api/client.ts
const api = createApiClient<Routes>({
  baseUrl: "https://api.example.com",
  onError: (err) => {
    toast.error(`${err.status}: ${err.statusText}`);
    logger.error("api_error", { status: err.status, body: err.body });
  },
});
```

> **Warning** — `onError` fires for every non-2xx error including 401, even when `onUnauthorized` is also configured. To suppress the global error callback for 401 during token refresh, guard by status inside `onError`.

Because `onError` only ever sees responses, it does not report the network failures
described above. Reporting that should also cover "the request never arrived"
belongs in the caller, or in a wrapper around it.

### Typed validation errors

A `422` response whose body matches the framework's validation shape (`{ message, errors }`,
as produced by [`@zerotal/validator`](/docs/validator)) throws a `ValidationError` — an
`ApiClientError` subclass with the field errors already parsed:

```ts
// in any frontend module
import { ValidationError } from "@zerotal/client";

try {
  await api.post("/api/users", form);
} catch (err) {
  if (err instanceof ValidationError) {
    setFieldErrors(err.errors); // { email: ["…"], password: ["…"] }
    err.has("email"); // boolean
    err.first("email"); // first message, or undefined
    err.fields(); // ["email", "password"]
    err.validationMessage; // "The given data was invalid."
  }
}
```

Check for `ValidationError` before `ApiClientError`. It is a subclass, so the
broader check also matches it and would swallow the parsed field errors.

A 422 whose body does not match that shape stays a plain `ApiClientError`, so an
endpoint returning its own error format still surfaces as an ordinary failure
rather than quietly producing an empty `errors` object.

`onForbidden` is the 403 counterpart of `onUnauthorized`:

```ts
// app/api/client.ts
createApiClient<Routes>({ onForbidden: () => router.push("/403") });
```

## Next steps

- [Client overview](/docs/client) — the guide's front page and the rest of the sections.
- [Resilience](/docs/client/resilience) — retries, timeouts, and the circuit breaker.
- [Authentication](/docs/client/auth) — the 401 refresh hook.
