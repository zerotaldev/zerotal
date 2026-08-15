import { Application } from "@zerotal/core";
import { TestResponse, type SessionDecoder } from "./TestResponse.ts";
import { TestExceptionHandler } from "./TestExceptionHandler.ts";
import { resetTestState } from "./resetTestState.ts";

type BunServer = { port: number; stop(drain?: boolean): void };

/**
 * Wrapper around a running Application that provides an HTTP test client.
 * Obtain an instance via createTestApp().
 *
 * @example
 * const app = await createTestApp(bootstrap);
 *
 * // Authenticated request
 * const res = await app.actingAs(user).get('/profile');
 * res.assertStatus(200);
 *
 * // Reset auth between tests
 * app.actingAsGuest();
 *
 * await app.close();
 */
/** Structural view of the container-bound session driver we need to encode a cookie. */
type SessionDriverLike = {
  cookieName?: string;
  saveSession(id: string, data: Record<string, unknown>, response: Response): Promise<void>;
  loadFromRequest(request: Request): Promise<{ id: string; data: Record<string, unknown> }>;
};

/** A file to attach to a multipart request. */
export interface TestFileInput {
  /** File contents. A string is encoded as UTF-8. */
  content: string | Uint8Array | Blob | File;
  /** Filename sent in the part's `Content-Disposition`. Defaults to `file`. */
  filename?: string;
  /** MIME type sent for the part. Defaults to `application/octet-stream`. */
  type?: string;
}

/** Field values a form or multipart request accepts. */
export type TestFormValue =
  string | number | boolean | null | undefined | TestFileInput | File | Blob;

export class TestApp {
  private readonly _server: BunServer;
  private _authCookie: string | undefined = undefined;
  // Auth intent is captured synchronously (so `actingAs(u).get()` stays chainable)
  // and encoded into a real session cookie lazily in request(), using the app's
  // own `session.driver` — so it always matches the driver's format (currently
  // AES-256-GCM encryption, not the legacy HMAC-signed format).
  private _actingUser: { id: number | string } | undefined = undefined;
  private _sessionData: Record<string, unknown> | undefined = undefined;
  private _globalHeaders: Record<string, string> = {};
  private _cookies: Record<string, string> = {};
  private _followRedirects: boolean = false;
  // `undefined` = not resolved yet; `null` = the app binds no session driver.
  private _sessionDriver: SessionDriverLike | null | undefined = undefined;

  constructor(
    private readonly _app: Application,
    private readonly _errors?: TestExceptionHandler,
  ) {
    const server = (_app as unknown as { _static: BunServer })._static;
    if (!server)
      throw new Error("[Zerotal/testing] App has no running server. Did you call start()?");
    this._server = server;
  }

  get port(): number {
    return this._server.port;
  }

  /** Base URL for all requests, e.g. http://localhost:52340 */
  get baseUrl(): string {
    return `http://localhost:${this.port}`;
  }

  /** The underlying application, for resolving container bindings inside a test. */
  get app(): Application {
    return this._app;
  }

  // ── Auth helpers ──────────────────────────────────────────────────────────

  /**
   * Forge a signed session cookie containing user_id so subsequent requests
   * behave as if the given user is authenticated via AuthMiddleware.
   *
   * Reads session.secret and session.cookie from the container config.
   * Chainable — returns `this` so you can inline it:
   *   `await app.actingAs(user).get('/profile')`
   *
   * @example
   * const res = await app.actingAs(user).get('/profile');
   * res.assertStatus(200);
   */
  actingAs(user: { id: number | string }): this {
    this._actingUser = user;
    this._authCookie = undefined; // rebuilt lazily against the app's session driver
    return this;
  }

  /**
   * Clear any auth cookie set by actingAs()/withSession(). Subsequent requests are guest.
   * Call in afterEach to reset state between tests.
   */
  actingAsGuest(): this {
    this._actingUser = undefined;
    this._sessionData = undefined;
    this._authCookie = undefined;
    return this;
  }

  /**
   * Pre-seed session data for the next request, merged with any `actingAs()` user.
   * Encoded into a real cookie by the app's session driver on the next request.
   *
   * @example
   * const res = await app.withSession({ locale: 'fr', flash_status: 'saved' }).get('/profile');
   */
  withSession(data: Record<string, unknown>): this {
    this._sessionData = { ...(this._sessionData ?? {}), ...data };
    this._authCookie = undefined; // rebuilt lazily
    return this;
  }

