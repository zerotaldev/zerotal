/**
 * Thin wrapper around a Fetch Response that adds assertion helpers.
 * Returned by TestApp.request().
 *
 * The body is read once, at construction, and every assertion works off that
 * buffered string. That is what lets `assertSee`/`assertJson` be synchronous
 * like the status assertions beside them: an async assertion that reads
 * identically to a sync one is a trap, because a forgotten `await` turns a
 * failure into an unhandled rejection and the test passes green.
 *
 * Session data is decoded the same way: {@link TestApp} hands {@link TestResponse.of}
 * a decoder bound to the application's own `session.driver`, which runs once
 * while the response is being read. Decoding through the real driver is the
 * only way the session assertions can be correct — the cookie format is the
 * driver's business (the shipped one is authenticated encryption), so anything
 * that parses the cookie itself is guessing, and a guess that fails silently
 * turns `assertSessionMissing` into an assertion that always passes.
 *
 * Use {@link TestResponse.of} to build one from a `Response`; the constructor
 * takes the already-read body so it can stay synchronous.
 */

/**
 * Decodes the session carried by a response, using the application's own
 * session driver. Returns `null` when the response sets no session cookie.
 */
export type SessionDecoder = (response: Response) => Promise<Record<string, unknown> | null>;

/** Optional extras {@link TestApp} attaches while building a response. */
export interface TestResponseContext {
  /** Decoder bound to the app's `session.driver`. */
  session?: SessionDecoder | undefined;
  /**
   * The exception the request raised, captured by
   * {@link TestApp.withoutExceptionHandling}. Included in assertion failures so
   * a 500 reports the bug rather than the error page rendered from it.
   */
  exception?: unknown;
}

/** How much of the body to quote back in an assertion failure. */
const EXCERPT_LIMIT = 400;

export class TestResponse {
  /**
   * The decoded session: a data record, `null` when the response set no session
   * cookie, or `undefined` when no decoder was available (a bare `TestResponse`
   * built outside {@link TestApp}).
   */
  private readonly _session: Record<string, unknown> | null | undefined;
  private readonly _exception: unknown;

  constructor(
    private readonly _res: Response,
    private readonly _body: string,
    context: TestResponseContext & {
      decodedSession?: Record<string, unknown> | null | undefined;
    } = {},
  ) {
    this._session = context.decodedSession;
    this._exception = context.exception;
  }

  /** Read a `Response`'s body (and session) and wrap it. The only async step in the class. */
  static async of(res: Response, context: TestResponseContext = {}): Promise<TestResponse> {
    const body = await res.clone().text();
    let decodedSession: Record<string, unknown> | null | undefined = undefined;
    if (context.session) {
      // A driver that cannot decode (a rotated secret, an unreachable Redis) must
      // not fail the request itself — it leaves the session `undefined`, which the
      // session assertions report as unavailable rather than as absent.
      try {
        decodedSession = await context.session(res);
      } catch {
        decodedSession = undefined;
      }
    }
    return new TestResponse(res, body, { ...context, decodedSession });
  }

  /** The parsed JSON body. Throws with the raw text when it is not JSON. */
  private _json<T = unknown>(): T {
    try {
      return JSON.parse(this._body) as T;
    } catch {
      throw new Error(
        this._decorate(`Expected a JSON body but could not parse it.`, { body: true }),
      );
    }
  }

  get status(): number {
    return this._res.status;
  }
  get ok(): boolean {
    return this._res.ok;
  }
  get headers(): Headers {
    return this._res.headers;
  }

  /**
   * The exception the request raised, when the suite called
   * {@link TestApp.withoutExceptionHandling}. `undefined` otherwise, and when
   * the request completed without throwing.
   *
   * @example
   * const res = await app.withoutExceptionHandling().get('/boom');
   * expect(res.exception()).toBeInstanceOf(PaymentDeclinedError);
   */
  exception(): unknown {
    return this._exception;
  }

