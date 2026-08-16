/**
 * The Zerotal kernel — the IoC container, application lifecycle, HTTP router and
 * pipeline, service providers, events, facades, and the common request helpers
 * that every Zerotal app builds on.
 *
 * `@zerotal/core` is the one package every app depends on. This root entry
 * carries only the hot, cheap kernel used across the framework — `Application`,
 * the {@link Container}, {@link HttpContext}, the {@link Router}, middleware,
 * providers, {@link Emitter | events}, facades, and helpers. Heavier or cohesive
 * subsystems live behind explicit subpaths so importing the kernel never drags
 * them in:
 *
 * | Subpath | What it provides |
 * | --- | --- |
 * | `@zerotal/core/contracts` | Interface-only seams packages implement and the kernel consumes (session, transaction, authenticatable user) |
 * | `@zerotal/core/carbon` | Date/time via {@link Carbon} (pulls the Temporal polyfill) |
 * | `@zerotal/core/http` | Outbound HTTP client, URL building, uploads, API resources, content negotiation |
 * | `@zerotal/core/view` | Server-side JSX runtime + authoring helpers |
 * | `@zerotal/core/env` | Typed environment-variable schema |
 * | `@zerotal/core/config` | Config manager/loader + app config shapes |
 * | `@zerotal/core/security` | `Crypt` + `Hash` |
 * | `@zerotal/core/logger` | Structured logging (`Log`, channels) |
 * | `@zerotal/core/lock` | Distributed locks |
 * | `@zerotal/core/commands` | Built-in CLI commands |
 * | `@zerotal/core/dev` | Dev-only build/reload tooling (owns `Bun.build`) |
 * | `@zerotal/core/assets` | Asset URL helper + versioning |
 * | `@zerotal/core/health` | Health checks |
 * | `@zerotal/core/metrics` | HTTP request metrics |
 *
 * @example Bootstrap an application
 * ```ts
 * // bootstrap/app.ts
 * import { Application } from "@zerotal/core";
 * import providers from "./providers.ts";
 *
 * const app = Application.create({ providers, env: "web" });
 * await app.start();
 * ```
 *
 * @example Define routes and a controller
 * ```ts
 * import { Router } from "@zerotal/core";
 *
 * Router.get("/", (ctx) => ctx.html("<h1>Hello</h1>"));
 * Router.get("/users/{id}", (ctx) => ctx.json({ id: ctx.params.id }));
 * ```
 *
 * @remarks
 * Zerotal runs on **Bun ≥ 1.1** — Node.js is not supported. The framework uses
 * `Bun.sql`, `Bun.CryptoHasher`, `Bun.build`, and other Bun-native APIs
 * throughout.
 *
 * @packageDocumentation
 */

// Application

// Application
export { Application, registerAppScope } from "./application/Application.ts";
export { currentApp, tryCurrentApp, withApp } from "./application/currentApp.ts";
export type { AuthenticatedUser } from "./auth/AuthenticatedUser.ts";
export type {
  WebSocketHandlers,
  RoutingEntry,
  RoutingConfig,
  FileRoutingEntry,
  FileRoutingConfig,
  AppScopeInstaller,
  ProviderReport,
} from "./application/Application.ts";
export { ExceptionHandler } from "./application/ExceptionHandler.ts";

// Container
export { Container } from "./container/Container.ts";
export { ScopedResolver } from "./container/ScopedResolver.ts";
export { inject } from "./container/inject.ts";
export type { ContainerBindings, BindingToken, Factory } from "./container/types.ts";

// Context
export { RequestContext } from "./context/RequestContext.ts";

// Pipeline
export { HttpContext, safeRedirectPath } from "./pipeline/HttpContext.ts";
export { currentPage, setCurrentPageResolver } from "./pipeline/currentPage.ts";
export { pageElements } from "./helpers/pageElements.ts";
export type { CurrentPageResolver } from "./pipeline/currentPage.ts";
export type { ContextRegistry, ContextKey, ContextValue } from "./pipeline/ContextRegistry.ts";
export type { CompiledDomain } from "./router/domain.ts";
export type { RequestIPProvider } from "./pipeline/HttpContext.ts";
export { Pipeline } from "./pipeline/Pipeline.ts";
export type { Pipe, NextFn, HasResponse, HttpResponse } from "./pipeline/types.ts";