  /**
   * Enable automatic redirect following for all requests on this instance.
   * The test client will follow up to 10 Location redirects transparently.
   *
   * @example
   * const res = await app.followingRedirects().post('/login', { email, password });
   * res.assertOk(); // landed on dashboard, not the 302
   */
  followingRedirects(): this {
    this._followRedirects = true;
    return this;
  }

  /** Disable redirect following (restores default behaviour). */
  withoutFollowingRedirects(): this {
    this._followRedirects = false;
    return this;
  }

  /**
   * Merge extra headers into every request sent by this TestApp instance.
   * Useful for setting Accept, Authorization, or custom app headers globally.
   *
   * @example
   * app.withHeaders({ 'X-App-Version': '2' });
   */
  withHeaders(headers: Record<string, string>): this {
    this._globalHeaders = { ...this._globalHeaders, ...headers };
    return this;
  }

  /**
   * Send the request as an API client: `Accept: application/json`. Errors then
   * come back as JSON rather than as the rendered HTML error page, which is what
   * the JSON assertions expect.
   *
   * @example
   * const res = await app.asJson().post('/api/posts', { title: '' });
   * res.assertUnprocessable().assertInvalid('title');
   */
  asJson(): this {
    return this.withHeaders({ Accept: "application/json" });
  }

  /**
   * Attach a cookie to every subsequent request.
   *
   * @example
   * app.withCookie('theme', 'dark');
   */
  withCookie(name: string, value: string): this {
    this._cookies[name] = value;
    return this;
  }

  /** Attach several cookies to every subsequent request. */
  withCookies(cookies: Record<string, string>): this {
    this._cookies = { ...this._cookies, ...cookies };
    return this;
  }

  /** Drop all cookies added with {@link withCookie}/{@link withCookies}. */
  withoutCookies(): this {
    this._cookies = {};
    return this;
  }

  // ── Exception handling ────────────────────────────────────────────────────

  /**
   * Stop converting exceptions into error pages: the error is captured and the
   * response is a bare `500`, so `res.exception()` hands you the original and
   * any failing assertion quotes its stack.
   *
   * Reach for it when a test is failing on a `500` and the rendered page is
   * telling you nothing. Errors are captured either way — this additionally
   * silences the handler's reporting, so an expected failure stops writing a
   * stack trace into the test output.
   *
   * @example
   * const res = await app.withoutExceptionHandling().get('/checkout');
   * expect(res.exception()).toBeInstanceOf(PaymentDeclinedError);
   */
  withoutExceptionHandling(): this {
    if (!this._errors) {
      throw new Error(
        "[Zerotal/testing] withoutExceptionHandling() needs an app built by createTestApp().",
      );
    }
    this._errors.captureMode = true;
    return this;
  }

  /** Restore normal exception rendering (the default). */
  withExceptionHandling(): this {
    if (this._errors) this._errors.captureMode = false;
    return this;
  }

  // ── HTTP client ───────────────────────────────────────────────────────────

  /**
   * Make an HTTP request to the test server.
   * Merges any global headers and the auth cookie automatically.
   */
  async request(url: string, init: RequestInit = {}): Promise<TestResponse> {
    const full = url.startsWith("http") ? url : `${this.baseUrl}${url}`;

    await this._ensureAuthCookie();

    // Merge global headers, then per-request headers, then auth cookie.
    const headers = new Headers({
      ...this._globalHeaders,
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    });

    const cookiePairs = Object.entries(this._cookies).map(([k, v]) => `${k}=${v}`);
    if (this._authCookie) cookiePairs.unshift(this._authCookie);
    if (cookiePairs.length > 0) {
      const existing = headers.get("Cookie");
      const merged = cookiePairs.join("; ");
      headers.set("Cookie", existing ? `${merged}; ${existing}` : merged);
    }

    if (this._errors) this._errors.lastError = undefined;

    let res = await fetch(full, { ...init, headers, redirect: "manual" });

    if (this._followRedirects) {
      let hops = 0;
      while (res.status >= 300 && res.status < 400 && hops < 10) {
        const location = res.headers.get("Location");
        if (!location) break;
        const nextUrl = location.startsWith("http") ? location : `${this.baseUrl}${location}`;
        // Propagate any Set-Cookie from the redirect response
        const setCookie = res.headers.get("Set-Cookie");
        const nextHeaders = new Headers(headers);
        if (setCookie) {
          const existing = nextHeaders.get("Cookie") ?? "";
          const cookiePair = setCookie.split(";")[0] ?? "";
          nextHeaders.set("Cookie", existing ? `${existing}; ${cookiePair}` : cookiePair);
        }
        res = await fetch(nextUrl, { method: "GET", headers: nextHeaders, redirect: "manual" });
        hops++;
      }
    }

    return TestResponse.of(res, {
      session: await this._sessionDecoder(),
      exception: this._errors?.lastError,
    });
  }

