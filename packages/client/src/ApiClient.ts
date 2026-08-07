import type { ApiRouteMap, ParamRecord, PathsFor, ResponseOf, BodyOf, QueryOf } from "./types.ts";
import { ApiClientError, makeApiError } from "./errors.ts";
import {
  interpolatePath,
  buildUrl,
  serializeBody,
  timeoutSignal,
  readCookie,
  resolveRetry,
  withRetry,
  type RetryOptions,
} from "./http.ts";
import { CircuitBreaker } from "./CircuitBreaker.ts";
import type { CircuitBreakerOptions } from "./CircuitBreaker.ts";

// Re-export the error vocabulary so existing `from "./ApiClient.ts"` imports keep working.
export { ApiClientError, ValidationError } from "./errors.ts";
export type { RetryOptions } from "./http.ts";

// ── Interceptor types ─────────────────────────────────────────────────────────

/**
 * The mutable request configuration passed through `onRequest` interceptors.
 * Modify and return the object (or a new one) to alter the outgoing request.
 */
export interface RequestConfig {
  method: string;
  url: string;
  /** Merged headers — modify here to add/override per-request headers. */
  headers: Record<string, string>;
  /** The request body (serialized): JSON string, `FormData`, `Blob`, … or `undefined`. */
  body: BodyInit | undefined;
}

/**
 * Called before every outgoing request. Must return the (possibly mutated) `RequestConfig`.
 *
 * @example
 * onRequest: async (cfg) => ({
 *   ...cfg,
 *   headers: { ...cfg.headers, Authorization: `Bearer ${await tokenStore.get()}` },
 * })
 */
export type RequestInterceptor = (config: RequestConfig) => RequestConfig | Promise<RequestConfig>;

/** The context passed to `onResponse` interceptors after a successful (2xx) response. */
export interface ResponseContext {
  /** HTTP status code of the response. */
  status: number;
  /** Response headers. */
  headers: Headers;
  /** Parsed response body (JSON-decoded, text, blob/arrayBuffer per `responseType`, or `undefined`). */
  data: unknown;
  /** The request config after all `onRequest` interceptors have run. */
  request: RequestConfig;
}

/**
 * Called after every successful (2xx) response, before the parsed body is returned. Must return
 * the (possibly mutated) `ResponseContext`. Useful for unwrapping API envelopes, logging, etc.
 */
export type ResponseInterceptor = (
  ctx: ResponseContext,
) => ResponseContext | Promise<ResponseContext>;

/** Lightweight response metadata handed to a per-request `meta` callback. */
export interface ResponseMeta {
  status: number;
  headers: Headers;
}

// ── Request options ───────────────────────────────────────────────────────────

export interface RequestOptions {
  /** Extra headers merged on top of the client's default headers. */
  headers?: Record<string, string>;
  /** Additional `RequestInit` fields (e.g. `credentials`, `mode`, `cache`). */
  init?: Omit<RequestInit, "method" | "headers" | "body">;
  /** Abort signal for cancellation (combined with any `timeout`). */
  signal?: AbortSignal;
  /** Per-request timeout in ms (overrides the client default; `0` disables). */
  timeout?: number;
  /** Per-request retry policy (overrides the client default; `false` disables). */
  retry?: number | RetryOptions | false;
  /** How to read the response body. Default `"auto"` (JSON with text fallback). */
  responseType?: "auto" | "json" | "text" | "blob" | "arrayBuffer";
  /** Read response metadata (status, headers) without a global interceptor. */
  meta?: (meta: ResponseMeta) => void;
}

export interface GetOptions<Q> extends RequestOptions {
  /** Query-string parameters (nested arrays/objects are serialized with bracket notation). */
  query?: Q;
}

export interface MutationOptions<Q> extends RequestOptions {
  /** URL path parameters for routes like `/api/users/{id}/action`. */
  params?: Record<string, string | number>;
  /** Query-string parameters. */
  query?: Q;
}

// ── Client config ─────────────────────────────────────────────────────────────

