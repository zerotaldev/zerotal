/**
 * Turns a compiled route into a Bun request handler: it resolves model
 * bindings, runs the middleware pipeline with the controller action as the
 * final pipe, renders failures through the exception handler, and emits the
 * framework request lifecycle events.
 */
import { RequestContext } from "../context/RequestContext.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";
import type { RequestIPProvider } from "../pipeline/HttpContext.ts";
import { Pipeline } from "../pipeline/Pipeline.ts";
import { ExceptionHandler } from "../application/ExceptionHandler.ts";
import { recordHttp, beginHttp, endHttp } from "../metrics/HttpMetrics.ts";
import { FrameworkEvents, RequestHandled, RequestFailed } from "../events/FrameworkEvents.ts";
import { injectRegistry } from "../container/inject.ts";
import type { Pipe, NextFn } from "../pipeline/types.ts";
import type { Container } from "../container/Container.ts";
import type { RouteDefinition, MiddlewareClass } from "./Route.ts";

/**
 * Per-request provider hooks dispatched by Application on every HTTP request.
 * Passed to createRouteHandler via Router.compile() so RouteHandler has no
 * hard import dependency on Application (avoids a circular module graph).
 */
export interface ProviderHooks {
  onRequestReceived(ctx: HttpContext): Promise<void>;
  onRequestProcessed(ctx: HttpContext): Promise<void>;
  /** Register onResponseSent for all providers via ctx.afterResponse(). */
  scheduleResponseSent(ctx: HttpContext): void;
}

/**
 * Run a middleware chain against an HttpContext and report whether the
 * request passed all the way through.
 *
 * "Passed" means every middleware called `next()` — a terminal probe pipe at
 * the end of the chain executed. A middleware that short-circuits (returns
 * without calling next, typically after setting `ctx.response`) yields
 * `passed: false`; inspect `ctx.response` for the redirect/error it produced.
 *
 * Used by framework packages that need to re-run route middleware outside the
 * normal HTTP pipeline (e.g. @zerotal/flow persistent middleware on WebSocket
 * updates).
 *
 * @example
 * const middleware = Router.middlewareFor('GET', '/dashboard');
 * const passed = await runMiddleware(ctx, middleware, container);
 * if (!passed) {
 *   // blocked — ctx.response holds the middleware's redirect/401/…
 * }
 */
export async function runMiddleware(
  ctx: HttpContext,
  middleware: MiddlewareClass[],
  container?: Container,
): Promise<boolean> {
  if (middleware.length === 0) return true;

  let passed = false;
  const TerminalProbe = class implements Pipe<HttpContext> {
    async handle(_context: HttpContext, next: NextFn): Promise<Response | void> {
      passed = true;
      return next();
    }
  };

  const pipeline = Pipeline.send<HttpContext>(ctx).through([
    ...middleware,
    TerminalProbe as MiddlewareClass,
  ]);
  if (container) pipeline.via(container);
  await pipeline.thenReturn();

  return passed;
}

/**
 * The parts of the request lifecycle that vary between the matched-route path
 * (`createRouteHandler`) and the unmatched fallback (`Application.start()`'s
 * fetch handler). Everything else — scoping, `HttpContext` creation, timing,
 * the in-flight gauge, framework events, exception rendering, after-response
 * hooks, and metrics — is shared in {@link dispatchRequest}.
 */
export interface DispatchOptions {
  container: Container;
  exceptionHandler?: ExceptionHandler | undefined;
  providerHooks?: ProviderHooks | undefined;
  /** Configure the freshly created context (params, route info) before dispatch. */
  configure?: (ctx: HttpContext) => void;
  /**
   * Path-specific work: run the pipeline and produce the response (or leave it
   * on `ctx.response`). Errors thrown here are rendered by the exception handler.
   */
  execute: (ctx: HttpContext) => Promise<Response | undefined>;
  /**
   * Render an unhandled error to a Response. Defaults to reporting + rendering
   * through `exceptionHandler` when present, else `ExceptionHandler.defaultRender`.
   */
  renderError?: (error: unknown, ctx: HttpContext) => Promise<Response>;
}