  // ── Status assertions ─────────────────────────────────────────────────

  /** Assert the HTTP status code. Chainable. */
  assertStatus(expected: number): this {
    if (this._res.status !== expected) {
      throw new Error(
        this._decorate(`Expected HTTP ${expected} but got ${this._res.status}.`, { body: true }),
      );
    }
    return this;
  }

  /** Assert HTTP 200 OK. */
  assertOk(): this {
    return this.assertStatus(200);
  }

  /** Assert HTTP 201 Created. */
  assertCreated(): this {
    return this.assertStatus(201);
  }

  /** Assert HTTP 204 No Content. */
  assertNoContent(): this {
    return this.assertStatus(204);
  }

  /** Assert HTTP 301 Moved Permanently. */
  assertMovedPermanently(): this {
    return this.assertStatus(301);
  }

  /** Assert HTTP 401 Unauthorized. */
  assertUnauthorized(): this {
    return this.assertStatus(401);
  }

  /** Assert HTTP 403 Forbidden. */
  assertForbidden(): this {
    return this.assertStatus(403);
  }

  /** Assert HTTP 404 Not Found. */
  assertNotFound(): this {
    return this.assertStatus(404);
  }

  /** Assert HTTP 422 Unprocessable Entity. */
  assertUnprocessable(): this {
    return this.assertStatus(422);
  }

  /** Assert HTTP 500 Internal Server Error. */
  assertServerError(): this {
    return this.assertStatus(500);
  }

  /** Assert the status is in the 2xx range. */
  assertSuccessful(): this {
    if (this._res.status < 200 || this._res.status > 299) {
      throw new Error(
        this._decorate(`Expected a 2xx status but got HTTP ${this._res.status}.`, { body: true }),
      );
    }
    return this;
  }

  /** Assert the response is a redirect to `url`. */
  assertRedirect(url: string): this {
    if (this._res.status < 300 || this._res.status > 399) {
      throw new Error(
        this._decorate(`Expected a redirect but got HTTP ${this._res.status}.`, { body: true }),
      );
    }
    const location = this._res.headers.get("Location") ?? "";
    if (!location.includes(url)) {
      throw new Error(
        this._decorate(`Expected redirect to "${url}" but Location was "${location}".`),
      );
    }
    return this;
  }

  // ── Header assertions ─────────────────────────────────────────────────

  /**
   * Assert a response header is present and optionally matches a value.
   *
   * @example
   * res.assertHeader('Content-Type');
   * res.assertHeader('Content-Type', 'application/json');
   */
  assertHeader(name: string, value?: string): this {
    const actual = this._res.headers.get(name);
    if (actual === null) {
      throw new Error(
        this._decorate(`Expected response header "${name}" to be present, but it was absent.`, {
          headers: true,
        }),
      );
    }
    if (value !== undefined && !actual.includes(value)) {
      throw new Error(
        this._decorate(`Expected header "${name}" to contain "${value}" but got "${actual}".`),
      );
    }
    return this;
  }

  /** Assert a response header is absent. */
  assertHeaderMissing(name: string): this {
    if (this._res.headers.get(name) !== null) {
      throw new Error(
        this._decorate(`Expected header "${name}" to be absent, but it was present.`),
      );
    }
    return this;
  }

  // ── Body assertions ───────────────────────────────────────────────────

  /**
   * Parse the body as JSON and assert that every key in `expected` matches.
   * Extra keys in the actual response are allowed.
   */
  assertJson(expected: Record<string, unknown>): this {
    const body = this._json<Record<string, unknown>>();
    for (const [key, value] of Object.entries(expected)) {
      const actual = body[key];
      if (JSON.stringify(actual) !== JSON.stringify(value)) {
        throw new Error(
          this._decorate(
            `assertJson: expected body["${key}"] to equal ${JSON.stringify(value)} ` +
              `but got ${JSON.stringify(actual)}.`,
            { body: true },
          ),
        );
      }
    }
    return this;
  }