// Provider
export { ServiceProvider } from "./provider/ServiceProvider.ts";
export type { AppEnvironment } from "./provider/ServiceProvider.ts";
export type { ConcernDescriptor, ConcernContext } from "./conventions/ConventionLoader.ts";

// Doctor (`zt doctor`; providers contribute checks via doctorChecks() or app.registerDoctorCheck())
export { runDoctor, builtinDoctorChecks } from "./doctor/AppDoctor.ts";
export type { DoctorCheck, DoctorCheckResult, DoctorReportEntry } from "./doctor/AppDoctor.ts";

// Dev processes (`zt dev`; providers contribute them via devProcesses()).
// Types only: naming the return type of `devProcesses()` needs them, but
// `collectDevProcesses` is the runner's own wiring and lives on `/dev`.
export type {
  DevProcessDefinition,
  DevProcessColor,
  ResolvedDevProcess,
  DevConfigShape,
} from "./dev/DevProcess.ts";

// Errors
export {
  ZerotalError,
  HttpError,
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  MethodNotAllowedError,
  ConflictError,
  GoneError,
  UnprocessableEntityError,
  TooManyRequestsError,
  ServiceUnavailableError,
  ValidationError,
  ConfigError,
  BindingNotFoundError,
  ContainerLockedError,
} from "./errors/index.ts";

// Events
export { Emitter } from "./events/Emitter.ts";
export { EventFake } from "./events/EventFake.ts";
export {
  FrameworkEvents,
  AppBooted,
  RequestHandled,
  RequestFailed,
  OutgoingRequestCompleted,
  MiddlewareSkipped,
  CommandRan,
} from "./events/FrameworkEvents.ts";
export { CallQueuedListener } from "./events/CallQueuedListener.ts";
export type { QueuedListener } from "./events/Emitter.ts";

// Helpers
export {
  env,
  requireEnv,
  setAppEnv,
  basePath,
  Str,
  tap,
  tapAsync,
  pipe,
  pipeAsync,
  rescue,
  rescueSync,
  data_get,
} from "./helpers/index.ts";
export { config } from "./helpers/config.ts";
export { pluralize, singularize, snakeCase, camelCase, tableNameFor } from "./support/str.ts";
export { deepMerge } from "./support/deepMerge.ts";
export type { DeepPartial } from "./support/deepMerge.ts";
// The type every class-keyed registry uses — a class rather than an instance.
export type { ClassRef } from "./support/classRef.ts";
export { safeEqual, sha256Hex, hmacHex } from "./support/crypto.ts";
export {
  buildCookie,
  readCookie,
  parseCookieHeader,
  type CookieOptions,
  type SameSite,
} from "./support/cookie.ts";
export { isDevSurfaceAllowed, devSurfacesEnabled } from "./support/env.ts";
// The deployment name (`production`/`staging`/…) as opposed to the runtime mode.
// Shared with first-party packages that gate behaviour on it — `APP_ENV` cannot be
// read directly for this after `setAppEnv()`.
export { isProdLike, deployEnv } from "./support/env.ts";
// Development-error-page diagnoses. A package that owns an error class registers
// a diagnoser so the overlay can say what to do about it — see `@zerotal/orm`,
// which turns "no such table" into the list of migrations that have not run.
export { registerErrorDiagnoser } from "./application/diagnostics.ts";
export type { ErrorDiagnoser, ErrorDiagnosis, DiagnosisAction } from "./application/diagnostics.ts";
export { fluent, Fluent } from "./helpers/fluent.ts";
export { collect, Collection } from "./helpers/Collection.ts";
export {
  ResponseBuilder,
  RedirectBuilder,
  MarkdownBuilder,
  redirect,
  redirectTo,
  json,
  view,
  html,
  markdown,
  file,
  abort,
} from "./helpers/response.ts";
export type { ControllerResponse } from "./helpers/response.ts";
export { request } from "./helpers/request.ts";
export { make, app } from "./helpers/make.ts";

