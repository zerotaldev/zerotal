/**
 * The HTTP client internals behind the `Http` facade: the fluent
 * `PendingRequest` builder, the `HttpClientResponse` wrapper, and the
 * request-interception machinery that powers `Http.fake()` in tests.
 */
import { ZerotalError } from "../errors/ZerotalError.ts";
import { FrameworkEvents, OutgoingRequestCompleted } from "../events/FrameworkEvents.ts";

/** An HTTP request method. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/**
 * A fake response definition matched by URL while `Http.fake()` is active.
 *
 * @internal
 */
export interface FakeStub {
  /** URL to match — exact string or glob-style `*` wildcard. */
  url: string;
  status?: number;
  /** Response body. If object/array, serialized as JSON and Content-Type set automatically. */
  body?: unknown;
  headers?: Record<string, string>;
}

let _fakeStubs: FakeStub[] | null = null;
const _recorded: Array<{ method: HttpMethod; url: string; options: RequestInit }> = [];

/** @internal Install fake stubs; while active, no real HTTP requests are made. */
export function _installFakes(stubs: FakeStub[]): void {
  _fakeStubs = stubs;
  _recorded.length = 0;
}

/** @internal Remove all fakes, restoring real HTTP behaviour. */
export function _clearFakes(): void {
  _fakeStubs = null;
  _recorded.length = 0;
}

/** @internal Return a copy of every request made while fakes are active. */
export function _getRecorded(): typeof _recorded {
  return [..._recorded];
}

function _matchUrl(pattern: string, url: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return pattern === url;
  const regex = new RegExp(
    "^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$",
  );
  return regex.test(url);
}

function _buildFakeResponse(stub: FakeStub): Response {
  const status = stub.status ?? 200;
  const headers = new Headers(stub.headers ?? {});

  if (stub.body === undefined) {
    return new Response(null, { status, headers });
  }
  if (typeof stub.body === "string") {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "text/plain");
    return new Response(stub.body, { status, headers });
  }
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(stub.body), { status, headers });
}

// ── HttpClientResponse ────────────────────────────────────────────────────────

/** Wraps a fetch Response with convenient accessors. */
export class HttpClientResponse {
  constructor(private readonly _res: Response) {}

  get status(): number {
    return this._res.status;
  }
  get ok(): boolean {
    return this._res.ok;
  }
  get headers(): Headers {
    return this._res.headers;
  }

  json<T = unknown>(): Promise<T> {
    return this._res.json() as Promise<T>;
  }
  text(): Promise<string> {
    return this._res.text();
  }
  blob(): Promise<Blob> {
    return this._res.blob();
  }

  /**
   * Return this response, or throw when the status is >= 400.
   * @throws {HttpClientError} when the underlying response is not `ok`.
   */
  throw(): this {
    if (!this._res.ok) {
      throw new HttpClientError(`HTTP ${this._res.status}`, this._res.status, this);
    }
    return this;
  }
}

/** Thrown by `HttpClientResponse.throw()` when a response has a 4xx/5xx status. */
export class HttpClientError extends ZerotalError {
  constructor(
    message: string,
    status: number,
    readonly response: HttpClientResponse,
  ) {
    super(message, "E_HTTP_CLIENT", status);
  }
}

// ── PendingRequest ────────────────────────────────────────────────────────────

/**
 * Fluent HTTP request builder.
 *
 * Can be awaited directly (`await Http.get(url)`) or chained for shorthand
 * (`await Http.post(url, data).json()`).
 */
export class PendingRequest implements PromiseLike<HttpClientResponse> {
  private _headers: Record<string, string> = {};
  private _timeout: number | undefined = undefined;
  private _retries: number = 0;
  private _retryDelay: number = 100;
  private _body: BodyInit | undefined = undefined;
  private _bodyType: "json" | "form" | "raw" = "json";

  constructor(
    private readonly _method: HttpMethod,
    private readonly _url: string,
  ) {}

  /**
   * Merge additional headers into the request.
   * @category Configuration
   */
  withHeaders(headers: Record<string, string>): this {
    Object.assign(this._headers, headers);
    return this;
  }

