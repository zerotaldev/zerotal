/**
 * The per-request `HttpContext` — the object that travels through the pipeline
 * and lives in request-scoped storage, exposing request input, response
 * helpers, route-model bindings, and after-response hooks to controllers.
 */
import { Container } from "../container/Container.ts";
import { RequestContext } from "../context/RequestContext.ts";
import { getRequestSubdomains } from "../router/domain.ts";
import { ScopedResolver } from "../container/ScopedResolver.ts";
import { UploadedFile } from "../http/UploadedFile.ts";
import {
  markdownExtractTitle,
  markdownPage,
  DEFAULT_MD_OPTIONS,
  type BunMarkdownOptions,
} from "../helpers/markdown.ts";
import type { SessionContract, TransactionContext } from "../contracts/index.ts";
import type { ContextRegistry, ContextKey } from "./ContextRegistry.ts";

/** Markup a view renders to — a string or anything stringifiable (e.g. JSX `SafeHtml`). */
type ViewMarkup = string | { toString(): string };

/**
 * A view component invoked by `view()` / `ctx.view()`. It receives the request
 * {@link HttpContext} (route params and model bindings live on `ctx.params`) plus
 * any explicit props, and returns renderable markup.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supertype of every ViewComponent<P> the public overloads accept.
type AnyViewComponent = (ctx: HttpContext<any>, props: any) => ViewMarkup | Promise<ViewMarkup>;

/**
 * Minimal Bun server interface needed for socket-level IP resolution.
 * Duck-typed so HttpContext has no hard dependency on Bun's global types.
 */
export interface RequestIPProvider {
  requestIP(req: Request): { address: string; family: string; port: number } | null;
}

/**
 * The central per-request object, exposing request input, response helpers,
 * route-model bindings, session flash, and after-response hooks to controllers
 * and middleware.
 *
 * Lives in the AsyncLocalStorage store AND travels through the pipeline.
 * Both are the same object reference — no sync needed between them.
 *
 * @typeParam TParams - Shape of `ctx.params` (route params plus resolved model
 * bindings). Defaults to a string-keyed record.
 *
 * @example
 * // A controller action reading input and returning JSON:
 * async show(ctx: HttpContext) {
 *   const id = ctx.integer('id');
 *   const post = ctx.model<Post>('post');
 *   return ctx.json({ id, post });
 * }
 *
 * @example
 * // An inline route handler — the context is passed directly:
 * Router.post('/subscribe', async (ctx) => {
 *   const { email } = await ctx.body<{ email: string }>();
 *   ctx.flash('success', `Subscribed ${email}`);
 *   ctx.redirect('/thanks', 303);
 * });
 */
export class HttpContext<TParams extends Record<string, unknown> = Record<string, string>> {
  readonly requestId: string;
  readonly startedAt: number;
  readonly url: URL;

  // ── Route parameters (e.g. /users/:id → { id: '42' }) ───────────────
  // Holds raw string params and, once the framework resolves route-model
  // bindings, the loaded instances under their param name (see RouteHandler).
  params: TParams = {} as TParams;

  sessionId?: string;

  // ── Session (set by @zerotal/session's SessionMiddleware) ───────────
  // Typed against the SessionContract the kernel owns, so flash()/flashed()
  // depend on a shape rather than on @zerotal/session. Undefined when the
  // session middleware is not active on this request.
  session?: SessionContract;

  // ── Matched route info (set by RouteHandler, read by devtools) ──────
  _routeDef?: { pattern: string; controller: string; action: string };

  // ── DB transaction (set by DB.transaction(), cleared on exit) ────────
  // Carried as the kernel-owned TransactionContext; @zerotal/orm narrows it
  // back to its concrete SQL connection at its own boundary.
  _transaction?: TransactionContext | undefined;

  // ── i18n (set by I18nMiddleware) ──────────────────────────────────────
  locale: string = "en";

  /** Set by controllers/route handlers. Read by Application after pipeline runs. */
  response: Response | undefined = undefined;

