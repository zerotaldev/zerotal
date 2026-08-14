/**
 * The global route registry and fluent registration API. Collects route, view,
 * resource, static, and markdown definitions at boot, then compiles them into a
 * `Bun.serve()`-compatible routes object with domain matching and model binding.
 */
import type { Container } from "../container/Container.ts";
import type {
  RouteDefinition,
  HttpMethod,
  ControllerClass,
  MiddlewareClass,
  FileHandler,
  RouteHandler,
  ModelClass,
  ModelBindingResolver,
  ViewLayout,
} from "./Route.ts";
import type {
  RouteArgs,
  RouteParamValue,
  RouteParamValues,
  RouteQuery,
  RouteTarget,
} from "./registry.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";
import type { ExceptionHandler } from "../application/ExceptionHandler.ts";
import { createRouteHandler } from "./RouteHandler.ts";
import { compileDomain, matchDomain, setRequestSubdomains } from "./domain.ts";
import type { ProviderHooks } from "./RouteHandler.ts";
import { tryCurrentApp } from "../application/currentApp.ts";
import { frameworkLog } from "../logger/frameworkLog.ts";
import {
  markdownExtractTitle,
  markdownPage,
  DEFAULT_MD_OPTIONS,
  type BunMarkdownOptions,
} from "../helpers/markdown.ts";

/**
 * Augmentable by external packages.  Declare additional methods here with
 * `declare module '@zerotal/core' { interface RouterMacros { ... } }`.
 *
 * The `Route` export from '@zerotal/core' is typed as `typeof Router & RouterMacros`
 * so every declared macro is callable as a static method.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- intentional augmentation target: external packages merge macros in via `declare module`.
export interface RouterMacros {}

// ── Handler wrappers ──────────────────────────────────────────────────────────

/**
 * Wrap a single-arg handler function in a synthetic controller class with a
 * `handle` action, so closure-style routes flow through the standard
 * `createRouteHandler` pipeline unchanged. `label` becomes the class name shown
 * in route:list and error traces.
 */
function _wrapHandler(fn: FileHandler, label: string): ControllerClass {
  const handlerController = class {
    async handle(args: unknown): Promise<unknown> {
      // Handler functions receive the request HttpContext, same as controller actions.
      return (fn as (args: unknown) => unknown)(args);
    }
  };
  Object.defineProperty(handlerController, "name", { value: label });
  return handlerController as unknown as ControllerClass;
}

function _wrapFileHandler(fn: FileHandler, debugName: string): ControllerClass {
  return _wrapHandler(fn, `FileRoute<${debugName}>`);
}

/**
 * Loose handler type used only by the verb-method *implementation* signatures.
 * The public overloads carry the precise, generic `RouteHandler<T>` typing; the
 * implementation just needs a supertype of every `RouteHandler<T>` a caller may pass.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supertype of every RouteHandler<T> the public overloads accept.
type AnyRouteHandler = RouteHandler<any>;

type RouteHandlerFn = (req: Request, server?: unknown) => Response | Promise<Response>;
/**
 * A path entry is either a method-keyed map of handlers, or a bare static
 * `Response` (Bun.serve serves the latter at zero JS cost per request).
 */
type CompiledRoutes = Record<string, Record<string, RouteHandlerFn> | Response>;

/** Options for {@link Router.static}. */
export interface StaticOptions {
  /** Extra response headers applied to every served file (e.g. Cache-Control). */
  headers?: Record<string, string>;
  /**
   * When true (default) every file in the directory is pre-registered at
   * compile() time as a static `Response`, so Bun serves it without invoking
   * JS. Set false to fall back to the per-request lookup in Application.fetch.
   */
  eager?: boolean;
}

type StaticDir = { prefix: string; rootDir: string; options?: StaticOptions | undefined };
type MarkdownDir = {
  prefix: string;
  rootDir: string;
  options?: (BunMarkdownOptions & { title?: string }) | undefined;
};