/**
 * Run one HTTP request through the full framework lifecycle:
 *
 *   runScoped → HttpContext → RequestContext → in-flight gauge → provider
 *   hooks → execute() → exception handling → RequestHandled/RequestFailed →
 *   after-response callbacks → metrics.
 *
 * Shared by `createRouteHandler` (matched routes) and `Application.start()`'s
 * fetch fallback (unmatched requests) so instrumentation — notably the
 * `beginHttp`/`endHttp` in-flight gauge — applies uniformly to both.
 */
export async function dispatchRequest(
  req: Request,
  server: unknown,
  options: DispatchOptions,
): Promise<Response> {
  const { container, exceptionHandler, providerHooks } = options;
  return container.runScoped(async (scoped) => {
    const ctx = new HttpContext(req, scoped);
    ctx._server = server as RequestIPProvider | undefined;
    options.configure?.(ctx);

    return RequestContext.run(ctx, async (): Promise<Response> => {
      const startedAtHighRes = performance.now();
      const startedAtMs = Date.now();
      beginHttp(); // in-flight gauge ++ (paired with endHttp in finally)
      let response: Response;
      let failure: unknown;

      try {
        if (providerHooks) await providerHooks.onRequestReceived(ctx);

        const result = await options.execute(ctx);

        if (providerHooks) await providerHooks.onRequestProcessed(ctx);

        response = result ?? ctx.response ?? new Response("", { status: 204 });
      } catch (error) {
        failure = error;
        if (options.renderError) {
          response = await options.renderError(error, ctx);
        } else if (exceptionHandler) {
          await exceptionHandler.report(error, ctx);
          response = await exceptionHandler.render(error, ctx);
        } else {
          response = await ExceptionHandler.defaultRender(error, ctx);
        }
      } finally {
        endHttp(); // in-flight gauge -- (always, even if error rendering throws)
      }

      // Last chance to touch the response. Runs for a rendered error exactly as
      // it does for a success, which is what lets session state set before a
      // throw (flashed validation errors, old input) reach the client on the
      // redirect that was supposed to carry it.
      for (const finalize of ctx._responseFinalizers) {
        try {
          await finalize(response!);
        } catch (error) {
          console.error("[Zerotal] response finalizer failed:", error);
        }
      }

      // Framework instrumentation: emit on every outcome so subscribers
      // (devtools, logger, telemetry) can finalise the request trace.
      const durationMs = Math.round(performance.now() - startedAtHighRes);
      if (failure !== undefined) {
        FrameworkEvents.emit(
          new RequestFailed(
            ctx,
            startedAtMs,
            durationMs,
            failure instanceof Error ? failure.message : String(failure),
            response!.status,
            // The class name and the stack alongside the message. A subscriber
            // rendering a failure has nothing to show without them, and by the
            // time the event is emitted the error is the only place they exist.
            failure instanceof Error ? failure.name : undefined,
            failure instanceof Error ? failure.stack : undefined,
          ),
        );
      } else {
        FrameworkEvents.emit(new RequestHandled(ctx, startedAtMs, durationMs));
      }

      // scheduleResponseSent fires for every request — success and error alike.
      // Providers observing onResponseSent see all outcomes via ctx.response.
      if (providerHooks) providerHooks.scheduleResponseSent(ctx);

      // runScoped's finally block calls scoped.flush() — no manual flush needed.
      if (ctx._afterResponseCallbacks.length > 0) {
        void Promise.allSettled(ctx._afterResponseCallbacks.map((callback) => callback()));
      }

      try {
        recordHttp(response!.status, performance.now() - startedAtHighRes);
      } catch {
        // Metrics are best-effort and must never break a request.
      }
      return response!;
    });
  });
}

/**
 * Whether a controller class declares constructor dependencies — via
 * `@inject()` metadata or declared constructor parameters. Used to decide whether zero-arg construction is a
 * safe fallback when container resolution fails.
 */
function _declaresConstructorDeps(ctor: RouteDefinition["controller"]): boolean {
  const injected = injectRegistry.get(ctor);
  if (injected && injected.length > 0) return true;
  return ctor.length > 0;
}

/**
 * Build a Bun-compatible request handler for a single route.
 *
 * The controller action is injected as the LAST pipe in the chain so that
 * middleware finally-blocks (e.g. SessionMiddleware saving the cookie) execute
 * after ctx.response has been set by the controller.
 *
 * Uses container.runScoped() so the scoped resolver is placed in AsyncLocalStorage,
 * allowing container.make() for scoped bindings to work correctly inside matched routes.
 */
