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

// Realtime broadcasting client (native @zerotal/broadcasting protocol; familiar realtime-client API).
export { Socket, Channel, PresenceChannel } from "./Socket.ts";
export type { SocketOptions, SocketState, SocketLike, PresenceMember } from "./Socket.ts";

export { ClientProvider, Client } from "./provider/ClientProvider.ts";
export { ClientConfig } from "./config.ts";
export type { ClientConfigShape } from "./config.ts";

// ── Factory function ──────────────────────────────────────────────────────────

import { ApiClient } from "./ApiClient.ts";
import type { ApiRouteMap } from "./types.ts";
import type { ApiClientConfig } from "./ApiClient.ts";

/**
 * Create a type-safe API client bound to your route map.
 *
 * @example
 * // frontend/api.ts
 * import { createApiClient } from '@zerotal/client';
 * import type { Routes } from './routes';
 *
 * export const api = createApiClient<Routes>({
 *   baseUrl: '/api',
 *   headers: { 'X-Requested-With': 'XMLHttpRequest' },
 * });
 *
 * // Anywhere in your UI:
 * const user = await api.get('/users/{id}', { id: 1 });
 * //    ^? UserResource  (inferred from Routes)
 *
 * const newUser = await api.post('/users', { name: 'Alice', email: 'alice@ex.com' });
 */
export function createApiClient<Routes extends ApiRouteMap>(
  config: ApiClientConfig = {},
): ApiClient<Routes> {
  return new ApiClient<Routes>(config);
}