  /**
   * Set a Bearer token in the Authorization header.
   * @category Configuration
   */
  withToken(token: string): this {
    this._headers["Authorization"] = `Bearer ${token}`;
    return this;
  }

  /**
   * Set HTTP Basic Auth credentials.
   * @category Configuration
   */
  withBasicAuth(username: string, password: string): this {
    const encoded = btoa(`${username}:${password}`);
    this._headers["Authorization"] = `Basic ${encoded}`;
    return this;
  }

  /**
   * Set an Accept: application/json header.
   * @category Configuration
   */
  acceptJson(): this {
    this._headers["Accept"] = "application/json";
    return this;
  }

  /**
   * Abort the request after the given number of milliseconds.
   * @category Retries & resilience
   */
  timeout(ms: number): this {
    this._timeout = ms;
    return this;
  }

  /**
   * Retry failed requests up to `times` times, with optional delay in ms.
   * @category Retries & resilience
   */
  retry(times: number, delay = 100): this {
    this._retries = times;
    this._retryDelay = delay;
    return this;
  }

  /**
   * Attach a JSON body. Used internally — prefer passing data to Http.post().
   * @category Configuration
   */
  withJson(data: unknown): this {
    this._body = JSON.stringify(data);
    this._bodyType = "json";
    this._headers["Content-Type"] = "application/json";
    return this;
  }

  /**
   * Attach a FormData body.
   * @category Configuration
   */
  withFormData(data: FormData): this {
    this._body = data;
    this._bodyType = "form";
    return this;
  }

  /**
   * Execute the request and return an HttpClientResponse.
   * @category Responses
   * @throws the last error encountered after all retry attempts are exhausted
   * (e.g. a network failure or `AbortSignal.timeout` abort).
   * @throws {Error} when `Http.fake()` is active but no stub matches the URL.
   */
  async send(): Promise<HttpClientResponse> {
    const options: RequestInit = {
      method: this._method,
      headers: this._headers,
    };
    if (this._body !== undefined) options.body = this._body;

    if (_fakeStubs !== null) {
      _recorded.push({ method: this._method, url: this._url, options });
      const stub = _fakeStubs.find((candidate) => _matchUrl(candidate.url, this._url));
      if (stub) return new HttpClientResponse(_buildFakeResponse(stub));
      throw new Error(`[Http.fake] No stub matched: ${this._method} ${this._url}`);
    }

    const startedAt = performance.now();
    let lastError: unknown;
    for (let attempt = 0; attempt <= this._retries; attempt++) {
      try {
        const signal = this._timeout ? AbortSignal.timeout(this._timeout) : undefined;
        const response = await fetch(this._url, signal ? { ...options, signal } : options);
        this._emitCompleted(response.status, response.ok, performance.now() - startedAt);
        return new HttpClientResponse(response);
      } catch (error) {
        lastError = error;
        if (attempt < this._retries) {
          await new Promise((resolve) => setTimeout(resolve, this._retryDelay));
        }
      }
    }
    this._emitCompleted(0, false, performance.now() - startedAt);
    throw lastError;
  }

  /** Announce a finished outgoing request on the framework event bus (best-effort). */
  private _emitCompleted(status: number, ok: boolean, ms: number): void {
    let host = this._url;
    try {
      host = new URL(this._url).host;
    } catch {
      /* non-absolute URL — keep the raw value */
    }
    FrameworkEvents.emit(
      new OutgoingRequestCompleted(host, this._method, this._url, status, Math.round(ms), ok),
    );
  }

  /**
   * Shorthand: send and deserialize JSON response body.
   * @category Responses
   */
  json<T = unknown>(): Promise<T> {
    return this.send().then((response) => response.json<T>());
  }

  /**
   * Shorthand: send and return the text body.
   * @category Responses
   */
  text(): Promise<string> {
    return this.send().then((response) => response.text());
  }

  // Allow `await Http.get(url)` without calling .send() explicitly.
  then<TResult1 = HttpClientResponse, TResult2 = never>(
    onfulfilled?: ((value: HttpClientResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.send().then(onfulfilled, onrejected);
  }
}