export function createRouteHandler(
  definition: RouteDefinition,
  container: Container,
  globalMiddleware: MiddlewareClass[] = [],
  exceptionHandler?: ExceptionHandler,
  providerHooks?: ProviderHooks,
): (req: Request, server?: unknown) => Promise<Response> {
  return (req: Request, server?: unknown): Promise<Response> =>
    dispatchRequest(req, server, {
      container,
      exceptionHandler,
      providerHooks,
      configure(ctx) {
        ctx.params = (req as { params?: Record<string, string> }).params ?? {};
        ctx._routeDef = {
          pattern: definition.path,
          controller: definition.controller.name,
          action: definition.action,
        };
      },
      async execute(ctx) {
        // Resolve the controller before building the pipe chain so failures
        // are caught by dispatchRequest and return a proper error response.
        // Zero-arg construction is only a fallback for dependency-FREE
        // controllers; a controller that declares dependencies must fail
        // loudly here rather than run with `undefined` injections that
        // explode far from the cause.
        let controller: Record<string, unknown>;
        try {
          controller = (await container.make(definition.controller)) as Record<string, unknown>;
        } catch (error) {
          if (_declaresConstructorDeps(definition.controller)) {
            throw new Error(
              `Failed to resolve controller ${definition.controller.name} from the container: ` +
                `${error instanceof Error ? error.message : String(error)}`,
              { cause: error },
            );
          }
          controller = new definition.controller() as Record<string, unknown>;
        }

        const action = controller[definition.action];
        if (typeof action !== "function") {
          throw new Error(
            `Controller action "${definition.action}" not found on ${definition.controller.name}.`,
          );
        }

        // Build a single-use Pipe that invokes the controller action.
        // Placing it LAST in the chain means middleware finally-blocks run
        // after ctx.response is set — required for session cookie persistence.
        const boundAction = (
          action as (ctx: HttpContext) => Promise<Response | void> | Response | void
        ).bind(controller);

        const ControllerPipe = class implements Pipe<HttpContext> {
          // Innermost pipe — runs the controller action and produces the response.
          // It never calls next(); the pipeline terminal reads ctx.response.
          // Route params and resolved model bindings are already on ctx.params.
          async handle(context: HttpContext, _next: NextFn): Promise<Response | void> {
            const result = await boundAction(context);
            if (result instanceof Response) {
              context.response = result;
            }
            return context.response;
          }
        };

        // ── Route-model binding ────────────────────────────────────────────
        // Second-innermost pipe: every middleware has run, the controller has
        // not.
        //
        // This used to resolve before the pipeline, which put a database read
        // and a 404 ahead of authentication: a protected route answered 404 for
        // a missing id but 401 for one that existed, so anyone could enumerate
        // which records exist without logging in. Middleware now decides
        // whether the request may proceed at all before a binding is resolved.
        //
        // A throw here still renders correctly — `execute()` is wrapped by
        // dispatchRequest's exception handler — and it now unwinds *through*
        // the middleware, so their finally-blocks (e.g. SessionMiddleware
        // persisting the cookie) run on a binding 404 as they do on any other
        // failure.
        const ModelBindingPipe = class implements Pipe<HttpContext> {
          async handle(context: HttpContext, next: NextFn): Promise<Response | void> {
            const params = context.params as Record<string, unknown>;
            for (const [paramName, resolver] of definition.bindings) {
              const paramValue = params[paramName] as string | undefined;
              if (paramValue === undefined) continue;
              const instance = await resolver(paramValue, context);
              context._models.set(paramName, instance);
              // Fold the resolved model onto params under its param name so handlers
              // read it via `ctx.params.post` (raw string params stay as-is).
              params[paramName] = instance;
            }
            return next();
          }
        };

        const allPipes = [
          ...globalMiddleware,
          ...definition.middleware,
          ...(definition.bindings.size > 0 ? [ModelBindingPipe as MiddlewareClass] : []),
          ControllerPipe as MiddlewareClass,
        ];

        const finalContext = await Pipeline.send<HttpContext>(ctx)
          .through(allPipes)
          .via(container)
          .thenReturn();

        return finalContext.response ?? undefined;
      },
    });
}