  /**
   * Assert a value at a dot-notation path in the JSON body.
   *
   * @example
   * res.assertJsonPath('user.name', 'Alice');
   * res.assertJsonPath('data.0.id', 1);
   */
  assertJsonPath(path: string, expected: unknown): this {
    const body = this._json<Record<string, unknown>>();
    const actual = _getPath(body, path);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        this._decorate(
          `assertJsonPath("${path}"): expected ${JSON.stringify(expected)} ` +
            `but got ${JSON.stringify(actual)}.`,
          { body: true },
        ),
      );
    }
    return this;
  }

  /**
   * Assert the JSON body (or a key within it) is an array of the given length.
   *
   * @example
   * res.assertJsonCount(3);          // top-level array
   * res.assertJsonCount(3, 'data');  // array at body.data
   */
  assertJsonCount(count: number, key?: string): this {
    const body = this._json();
    const target = key ? _getPath(body as Record<string, unknown>, key) : body;
    if (!Array.isArray(target)) {
      throw new Error(
        this._decorate(
          `assertJsonCount: expected ${key ? `"${key}"` : "body"} to be an array, ` +
            `but got ${typeof target}.`,
          { body: true },
        ),
      );
    }
    if (target.length !== count) {
      throw new Error(
        this._decorate(
          `assertJsonCount: expected ${count} item(s) ` +
            `${key ? `at "${key}"` : ""} but got ${target.length}.`,
          { body: true },
        ),
      );
    }
    return this;
  }

  /**
   * Assert the response body contains the given string.
   *
   * @example
   * res.assertSee('Welcome, Alice');
   */
  assertSee(needle: string): this {
    if (!this._body.includes(needle)) {
      throw new Error(this._decorate(`Expected body to contain "${needle}".`, { body: true }));
    }
    return this;
  }

  /**
   * Assert the response body does NOT contain the given string.
   *
   * @example
   * res.assertDontSee('Error');
   */
  assertDontSee(needle: string): this {
    if (this._body.includes(needle)) {
      throw new Error(
        this._decorate(`Expected body NOT to contain "${needle}", but it does.`, { body: true }),
      );
    }
    return this;
  }

  /** Assert the response body contains the given string. Alias of assertSee. */
  assertBodyContains(needle: string): this {
    return this.assertSee(needle);
  }

  /**
   * Assert the body contains `needle` once tags are stripped — the text a user
   * would actually read. Use it when markup sits between the words you expect,
   * which is what makes a plain {@link assertSee} on rendered HTML brittle.
   *
   * @example
   * // Passes against `<strong>Welcome</strong>, <em>Alice</em>`
   * res.assertSeeText('Welcome, Alice');
   */
  assertSeeText(needle: string): this {
    const text = _stripTags(this._body);
    if (!text.includes(needle)) {
      throw new Error(this._decorate(`Expected body text to contain "${needle}".`, { body: true }));
    }
    return this;
  }

  /** Assert the tag-stripped body does NOT contain `needle`. */
  assertDontSeeText(needle: string): this {
    const text = _stripTags(this._body);
    if (text.includes(needle)) {
      throw new Error(
        this._decorate(`Expected body text NOT to contain "${needle}", but it does.`, {
          body: true,
        }),
      );
    }
    return this;
  }

  /** Parse and return the full JSON body. */
  json<T = unknown>(): T {
    return this._json<T>();
  }

  /** Return the full response body as text. */
  text(): string {
    return this._body;
  }

  // ── Validation assertions ─────────────────────────────────────────────

  /**
   * The validation errors this response carries, from whichever place the
   * response put them: a JSON API gets `422 { errors: {...} }`, while a form
   * submit gets a redirect with the errors flashed to the session. Returns
   * `null` when the response carries none.
   *
   * @example
   * const errors = res.validationErrors();
   */
  validationErrors(): Record<string, string[]> | null {
    // JSON clients: `{ message, errors }` with a 422.
    try {
      const body = JSON.parse(this._body) as { errors?: unknown };
      const normalised = _normaliseErrors(body?.errors);
      if (normalised) return normalised;
    } catch {
      // Not JSON — fall through to the session.
    }
    // Form submits: flashed to the session and redirected back.
    if (this._session) return _normaliseErrors(this._session["errors"]);
    return null;
  }

  /**
   * Assert the request failed validation, optionally naming the fields.
   *
   * Covers both shapes a failed validation takes: the `422` JSON body an API
   * client receives, and the errors a form submit flashes to the session before
   * redirecting back. You assert the same way for either.
   *
   * @example
   * res.assertInvalid();                      // failed on something
   * res.assertInvalid('email');               // failed on email
   * res.assertInvalid(['email', 'password']); // failed on both
   * res.assertInvalid({ email: 'required' }); // and the message contains "required"
   */
  assertInvalid(fields?: string | string[] | Record<string, string>): this {
    const errors = this.validationErrors();
    if (errors === null || Object.keys(errors).length === 0) {
      throw new Error(
        this._decorate("assertInvalid: expected validation errors but the response had none.", {
          body: true,
          session: true,
        }),
      );
    }
    if (fields === undefined) return this;

    const expected: Record<string, string | null> =
      typeof fields === "string"
        ? { [fields]: null }
        : Array.isArray(fields)
          ? Object.fromEntries(fields.map((f) => [f, null]))
          : fields;

    for (const [field, message] of Object.entries(expected)) {
      const messages = errors[field];
      if (!messages) {
        throw new Error(
          this._decorate(
            `assertInvalid: expected a validation error for "${field}" but the failing ` +
              `fields were [${Object.keys(errors).join(", ")}].`,
          ),
        );
      }
      if (message !== null && !messages.some((m) => m.includes(message))) {
        throw new Error(
          this._decorate(
            `assertInvalid: expected the "${field}" error to contain "${message}" but ` +
              `got ${JSON.stringify(messages)}.`,
          ),
        );
      }
    }
    return this;
  }

  /**
   * Assert the response carries no validation errors — for the named fields
   * when given, or for any field at all when called bare.
   *
   * @example
   * res.assertValid();        // nothing failed
   * res.assertValid('email'); // email in particular did not fail
   */
  assertValid(fields?: string | string[]): this {
    const errors = this.validationErrors();
    if (errors === null) return this;

    if (fields === undefined) {
      const failing = Object.keys(errors);
      if (failing.length > 0) {
        throw new Error(
          this._decorate(
            `assertValid: expected no validation errors but [${failing.join(", ")}] failed: ` +
              `${JSON.stringify(errors)}.`,
          ),
        );
      }
      return this;
    }

    for (const field of Array.isArray(fields) ? fields : [fields]) {
      if (errors[field]) {
        throw new Error(
          this._decorate(
            `assertValid: expected "${field}" to pass validation but it failed with ` +
              `${JSON.stringify(errors[field])}.`,
          ),
        );
      }
    }
    return this;
  }

  // ── Cookie assertions ─────────────────────────────────────────────────

  /**
   * Assert that the response sets a cookie with the given name.
   * Optionally assert its value.
   *
   * @example
   * res.assertCookie('zerotal_session');
   * res.assertCookie('theme', 'dark');
   */
  assertCookie(name: string, value?: string): this {
    const cookies = _parseCookies(this._res.headers);
    if (!(name in cookies)) {
      const set = Object.keys(cookies);
      throw new Error(
        this._decorate(
          `Expected response to set cookie "${name}" but it was not found. ` +
            (set.length ? `Cookies set: [${set.join(", ")}].` : "No cookies were set."),
        ),
      );
    }
    if (value !== undefined && cookies[name] !== value) {
      throw new Error(
        this._decorate(`Expected cookie "${name}" to equal "${value}" but got "${cookies[name]}".`),
      );
    }
    return this;
  }

  /**
   * Assert that the response does NOT set a cookie with the given name.
   *
   * @example
   * res.assertCookieMissing('remember_me');
   */
  assertCookieMissing(name: string): this {
    const cookies = _parseCookies(this._res.headers);
    if (name in cookies) {
      throw new Error(
        this._decorate(`Expected response NOT to set cookie "${name}" but it was found.`),
      );
    }
    return this;
  }

  // ── Session assertions ────────────────────────────────────────────────

  /**
   * The session the response carries, decoded through the app's own session
   * driver. `null` when the response set no session cookie.
   *
   * @throws When the response was not produced by a {@link TestApp} with a
   * resolvable `session.driver` — there is nothing to decode with.
   *
   * @example
   * expect(res.session()?.['cart_id']).toBe(7);
   */
  session(): Record<string, unknown> | null {
    if (this._session === undefined) throw new Error(_SESSION_UNAVAILABLE);
    return this._session;
  }

  /**
   * Assert that the session contains the given key (optionally matching value).
   *
   * @example
   * res.assertSessionHas('status', 'saved');
   * res.assertSessionHas('user_id');
   */
  assertSessionHas(key: string, value?: unknown): this {
    const data = this.session();
    if (data === null) {
      throw new Error(
        this._decorate("assertSessionHas: the response set no session cookie.", { headers: true }),
      );
    }
    if (!(key in data)) {
      throw new Error(
        this._decorate(
          `Expected session to contain key "${key}" but the session held ` +
            `[${Object.keys(data).join(", ")}].`,
        ),
      );
    }
    if (value !== undefined) {
      const actual = data[key];
      if (JSON.stringify(actual) !== JSON.stringify(value)) {
        throw new Error(
          this._decorate(
            `Expected session["${key}"] to equal ${JSON.stringify(value)} but got ${JSON.stringify(actual)}.`,
          ),
        );
      }
    }
    return this;
  }

  /**
   * Assert that the session does NOT contain the given key.
   *
   * A session that cannot be decoded throws rather than passing: "I could not
   * read the session" is not evidence that the key is absent, and treating it
   * as such is an assertion that can never fail.
   *
   * @example
   * res.assertSessionMissing('errors');
   */
  assertSessionMissing(key: string): this {
    const data = this.session();
    if (data === null) return this; // no session cookie at all — the key is genuinely absent
    if (key in data) {
      throw new Error(
        this._decorate(
          `Expected session NOT to contain key "${key}" but it held ` +
            `${JSON.stringify(data[key])}.`,
        ),
      );
    }
    return this;
  }

  /**
   * Assert the session carries flashed validation errors, optionally for the
   * named fields. The form-submit counterpart of {@link assertInvalid}.
   *
   * @example
   * res.assertSessionHasErrors(['email']);
   */
  assertSessionHasErrors(fields?: string | string[]): this {
    this.assertSessionHas("errors");
    if (fields === undefined) return this;
    return this.assertInvalid(fields);
  }

  /** Assert the session carries no flashed validation errors. */
  assertSessionHasNoErrors(): this {
    return this.assertSessionMissing("errors");
  }

  // ── Auth assertions ───────────────────────────────────────────────────

  /**
   * Assert the response leaves someone signed in — the session carries the
   * `user_id` that {@link AuthSessionMiddleware} hydrates `ctx.user` from.
   *
   * @example
   * const res = await app.followingRedirects().post('/login', creds);
   * res.assertAuthenticated();
   */
  assertAuthenticated(): this {
    const data = this.session();
    if (data === null || data["user_id"] === undefined || data["user_id"] === null) {
      throw new Error(
        this._decorate(
          "assertAuthenticated: expected the session to hold a user_id, but the request " +
            "ended as a guest.",
          { session: true },
        ),
      );
    }
    return this;
  }

  /**
   * Assert the response leaves the given user signed in.
   *
   * Accepts the user or a bare id, and compares loosely across the number/string
   * divide — a session round-trips through JSON, so an integer key can come back
   * either way depending on the driver.
   *
   * @example
   * res.assertAuthenticatedAs(user);
   * res.assertAuthenticatedAs(42);
   */
  assertAuthenticatedAs(user: { id: number | string } | number | string): this {
    this.assertAuthenticated();
    const expected = typeof user === "object" ? user.id : user;
    const actual = this.session()?.["user_id"];
    if (String(actual) !== String(expected)) {
      throw new Error(
        this._decorate(
          `assertAuthenticatedAs: expected user ${JSON.stringify(expected)} to be signed in ` +
            `but the session held ${JSON.stringify(actual)}.`,
        ),
      );
    }
    return this;
  }

  /** Assert the response leaves nobody signed in. */
  assertGuest(): this {
    const data = this.session();
    const userId = data?.["user_id"];
    if (userId !== undefined && userId !== null) {
      throw new Error(
        this._decorate(
          `assertGuest: expected nobody to be signed in but the session held ` +
            `user_id ${JSON.stringify(userId)}.`,
        ),
      );
    }
    return this;
  }

  // ── Inertia assertions ────────────────────────────────────────────────

  /**
   * The Inertia page object this response carries, from either shape the
   * protocol uses: the JSON body of an `X-Inertia` visit, or the
   * `<script data-page>` payload embedded in a full page load. `null` when the
   * response is not an Inertia response.
   */
  inertia(): InertiaPage | null {
    if (this._res.headers.get("X-Inertia") === "true") {
      try {
        return JSON.parse(this._body) as InertiaPage;
      } catch {
        return null;
      }
    }
    const match = /<script[^>]*data-page="app"[^>]*>([\s\S]*?)<\/script>/.exec(this._body);
    if (!match?.[1]) return null;
    try {
      return JSON.parse(match[1]) as InertiaPage;
    } catch {
      return null;
    }
  }

  /**
   * Assert the response rendered an Inertia page — optionally the named
   * component, optionally carrying the given props.
   *
   * Props are matched partially, so you assert the ones the test is about and
   * ignore the shared props riding along with every page.
   *
   * @example
   * res.assertInertia('Posts/Index');
   * res.assertInertia('Posts/Show', { post: { id: 1, title: 'Hello' } });
   */
  assertInertia(component?: string, props?: Record<string, unknown>): this {
    const page = this.inertia();
    if (page === null) {
      throw new Error(
        this._decorate("assertInertia: the response carries no Inertia page object.", {
          body: true,
        }),
      );
    }
    if (component !== undefined && page.component !== component) {
      throw new Error(
        this._decorate(
          `assertInertia: expected component "${component}" but rendered "${page.component}".`,
        ),
      );
    }
    if (props !== undefined) {
      for (const [key, value] of Object.entries(props)) {
        const actual = page.props?.[key];
        if (JSON.stringify(actual) !== JSON.stringify(value)) {
          throw new Error(
            this._decorate(
              `assertInertia: expected prop "${key}" to equal ${JSON.stringify(value)} ` +
                `but got ${JSON.stringify(actual)}. Props present: ` +
                `[${Object.keys(page.props ?? {}).join(", ")}].`,
            ),
          );
        }
      }
    }
    return this;
  }

  /** Assert the Inertia page carries the named prop, optionally matching a value. */
  assertInertiaProp(key: string, value?: unknown): this {
    const page = this.inertia();
    if (page === null) {
      throw new Error(
        this._decorate("assertInertiaProp: the response carries no Inertia page object.", {
          body: true,
        }),
      );
    }
    const props = page.props ?? {};
    if (!(key in props)) {
      throw new Error(
        this._decorate(
          `assertInertiaProp: expected prop "${key}" but the page carried ` +
            `[${Object.keys(props).join(", ")}].`,
        ),
      );
    }
    if (value !== undefined && JSON.stringify(props[key]) !== JSON.stringify(value)) {
      throw new Error(
        this._decorate(
          `assertInertiaProp: expected "${key}" to equal ${JSON.stringify(value)} ` +
            `but got ${JSON.stringify(props[key])}.`,
        ),
      );
    }
    return this;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  /**
   * Attach the context that turns a bare expectation mismatch into something
   * you can act on: the exception the request actually raised, an excerpt of
   * the body, the headers, the session. An assertion that says only
   * "expected 200, got 500" makes you re-run the test by hand to learn why.
   */
  private _decorate(
    message: string,
    include: { body?: boolean; headers?: boolean; session?: boolean } = {},
  ): string {
    const parts = [message];

    if (this._exception !== undefined) {
      const error = this._exception;
      const detail =
        error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
      parts.push(`\nThe request raised:\n${_indent(detail)}`);
    }

    if (include.body) {
      parts.push(`\nResponse body (${this._res.status}):\n${_indent(this._excerpt())}`);
    }

    if (include.headers) {
      const headers = [...this._res.headers.entries()]
        .map(([name, value]) => `${name}: ${value}`)
        .join("\n");
      parts.push(`\nResponse headers:\n${_indent(headers || "<none>")}`);
    }

    if (include.session && this._session) {
      parts.push(`\nSession:\n${_indent(JSON.stringify(this._session, null, 2))}`);
    }

    return parts.join("\n");
  }

  /**
   * A readable excerpt of the body. JSON is pretty-printed and HTML is reduced
   * to its text, because the useful part of a failing error page is the message
   * buried in it, not the markup around it.
   */
  private _excerpt(limit = EXCERPT_LIMIT): string {
    const body = this._body.trim();
    if (!body) return "<empty body>";

    const type = this._res.headers.get("Content-Type") ?? "";

    if (type.includes("json") || body.startsWith("{") || body.startsWith("[")) {
      try {
        return _truncate(JSON.stringify(JSON.parse(body), null, 2), limit);
      } catch {
        // Not actually JSON — fall through.
      }
    }

    if (type.includes("html") || body.startsWith("<")) {
      const text = _stripTags(body);
      return _truncate(text || "<no text content>", limit);
    }

    return _truncate(body, limit);
  }
}