/** A bearer token, or a (possibly async) function resolving one per request. */
export type TokenSource =
  string | (() => string | null | undefined | Promise<string | null | undefined>);

export interface ApiClientConfig {
  /** Base URL prepended to every request path, e.g. `'https://api.example.com'`. */
  baseUrl?: string;
  /** Default headers sent with every request (e.g. `Authorization`). */
  headers?: Record<string, string>;
  /**
   * Bearer token attached as `Authorization: Bearer <token>` when no `Authorization` header is
   * already present. May be a string or a (possibly async) resolver. Update at runtime with
   * {@link ApiClient.setToken}.
   */
  token?: TokenSource;
  /** Send credentials (cookies) with every request — sets `credentials: 'include'`. */
  withCredentials?: boolean;
  /**
   * Attach the CSRF/XSRF token to mutating requests: reads the `XSRF-TOKEN` cookie and sends it as
   * `X-XSRF-TOKEN` (the SPA/session flow). Defaults to `true` when `withCredentials` is set.
   * Customize the cookie/header names with an object.
   */
  csrf?: boolean | { cookie?: string; header?: string };
  /** Default per-request timeout in ms (`0`/omitted = no timeout). */
  timeout?: number;
  /**
   * Default retry policy. `2` retries idempotent requests on network errors / 5xx / 429 with
   * exponential backoff (honoring `Retry-After`); pass {@link RetryOptions} to tune, or omit to
   * disable. Per-request `retry` overrides this.
   */
  retry?: number | RetryOptions;
  /** Called for every non-2xx response before the error is thrown. */
  onError?: (error: ApiClientError) => void | Promise<void>;
  /** Called when a request receives `403 Forbidden`. */
  onForbidden?: (error: ApiClientError) => void | Promise<void>;
  /** One or more request interceptors executed in order before every fetch. */
  onRequest?: RequestInterceptor | RequestInterceptor[];
  /** One or more response interceptors executed in order after every successful (2xx) response. */
  onResponse?: ResponseInterceptor | ResponseInterceptor[];
  /**
   * Called when a request receives `401 Unauthorized`. Receives the error and a `retry` function
   * (optionally with header overrides) to re-execute the request once.
   *
   * @example
   * onUnauthorized: async (err, retry) => retry({ Authorization: `Bearer ${await refresh()}` }),
   */
  onUnauthorized?: (
    error: ApiClientError,
    retry: (headerOverrides?: Record<string, string>) => Promise<unknown>,
  ) => Promise<unknown> | void;
  /** Attach a circuit breaker (instance to share, or options to create a dedicated one). */
  circuitBreaker?: CircuitBreaker | CircuitBreakerOptions;
}

// ── ApiClient<Routes> ───────────────────────────────────────────────────────────

/**
 * Type-safe HTTP client bound to a route map.
 *
 * Do not instantiate directly — use `createApiClient<Routes>(config)`.
 */
export class ApiClient<Routes extends ApiRouteMap> {
  private readonly _baseUrl: string;
  private readonly _headers: Record<string, string>;
  private _token: TokenSource | undefined;
  private readonly _withCredentials: boolean;
  private readonly _csrf: { cookie: string; header: string } | undefined;
  private readonly _timeout: number | undefined;
  private readonly _retry: number | RetryOptions | undefined;
  private readonly _onError: ((e: ApiClientError) => void | Promise<void>) | undefined;
  private readonly _onForbidden: ((e: ApiClientError) => void | Promise<void>) | undefined;
  private readonly _interceptors: RequestInterceptor[];
  private readonly _responseInterceptors: ResponseInterceptor[];
  private readonly _onUnauthorized: ApiClientConfig["onUnauthorized"];
  private readonly _breaker: CircuitBreaker | undefined;

