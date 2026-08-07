---
title: Client References
description: Every ApiClient method, config key, and error type in one table.
---

# References

## `createApiClient<Routes>(config)`

Returns an `ApiClient<Routes>` bound to your route map. The `config` is an
`ApiClientConfig` (see the [Configuration](/docs/client#configuration) table for the common
fields, plus `onError`, `onResponse`, `onRequest`, `onUnauthorized`, `onForbidden`,
and `circuitBreaker`).

## ApiClient methods

| Method     | Signature                                                            | Description                        |
| ---------- | -------------------------------------------------------------------- | ---------------------------------- |
| `get`      | `get(path, params?, options?: GetOptions): Promise<Response>`        | Typed GET; path params then query. |
| `post`     | `post(path, body?, options?: MutationOptions): Promise<Response>`    | Typed POST with body.              |
| `put`      | `put(path, body?, options?: MutationOptions): Promise<Response>`     | Typed PUT with body.               |
| `patch`    | `patch(path, body?, options?: MutationOptions): Promise<Response>`   | Typed PATCH with body.             |
| `delete`   | `delete(path, params?, options?: RequestOptions): Promise<Response>` | Typed DELETE; path params only.    |
| `setToken` | `setToken(token: TokenSource \| null): void`                         | Update or clear the bearer token.  |

## ApiClientError

| Member         | Signature               | Description                            |
| -------------- | ----------------------- | -------------------------------------- |
| `status`       | `number`                | HTTP status code.                      |
| `statusText`   | `string`                | HTTP status text.                      |
| `body`         | `string`                | Raw response text.                     |
| `headers`      | `Headers \| undefined`  | Response headers, when available.      |
| `retryAfterMs` | `get(): number \| null` | Parsed `Retry-After` in ms, or `null`. |

## ValidationError extends ApiClientError

| Member              | Signature                                   | Description                        |
| ------------------- | ------------------------------------------- | ---------------------------------- |
| `errors`            | `Record<string, string[]>`                  | Field → messages map.              |
| `validationMessage` | `string`                                    | Top-level `message` from the body. |
| `has`               | `has(field: string): boolean`               | Whether a field has any error.     |
| `first`             | `first(field: string): string \| undefined` | First message for a field.         |
| `all`               | `all(): Record<string, string[]>`           | The full field-error map.          |
| `fields`            | `fields(): string[]`                        | Names of every failed field.       |

## CircuitBreaker

| Member     | Signature                                   | Description                             |
| ---------- | ------------------------------------------- | --------------------------------------- |
| `call`     | `call<T>(fn: () => Promise<T>): Promise<T>` | Run `fn` under the breaker.             |
| `state`    | `get(): CircuitState`                       | `'closed'`, `'open'`, or `'half-open'`. |
| `failures` | `get(): number`                             | Current consecutive failure count.      |
| `reset`    | `reset(): void`                             | Manually return to the closed state.    |

## Next steps

- [Client overview](/docs/client) — the guide's front page and the rest of the sections.