/** The page object the Inertia protocol puts on the wire. */
export interface InertiaPage {
  component: string;
  props: Record<string, unknown>;
  url: string;
  version: string | null;
}

const _SESSION_UNAVAILABLE =
  "Session assertions need a response produced by a TestApp whose container can " +
  "resolve `session.driver` — the session is decoded through the app's own driver. " +
  "Register SessionProvider (or bind `session.driver`) in the app you pass to createTestApp().";

/** Resolve a dot-notation path inside a nested object/array. */
function _getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, key) => {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const i = parseInt(key, 10);
      return isNaN(i) ? undefined : cur[i];
    }
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

/**
 * Parse all Set-Cookie headers from a response into a name→value map.
 * Only extracts the cookie name=value pair (ignores Path, Secure, HttpOnly etc.).
 */
function _parseCookies(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") return;
    // A single Set-Cookie header may contain one cookie directive
    const pair = value.split(";")[0]?.trim() ?? "";
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) return;
    const cookieName = pair.slice(0, eqIdx).trim();
    const cookieValue = pair.slice(eqIdx + 1).trim();
    result[cookieName] = cookieValue;
  });
  return result;
}

/**
 * Coerce the several shapes validation errors arrive in — `{ field: "msg" }`,
 * `{ field: ["msg"] }` — into one `{ field: string[] }`, so the assertions
 * above have a single thing to reason about.
 */
function _normaliseErrors(raw: unknown): Record<string, string[]> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out: Record<string, string[]> = {};
  for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) out[field] = value.map((v) => String(v));
    else if (value !== null && value !== undefined) out[field] = [String(value)];
  }
  return out;
}

/** Reduce markup to the text a reader would see. */
function _stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function _truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}… (${text.length} chars total)`;
}

function _indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}