/** Options for Router.group(). All fields are optional. */
export interface GroupOptions {
  /** URL prefix applied to every route registered inside the group. */
  prefix?: string;
  /**
   * Middleware to prepend to every route inside the group.
   * Accepts a named group (string), an array of names/classes, or middleware class(es) directly.
   *
   * @example
   * Router.group({ middleware: 'api' }, () => { ... });
   * Router.group({ middleware: ['web', AuthMiddleware] }, () => { ... });
   */
  middleware?: string | string[] | MiddlewareClass | MiddlewareClass[];
  /** Host pattern; routes inside the group only match this host (e.g. ':tenant.app.com'). */
  domain?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Convert a model class (has static `findOrFail`) or a raw resolver function
 * into a `ModelBindingResolver`. Class constructors are functions in JS, so we
 * distinguish them by the presence of the `findOrFail` property.
 */
function _toResolver(modelOrResolver: ModelClass | ModelBindingResolver): ModelBindingResolver {
  if (typeof modelOrResolver === "function" && "findOrFail" in modelOrResolver) {
    return (value: string) =>
      (modelOrResolver as unknown as ModelClass).findOrFail(
        /^\d+$/.test(value) ? Number(value) : value,
      );
  }
  return modelOrResolver as ModelBindingResolver;
}

/**
 * All mutable router state in one swappable object: registered routes, the
 * active group prefix/middleware/domain, static and markdown directories, named
 * routes, and named middleware groups.
 */
export class RouterState {
  routes = new Map<string, RouteDefinition>();
  prefix = "";
  domain: string | undefined = undefined;
  staticDirs: StaticDir[] = [];
  markdownDirs: MarkdownDir[] = [];
  groupMiddleware: MiddlewareClass[] = [];
  rawRoutes = new Map<string, (req: Request) => Response | Promise<Response>>();
  namedRoutes = new Map<string, string>();
  middlewareGroups = new Map<string, MiddlewareClass[]>();
  /**
   * Resolver contributed by the ORM (via {@link setImplicitModelResolver}) that maps a route
   * parameter name to a model-binding resolver, or `undefined` when no model claims it. Consulted
   * at compile() time for any `:param` without an explicit `.bind()`.
   */
  implicitModelResolver: ((paramName: string) => ModelBindingResolver | undefined) | null = null;
}

/**
 * The routing table lives on the current {@link Application} (its
 * `routerState`), reached through {@link currentApp}. A module-level fallback
 * serves the appless case — `Router` used in a unit test, or before an
 * application is created — so the static API works standalone.
 */
const _fallbackState = new RouterState();
function _s(): RouterState {
  return tryCurrentApp()?.routerState ?? _fallbackState;
}

// ── Implicit model binding ────────────────────────────────────────────────────

/**
 * Register the resolver that powers implicit route-model binding on the current
 * application's routing state. Called by the ORM's `DatabaseProvider`; apps never
 * call this directly. Pass `null` to disable.
 *
 * @internal
 */
export function setImplicitModelResolver(
  fn: ((paramName: string) => ModelBindingResolver | undefined) | null,
): void {
  _s().implicitModelResolver = fn;
}

/**
 * The registry key for a route.
 *
 * The domain is part of the key, not just the definition, because two `Router.group({ domain })`
 * blocks routinely register the same method and path for different hosts. Keying on
 * `method path` alone collapsed them onto one entry, so a later public group silently erased
 * an earlier admin group's routes *and its auth middleware*, and the survivor answered on any
 * host. Only `_register` carried the domain; `_registerAbsolute` (resource routes) and
 * `_registerFileHandler` (view + file routes) did not, which is why they were the ones that
 * lost it. `\0` separates because it cannot occur in a path or a host.
 */
function _routeKey(method: HttpMethod, fullPath: string, domain: string | undefined): string {
  return domain ? `${method} ${fullPath}\u0000${domain}` : `${method} ${fullPath}`;
}

/**
 * Derive a `HEAD` handler from a route's `GET` handler.
 *
 * `HEAD` must answer with the status and headers `GET` would, and no body (RFC 9110 §9.3.2).
 * Bun does not derive it, and `HttpMethod` has no `HEAD` member — so every uptime monitor,
 * load-balancer probe, CDN origin check and `curl -I` against a Zerotal app got a 404. Running
 * the real handler and dropping the body is the only way to keep the headers honest;
 * `Content-Length` is preserved explicitly, since constructing a bodiless Response otherwise
 * loses it.
 */
function _headFrom(get: RouteHandlerFn): RouteHandlerFn {
  return async (req: Request, server?: unknown): Promise<Response> => {
    const response = await get(req, server);
    const body = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set("Content-Length", String(body.byteLength));
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

/** Extract `:param` names from a route path pattern. */
function _pathParams(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]!);
}

/**
 * Returned by Router.get/post/put/delete/patch — allows chaining .name() and .bind()
 * to register the route for URL generation and model binding.
 *
 * @example
 * Router.get('/posts/:slug', PostController, 'show').name('posts.show');
 * route('posts.show', { slug: 'hello' }); // → '/posts/hello'
 *
 * Router.get('/users/:user', UserController, 'show').bind('user', User);
 * // controller: const user = ctx.model<User>('user');
 */
export interface RouteRegistration {
  /**
   * Name this route so it can be resolved to a URL with the {@link route} helper.
   *
   * @param routeName - Dot-notation name, e.g. `'posts.show'`.
   */
  name(routeName: string): RouteRegistration;
  /**
   * Attach a model binding to a specific route parameter.
   *
   * When a request matches this route, the framework calls `Model.findOrFail(id)`
   * before the controller runs and stores the result in `ctx.model('paramName')`.
   * If the record does not exist, a `ModelNotFoundError` (404) is thrown automatically.
   *
   * @param paramName  The `:param` segment name (without the colon).
   * @param model      A model class with a `static findOrFail(id)` method,
   *                   OR a custom async resolver `(value, ctx) => Promise<T>`.
   *
   * @example
   * // Model class (uses findOrFail internally):
   * Router.get('/users/:user', UserController, 'show').bind('user', User);
   *
   * // Custom resolver — resolve by slug instead of id:
   * Router.get('/posts/:post', PostController, 'show')
   *   .bind('post', (value) => Post.where('slug', value).firstOrFail());
   */
  bind(paramName: string, model: ModelClass | ModelBindingResolver): RouteRegistration;
}

/** Returned by {@link Router.view} — chain `.name()` and `.withLayout()` to configure the view route. */
export interface ViewRegistration {
  /** Name this view route for URL generation via the {@link route} helper. */
  name(routeName: string): ViewRegistration;
  /** Wrap the rendered component in a layout that receives it as `children`. */
  withLayout(layout: ViewLayout): ViewRegistration;
}

/** Encode one catch-all value: `'guides/intro'` and `['guides','intro']` both give `guides/intro`. */
function _encodeWildcard(value: RouteParamValue | readonly RouteParamValue[]): string {
  const segments = Array.isArray(value) ? value : String(value).split("/");
  return (segments as readonly RouteParamValue[])
    .map((segment) => encodeURIComponent(String(segment)))
    .filter((segment) => segment.length > 0)
    .join("/");
}

/** Serialise the query bag: `null`/`undefined` drop out, arrays repeat the key. */
function _encodeQuery(query: RouteQuery): string {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values as readonly (string | number | boolean)[]) {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(entry))}`);
    }
  }
  return pairs.join("&");
}

/** The {@link route} helper: a checked call signature plus its `dynamic` escape hatch. */
export interface RouteBuilder {
  /**
   * Generate a URL for a named route, substituting `:param` segments.
   *
   * @param name - The registered route name, e.g. `'posts.show'`.
   * @param args - `params` (one value per `:param`; a catch-all takes the `"*"` key and accepts an array of segments) then optional `query` values.
   * @throws {Error} when the route name is unknown, a required `:param` is missing, or a param key matches no segment.
   */
  <N extends RouteTarget>(name: N, ...args: RouteArgs<N>): string;

  /**
   * Build a URL for a route name that isn't known at compile time — a name from
   * config, a database row, or a package that registers routes conditionally.
   *
   * The escape hatch is a separate function rather than an overload on purpose:
   * an overload taking `string` is matched by every string, which would let
   * every typo through the front door. This one is greppable, and reads as the
   * exception it is.
   *
   * @param name - The route name, resolved at runtime.
   * @param params - One value per `:param` in the pattern.
   * @param query - Optional query-string values.
   * @throws {Error} on the same conditions as {@link route} — an unknown name still throws.
   *
   * @example
   * route.dynamic(config('app.home_route'), { id })
   */
  dynamic(name: string, params?: RouteParamValues, query?: RouteQuery): string;
}

/**
 * Generate a URL for a named route, substituting `:param` segments.
 *
 * Params are **exact**: a key the pattern has no segment for is a mistake, not a
 * query-string entry, so query values go in the third argument. That is what
 * makes the types worth having — a typo'd param name that silently became
 * `?slugg=hello` is precisely the bug this signature exists to catch.
 *
 * Once `types/routes.generated.ts` exists (`bun zt route:types`) the name and
 * its params are checked at compile time: `route('nope')` and
 * `route('posts.show', {})` are both errors, and the second one names the
 * `slug` it wants. Until then every name is accepted and nothing is checked.
 * For a name that is only known at runtime, use `route.dynamic`.
 *
 * @example
 * route('posts.show', { slug: 'hello' })              // '/posts/hello'
 * route('search', {}, { q: 'reno', page: 2 })         // '/search?q=reno&page=2'
 * route('docs.show', { '*': 'guides/intro' })         // '/docs/guides/intro'
 *
 * @category Naming & URLs
 */
export const route: RouteBuilder = Object.assign(
  <N extends RouteTarget>(name: N, ...args: RouteArgs<N>): string => {
    const [params = {}, query = {}] = args as [RouteParamValues?, RouteQuery?];
    return _buildRoute(name, params, query);
  },
  {
    dynamic: (name: string, params: RouteParamValues = {}, query: RouteQuery = {}): string =>
      _buildRoute(name, params, query),
  },
);

function _buildRoute(name: string, params: RouteParamValues, query: RouteQuery): string {
  const pattern = _s().namedRoutes.get(name);
  if (pattern === undefined) {
    throw new Error(`[Zerotal] Named route not found: "${name}"`);
  }

  const usedKeys = new Set<string>();
  let url = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) {
      throw new Error(`[Zerotal] Missing parameter "${key}" for route "${name}"`);
    }
    usedKeys.add(key);
    // Encode path params so values containing `/ ? #` cannot mangle the URL.
    return encodeURIComponent(String(value));
  });

  // A catch-all segment reaches the router as `*` — the `[...slug]` name is gone
  // by then — so the wildcard is its own param key.
  if (url.includes("*")) {
    const value = params["*"];
    if (value === undefined) {
      throw new Error(`[Zerotal] Missing catch-all parameter "*" for route "${name}"`);
    }
    usedKeys.add("*");
    url = url.replace("*", _encodeWildcard(value));
  }

  const unknown = Object.keys(params).filter((key) => !usedKeys.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `[Zerotal] Unknown parameter${unknown.length > 1 ? "s" : ""} ` +
        `${unknown.map((key) => `"${key}"`).join(", ")} for route "${name}" (${pattern}). ` +
        `Query-string values go in the third argument: route(name, params, query).`,
    );
  }

  const search = _encodeQuery(query);
  return search ? `${url}?${search}` : url;
}

