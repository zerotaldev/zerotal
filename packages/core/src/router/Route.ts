/**
 * The shared routing type vocabulary: HTTP methods, controller/middleware
 * class shapes, the handler `Context` bag, model-binding contracts, and the
 * compiled `RouteDefinition` that the router and file router both build.
 */
import type { HttpContext } from "../pipeline/HttpContext.ts";
import type { Pipe } from "../pipeline/types.ts";

/** The HTTP methods the router can register routes for. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A controller class the router can instantiate to dispatch an action. */
export type ControllerClass = new (...args: unknown[]) => unknown;
/** A middleware class the pipeline can instantiate into a {@link Pipe}. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- middleware constructors take provider-specific dependency args that aren't known at this boundary.
export type MiddlewareClass = new (...args: any[]) => Pipe<HttpContext>;

/** Handler signature for file-based routes. Receives the request {@link HttpContext}
 *  directly — route params and resolved model bindings live on `ctx.params`. May return
 *  a Response or mutate `ctx` directly. */
export type FileHandler = (ctx: HttpContext) => void | Response | Promise<void | Response>;

/**
 * Closure handler for an inline route (e.g. `Router.get('/', handler)`). Receives the
 * request {@link HttpContext} directly. The optional type parameter types `ctx.params`
 * with the route's bound models / raw route params.
 *
 * @example
 * Router.get('/', (ctx) => ctx.html('<h1>Home</h1>'));
 * Router.get('/posts/:slug', (ctx: HttpContext<{ slug: string }>) =>
 *   ctx.json({ slug: ctx.params.slug }),
 * );
 */
export type RouteHandler<T extends Record<string, unknown> = Record<string, never>> = (
  ctx: HttpContext<T>,
) => void | Response | Promise<void | Response>;

/** A view function rendered for a route, receiving the request context and explicit props. */
export type ViewComponent<P extends Record<string, unknown> = Record<string, unknown>> = (
  ctx: HttpContext,
  props: P,
) => unknown;

/** A layout that wraps a rendered view's output as its `children`. */
export type ViewLayout = (ctx: HttpContext, props: { children: unknown }) => unknown;

/**
 * A callable resolver for a single route-model binding.
 * Receives the raw string param value and the current context;
 * must return (or resolve to) the model instance.
 * Throw `ModelNotFoundError` (or any 404 error) when the record does not exist.
 */
export type ModelBindingResolver = (value: string, ctx: HttpContext) => Promise<unknown>;

/**
 * Duck-typed interface for ActiveRecord model classes.
 * Any class with a static `findOrFail(id)` method satisfies this contract
 * without importing `BaseModel` from `@zerotal/orm` (which would create a cycle).
 */
export interface ModelClass {
  findOrFail(id: number | string): Promise<unknown>;
}

/** A fully compiled route ready for matching and dispatch. */
export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  controller: ControllerClass;
  action: string;
  middleware: MiddlewareClass[];
  name: string | undefined;
  /** Per-route model bindings, keyed by param name. Merged with global bindings at compile time. */
  bindings: Map<string, ModelBindingResolver>;
  /** Host pattern from `Router.group({ domain })`; matched per request. */
  domain?: string;
}