// Router
export {
  RouterState,
  route,
  ResourceRouteBuilder,
  setImplicitModelResolver,
} from "./router/Router.ts";
export type {
  RouteRegistration,
  ViewRegistration,
  GroupOptions,
  RouterMacros,
  RouteBuilder,
} from "./router/Router.ts";
// Typed route names — `RouteRegistry` is the augmentation target that
// `types/routes.generated.ts` fills in (see `bun zt route:types`).
export type {
  RouteRegistry,
  RouteName,
  RouteTarget,
  RoutePattern,
  RouteParams,
  RouteParamsArg,
  RouteParamValue,
  RouteParamValues,
  RouteQuery,
  RouteArgs,
  ParamsOf,
} from "./router/registry.ts";
// The generator itself stays off the kernel barrel — it is build-time tooling,
// reached through `bun zt route:types` (and by `serve --dev-worker` internally).
export type {
  RouteDefinition,
  HttpMethod,
  MiddlewareClass,
  ModelClass,
  ModelBindingResolver,
  ViewComponent,
  ViewLayout,
} from "./router/Route.ts";
export { scanFileRoutes, registerFileRouteResolver } from "./router/FileRouter.ts";
export type { FileRouteResolver, FileRouteContext } from "./router/FileRouter.ts";
export type {
  FileHandler,
  RouteModule,
  RouteFileMeta,
  RouteMiddleware,
  RouteMethodMiddleware,
  MiddlewareModule,
} from "./router/FileRouter.ts";
export type { FileHandler as FileRouteHandler } from "./router/FileRouter.ts";

// Command
export { Command } from "./command/Command.ts";
export type { ArgDef, FlagDef } from "./command/Command.ts";
export { CommandRunner } from "./command/CommandRunner.ts";
export { startZerotal } from "./command/startZerotal.ts";
export type { StartZerotalOptions } from "./command/startZerotal.ts";

// OutputWriter
export { TerminalWriter, BufferWriter } from "./command/OutputWriter.ts";
export type { OutputWriter } from "./command/OutputWriter.ts";

// Facades
export { createFacade } from "./facade/Facade.ts";
export { App, Config, Events, Artisan } from "./facade/facades/index.ts";
export type { ArtisanResult } from "./facade/facades/index.ts";

// Middleware
export { BaseMiddleware } from "./middleware/BaseMiddleware.ts";
export { ThrottleMiddleware } from "./middleware/ThrottleMiddleware.ts";
export type { ThrottleOptions } from "./middleware/ThrottleMiddleware.ts";
export { CorsMiddleware } from "./middleware/CorsMiddleware.ts";
export type { CorsOptions } from "./middleware/CorsMiddleware.ts";
export { RateLimiter, LimiterDefinition } from "./middleware/RateLimiter.ts";
export { SecureHeadersMiddleware } from "./middleware/SecureHeadersMiddleware.ts";
export type { SecureHeadersOptions } from "./middleware/SecureHeadersMiddleware.ts";
export { WebhookMiddleware } from "./middleware/WebhookMiddleware.ts";
export type { WebhookOptions } from "./middleware/WebhookMiddleware.ts";

// Response header helper — reconstructs (never mutates) so immutable responses are safe
export { withHeaders } from "./http/withHeaders.ts";

import { Router as _Router } from "./router/Router.ts";
import type { RouterMacros as _RouterMacros } from "./router/Router.ts";

/**
 * The route registry, macro-aware: methods packages add via `Router.macro()`
 * (`Router.flow`, `Router.inertia`, …) are visible to TypeScript without a cast.
 */
export const Router: typeof _Router & _RouterMacros = _Router as typeof _Router & _RouterMacros;