  // ── After-response callbacks ──────────────────────────────────────────
  _afterResponseCallbacks: Array<() => Promise<void>> = [];

  // ── Response finalizers ───────────────────────────────────────────────
  // Run once the final Response exists but before it is returned, so they can
  // still attach headers. See {@link onResponseReady}.
  _responseFinalizers: Array<(response: Response) => Promise<void>> = [];

  // ── Bun server reference (set by Application/RouteHandler) ───────────
  // Exposes requestIP() for socket-level IP resolution. Not available in tests
  // created via HttpContext.fake() unless explicitly set.
  _server: RequestIPProvider | undefined = undefined;

  // ── Route-model binding storage ───────────────────────────────────────
  // Populated by createRouteHandler before the pipeline runs.
  readonly _models = new Map<string, unknown>();

  /**
   * Where `paginate()` reads the current page for this request, when a caller doesn't pass
   * one. Set via `setCurrentPageResolver()`; unset means the query string. Per-request
   * because one process serves many requests at once.
   *
   * @internal
   */
  _pageResolver?: (pageName: string) => number | undefined;

  // ── Internal meta (for framework packages; keys typed via ContextRegistry) ──
  private _meta = new Map<string, unknown>();
  private _body: Record<string, unknown> | undefined = undefined;
  private _formData: FormData | null | undefined = undefined;

  constructor(
    readonly request: Request,
    readonly container: ScopedResolver,
  ) {
    this.requestId = crypto.randomUUID();
    this.startedAt = performance.now();
    this.url = new URL(request.url);

    // Bind every prototype method to this instance so handlers can destructure
    // them off the context — `async show({ json, view, params }: HttpContext)` —
    // without losing `this`. The method list is scanned ONCE at module load
    // (see _prototypeMethods below); only the per-instance .bind() runs here.
    for (const [key, method] of _prototypeMethods) {
      (this as Record<string, unknown>)[key] = method.bind(this);
    }
  }

  // ── Computed helpers ──────────────────────────────────────────────────

  /**
   * Elapsed milliseconds since this request started.
   *
   * @category Lifecycle
   */
  get took(): number {
    return Math.round(performance.now() - this.startedAt);
  }

  // ── Response helpers ──────────────────────────────────────────────────

  /**
   * Set a JSON response.
   *
   * @example
   * ctx.json({ user });         // 200
   * ctx.json({ errors }, 422);  // 422
   *
   * @category Responses
   */
  json(data: unknown, status = 200): void {
    this.response = Response.json(data, { status });
  }

  /**
   * Respond with a server-side view rendered to a full HTML document.
   * Prepends `<!DOCTYPE html>` and sets `Content-Type: text/html`.
   *
   * Accepts either pre-rendered markup, or a **view component** plus its props.
   * A view component receives the request {@link HttpContext} (route params and
   * model bindings live on `ctx.params`) and the props you pass as a second
   * argument. Pair with core's JSX runtime (add `/** @jsxImportSource @zerotal/core *\/`
   * to view files) so JSX evaluates directly to HTML.
   *
   * @example
   * // resources/views/Welcome.tsx
   * export default function Welcome(ctx: HttpContext, { title }: { title: string }) {
   *   return <html><body><h1>{title}</h1><p>{ctx.url.pathname}</p></body></html>;
   * }
   *
   * // In a route/controller:
   * ctx.view(Welcome, { title: 'Hello' });
   *
   * // Or pass already-rendered markup:
   * ctx.view(Welcome(ctx, { title: 'Hello' }));
   *
   * @category Responses
   */
  view(markup: ViewMarkup, status?: number): void;
  view<P extends Record<string, unknown> = Record<string, never>>(
    component: (ctx: HttpContext, props: P) => ViewMarkup | Promise<ViewMarkup>,
    props?: P,
    status?: number,
  ): void | Promise<void>;
  view(
    markupOrComponent: ViewMarkup | AnyViewComponent,
    propsOrStatus?: Record<string, unknown> | number,
    status = 200,
  ): void | Promise<void> {
    if (typeof markupOrComponent === "function") {
      const props = (typeof propsOrStatus === "object" ? propsOrStatus : undefined) ?? {};
      const result = markupOrComponent(this, props);
      if (result instanceof Promise) {
        return result.then((markup) => this._renderView(markup, status));
      }
      this._renderView(result, status);
      return;
    }
    // Pre-rendered markup form — `propsOrStatus` is the optional status code.
    this._renderView(markupOrComponent, typeof propsOrStatus === "number" ? propsOrStatus : 200);
  }

