/**
 * The `Http` facade — a fluent, static entry point for making outgoing HTTP
 * requests, plus the test helpers (`fake`, `assertSent`, …) for intercepting
 * and asserting on them.
 */
import {
  PendingRequest,
  _installFakes,
  _clearFakes,
  _getRecorded,
  type FakeStub,
} from "./HttpClient.ts";

/**
 * Fluent facade for outgoing (server-to-server) HTTP requests. Static verb
 * methods ({@link Http.get}, {@link Http.post}, …) return a {@link PendingRequest}
 * that can be awaited directly or chained (`.json()`, `.text()`). Prefix a request
 * with configuration ({@link Http.withHeaders}, {@link Http.withToken},
 * {@link Http.timeout}, {@link Http.retry}) to apply it before the verb.
 *
 * The `fake`/`assert*` helpers intercept requests in tests so no real network
 * traffic occurs.
 *
 * @example
 * ```ts
 * // GET with a custom header, retry, and timeout
 * const users = await Http
 *   .withHeaders({ "X-Trace": "abc" })
 *   .retry(3, 200)      // up to 3 attempts, 200ms apart
 *   .timeout(5000)      // abort after 5s
 *   .get("https://api.example.com/users")
 *   .json();
 *
 * // POST a JSON body with a bearer token
 * const created = await Http
 *   .withToken("secret")
 *   .post("https://api.example.com/users", { name: "Alice" })
 *   .json();
 *
 * // Testing — intercept requests
 * Http.fake([{ url: "https://api.example.com/*", body: { ok: true } }]);
 * await Http.get("https://api.example.com/users");
 * Http.assertSent((req) => req.url.includes("/users"));
 * Http.resetFakes();
 * ```
 */
export class Http {
  // ── Instance builder (for chaining global options before the method) ─────

  /**
   * Start a request with the given headers applied.
   * Returns a builder whose `get`/`post`/etc. methods issue the actual request.
   * @category Configuration
   */
  static withHeaders(headers: Record<string, string>): _Builder {
    return new _Builder().withHeaders(headers);
  }

  /**
   * Set a Bearer token on the next request.
   * @category Configuration
   */
  static withToken(token: string): _Builder {
    return new _Builder().withToken(token);
  }

  /**
   * Set HTTP Basic Auth credentials.
   * @category Configuration
   */
  static withBasicAuth(username: string, password: string): _Builder {
    return new _Builder().withBasicAuth(username, password);
  }

  /**
   * Set the request timeout in milliseconds.
   * @category Retries & resilience
   */
  static timeout(milliseconds: number): _Builder {
    return new _Builder().timeout(milliseconds);
  }

  /**
   * Retry up to `times` times with optional delay.
   * @category Retries & resilience
   */
  static retry(times: number, delay?: number): _Builder {
    return new _Builder().retry(times, delay);
  }

  // ── Verb shortcuts ────────────────────────────────────────────────────────

  /**
   * Begin a GET request to `url`.
   * @category Requests
   */
  static get(url: string): PendingRequest {
    return new PendingRequest("GET", url);
  }

  /**
   * Begin a POST request to `url`, attaching `data` as a JSON body when given.
   * @category Requests
   */
  static post(url: string, data?: unknown): PendingRequest {
    const request = new PendingRequest("POST", url);
    if (data !== undefined) request.withJson(data);
    return request;
  }

  /**
   * Begin a PUT request to `url`, attaching `data` as a JSON body when given.
   * @category Requests
   */
  static put(url: string, data?: unknown): PendingRequest {
    const request = new PendingRequest("PUT", url);
    if (data !== undefined) request.withJson(data);
    return request;
  }

  /**
   * Begin a PATCH request to `url`, attaching `data` as a JSON body when given.
   * @category Requests
   */
  static patch(url: string, data?: unknown): PendingRequest {
    const request = new PendingRequest("PATCH", url);
    if (data !== undefined) request.withJson(data);
    return request;
  }

  /**
   * Begin a DELETE request to `url`.
   * @category Requests
   */
  static delete(url: string): PendingRequest {
    return new PendingRequest("DELETE", url);
  }

  /**
   * Begin a HEAD request to `url`.
   * @category Requests
   */
  static head(url: string): PendingRequest {
    return new PendingRequest("HEAD", url);
  }

  // ── Fake / testing ────────────────────────────────────────────────────────

