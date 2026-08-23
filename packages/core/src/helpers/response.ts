/**
 * Global response helpers usable from controller handlers — `redirect()`,
 * `back()`, `json()`, `view()`, `html()`, `markdown()`, `file()`, and `abort()`
 * — plus the fluent `ResponseBuilder` / `MarkdownBuilder` they return.
 */
import { RequestContext } from "../context/RequestContext.ts";
import { HttpError, NotFoundError } from "../errors/HttpError.ts";
import { route } from "../router/Router.ts";
import type { RouteParamValues, RouteParamsArg, RouteTarget } from "../router/registry.ts";
import { safeRedirectPath } from "../pipeline/HttpContext.ts";
import { DEFAULT_MD_OPTIONS, type BunMarkdownOptions } from "../helpers/markdown.ts";
import type { ZerotalError } from "../errors/ZerotalError.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";

/** Markup a view renders to — a string or anything stringifiable (e.g. JSX `SafeHtml`). */
type ViewMarkup = string | { toString(): string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supertype of every view component the public overloads accept.
type AnyViewComponent = (ctx: HttpContext<any>, props: any) => ViewMarkup | Promise<ViewMarkup>;

function _ctx(): HttpContext {
  const ctx = RequestContext.tryGet();
  if (!ctx) {
    throw new Error(
      "[Zerotal] Response helpers (back, redirect, json, etc.) must be called inside an active HTTP request.",
    );
  }
  return ctx;
}

// ── ResponseBuilder ────────────────────────────────────────────────────────

/**
 * Fluent builder returned by the redirect helpers for attaching flash data
 * (`.withErrors()`, `.withSuccess()`, …) to the response.
 *
 * It implements `PromiseLike<void>` so that `return back().withErrors(...)`
 * compiles cleanly in handlers typed as `async (ctx): Promise<void>`: TypeScript
 * unwraps `PromiseLike<void>` in async context, making the builder void-compatible.
 */
export class ResponseBuilder implements PromiseLike<void> {
  readonly #ctx: HttpContext;

  constructor(ctx: HttpContext) {
    this.#ctx = ctx;
  }

  /** Flash an arbitrary key/value onto the next request's session. */
  with(key: string, value: unknown): this {
    this.#ctx.flash(key, value);
    return this;
  }

  /** Flash a map of field errors under the `errors` key. */
  withErrors(errors: Record<string, string>): this {
    return this.with("errors", errors);
  }

  /** Flash a success message under the `success` key. */
  withSuccess(message: string): this {
    return this.with("success", message);
  }

  /** Flash an error message under the `error` key. */
  withError(message: string): this {
    return this.with("error", message);
  }

  /** Flash a warning message under the `warning` key. */
  withWarning(message: string): this {
    return this.with("warning", message);
  }

  /** Flash an info message under the `info` key. */
  withInfo(message: string): this {
    return this.with("info", message);
  }

  then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve<void>(undefined).then(onfulfilled, onrejected);
  }
}

// ── RedirectBuilder ─────────────────────────────────────────────────────────

/**
 * Returned by the no-argument `redirect()` form to pick a destination fluently. Each method
 * sets the redirect target and returns a {@link ResponseBuilder} so flash data can be chained:
 *
 * @example
 * redirect("/login", 302).withError("Please log in to continue.");
 * redirect().back().withErrors({ email: "Invalid email or password." });
 * redirect().intended("/").withInfo("Please log in to continue.");
 * redirect().to("profile", { username: "alice" }).withSuccess("Profile updated.");
 */
export class RedirectBuilder {
  readonly #ctx: HttpContext;

  constructor(ctx: HttpContext) {
    this.#ctx = ctx;
  }