  /** Set the response to a full HTML document wrapping the rendered markup. */
  private _renderView(markup: ViewMarkup, status: number): void {
    this.response = new Response(`<!DOCTYPE html>\n${markup}`, {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  /**
   * Render a Markdown string to a full HTML document using Bun's built-in
   * `Bun.markdown.html()`. Automatically enables tables, strikethrough,
   * tasklists, autolinks, and heading IDs — pass `options` to override.
   *
   * Useful for serving `.md` files as documentation pages:
   *
   * @example
   * const content = await Bun.file('./docs/getting-started.md').text();
   * ctx.markdown(content);
   *
   * // Custom title / options:
   * ctx.markdown(content, { title: 'Getting Started', headings: { ids: true } });
   *
   * @category Responses
   */
  markdown(content: string, options?: BunMarkdownOptions & { title?: string }, status = 200): void {
    const { title, ...mdOptions } = options ?? {};
    const body = Bun.markdown.html(content, {
      ...DEFAULT_MD_OPTIONS,
      ...mdOptions,
    });
    const pageTitle = title ?? markdownExtractTitle(content) ?? "Docs";
    this.view(markdownPage(pageTitle, body), status);
  }

  /**
   * Respond with a raw HTML string. Unlike `view()`, no DOCTYPE is prepended —
   * useful for HTML fragments, partials, or when you manage the document shell
   * yourself (e.g. when returning a partial for htmx or Turbo Streams).
   *
   * @example
   * ctx.html('<p>Updated!</p>');
   * ctx.html(renderPartial(data), 200);
   *
   * @category Responses
   */
  html(markup: string | { toString(): string }, status = 200): void {
    this.response = new Response(String(markup), {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  /**
   * Set an HTTP redirect response.
   * Default 302 (Found). Use 303 (See Other) after POST/PUT/DELETE — Inertia
   * and browsers always issue a GET on a 303, preventing form re-submission.
   *
   * @example
   * ctx.redirect('/dashboard');       // 302
   * ctx.redirect('/dashboard', 303);  // 303 after POST
   *
   * @category Redirects
   */
  redirect(url: string, status: 301 | 302 | 303 | 307 | 308 = 302): void {
    this.response = new Response(null, {
      status,
      headers: { Location: url },
    });
  }

  /**
   * Redirect back to the previous page using the Referer header.
   * Falls back to '/' when no Referer is present or when the Referer
   * points to a different origin (prevents open-redirect attacks).
   *
   * @example
   * ctx.back();       // 302 to Referer
   * ctx.back(303);    // 303 to Referer (use after Inertia POST)
   *
   * @category Redirects
   */
  back(status: 301 | 302 | 303 | 307 | 308 = 302): void {
    const referer = this.request.headers.get("Referer");
    const url = safeRedirectPath(referer, this.url.origin) ?? "/";
    this.redirect(url, status);
  }

  /**
   * Write a value into the session for the next request.
   * Requires SessionMiddleware to be active; silently no-ops if absent.
   *
   * Use flash() to pass data across a redirect (errors, status messages, etc.).
   * Read it back with flashed() on the next request.
   *
   * @example
   * ctx.flash('success', 'Post saved!');
   * ctx.flash('errors', { email: 'Already taken' });
   *
   * @category Session & state
   */
  flash(key: string, value: unknown): void {
    this.session?.flash(key, value);
  }

  /**
   * Read a value that was flashed in the previous request.
   * Returns undefined if the key was not flashed or session is absent.
   *
   * @example
   * const errors  = ctx.flashed<Record<string, string>>('errors');
   * const success = ctx.flashed<string>('success');
   *
   * @category Session & state
   */
  flashed<T = unknown>(key: string): T | undefined {
    return this.session?.get(key) as T | undefined;
  }

  // ── URI & path helpers ───────────────────────────────────────────────

  /**
   * The current request pathname (no query string).
   *
   * @category Request data
   */
  path(): string {
    return this.url.pathname;
  }

  /**
   * The full request URL including query string.
   *
   * @category Request data
   */
  fullUrl(): string {
    return this.url.href;
  }

  /**
   * The host portion of the URL (hostname + port if non-standard).
   *
   * @category Request data
   */
  host(): string {
    return this.url.host;
  }

  /**
   * Subdomain params captured from a `Router.group({ domain })` match.
   *
   * @example
   * // Router.group({ domain: ':tenant.app.com' }, () => { ... });
   * ctx.subdomains;            // { tenant: 'acme' } for acme.app.com
   * ctx.subdomain('tenant');   // 'acme'
   *
   * @category Request data
   */
  get subdomains(): Record<string, string> {
    return getRequestSubdomains(this.request);
  }

  /**
   * A single subdomain param, or null when absent.
   *
   * @category Request data
   */
  subdomain(name: string): string | null {
    return this.subdomains[name] ?? null;
  }

  /**
   * Test the request path against a glob-style pattern.
   * `*` matches any sequence of characters except `/`.
   * `**` matches any sequence including `/`.
   *
   * @example
   * ctx.is('/admin/*')     // true for /admin/users, false for /posts
   * ctx.is('/posts/**')    // true for /posts/1/comments
   *
   * @category Request data
   */
  is(pattern: string): boolean {
    const regexSource =
      "^" +
      pattern
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, ".+")
        .replace(/\*/g, "[^/]+") +
      "$";
    return new RegExp(regexSource).test(this.url.pathname);
  }

  // ── Network helpers ───────────────────────────────────────────────────

  /**
   * The raw client IP address taken directly from the TCP socket.
   *
   * Available when running inside `Bun.serve()` — returns `null` in tests
   * or any context where the Bun server reference was not injected.
   *
   * When Bun sits behind a reverse proxy (nginx, Caddy, etc.) this returns
   * the proxy's IP, not the end-user's. Use `ThrottleMiddleware`'s
   * `trustedProxies` option together with `X-Forwarded-For` to resolve the
   * real client IP in those deployments.
   *
   * @category Request data
   */
  ip(): string | null {
    return this._server?.requestIP(this.request)?.address ?? null;
  }

  /**
   * Retrieve a route-model-bound instance by its parameter name.
   *
   * The instance is resolved automatically by the framework before the controller
   * runs, using the model bound to the param — implicitly by name, or with `.bind()` on the
   * route. Throws if no binding was resolved for the given param name (which means
   * either the route has no such param or no binding was registered).
   *
   * @example
   * // Route: Router.get('/users/:user', UserController, 'show')
   *
   * async show(ctx: HttpContext) {
   *   const user = ctx.model<User>('user');
   *   return ctx.json({ user });
   * }
   *
   * @throws {Error} when no binding was resolved for `name` (the route has no
   * such param, or nothing bound it).
   * @category Request data
   */
  model<T = unknown>(name: string): T {
    if (!this._models.has(name)) {
      throw new Error(
        `[Zerotal] No model binding resolved for param "${name}". ` +
          `Name the param after a model, or bind it with .bind('${name}', MyModel).`,
      );
    }
    return this._models.get(name) as T;
  }

  // ── Header helpers ────────────────────────────────────────────────────

  /**
   * Retrieve a request header by name (case-insensitive).
   * Returns `fallback` (default `null`) when the header is absent.
   *
   * @category Request data
   */
  header(key: string, fallback: string | null = null): string | null {
    return this.request.headers.get(key) ?? fallback;
  }

  /**
   * Extract the Bearer token from the `Authorization` header.
   * Returns `null` when absent or the header does not use the Bearer scheme.
   *
   * @category Request data
   */
  bearerToken(): string | null {
    const auth = this.request.headers.get("Authorization");
    return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  }

  // ── Content negotiation ───────────────────────────────────────────────

  /**
   * True when the request sends a JSON body (`Content-Type: application/json`).
   *
   * @category Request data
   */
  isJson(): boolean {
    return (this.request.headers.get("Content-Type") ?? "").includes("application/json");
  }

  /**
   * True when the client expects a JSON response (`Accept: application/json`).
   * Useful in exception handlers to decide between an error page and a JSON error.
   *
   * @category Request data
   */
  wantsJson(): boolean {
    return (this.request.headers.get("Accept") ?? "").includes("application/json");
  }

  // ── Request input helpers ─────────────────────────────────────────────

  /**
   * Read a URL query-string parameter by name.
   * Returns `fallback` (default `undefined`) when the param is absent.
   *
   * @example
   * const page = ctx.query('page', '1');
   * const q    = ctx.query('search');
   *
   * @category Request data
   */
  query(key: string, fallback?: string): string | undefined {
    return this.url.searchParams.get(key) ?? fallback;
  }

  /**
   * Parse a query param or route param as an integer.
   * Checks route params first, then the query string.
   * Returns `fallback` when the value is absent or not a valid integer.
   *
   * @example
   * const id   = ctx.integer('id');           // route param
   * const page = ctx.integer('page', 1);      // query string with default
   *
   * @category Request data
   */
  integer(key: string, fallback?: number): number | undefined {
    const raw = (this.params[key] as string | undefined) ?? this.url.searchParams.get(key);
    if (raw === undefined || raw === null) return fallback;
    const parsed = parseInt(raw, 10);
    return isNaN(parsed) ? fallback : parsed;
  }

  /**
   * Read a query param or route param as a string.
   * Checks route params first, then the query string.
   *
   * @example
   * const slug = ctx.string('slug');
   * const sort = ctx.string('sort', 'asc');
   *
   * @category Request data
   */
  string(key: string, fallback?: string): string | undefined {
    return (this.params[key] as string | undefined) ?? this.url.searchParams.get(key) ?? fallback;
  }

  /**
   * Read a query param or route param coerced to a boolean.
   * Truthy values: `'1'`, `'true'`, `'yes'`, `'on'` (case-insensitive).
   *
   * @example
   * const active = ctx.boolean('active', false);
   *
   * @category Request data
   */
  boolean(key: string, fallback = false): boolean {
    const raw = (this.params[key] as string | undefined) ?? this.url.searchParams.get(key);
    if (raw === undefined || raw === null) return fallback;
    return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
  }

  /**
   * Parse and cache the JSON request body.
   * Subsequent calls return the cached result — safe to call multiple times.
   * Returns `{}` when the body is absent or not valid JSON.
   *
   * @example
   * const { title, body } = await ctx.body<{ title: string; body: string }>();
   *
   * @category Request data
   */
  async body<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T> {
    if (this._body !== undefined) return this._body as T;

    const contentType = this.request.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      try {
        this._body = (await this.request.json()) as Record<string, unknown>;
      } catch {
        this._body = {};
      }
    } else if (
      contentType.includes("multipart/form-data") ||
      contentType.includes("application/x-www-form-urlencoded")
    ) {
      const formData = await this._parseFormData();
      const fields: Record<string, unknown> = {};
      if (formData) {
        for (const [key, value] of formData.entries()) {
          // File entries are handled separately by file() / files().
          if (typeof value === "string") fields[key] = value;
        }
      }
      this._body = fields;
    } else {
      this._body = {};
    }

    return this._body as T;
  }

  private async _parseFormData(): Promise<FormData | null> {
    if (this._formData !== undefined) return this._formData;
    try {
      this._formData = await this.request.formData();
    } catch {
      this._formData = null;
    }
    return this._formData;
  }

  /** @internal Seed the body cache with already-parsed data, for middleware that reads the raw body. */
  _primeBody(data: Record<string, unknown>): void {
    this._body = data;
  }

  /**
   * Return the first uploaded file for the given form field, or `null` if absent.
   *
   * Parses and caches the multipart body on first call.
   *
   * @example
   * const avatar = await ctx.file('avatar');
   * if (!avatar?.isValid({ maxSize: 2 * 1024 * 1024, mimes: ['image/jpeg', 'image/png'] })) {
   *   return redirect().back().withErrors({ avatar: 'Invalid file.' });
   * }
   * const path = await avatar.store('avatars', Storage.disk());
   *
   * @category Files & uploads
   */
  async file(field: string): Promise<UploadedFile | null> {
    const formData = await this._parseFormData();
    if (!formData) return null;
    const entry = formData.get(field);
    return entry instanceof File ? new UploadedFile(entry) : null;
  }

  /**
   * Return all uploaded files for the given form field.
   * Useful for `<input type="file" multiple>` inputs.
   *
   * @example
   * const attachments = await ctx.files('attachments');
   * for (const file of attachments) {
   *   await file.store('attachments', Storage.disk('s3'));
   * }
   *
   * @category Files & uploads
   */
  async files(field: string): Promise<UploadedFile[]> {
    const formData = await this._parseFormData();
    if (!formData) return [];
    return formData
      .getAll(field)
      .filter((entry): entry is File => entry instanceof File)
      .map((file) => new UploadedFile(file));
  }

  /**
   * Read a value from the merged input bag in priority order:
   * route params → cached JSON body → query string.
   *
   * Body data is only available here if `ctx.body()` was awaited earlier in
   * the lifecycle (e.g. by a FormRequest or validate() call). For guaranteed
   * body access, use `await ctx.body()` or a FormRequest.
   *
   * @example
   * ctx.input('id')          // route param :id or query ?id=
   * ctx.input('q', 'all')    // with fallback
   *
   * @category Request data
   */
  input<T = unknown>(key: string, fallback?: T): T {
    if (key in this.params) return this.params[key] as unknown as T;
    if (this._body !== undefined && key in this._body) return this._body[key] as T;
    const queryValue = this.url.searchParams.get(key);
    if (queryValue !== null) return queryValue as unknown as T;
    return fallback as T;
  }

  // ── After-response API ────────────────────────────────────────────────

  /**
   * Register a callback to fire after the Response is sent to the client.
   * Calls container.acquire() synchronously at registration time — before any
   * await — so the request's finally block cannot flush the scope before the
   * callback has a chance to run. This ordering fixes a scope-flush race.
   *
   * @example
   * ctx.afterResponse(async () => {
   *   await Analytics.track('page_view', { path: ctx.path() });
   * });
   *
   * @category Lifecycle
   */
  afterResponse(callback: () => Promise<void>): this {
    // acquire() MUST be called synchronously here — before the callback is stored
    this.container.acquire();

    this._afterResponseCallbacks.push(async () => {
      try {
        await callback();
      } catch (error) {
        // An afterResponse error must never crash the server, so log and swallow it.
        console.error("[Zerotal] afterResponse callback failed:", error);
      } finally {
        // Release the reference — _doFlush() fires when count reaches 0
        this.container.release();
      }
    });

    return this;
  }

  /**
   * Register a callback that runs once the final `Response` exists, before it is
   * returned to the client — the last point at which a header can still be set.
   *
   * This is what a middleware needs when its work has to land on *every*
   * response, including one produced by the exception handler. A middleware's own
   * `finally` block cannot do that: when a handler throws, the pipeline unwinds
   * before any response has been built, so there is nothing to write to. Sessions
   * are the motivating case — a `Set-Cookie` that only appears on the success path
   * silently drops flashed validation errors on the redirect that carries them.
   *
   * Finalizers run in registration order and are awaited. An error thrown by one
   * is logged and swallowed, because a failed finalizer must not turn a rendered
   * response into a crash.
   *
   * @example
   * ctx.onResponseReady(async (response) => {
   *   response.headers.set('X-Request-Id', ctx.requestId);
   * });
   *
   * @category Lifecycle
   */
  onResponseReady(callback: (response: Response) => Promise<void>): this {
    this._responseFinalizers.push(callback);
    return this;
  }

  // ── Internal meta store (typed via ContextRegistry) ───────────────────
  // The backing store is a private Map; the accessors below are typed against
  // the declaration-merged {@link ContextRegistry}, so a registered key carries
  // its value type and any other string key falls back to `unknown`.

  /**
   * Stash a value on the request-scoped meta store for framework packages.
   * A key registered on {@link ContextRegistry} is type-checked against its
   * declared value; any other string key accepts `unknown`.
   * @internal
   */
  setInternal<K extends ContextKey>(key: K, value: ContextRegistry[K]): this;
  setInternal(key: string, value: unknown): this;
  setInternal(key: string, value: unknown): this {
    this._meta.set(key, value);
    return this;
  }

  /**
   * Read a value previously stored with {@link setInternal}. Returns the typed
   * value for a registered key, or `undefined` when absent.
   * @internal
   */
  getInternal<K extends ContextKey>(key: K): ContextRegistry[K] | undefined;
  getInternal<T = unknown>(key: string): T | undefined;
  getInternal(key: string): unknown {
    return this._meta.get(key);
  }

  /** @internal Report whether a value is present under `key`. */
  hasInternal(key: ContextKey | (string & {})): boolean {
    return this._meta.has(key);
  }

  /** @internal Remove a value from the request-scoped meta store. */
  deleteInternal(key: ContextKey | (string & {})): this {
    this._meta.delete(key);
    return this;
  }

  // ── Test factory ──────────────────────────────────────────────────────

  /**
   * Create a fake HttpContext for unit tests.
   * Does not require a running server.
   *
   * @example
   * const ctx = HttpContext.fake('http://localhost/posts?page=2');
   * expect(ctx.integer('page')).toBe(2);
   *
   * @category Lifecycle
   */
  static fake(
    url = "http://localhost/",
    init: RequestInit = {},
    container?: ScopedResolver,
  ): HttpContext {
    if (!container) {
      container = new ScopedResolver(new Container());
    }
    return new HttpContext(new Request(url, init), container);
  }

  // ── Ambient access ────────────────────────────────────────────────────

  /**
   * The current request's `HttpContext`, or `undefined` outside a request.
   * Safe in code that runs both in and out of requests (CLI commands, queue
   * workers, scheduled jobs).
   *
   * @category Lifecycle
   */
  static tryGet(): HttpContext | undefined {
    return RequestContext.tryGet();
  }
}

/**
 * The bindable prototype methods of {@link HttpContext}, computed once per
 * process instead of once per request. Getters (took, subdomains) have no
 * `.value` and are skipped, so they still evaluate lazily on property access.
 * The constructor only performs the per-instance `.bind()` over this list.
 */
const _prototypeMethods: ReadonlyArray<[string, (...args: unknown[]) => unknown]> = (() => {
  const proto = HttpContext.prototype;
  const methods: Array<[string, (...args: unknown[]) => unknown]> = [];
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === "constructor") continue;
    const desc = Object.getOwnPropertyDescriptor(proto, key)!;
    if (typeof desc.value === "function") {
      methods.push([key, desc.value as (...args: unknown[]) => unknown]);
    }
  }
  return methods;
})();

/**
 * Return `url` only when it belongs to the same `origin`, otherwise `undefined`.
 * Guards `ctx.back()` and similar helpers against open-redirect attacks by
 * rejecting absent, malformed, or cross-origin URLs.
 *
 * @param url - Candidate redirect target (e.g. a `Referer` header value).
 * @param origin - The current request origin to match against.
 * @returns The same-origin `url`, or `undefined` when it is absent, unparseable,
 * or points to a different origin.
 */
export function safeRedirectPath(
  url: string | null | undefined,
  origin: string,
): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin === origin ? url : undefined;
  } catch {
    return undefined;
  }
}