  /** Send a GET request. */
  async get(url: string, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.request(url, { method: "GET", headers });
  }

  /** Send a HEAD request. */
  async head(url: string, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.request(url, { method: "HEAD", headers });
  }

  /** Send an OPTIONS request. */
  async options(url: string, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.request(url, { method: "OPTIONS", headers });
  }

  /** Send a POST request with a JSON body. */
  async post(
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    return this.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  /** Send a PUT request with a JSON body. */
  async put(
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    return this.request(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  /** Send a PATCH request with a JSON body. */
  async patch(
    url: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    return this.request(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  /** Send a DELETE request. */
  async delete(url: string, headers: Record<string, string> = {}): Promise<TestResponse> {
    return this.request(url, { method: "DELETE", headers });
  }

  // ── Form and file-upload requests ─────────────────────────────────────────

  /**
   * Submit a URL-encoded form, the way a browser posts one.
   *
   * A JSON `post()` does not exercise the same path: form submits are what
   * trigger the redirect-back-with-errors branch of validation, the CSRF check,
   * and any middleware that reads `application/x-www-form-urlencoded`. A route
   * meant for a browser should be tested the way a browser reaches it.
   *
   * @example
   * const res = await app.postForm('/posts', { title: 'Hello', published: true });
   * res.assertRedirect('/posts');
   */
  async postForm(
    url: string,
    body: Record<string, TestFormValue> = {},
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    return this._formRequest("POST", url, body, headers);
  }

  /** Submit a URL-encoded form with `PUT`. */
  async putForm(
    url: string,
    body: Record<string, TestFormValue> = {},
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    return this._formRequest("PUT", url, body, headers);
  }

  /** Submit a URL-encoded form with `PATCH`. */
  async patchForm(
    url: string,
    body: Record<string, TestFormValue> = {},
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    return this._formRequest("PATCH", url, body, headers);
  }

  /**
   * Submit a `multipart/form-data` request — the only way to exercise a route
   * that reads uploaded files.
   *
   * Pair it with {@link fakeFile} to build the attachments; plain values are
   * sent as ordinary fields alongside them.
   *
   * @example
   * const res = await app.multipart('/avatar', {
   *   name: 'Alice',
   *   avatar: fakeFile.image('avatar.png', { width: 64, height: 64 }),
   * });
   * res.assertCreated();
   */
  async multipart(
    url: string,
    body: Record<string, TestFormValue> = {},
    headers: Record<string, string> = {},
    method: "POST" | "PUT" | "PATCH" = "POST",
  ): Promise<TestResponse> {
    const form = new FormData();
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || value === null) continue;
      if (value instanceof File) {
        form.append(key, value);
      } else if (value instanceof Blob) {
        form.append(key, value, key);
      } else if (typeof value === "object") {
        form.append(key, _toFile(value));
      } else {
        form.append(key, String(value));
      }
    }
    // Content-Type is deliberately not set: fetch derives it from the FormData,
    // and it must carry the generated multipart boundary.
    return this.request(url, { method, headers, body: form });
  }

  /** @internal Set when this app is the per-process shared instance (see createTestApp). */
  _shared = false;

  /**
   * Stop the test server and shut the app's providers down. Call in `afterAll()`.
   *
   * When this app is the per-process shared instance — the normal case, where each
   * test file calls `createTestApp()` with the same `bootstrap/app.ts` — this only
   * resets per-test state (auth, flash, captured mail) and leaves the app running for
   * the files that come after. Tearing it down here would close the process-global
   * database connection out from under them, and the file that broke would be an
   * entirely correct one that merely ran second.
   *
   * The shared instance is torn down once, by {@link closeSharedTestApps}.
   */
  async close(): Promise<void> {
    if (this._shared) {
      resetTestState();
      return;
    }
    // Run the full provider teardown (onStopping/onStopped), not just the HTTP
    // server: otherwise queue polling intervals, monitor timers, worker threads,
    // and DB connections from this test file keep running while the next file
    // boots a new app in the same process — a real source of flaky suites and
    // `bun test` runs that never exit. `exit: false` keeps the test process alive.
    await this._app.stop({ exit: false });
    resetTestState();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /** Send `body` as `application/x-www-form-urlencoded`. */
  private async _formRequest(
    method: string,
    url: string,
    body: Record<string, TestFormValue>,
    headers: Record<string, string>,
  ): Promise<TestResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || value === null) continue;
      if (typeof value === "object") {
        throw new Error(
          `[Zerotal/testing] Field "${key}" is a file — use multipart() instead of ${method.toLowerCase()}Form().`,
        );
      }
      params.append(key, String(value));
    }
    return this.request(url, {
      method,
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: params.toString(),
    });
  }

  /** Resolve (once) the app's session driver, or `null` when it binds none. */
  private async _driver(): Promise<SessionDriverLike | null> {
    if (this._sessionDriver !== undefined) return this._sessionDriver;
    try {
      const container = this._app.container as unknown as { make(token: string): Promise<unknown> };
      this._sessionDriver = (await container.make("session.driver")) as SessionDriverLike;
    } catch {
      this._sessionDriver = null;
    }
    return this._sessionDriver;
  }

  /**
   * Build the decoder {@link TestResponse} uses for session assertions: it feeds
   * the response's cookies back through the app's own driver, so whatever format
   * the driver writes is the format that gets read. Returns `undefined` when the
   * app binds no driver, which the assertions report as "no session to read".
   */
  private async _sessionDecoder(): Promise<SessionDecoder | undefined> {
    const driver = await this._driver();
    if (!driver || typeof driver.loadFromRequest !== "function") return undefined;
    const cookieName = driver.cookieName;

    return async (response: Response): Promise<Record<string, unknown> | null> => {
      const pairs: string[] = [];
      response.headers.forEach((value, name) => {
        if (name.toLowerCase() !== "set-cookie") return;
        const pair = value.split(";")[0]?.trim();
        if (!pair) return;
        // Only the session cookie matters; an unrelated `theme=dark` must not be
        // mistaken for "a session was set" and reported as an empty session.
        if (cookieName && !pair.startsWith(`${cookieName}=`)) return;
        pairs.push(pair);
      });
      if (pairs.length === 0) return null;

      const request = new Request(this.baseUrl, { headers: { Cookie: pairs.join("; ") } });
      const payload = await driver.loadFromRequest(request);
      return payload?.data ?? null;
    };
  }

  /**
   * Encode the pending `actingAs()` user / `withSession()` data into a real
   * session cookie using the app's own `session.driver`. Doing it through the
   * driver (rather than hand-rolling crypto) guarantees the cookie matches the
   * driver's exact format — encrypted (AES-256-GCM), signed, or otherwise.
   * No-op when neither actingAs nor withSession has been called.
   */
  private async _ensureAuthCookie(): Promise<void> {
    if (this._authCookie !== undefined) return;
    if (this._actingUser === undefined && this._sessionData === undefined) return;

    const data: Record<string, unknown> = { ...(this._sessionData ?? {}) };
    if (this._actingUser) data["user_id"] = this._actingUser.id;

    const driver = await this._driver();
    if (!driver) {
      throw new Error(
        "[Zerotal/testing] actingAs()/withSession() need a `session.driver` binding — " +
          "register SessionProvider in the app you pass to createTestApp().",
      );
    }
    const res = new Response();
    await driver.saveSession(crypto.randomUUID(), data, res);
    const setCookie = res.headers.get("Set-Cookie");
    // Keep just the `name=value` pair (drop attributes like Path/HttpOnly/Max-Age).
    this._authCookie = setCookie ? (setCookie.split(";")[0] ?? undefined) : undefined;
  }
}

/** Turn a {@link TestFileInput} into the `File` FormData wants. */
function _toFile(input: TestFileInput | File | Blob): File {
  if (input instanceof File) return input;
  if (input instanceof Blob) return new File([input], "file", { type: input.type });
  const { content, filename = "file", type = "application/octet-stream" } = input;
  if (content instanceof File) return content;
  const parts = typeof content === "string" ? [content] : [content as BlobPart];
  return new File(parts, filename, { type });
}

/**
 * Boot the app and start it on an OS-assigned port (port 0).
 *
 * Routes must be registered in the optional `setup` callback (called after
 * reset but before start) so they are compiled into the server correctly.
 *
 * @example
 * import { Application, Router } from '@zerotal/core';
 * import { DatabaseProvider } from '@zerotal/orm';
 *
 * const app = await createTestApp(
 *   () => Application.create({ env: 'test' }).register([DatabaseProvider]).useConfig({ database: { url: ':memory:' } }),
 *   () => { Router.get('/ping', PingController, 'handle'); },
 * );
 */
/**
 * The per-process shared apps, keyed by the {@link Application} they wrap.
 *
 * Bun runs an entire test suite in one process, and the ORM connection is
 * process-global — so a second file that boots its own app inherits a connection the
 * first file's `afterAll` already closed, and dies in `migrateDatabase()` with
 * "No database connection". Booting once and handing the same instance to every file
 * removes the interference without asking each test file to know about it.
 *
 * Keyed by the Application and not by the `bootstrap` callback: the scaffolded pattern
 * is `createTestApp(() => import('../bootstrap/app.ts').then((m) => m.default))`, a
 * fresh arrow on every call. The module it imports is cached, so the *Application* is
 * the thing that is genuinely the same across files.
 */
const _sharedApps = new Map<Application, TestApp>();

export async function createTestApp(
  bootstrap: () => Application | Promise<Application>,
  setup?: () => void,
): Promise<TestApp> {
  // A `setup` callback registers routes, and registering them twice against an
  // already-started server is not idempotent — so those callers always get a fresh
  // app and own its teardown, exactly as before.
  //
  // Reset BEFORE probing, not after. `bootstrap()` may be evaluating its module for
  // the first time, and the scaffolded bootstrap builds its Application at module
  // scope — so probing first calls `Application.create()` while the previous file's
  // app is still installed, and it throws "An application already exists in this
  // process" before sharing is ever considered. Whether an app is still installed
  // depends on which file happened to run before this one, which is why this passed
  // on one machine and failed on the CI runner with the same code.
  //
  // Resetting first is safe on both paths: `resetTestState()` calls
  // `Application._resetInstance()`, and every path below re-adopts — the shared one
  // here, the fresh one after its own reset. Adopting before the reset is what is
  // unsafe: it hands back an app whose scope has just been torn down, and the first
  // facade to touch it throws E_FACADE_BEFORE_BOOT.
  if (!setup && _sharedApps.size > 0) {
    resetTestState();
    const booted = await bootstrap();
    const existing = _sharedApps.get(booted);
    if (existing) {
      booted.adoptAsCurrent();
      return existing;
    }
    // Not a shared app after all. Fall through — the module is cached now, so the
    // bootstrap below returns this same instance rather than creating a second one,
    // and the `adoptAsCurrent()` there reinstalls the scope this reset tore down.
  }

  resetTestState();
  const app = await bootstrap();
  // A module-cached `bootstrap/app.ts` returns its top-level app on re-import
  // (e.g. a second test file in the same process): `Application.create()`
  // short-circuits, so the app scope `resetTestState()` just tore down is never
  // reinstalled. Re-adopt it so facades resolve. No-op for a fresh app.
  app.adoptAsCurrent();
  setup?.();

  // Wrap whatever handler the app already has, so every request's exception is
  // recoverable by the test that made it — a suite testing a custom handler still
  // exercises that handler. Routes capture the handler by value when they compile,
  // which is why this has to happen before start().
  const errors = new TestExceptionHandler();
  errors.inner = app._swapExceptionHandler(errors);

  await app.start(0);
  const testApp = new TestApp(app, errors);

  if (!setup) {
    testApp._shared = true;
    _sharedApps.set(app, testApp);
  }
  return testApp;
}

/**
 * Tear down every shared app created by {@link createTestApp}.
 *
 * Only needed when something must be released before the process exits — a global
 * teardown file, or a suite that asserts no timers are left running. Individual test
 * files should keep calling `app.close()`; on a shared app that resets per-test state
 * and leaves the app up for the files still to run.
 */
export async function closeSharedTestApps(): Promise<void> {
  for (const testApp of _sharedApps.values()) {
    testApp._shared = false;
    await testApp.close();
  }
  _sharedApps.clear();
}