/**
 * Global static router. Collects route definitions at boot time and compiles
 * them into a Bun.serve()-compatible routes object.
 *
 * Routes are stored in a module-level Map (singleton pattern).
 * Call Router.reset() between tests to clear state.
 *
 * @example
 * Router.get('/users', UserController, 'index');
 * Router.post('/users', UserController, 'store');
 * Router.get('/posts/:slug', PostController, 'show').name('posts.show');
 * Router.resource('comments', CommentController);
 *
 * // In Application.start():
 * const routes = Router.compile(container, globalMiddleware);
 */
export class Router {
  /**
   * The live routing state — the current application's `routerState` (or the
   * standalone fallback when no application is active).
   *
   * @category Introspection
   */
  static get state(): RouterState {
    return _s();
  }

  /** @internal Current group prefix — read by FileRouter to support groupAsync wrapping. */
  static get _activePrefix(): string {
    return _s().prefix;
  }
  /** @internal Current group middleware — read by FileRouter to support groupAsync wrapping. */
  static get _activeMiddleware(): MiddlewareClass[] {
    return _s().groupMiddleware;
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  /** Resolve a middleware option (named group / class / array) to a flat class array. */
  private static _resolveMiddleware(
    middleware: string | string[] | MiddlewareClass | MiddlewareClass[],
  ): MiddlewareClass[] {
    if (typeof middleware === "string") {
      return _s().middlewareGroups.get(middleware) ?? [];
    }
    if (typeof middleware === "function") {
      return [middleware];
    }
    const result: MiddlewareClass[] = [];
    for (const item of middleware as (string | MiddlewareClass)[]) {
      if (typeof item === "string") {
        result.push(...(_s().middlewareGroups.get(item) ?? []));
      } else {
        result.push(item);
      }
    }
    return result;
  }

  private static _register(
    method: HttpMethod,
    path: string,
    controller: ControllerClass,
    action: string,
    middleware: MiddlewareClass[] = [],
  ): RouteRegistration {
    const fullPath = _s().prefix + path;
    const domain = _s().domain;
    const key = _routeKey(method, fullPath, domain);
    _s().routes.set(key, {
      method,
      path: fullPath,
      controller,
      action,
      // Group middleware is prepended so outer groups run before inner middleware.
      middleware: [..._s().groupMiddleware, ...middleware],
      name: undefined,
      bindings: new Map(),
      ...(domain ? { domain } : {}),
    });

    const registration: RouteRegistration = {
      name: (routeName: string) => {
        _s().namedRoutes.set(routeName, fullPath);
        return registration;
      },
      bind: (paramName: string, modelOrResolver: ModelClass | ModelBindingResolver) => {
        const def = _s().routes.get(key)!;
        def.bindings.set(paramName, _toResolver(modelOrResolver));
        return registration;
      },
    };
    return registration;
  }

  /**
   * Shared dispatcher for the HTTP-verb methods. Accepts both the controller form
   * `(path, Controller, 'action', middleware?)` and the closure form
   * `(path, handler, middleware?)`, discriminating on whether the third argument
   * is an action name (string) or a middleware array.
   */
  private static _route(
    method: HttpMethod,
    path: string,
    handlerOrController: ControllerClass | AnyRouteHandler,
    actionOrMiddleware?: string | MiddlewareClass[],
    middleware: MiddlewareClass[] = [],
  ): RouteRegistration {
    // Controller + action form: Router.get('/users', UserController, 'index').
    if (typeof actionOrMiddleware === "string") {
      return Router._register(
        method,
        path,
        handlerOrController as ControllerClass,
        actionOrMiddleware,
        middleware,
      );
    }
    // Closure form: Router.get('/users', (ctx) => ctx.json(...), [middleware]).
    const controller = _wrapHandler(
      handlerOrController as FileHandler,
      `Route<${method} ${_s().prefix + path}>`,
    );
    return Router._register(method, path, controller, "handle", actionOrMiddleware ?? []);
  }

  /**
   * @internal Register a route at an absolute path, bypassing the current prefix.
   * Used by ResourceRouteBuilder which captures the prefix at resource() call time.
   */
  static _registerAbsolute(
    method: HttpMethod,
    fullPath: string,
    controller: ControllerClass,
    action: string,
    middleware: MiddlewareClass[],
    name?: string,
    domain: string | undefined = _s().domain,
  ): void {
    _s().routes.set(_routeKey(method, fullPath, domain), {
      method,
      path: fullPath,
      controller,
      action,
      middleware: [..._s().groupMiddleware, ...middleware],
      name,
      bindings: new Map(),
      ...(domain ? { domain } : {}),
    });
    if (name) _s().namedRoutes.set(name, fullPath);
  }

  /** @internal Remove a single route by its map key. Used by ResourceRouteBuilder. */
  static _delete(key: string): void {
    _s().routes.delete(key);
  }

  /**
   * @internal Register a file-based route handler.
   * Wraps the function in a synthetic controller class so it flows through
   * the standard `createRouteHandler` pipeline unchanged.
   * Called by `FileRouter.scanFileRoutes()`.
   */
  static _registerFileHandler(
    method: HttpMethod,
    fullPath: string,
    handler: FileHandler,
    middleware: MiddlewareClass[],
    name?: string,
    domain: string | undefined = _s().domain,
  ): void {
    const controller = _wrapFileHandler(handler, `${method} ${fullPath}`);
    const key = _routeKey(method, fullPath, domain);
    _s().routes.set(key, {
      method,
      path: fullPath,
      controller,
      action: "handle",
      middleware: [..._s().groupMiddleware, ...middleware],
      name,
      bindings: new Map(),
      ...(domain ? { domain } : {}),
    });
    if (name) _s().namedRoutes.set(name, fullPath);
  }

  // ── Registration ──────────────────────────────────────────────────────

  /**
   * Register a GET route. Accepts either a controller action or an inline
   * closure handler.
   *
   * @example
   * // Controller + action:
   * Router.get('/users', UserController, 'index');
   * Router.get('/users', UserController, 'index', [AuthMiddleware]);
   *
   * // Inline closure — receives the request HttpContext, same as a controller action:
   * Router.get('/', (ctx) => ctx.html('<h1>Home</h1>'));
   * Router.get('/posts/:slug', (ctx: HttpContext<{ slug: string }>) =>
   *   ctx.json({ slug: ctx.params.slug }),
   * );
   * Router.get('/admin', (ctx) => ctx.json({ ok: true }), [AuthMiddleware]);
   *
   * @category Route definition
   */
  static get(
    path: string,
    controller: ControllerClass,
    action: string,
    middleware?: MiddlewareClass[],
  ): RouteRegistration;
  static get<T extends Record<string, unknown> = Record<string, never>>(
    path: string,
    handler: RouteHandler<T>,
    middleware?: MiddlewareClass[],
  ): RouteRegistration;
  static get(
    path: string,
    handlerOrController: ControllerClass | AnyRouteHandler,
    actionOrMiddleware?: string | MiddlewareClass[],
    middleware: MiddlewareClass[] = [],
  ): RouteRegistration {
    return Router._route("GET", path, handlerOrController, actionOrMiddleware, middleware);
  }

  /**
   * Register a POST route mapping `path` to a controller action or inline closure handler.
   *
   * @category Route definition
   */
  static post(
    path: string,
    controller: ControllerClass,
    action: string,
    middleware?: MiddlewareClass[],
  ): RouteRegistration;
  static post<T extends Record<string, unknown> = Record<string, never>>(
    path: string,
    handler: RouteHandler<T>,
    middleware?: MiddlewareClass[],
  ): RouteRegistration;
  static post(
    path: string,
    handlerOrController: ControllerClass | AnyRouteHandler,
    actionOrMiddleware?: string | MiddlewareClass[],
    middleware: MiddlewareClass[] = [],
  ): RouteRegistration {
    return Router._route("POST", path, handlerOrController, actionOrMiddleware, middleware);
  }

  /**
   * Register a PUT route mapping `path` to a controller action or inline closure handler.
   *
   * @category Route definition
   */
  static put(
    path: string,
    controller: ControllerClass,
    action: string,
    middleware?: MiddlewareClass[],
  ): RouteRegistration;
  static put<T extends Record<string, unknown> = Record<string, never>>(
    path: string,
    handler: RouteHandler<T>,
    middleware?: MiddlewareClass[],
  ): RouteRegistration;
  static put(
    path: string,
    handlerOrController: ControllerClass | AnyRouteHandler,
    actionOrMiddleware?: string | MiddlewareClass[],
    middleware: MiddlewareClass[] = [],
  ): RouteRegistration {
    return Router._route("PUT", path, handlerOrController, actionOrMiddleware, middleware);
  }

  /**
   * Register a PATCH route mapping `path` to a controller action or inline closure handler.
   *
   * @category Route definition
   */
  static patch(
    path: string,
    controller: ControllerClass,
    action: string,
    middleware?: MiddlewareClass[],
  ): RouteRegistration;
  static patch<T extends Record<string, unknown> = Record<string, never>>(
    path: string,
    handler: RouteHandler<T>,
    middleware?: MiddlewareClass[],
  ): RouteRegistration;
  static patch(
    path: string,
    handlerOrController: ControllerClass | AnyRouteHandler,
    actionOrMiddleware?: string | MiddlewareClass[],
    middleware: MiddlewareClass[] = [],
  ): RouteRegistration {
    return Router._route("PATCH", path, handlerOrController, actionOrMiddleware, middleware);
  }

  /**
   * Register a DELETE route mapping `path` to a controller action or inline closure handler.
   *
   * @category Route definition
   */
  static delete(
    path: string,
    controller: ControllerClass,
    action: string,
    middleware?: MiddlewareClass[],
  ): RouteRegistration;
  static delete<T extends Record<string, unknown> = Record<string, never>>(
    path: string,
    handler: RouteHandler<T>,
    middleware?: MiddlewareClass[],
  ): RouteRegistration;
  static delete(
    path: string,
    handlerOrController: ControllerClass | AnyRouteHandler,
    actionOrMiddleware?: string | MiddlewareClass[],
    middleware: MiddlewareClass[] = [],
  ): RouteRegistration {
    return Router._route("DELETE", path, handlerOrController, actionOrMiddleware, middleware);
  }

  /**
   * Register a macro — a provider-contributed static method on `Route`.
   *
   * Call this in `onRegister()` so the method is available before routes load.
   *
   * @example
   * // In FlowProvider.onRegister():
   * Router.macro('flow', flowRoute);
   *
   * // In routes/index.ts:
   * Router.flow('/dashboard', Dashboard);
   *
   * @category Route definition
   */
  static macro<K extends keyof RouterMacros>(name: K, fn: RouterMacros[K]): void {
    (Router as unknown as Record<string, unknown>)[name as string] = fn;
  }

  /**
   * Register a GET route that renders a core TSX view component directly —
   * no controller needed for simple server-rendered pages.
   *
   * `props` can be a static object (evaluated once at route registration) or a
   * per-request factory function that receives `HttpContext` and may be async.
   * When omitted, the component is called with an empty object.
   *
   * @example
   * // Static props — great for marketing/info pages:
   * Router.view('/about', AboutPage, { title: 'About Us' });
   *
   * // Dynamic props — resolved per request:
   * Router.view('/dashboard', DashboardPage, ctx => ({
   *   user: ctx.user,
   *   greeting: `Hello, ${ctx.user?.name ?? 'guest'}`,
   * }));
   *
   * // No props needed:
   * Router.view('/privacy', PrivacyPage);
   *
   * @category Route definition
   */
  static view<P extends Record<string, unknown>>(
    path: string,
    component: (props: P) => { toString(): string },
    props?: P | ((ctx: HttpContext) => P | Promise<P>),
    middleware: MiddlewareClass[] = [],
  ): ViewRegistration {
    let layout: ViewLayout | undefined;

    const handler: FileHandler = async (http) => {
      const resolved: P =
        typeof props === "function"
          ? await (props as (ctx: HttpContext) => P | Promise<P>)(http)
          : (props ?? ({} as P));
      const rendered = component(resolved);
      if (layout) {
        http.view((await layout(http, { children: rendered })) as { toString(): string });
      } else {
        http.view(rendered);
      }
    };

    const fullPath = _s().prefix + path;
    Router._registerFileHandler("GET", fullPath, handler, middleware);

    const registration: ViewRegistration = {
      name: (routeName: string) => {
        _s().namedRoutes.set(routeName, fullPath);
        return registration;
      },
      withLayout: (viewLayout: ViewLayout) => {
        layout = viewLayout;
        return registration;
      },
    };
    return registration;
  }

  /**
   * Serve static files from a local directory under a URL prefix.
   *
   * By default every file is pre-registered at compile() time as a static
   * `Response`, which Bun serves without ever entering JS — far cheaper than a
   * per-request filesystem lookup. Pass `headers` for cache-control etc., or
   * `eager: false` to keep the per-request fallback only.
   *
   * @example
   * Router.static('/assets', './public/assets');
   * Router.static('/assets', './public', {
   *   headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
   * });
   *
   * @category Route definition
   */
  static static(prefix: string, rootDir: string, options?: StaticOptions): void {
    _s().staticDirs.push({ prefix, rootDir, options });
  }

  /**
   * Discover and self-register controllers from a directory. Each exported class
   * with a static `register()` method is registered. Best-effort: scan failures
   * and unimportable files are skipped. Returns the number registered.
   *
   * @category Route definition
   */
  static async controllers(dir: string): Promise<number> {
    let count = 0;
    let glob: { scan(options: { cwd: string; onlyFiles: boolean }): AsyncIterable<string> };
    try {
      glob = new Bun.Glob("**/*.{ts,js}");
    } catch {
      return 0;
    }
    try {
      for await (const file of glob.scan({ cwd: dir, onlyFiles: true })) {
        if (file.endsWith(".test.ts") || file.endsWith(".test.js")) continue;
        let loadedModule: Record<string, unknown>;
        try {
          loadedModule = (await import(`${dir}/${file}`)) as Record<string, unknown>;
        } catch {
          continue;
        }
        for (const exported of Object.values(loadedModule)) {
          if (
            typeof exported === "function" &&
            typeof (exported as { register?: unknown }).register === "function"
          ) {
            (exported as unknown as { register: () => void }).register();
            count++;
          }
        }
      }
    } catch {
      // Scanning is best-effort — a directory that can't be walked just contributes no controllers.
    }
    if (count > 0) {
      frameworkLog("router").info(`Registered ${count} controller${count === 1 ? "" : "s"}`, {
        dir,
      });
    }
    return count;
  }

  /**
   * Serve a directory of `.md` files as rendered HTML pages.
   *
   * Maps `GET /prefix/foo/bar` → `rootDir/foo/bar.md` (also tries `index.md`
   * for bare directory paths like `/prefix/foo/`).
   *
   * Uses `Bun.markdown.html()` with GFM extensions enabled by default.
   * Pass `options` to override parser settings or supply a default page title.
   *
   * @example
   * Router.markdown('/docs', './docs');
   * Router.markdown('/docs', './docs', { headings: { ids: true } });
   *
   * @category Route definition
   */
  static markdown(
    prefix: string,
    rootDir: string,
    options?: BunMarkdownOptions & { title?: string },
  ): void {
    _s().markdownDirs.push({ prefix, rootDir, options });
  }

  // ── Resource routing ─────────────────────────────────────────────────

  /**
   * Register RESTful resource routes for a controller.
   * Returns a ResourceRouteBuilder for optional .only() / .except() filtering.
   *
   * Route map:
   *   GET    /{name}           → index
   *   GET    /{name}/create    → create
   *   POST   /{name}           → store
   *   GET    /{name}/:id       → show
   *   GET    /{name}/:id/edit  → edit
   *   PUT    /{name}/:id       → update
   *   DELETE /{name}/:id       → destroy
   *
   * @example
   * Router.resource('posts', PostController);
   * Router.resource('photos', PhotoController).only(['index', 'show']);
   * Router.resource('tags',   TagController).except(['create', 'edit']);
   *
   * @category Resource routes
   */
  static resource(
    name: string,
    controller: ControllerClass,
    middleware: MiddlewareClass[] = [],
  ): ResourceRouteBuilder {
    // Capture the current group prefix NOW — before it might be popped by group().
    const basePath = _s().prefix + "/" + name.replace(/^\/+/, "");
    return new ResourceRouteBuilder(basePath, controller, middleware);
  }

  // ── Grouping and named middleware ─────────────────────────────────────

  /**
   * Register a named middleware group for use in Router.group({ middleware }).
   *
   * @example
   * Router.middlewareGroup('api', [ThrottleMiddleware, JsonMiddleware]);
   * Router.middlewareGroup('web', [SessionMiddleware, CsrfMiddleware]);
   *
   * Router.group({ prefix: '/api', middleware: 'api' }, () => {
   *   Router.resource('posts', PostController);
   * });
   *
   * @category Middleware
   */
  static middlewareGroup(name: string, middlewares: MiddlewareClass[]): void {
    _s().middlewareGroups.set(name, middlewares);
  }

  /**
   * Run a callback with routes inside a group.
   * Groups can be nested — prefix and middleware stack accumulate.
   *
   * @example
   * Router.group({ prefix: '/api/v1', middleware: 'api' }, () => {
   *   Router.get('/users', UserController, 'index');
   * });
   * // registers GET /api/v1/users with 'api' group middleware
   *
   * Router.group({ middleware: ['web', AuthMiddleware] }, () => {
   *   Router.resource('posts', PostController);
   * });
   *
   * @category Route groups
   */
  static group(options: GroupOptions, fn: () => void): void {
    const savedPrefix = _s().prefix;
    const savedMiddleware = _s().groupMiddleware;
    const savedDomain = _s().domain;

    _s().domain = options.domain ?? savedDomain;
    _s().prefix = savedPrefix + (options.prefix ?? "");
    _s().groupMiddleware =
      options.middleware !== undefined
        ? [...savedMiddleware, ...Router._resolveMiddleware(options.middleware)]
        : savedMiddleware;

    try {
      fn();
    } finally {
      // Mirror groupAsync: a throwing callback must not corrupt group state.
      _s().prefix = savedPrefix;
      _s().groupMiddleware = savedMiddleware;
      _s().domain = savedDomain;
    }
  }

  /**
   * Async variant of {@link Router.group} — awaits the callback before restoring group state.
   *
   * @category Route groups
   */
  static async groupAsync(options: GroupOptions, fn: () => Promise<void>): Promise<void> {
    const savedPrefix = _s().prefix;
    const savedMiddleware = _s().groupMiddleware;
    const savedDomain = _s().domain;

    _s().domain = options.domain ?? savedDomain;
    _s().prefix = savedPrefix + (options.prefix ?? "");
    _s().groupMiddleware =
      options.middleware !== undefined
        ? [...savedMiddleware, ...Router._resolveMiddleware(options.middleware)]
        : savedMiddleware;

    try {
      await fn();
    } finally {
      _s().prefix = savedPrefix;
      _s().groupMiddleware = savedMiddleware;
      _s().domain = savedDomain;
    }
  }

  // ── Compilation ───────────────────────────────────────────────────────

  /**
   * Compile all registered routes into a `Bun.serve()`-compatible routes object,
   * resolving model bindings, grouping domain-scoped routes for host dispatch,
   * and registering static files, markdown pages, and raw routes.
   *
   * @category Compilation
   */
  static compile(
    container: Container,
    globalMiddleware: MiddlewareClass[] = [],
    exceptionHandler?: ExceptionHandler,
    providerHooks?: ProviderHooks,
  ): CompiledRoutes {
    const compiled: CompiledRoutes = {};

    // Merge global bindings, then group definitions by (path, method) so that
    // domain-scoped routes sharing a path can be dispatched by host.
    const groups = new Map<string, RouteDefinition[]>();
    for (const definition of _s().routes.values()) {
      // Implicit model binding — for any path param with no explicit binding, ask the ORM
      // resolver whether a registered model claims it (by `implicitBindingKey` or class-name
      // convention). An explicit `.bind()` always wins.
      const implicitResolver = _s().implicitModelResolver;
      if (implicitResolver) {
        for (const paramName of _pathParams(definition.path)) {
          if (definition.bindings.has(paramName)) continue;
          const resolver = implicitResolver(paramName);
          if (resolver) definition.bindings.set(paramName, resolver);
        }
      }
      const groupKey = `${definition.method} ${definition.path}`;
      const existing = groups.get(groupKey);
      if (existing) existing.push(definition);
      else groups.set(groupKey, [definition]);
    }

    for (const definitions of groups.values()) {
      const { path, method } = definitions[0]!;
      const map = (compiled[path] ??= {}) as Record<string, RouteHandlerFn>;
      const makeHandler = (definition: RouteDefinition): RouteHandlerFn =>
        createRouteHandler(
          definition,
          container,
          globalMiddleware,
          exceptionHandler,
          providerHooks,
        );
      const domainDefinitions = definitions.filter((definition) => definition.domain);
      const plainDefinition = definitions.find((definition) => !definition.domain);

      if (domainDefinitions.length === 0) {
        map[method] = makeHandler(plainDefinition!);
        if (method === "GET") map["HEAD"] ??= _headFrom(map[method]!);
        continue;
      }

      const hostRoutes = domainDefinitions.map((definition) => ({
        matcher: compileDomain(definition.domain!),
        handler: makeHandler(definition),
      }));
      const plainHandler = plainDefinition ? makeHandler(plainDefinition) : undefined;
      map[method] = async (req: Request, server?: unknown): Promise<Response> => {
        const host = req.headers.get("host") ?? new URL(req.url).host;
        for (const { matcher, handler } of hostRoutes) {
          const params = matchDomain(matcher, host);
          if (params) {
            setRequestSubdomains(req, params);
            return handler(req, server as never);
          }
        }
        if (plainHandler) return plainHandler(req, server as never);
        return new Response("Not Found", { status: 404 });
      };
      if (method === "GET") map["HEAD"] ??= _headFrom(map[method]!);
    }

    for (const { prefix, rootDir, options } of _s().staticDirs) {
      if (options?.eager === false) continue;
      let files: string[];
      try {
        files = Array.from(new Bun.Glob("**/*").scanSync({ cwd: rootDir, onlyFiles: true }));
      } catch {
        continue;
      }
      const basePrefix = prefix.replace(/\/$/, "");
      let registered = 0;
      for (const relativePath of files) {
        const urlPath = `${basePrefix}/${relativePath.replace(/\\/g, "/")}`.replace(/\/+/g, "/");
        if (compiled[urlPath]) continue;
        const headers = options?.headers;
        compiled[urlPath] = new Response(
          Bun.file(`${rootDir}/${relativePath}`) as unknown as BodyInit,
          headers ? { headers } : undefined,
        );
        registered++;
      }
      if (registered > 0) {
        frameworkLog("router").info(
          `Registered ${registered} static asset route${registered === 1 ? "" : "s"}`,
          { dir: rootDir },
        );
      }
    }

    for (const { prefix, rootDir, options } of _s().markdownDirs) {
      const stripped = prefix.replace(/\/$/, "");
      const pattern = stripped + "/*";
      const mdMap = (compiled[pattern] ??= {}) as Record<string, RouteHandlerFn>;
      mdMap["GET"] = async (req: Request): Promise<Response> => {
        const pathname = new URL(req.url).pathname;
        const relative = pathname.slice(stripped.length).replace(/^\//, "") || "index";
        const candidates = [`${rootDir}/${relative}.md`, `${rootDir}/${relative}/index.md`];
        for (const candidate of candidates) {
          const file = Bun.file(candidate);
          if (await file.exists()) {
            const content = await file.text();
            const { title: titleOption, ...markdownOptions } = options ?? {};
            const body = Bun.markdown.html(content, { ...DEFAULT_MD_OPTIONS, ...markdownOptions });
            const title = titleOption ?? markdownExtractTitle(content) ?? relative;
            return new Response(markdownPage(title, body), {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }
        }
        return new Response("Not Found", { status: 404 });
      };
    }

    // Raw routes bypass the middleware pipeline entirely — added last so they
    // take precedence over any same-path pipeline routes.
    for (const [key, handler] of _s().rawRoutes) {
      const spaceIndex = key.indexOf(" ");
      const method = key.slice(0, spaceIndex) as HttpMethod;
      const path = key.slice(spaceIndex + 1);
      const rawMap = (compiled[path] ??= {}) as Record<string, RouteHandlerFn>;
      rawMap[method] = handler;
    }

    return compiled;
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  /**
   * Register a raw Bun route handler that bypasses the global middleware pipeline.
   *
   * Use this for internal framework endpoints (health checks, asset servers, etc.)
   * that must not go through session / auth middleware. The handler receives the
   * raw `Request` and returns a `Response` directly — no `HttpContext`, no pipeline.
   *
   * @example
   * Router.raw('GET', '/__internal/ping', () => new Response('pong'));
   *
   * @category Route definition
   */
  static raw(
    method: HttpMethod | string,
    path: string,
    handler: (req: Request) => Response | Promise<Response>,
  ): void {
    _s().rawRoutes.set(`${method.toUpperCase()} ${path}`, handler);
  }

  /**
   * Clear all registered routes, static dirs, named routes, groups, and model bindings. Used in tests.
   *
   * @category Introspection
   */
  static reset(): void {
    _s().routes.clear();
    _s().rawRoutes.clear();
    _s().staticDirs = [];
    _s().markdownDirs = [];
    _s().prefix = "";
    _s().groupMiddleware = [];
    _s().namedRoutes.clear();
    _s().middlewareGroups.clear();
  }

  /**
   * Middleware attached to a registered route (group middleware included,
   * in execution order). Returns an empty array for unknown routes.
   *
   * Lets framework packages re-run a route's middleware outside the normal
   * HTTP pipeline — e.g. @zerotal/flow re-applies the original page route's
   * middleware on every WebSocket update (persistent middleware).
   *
   * @example
   * const middleware = Router.middlewareFor('GET', '/dashboard');
   * await runMiddleware(ctx, middleware, container);
   *
   * @category Middleware
   */
  static middlewareFor(method: HttpMethod, path: string): MiddlewareClass[] {
    return [...(_s().routes.get(`${method} ${path}`)?.middleware ?? [])];
  }

  /**
   * The currently accumulated Router.group() prefix ('' outside a group).
   * For framework packages that register derived routes and need the full
   * runtime path (e.g. @zerotal/flow storing the page path in its snapshot).
   *
   * @category Route groups
   */
  static get groupPrefix(): string {
    return _s().prefix;
  }

  /**
   * Read-only view of registered static directories. Used by Application.start() to serve files in the fetch handler.
   *
   * @category Introspection
   */
  static get staticDirs(): ReadonlyArray<{
    prefix: string;
    rootDir: string;
    options?: StaticOptions | undefined;
  }> {
    return _s().staticDirs;
  }

  /**
   * Read-only view of registered routes. Useful for debugging and tests.
   *
   * @category Introspection
   */
  static get routes(): ReadonlyMap<string, RouteDefinition> {
    return _s().routes;
  }

  /**
   * Read-only view of named routes (name → path). Useful for debugging.
   *
   * @category Naming & URLs
   */
  static get namedRoutes(): ReadonlyMap<string, string> {
    return _s().namedRoutes;
  }
}

// ── ResourceRouteBuilder ──────────────────────────────────────────────────────

type ResourceAction = "index" | "create" | "store" | "show" | "edit" | "update" | "destroy";

interface ResourceRoute {
  method: HttpMethod;
  suffix: string;
  action: ResourceAction;
}

const ALL_RESOURCE_ROUTES: ResourceRoute[] = [
  { method: "GET", suffix: "", action: "index" },
  { method: "GET", suffix: "/create", action: "create" },
  { method: "POST", suffix: "", action: "store" },
  { method: "GET", suffix: "/:id", action: "show" },
  { method: "GET", suffix: "/:id/edit", action: "edit" },
  { method: "PUT", suffix: "/:id", action: "update" },
  { method: "PATCH", suffix: "/:id", action: "update" },
  { method: "DELETE", suffix: "/:id", action: "destroy" },
];

/** Builds and manages the set of RESTful routes for a resource, with `.only()`/`.except()` filtering. */
export class ResourceRouteBuilder {
  private _registeredKeys = new Set<string>();

  /**
   * The domain in force when `Router.resource()` was called.
   *
   * Captured for the same reason `_base` is: `.only()` / `.except()` re-register after the
   * enclosing `group()` has already restored the previous domain, so reading it at commit
   * time would drop the host constraint on exactly the routes an app narrowed by hand.
   */
  private readonly _domain: string | undefined = _s().domain;

  constructor(
    private readonly _base: string,
    private readonly _controller: ControllerClass,
    private readonly _middleware: MiddlewareClass[],
  ) {
    this._commit(ALL_RESOURCE_ROUTES);
  }

  /**
   * Limit this resource to only the specified actions.
   *
   * @example
   * Router.resource('photos', PhotoController).only(['index', 'show']);
   */
  only(actions: ResourceAction[]): this {
    this._deregisterAll();
    this._commit(ALL_RESOURCE_ROUTES.filter((route) => actions.includes(route.action)));
    return this;
  }

  /**
   * Exclude the specified actions from this resource.
   *
   * @example
   * Router.resource('tags', TagController).except(['create', 'edit']);
   */
  except(actions: ResourceAction[]): this {
    this._deregisterAll();
    this._commit(ALL_RESOURCE_ROUTES.filter((route) => !actions.includes(route.action)));
    return this;
  }

  private _commit(routes: ResourceRoute[]): void {
    for (const { method, suffix, action } of routes) {
      const fullPath = this._base + suffix;
      Router._registerAbsolute(
        method,
        fullPath,
        this._controller,
        action,
        this._middleware,
        undefined,
        this._domain,
      );
      this._registeredKeys.add(_routeKey(method, fullPath, this._domain));
    }
  }

  private _deregisterAll(): void {
    for (const key of this._registeredKeys) {
      Router._delete(key);
    }
    this._registeredKeys.clear();
  }
}