  constructor(config: ApiClientConfig = {}) {
    this._baseUrl = config.baseUrl ?? "";
    this._headers = config.headers ?? {};
    this._token = config.token;
    this._withCredentials = config.withCredentials ?? false;
    this._timeout = config.timeout;
    this._retry = config.retry;
    this._onError = config.onError;
    this._onForbidden = config.onForbidden;
    this._onUnauthorized = config.onUnauthorized;
    this._interceptors = _asArray(config.onRequest);
    this._responseInterceptors = _asArray(config.onResponse);

    const csrf = config.csrf ?? (this._withCredentials ? true : false);
    this._csrf = csrf
      ? {
          cookie: (typeof csrf === "object" && csrf.cookie) || "XSRF-TOKEN",
          header: (typeof csrf === "object" && csrf.header) || "X-XSRF-TOKEN",
        }
      : undefined;

    this._breaker =
      config.circuitBreaker instanceof CircuitBreaker
        ? config.circuitBreaker
        : config.circuitBreaker
          ? new CircuitBreaker(config.circuitBreaker as CircuitBreakerOptions)
          : undefined;
  }

  /** Update (or clear) the bearer token used for subsequent requests. */
  setToken(token: TokenSource | null): void {
    this._token = token ?? undefined;
  }

  // ── GET ─────────────────────────────────────────────────────────────────────

  /**
   * Send a typed GET request.
   *
   * @example
   * const user = await api.get('/api/users/{id}', { id: 1 });   // ^? UserResource
   * const list = await api.get('/api/users', undefined, { query: { page: 2 } });
   */
  async get<Path extends PathsFor<Routes, "GET">>(
    path: Path,
    params?: ParamRecord<Path & string>,
    options?: GetOptions<QueryOf<Routes, "GET", Path & string>>,
  ): Promise<ResponseOf<Routes, "GET", Path & string>> {
    const url = buildUrl(
      this._baseUrl,
      interpolatePath(path as string, params as Record<string, string | number> | undefined),
      options?.query as Record<string, unknown> | undefined,
    );
    return this._send("GET", url, undefined, options);
  }

  // ── POST ────────────────────────────────────────────────────────────────────

  /**
   * Send a typed POST request. The body may be a plain object (JSON), `FormData`, `Blob`,
   * `URLSearchParams`, or a string.
   *
   * @example
   * await api.post('/api/users', { name: 'Alice', email: 'alice@example.com' });
   * await api.post('/api/avatars', formData);   // multipart upload
   */
  async post<Path extends PathsFor<Routes, "POST">>(
    path: Path,
    body?: BodyOf<Routes, "POST", Path & string>,
    options?: MutationOptions<QueryOf<Routes, "POST", Path & string>>,
  ): Promise<ResponseOf<Routes, "POST", Path & string>> {
    return this._send("POST", this._mutationUrl(path, options), body, options);
  }

  // ── PUT ─────────────────────────────────────────────────────────────────────

  async put<Path extends PathsFor<Routes, "PUT">>(
    path: Path,
    body?: BodyOf<Routes, "PUT", Path & string>,
    options?: MutationOptions<QueryOf<Routes, "PUT", Path & string>>,
  ): Promise<ResponseOf<Routes, "PUT", Path & string>> {
    return this._send("PUT", this._mutationUrl(path, options), body, options);
  }

  // ── PATCH ───────────────────────────────────────────────────────────────────

  async patch<Path extends PathsFor<Routes, "PATCH">>(
    path: Path,
    body?: BodyOf<Routes, "PATCH", Path & string>,
    options?: MutationOptions<QueryOf<Routes, "PATCH", Path & string>>,
  ): Promise<ResponseOf<Routes, "PATCH", Path & string>> {
    return this._send("PATCH", this._mutationUrl(path, options), body, options);
  }

  // ── DELETE ──────────────────────────────────────────────────────────────────

