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

export { createApiClient } from "./createApiClient.ts";