  /** Redirect to an absolute or relative URL. */
  away(url: string, status: 301 | 302 | 303 | 307 | 308 = 302): ResponseBuilder {
    this.#ctx.redirect(url, status);
    return new ResponseBuilder(this.#ctx);
  }

  /**
   * Redirect to a named route, resolving its URL from the route name and params.
   *
   * Params are checked against the route's pattern once `types/routes.generated.ts`
   * exists. For a query string, or a name only known at runtime, redirect to a
   * built URL instead: `redirect().away(route.dynamic(name, params, query))`.
   */
  to<N extends RouteTarget>(
    name: N,
    params?: RouteParamsArg<N>,
    status: 301 | 302 | 303 | 307 | 308 = 302,
  ): ResponseBuilder {
    // The values in `RouteParams<N>` are `RouteParamValue`s by construction, but
    // `N` is still a type variable here, so the compiler cannot see through the
    // conditional to say so.
    this.#ctx.redirect(route.dynamic(name, params as RouteParamValues), status);
    return new ResponseBuilder(this.#ctx);
  }

  /** Redirect to the previous URL (the `Referer`). */
  back(status: 301 | 302 | 303 | 307 | 308 = 302): ResponseBuilder {
    this.#ctx.back(status);
    return new ResponseBuilder(this.#ctx);
  }

  /**
   * Redirect to the URL stored in session under `intended_url` (set by RequireAuth when
   * intercepting an unauthenticated request), then clear it. Falls back to `fallback` when
   * none is stored, or when the stored URL is cross-origin (open-redirect guard).
   *
   * **Single use.** Reading it spends it, so a second call in the same sign-in gets
   * `fallback` — which is right (a stale destination should not hijack a later
   * navigation) and surprising when the *first* redirect did not take effect. If a
   * form is resubmitted because its redirect went unnoticed, the retry lands on
   * `fallback`, and a customer who was part-way through something arrives somewhere
   * they did not ask for with their selection gone. Nothing here can tell the two
   * cases apart; read the value before authenticating if the flow needs it twice.
   */
  intended(fallback = "/", status: 301 | 302 | 303 | 307 | 308 = 302): ResponseBuilder {
    const session = (
      this.#ctx as unknown as {
        session?: { get<T>(k: string): T | undefined; forget(k: string): void };
      }
    ).session;
    const stored = session?.get<string>("intended_url");
    if (stored) session?.forget("intended_url");
    this.#ctx.redirect(safeRedirectPath(stored, this.#ctx.url.origin) ?? fallback, status);
    return new ResponseBuilder(this.#ctx);
  }
}

/**
 * Return type for controller handler methods.
 *
 * `void` covers the direct helpers (`json()`, `view()`, `ctx.json()`, etc.).
 * `ResponseBuilder` covers fluent redirect helpers (`back()`, `redirect()`, etc.)
 * `MarkdownBuilder` covers `markdown().withLayout(...)` chains.
 * Both builder types implement `PromiseLike<void>` so they are valid in
 * `async (): Promise<void>` handlers.
 *
 * @example
 * async store(ctx: HttpContext): Promise<ControllerResponse> {
 *   return back().withErrors({ title: 'Required' });
 * }
 */
export type ControllerResponse = void | ResponseBuilder | MarkdownBuilder;

// ── MarkdownBuilder ────────────────────────────────────────────────────────

/**
 * Builder returned by `markdown()` that enables optional layout chaining, e.g.
 * `return markdown(content, { title }).withLayout(Layout, { title })`.
 *
 * Calling `.withLayout()` re-renders the markdown inside the provided layout
 * function, overwriting the plain markdown response already set by `markdown()`.
 * Implements `PromiseLike<void>` following the same pattern as `ResponseBuilder`.
 */
export class MarkdownBuilder implements PromiseLike<void> {
  readonly #content: string;
  readonly #options: BunMarkdownOptions & { title?: string };
  readonly #status: number;

  constructor(content: string, options?: BunMarkdownOptions & { title?: string }, status = 200) {
    this.#content = content;
    this.#options = options ?? {};
    this.#status = status;
  }

  /**
   * Re-render the markdown content inside a custom layout function.
   *
   * `layoutFn` receives `{ ...props, content: <rendered-html> }` and must return
   * a complete HTML string. This call REPLACES the plain markdown response
   * that was set when `markdown()` was first called.
   *
   * @example
   * import { Layout } from "./_layout";
   *
   * export function GET() {
   *   const title = "Welcome to Zerotal!";
   *   return markdown(CONTENT, { title }).withLayout(Layout, { title });
   * }
   */
  withLayout<P extends { content: string }>(
    layoutFn: (props: P) => string,
    props: Omit<P, "content">,
  ): void {
    const { title: _title, ...mdOptions } = this.#options;
    const body = Bun.markdown.html(this.#content, {
      ...DEFAULT_MD_OPTIONS,
      ...(mdOptions as BunMarkdownOptions),
    });
    const ctx = RequestContext.tryGet();
    if (!ctx) {
      throw new Error(
        "[Zerotal] MarkdownBuilder.withLayout() must be called inside an active HTTP request.",
      );
    }
    ctx.html(layoutFn({ ...props, content: body } as P), this.#status);
  }

  then<TResult1 = void, TResult2 = never>(
    onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve<void>(undefined).then(onfulfilled, onrejected);
  }
}

// ── redirect() ────────────────────────────────────────────────────────────

/**
 * Single entry point for every redirect. Pass a URL for a direct redirect, or call with no
 * arguments to pick the destination fluently via {@link RedirectBuilder}. All forms return a
 * {@link ResponseBuilder} so flash data chains naturally.
 *
 * @example
 * redirect("/login", 302).withError("Please log in to continue.");
 * redirect().back().withErrors({ email: "Invalid email or password." });
 * redirect().intended("/").withInfo("Please log in to continue.");
 * redirect().to("profile", { username: "alice" }).withSuccess("Profile updated.");
 *
 * @throws {Error} when called outside an active HTTP request.
 */
export function redirect(url: string, status?: 301 | 302 | 303 | 307 | 308): ResponseBuilder;
export function redirect(): RedirectBuilder;
export function redirect(
  url?: string,
  status: 301 | 302 | 303 | 307 | 308 = 302,
): ResponseBuilder | RedirectBuilder {
  const ctx = _ctx();
  if (url === undefined) return new RedirectBuilder(ctx);
  ctx.redirect(url, status);
  return new ResponseBuilder(ctx);
}

/**
 * Redirect to a named route.
 * @param name - The route name to redirect to.
 * @param params - Optional route parameters to interpolate into the route path.
 * @param status - Optional HTTP status code (default: 302).
 * @returns
 */
export function redirectTo<N extends RouteTarget>(
  name: N,
  params?: RouteParamsArg<N>,
  status: 301 | 302 | 303 | 307 | 308 = 302,
): ResponseBuilder {
  return redirect().to(name, params, status);
}

// ── json() ───────────────────────────────────────────────────────────────

/**
 * Set a JSON response body on the current request.
 *
 * @param data - Any JSON-serializable value.
 * @param status - HTTP status code (default: 200).
 * @throws {Error} when called outside an active HTTP request.
 * @example
 * json({ user: { id: 1, name: 'Alice' } });      // 200
 * json({ message: 'Created' }, 201);
 */
export function json(data: unknown, status = 200): void {
  _ctx().json(data, status);
}

// ── view() ───────────────────────────────────────────────────────────────

/**
 * Render a view as the current response. Accepts either pre-rendered markup, or
 * a view component plus its props — in which case the component receives the
 * active request's `HttpContext` (route params and model bindings live on
 * `ctx.params`) and the `props` you pass as a second argument.
 *
 * @example
 * // component + props — the request HttpContext is passed automatically:
 * view(Welcome, { title: "Welcome to Zerotal" });
 *
 * // pre-rendered markup:
 * view(<Welcome title="Hi" />);
 */
export function view(markup: string | { toString(): string }, status?: number): void;
export function view<P extends Record<string, unknown> = Record<string, never>>(
  component: (ctx: HttpContext, props: P) => ViewMarkup | Promise<ViewMarkup>,
  props?: P,
  status?: number,
): void | Promise<void>;
export function view(
  markupOrComponent: ViewMarkup | AnyViewComponent,
  propsOrStatus?: Record<string, unknown> | number,
  status = 200,
): void | Promise<void> {
  // Delegate to HttpContext.view, which carries the same dual overload.
  return (_ctx().view as (...args: unknown[]) => void | Promise<void>)(
    markupOrComponent,
    propsOrStatus,
    status,
  );
}

// ── html() ───────────────────────────────────────────────────────────────

/** Set a raw HTML response body on the current request. */
export function html(markup: string | { toString(): string }, status = 200): void {
  _ctx().html(markup, status);
}

// ── markdown() ───────────────────────────────────────────────────────────

/**
 * Render markdown content and set it as the current response.
 *
 * Returns a `MarkdownBuilder` that can optionally chain `.withLayout(layoutFn, props)`
 * to re-render the content inside a custom layout. When `.withLayout()` is called it
 * replaces the plain markdown response set here with the layout-wrapped version.
 *
 * @example — plain (backward-compatible)
 * markdown(content);
 *
 * @example — with custom layout
 * return markdown(content, { title }).withLayout(Layout, { title });
 */
export function markdown(
  content: string,
  options?: BunMarkdownOptions & { title?: string },
  status = 200,
): MarkdownBuilder {
  // Render immediately so plain usage (no .withLayout) works without returning.
  _ctx().markdown(content, options, status);
  return new MarkdownBuilder(content, options, status);
}

// ── file() ───────────────────────────────────────────────────────────────

/**
 * Stream a file from disk as the response. Defaults to `attachment` disposition
 * (a browser download) with the file's basename; override either via `options`.
 *
 * @param path - Absolute or working-directory-relative path to the file.
 * @param options - Optional `filename` (download name) and `disposition`
 * (`"attachment"` to download, `"inline"` to display in the browser).
 * @throws {NotFoundError} If no file exists at `path`.
 * @example
 * await file('storage/invoices/2026-07.pdf');                          // download as "2026-07.pdf"
 * await file('storage/report.pdf', { filename: 'Q3-Report.pdf' });     // download, renamed
 * await file('storage/preview.pdf', { disposition: 'inline' });        // view in-browser
 */
export async function file(
  path: string,
  options?: { filename?: string; disposition?: "attachment" | "inline" },
): Promise<void> {
  const ctx = _ctx();
  const bunFile = Bun.file(path);

  if (!(await bunFile.exists())) throw new NotFoundError(`File not found: ${path}`);

  const name = options?.filename ?? path.replace(/\\/g, "/").split("/").pop() ?? "download";
  const disposition = options?.disposition ?? "attachment";

  // Bun's FileRef is a Blob-compatible body but its TS type predates the W3C Blob interface — cast needed.
  const blob = bunFile as unknown as Blob;

  ctx.response = new Response(blob, {
    headers: {
      "Content-Disposition": `${disposition}; filename="${name}"`,
      "Content-Type": blob.type || "application/octet-stream",
    },
  });
}

// ── abort() ──────────────────────────────────────────────────────────────

/**
 * Throw an HTTP error to end the request. Accepts a message (defaults to 500),
 * an explicit status plus message, or a `ZerotalError` subclass to instantiate.
 *
 * @throws {HttpError} (or the given `ZerotalError` subclass) — always; the return
 * type is `never`.
 * @example
 * abort('Something went wrong');           // 500
 * abort(403, 'Forbidden');                 // explicit status
 * abort(NotFoundError);                    // throw a specific error class
 */
export function abort(message: string): never;
export function abort(status: number, message: string): never;
export function abort(ErrorClass: new () => ZerotalError): never;
export function abort(
  statusOrMessageOrError: string | number | (new () => ZerotalError),
  message?: string,
): never {
  if (typeof statusOrMessageOrError === "function") {
    throw new (statusOrMessageOrError as new () => ZerotalError)();
  }
  if (typeof statusOrMessageOrError === "string") {
    throw new HttpError(statusOrMessageOrError, 500);
  }
  throw new HttpError(message ?? "Aborted", statusOrMessageOrError);
}