  async delete<Path extends PathsFor<Routes, "DELETE">>(
    path: Path,
    params?: ParamRecord<Path & string>,
    options?: RequestOptions,
  ): Promise<ResponseOf<Routes, "DELETE", Path & string>> {
    const url = buildUrl(
      this._baseUrl,
      interpolatePath(path as string, params as Record<string, string | number> | undefined),
    );
    return this._send("DELETE", url, undefined, options);
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  private _mutationUrl(path: string, options?: MutationOptions<unknown>): string {
    return buildUrl(
      this._baseUrl,
      interpolatePath(path, options?.params),
      options?.query as Record<string, unknown> | undefined,
    );
  }

  /** Merge default + token + CSRF + per-request headers. */
  private async _buildHeaders(
    method: string,
    perRequest: Record<string, string> | undefined,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = { ...this._headers, ...perRequest };

    if (this._token !== undefined && !_hasHeader(headers, "authorization")) {
      const tok = typeof this._token === "function" ? await this._token() : this._token;
      if (tok) headers["Authorization"] = `Bearer ${tok}`;
    }

    if (this._csrf && _isMutating(method) && !_hasHeader(headers, this._csrf.header)) {
      const value = readCookie(this._csrf.cookie);
      if (value) headers[this._csrf.header] = value;
    }

    return headers;
  }

  private async _parseResponse(
    res: Response,
    type: RequestOptions["responseType"],
  ): Promise<unknown> {
    if (type === "blob") return res.blob();
    if (type === "arrayBuffer") return res.arrayBuffer();
    if (res.status === 204 || res.headers.get("content-length") === "0") return undefined;
    if (type === "text") return res.text();
    const text = await res.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text; // "auto" / "json": fall back to raw text for non-JSON bodies
    }
  }

  private async _send<T>(
    method: string,
    url: string,
    body: unknown,
    options?: RequestOptions,
    _isRetry = false,
  ): Promise<T> {
    const headers = await this._buildHeaders(method, options?.headers);
    const { body: serialized, contentType } = serializeBody(body);
    if (contentType && !_hasHeader(headers, "content-type")) headers["Content-Type"] = contentType;

    let config: RequestConfig = { method, url, headers, body: serialized };
    for (const interceptor of this._interceptors) config = await interceptor(config);

    const timeout = options?.timeout ?? this._timeout;
    const policy = resolveRetry(options?.retry ?? this._retry, method);
    const userSignal = options?.signal ?? options?.init?.signal ?? undefined;
    const credentials =
      options?.init?.credentials ?? (this._withCredentials ? "include" : undefined);

    const attempt = async (): Promise<Response> => {
      const signal = timeoutSignal(timeout, userSignal);
      const init: RequestInit = { method: config.method, headers: config.headers };
      if (config.body !== undefined) init.body = config.body;
      Object.assign(init, options?.init);
      if (signal) init.signal = signal;
      if (credentials) init.credentials = credentials;

      const raw = await fetch(config.url, init);
      if (!raw.ok) {
        const text = await raw.text().catch(() => "");
        throw makeApiError(raw.status, raw.statusText, text, raw.headers);
      }
      return raw;
    };
    const runOnce = (): Promise<Response> =>
      this._breaker ? this._breaker.call(attempt) : attempt();

    let res: Response;
    try {
      res = await withRetry(runOnce, policy);
    } catch (err) {
      if (err instanceof ApiClientError) {
        // 401 → optional one-shot refresh + retry.
        if (err.status === 401 && !_isRetry && this._onUnauthorized) {
          const retry = (headerOverrides?: Record<string, string>): Promise<unknown> =>
            this._send<unknown>(
              method,
              url,
              body,
              { ...options, headers: { ...options?.headers, ...headerOverrides } },
              true,
            );
          const result = await this._onUnauthorized(err, retry);
          if (result !== undefined) return result as T;
        }
        if (err.status === 403) await this._onForbidden?.(err);
        await this._onError?.(err);
      }
      throw err;
    }

    const data = await this._parseResponse(res, options?.responseType);

    let ctx: ResponseContext = { status: res.status, headers: res.headers, data, request: config };
    for (const interceptor of this._responseInterceptors) ctx = await interceptor(ctx);

    options?.meta?.({ status: res.status, headers: res.headers });

    return ctx.data as T;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function _asArray<T>(v: T | T[] | undefined): T[] {
  return v ? (Array.isArray(v) ? v : [v]) : [];
}

function _hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

function _isMutating(method: string): boolean {
  const m = method.toUpperCase();
  return m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE";
}