  /**
   * Intercept all outgoing HTTP requests with the given stubs.
   * No real HTTP requests will be made while fakes are active.
   *
   * @param stubs Array of URL-response pairs. Use `'*'` to match any URL.
   * @category Testing
   * @example
   * Http.fake([
   *   { url: 'https://api.example.com/users', body: [{ id: 1 }] },
   *   { url: '*', status: 503 },
   * ]);
   */
  static fake(stubs: FakeStub[] = [{ url: "*" }]): void {
    _installFakes(stubs);
  }

  /**
   * Remove all fake stubs and restore real HTTP behaviour.
   * @category Testing
   */
  static resetFakes(): void {
    _clearFakes();
  }

  /**
   * Return all requests recorded since `Http.fake()` was called.
   * @category Testing
   */
  static recorded(): Array<{ method: string; url: string; options: RequestInit }> {
    return _getRecorded();
  }

  /**
   * Assert that at least one recorded request matches the predicate.
   * @category Testing
   * @throws {Error} when no recorded request matches.
   */
  static assertSent(predicate: (req: { method: string; url: string }) => boolean): void {
    const recorded = _getRecorded();
    const match = recorded.some(predicate);
    if (!match) {
      throw new Error(
        `Http.assertSent: no recorded request matched the predicate.\n` +
          `Recorded: ${JSON.stringify(
            recorded.map((entry) => `${entry.method} ${entry.url}`),
            null,
            2,
          )}`,
      );
    }
  }

  /**
   * Assert that no recorded request matches the predicate.
   * @category Testing
   * @throws {Error} when a recorded request matches.
   */
  static assertNotSent(predicate: (req: { method: string; url: string }) => boolean): void {
    const recorded = _getRecorded();
    const match = recorded.some(predicate);
    if (match) {
      const found = recorded.filter(predicate).map((entry) => `${entry.method} ${entry.url}`);
      throw new Error(`Http.assertNotSent: unexpected request(s) matched: ${found.join(", ")}`);
    }
  }

  /**
   * Assert that exactly `count` requests were recorded.
   * @category Testing
   * @throws {Error} when the recorded count differs from `count`.
   */
  static assertSentCount(count: number): void {
    const actual = _getRecorded().length;
    if (actual !== count) {
      throw new Error(`Http.assertSentCount: expected ${count}, got ${actual}.`);
    }
  }

  /**
   * Assert that no requests were recorded.
   * @category Testing
   * @throws {Error} when any request was recorded.
   */
  static assertNothingSent(): void {
    Http.assertSentCount(0);
  }
}

// ── Internal pre-configured builder ──────────────────────────────────────────
// Http.withToken(...).get(url) pattern

class _Builder {
  private _headers: Record<string, string> = {};
  private _timeoutMs: number | undefined = undefined;
  private _retries: number = 0;
  private _retryDelay: number = 100;

  withHeaders(headers: Record<string, string>): this {
    Object.assign(this._headers, headers);
    return this;
  }
  withToken(token: string): this {
    this._headers["Authorization"] = `Bearer ${token}`;
    return this;
  }
  withBasicAuth(username: string, password: string): this {
    this._headers["Authorization"] = `Basic ${btoa(`${username}:${password}`)}`;
    return this;
  }
  timeout(milliseconds: number): this {
    this._timeoutMs = milliseconds;
    return this;
  }
  retry(times: number, delay = 100): this {
    this._retries = times;
    this._retryDelay = delay;
    return this;
  }

  private _build(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD",
    url: string,
    data?: unknown,
  ): PendingRequest {
    const request = new PendingRequest(method, url).withHeaders(this._headers);
    if (this._timeoutMs !== undefined) request.timeout(this._timeoutMs);
    if (this._retries > 0) request.retry(this._retries, this._retryDelay);
    if (data !== undefined) request.withJson(data);
    return request;
  }

  get(url: string): PendingRequest {
    return this._build("GET", url);
  }
  post(url: string, data?: unknown): PendingRequest {
    return this._build("POST", url, data);
  }
  put(url: string, data?: unknown): PendingRequest {
    return this._build("PUT", url, data);
  }
  patch(url: string, data?: unknown): PendingRequest {
    return this._build("PATCH", url, data);
  }
  delete(url: string): PendingRequest {
    return this._build("DELETE", url);
  }
  head(url: string): PendingRequest {
    return this._build("HEAD", url);
  }
}
