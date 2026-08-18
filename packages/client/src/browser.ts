/**
 * The browser-safe half of this package.
 *
 * Resolved for `import … from "@zerotal/client"` under the `browser` export
 * condition, so a bundler targeting a browser gets this file and a Bun/Node
 * import gets `index.ts` unchanged. Nobody has to know: the documented import
 * is the same either way.
 *
 * What it leaves out is `ClientProvider` and `ClientConfig` — the two things
 * here that are genuinely server-side. `ClientProvider` extends core's
 * `ServiceProvider`, which reaches `CommandRunner`, which reaches the built-in
 * CLI commands, one of which does `await import("bun")`. That is a hard error in
 * a browser build and it happens during *resolution*, so tree-shaking never gets
 * a chance to drop the unused half. The whole package became unbundleable
 * because of one export nobody in a browser wanted.
 *
 * The rule this encodes: `@zerotal/core`'s root entry is server-only. A module
 * that can run in a browser imports from a narrow subpath — `@zerotal/core/errors`,
 * `@zerotal/core/helpers` — and never from the root.
 */
export type {
  ApiRouteMap,
  RouteShape,
  HttpMethod,
  PathParams,
  ParamRecord,
  PathsFor,
  ResponseOf,
  BodyOf,
  QueryOf,
} from "./types.ts";

export { ApiClient, ApiClientError, ValidationError } from "./ApiClient.ts";
export type {
  ApiClientConfig,
  RequestConfig,
  RequestInterceptor,
  ResponseContext,
  ResponseInterceptor,
  ResponseMeta,
  RequestOptions,
  GetOptions,
  MutationOptions,
  TokenSource,
  RetryOptions,
} from "./ApiClient.ts";

export { CircuitBreaker, CircuitBreakerOpenError } from "./CircuitBreaker.ts";
export type { CircuitBreakerOptions, CircuitState } from "./CircuitBreaker.ts";

export { Socket, Channel, PresenceChannel } from "./Socket.ts";
export type { SocketOptions, SocketState, SocketLike, PresenceMember } from "./Socket.ts";

export { createApiClient } from "./createApiClient.ts";
