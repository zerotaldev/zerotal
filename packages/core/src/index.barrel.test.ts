import { describe, it, expect } from "bun:test";
import * as barrel from "./index.ts";

// Frozen kernel surface. The root `@zerotal/core` barrel is intentionally lean:
// heavy or cohesive subsystems live behind explicit subpaths (`@zerotal/core/carbon`,
// `/http`, `/view`, `/env`, `/config`, `/security`, `/dev`, `/assets`, `/health`,
// `/metrics`). This guard stops the barrel from silently re-growing into a god-module.
//
// If this test fails:
//   • You added a symbol that belongs to a subsystem → export it from that subpath's
//     `index.ts` instead of the root barrel.
//   • You deliberately grew the kernel → add the name here, on purpose.
// (Type-only exports are invisible at runtime and are not listed here.)
const KERNEL_EXPORTS = [
  "App",
  "AppBooted",
  "Application",
  "Artisan",
  "BadRequestError",
  "BaseMiddleware",
  "BindingNotFoundError",
  "BufferWriter",
  "CallQueuedListener",
  "Collection",
  "Command",
  "CommandRan",
  "CommandRunner",
  "Config",
  "ConfigError",
  "ConflictError",
  "Container",
  "ContainerLockedError",
  "CorsMiddleware",
  "Emitter",
  // Deliberate kernel addition: the emitter it stands in for is here too, and a
  // fake that is harder to import than the thing it fakes does not get used.
  "EventFake",
  "Events",
  "ExceptionHandler",
  "Fluent",
  "ForbiddenError",
  "FrameworkEvents",
  "GoneError",
  "HttpContext",
  "HttpError",
  "ZerotalError",
  "LimiterDefinition",
  "MarkdownBuilder",
  "MethodNotAllowedError",
  "MiddlewareSkipped",
  "NotFoundError",
  "OutgoingRequestCompleted",
  "Pipeline",
  "RateLimiter",
  "RedirectBuilder",
  "RequestContext",
  "RequestFailed",
  "RequestHandled",
  "ResourceRouteBuilder",
  "ResponseBuilder",
  "Router",
  "RouterState",
  "ScopedResolver",
  "SecureHeadersMiddleware",
  "ServiceProvider",
  "ServiceUnavailableError",
  "Str",
  "TerminalWriter",
  "ThrottleMiddleware",
  "TooManyRequestsError",
  "UnauthorizedError",
  "UnprocessableEntityError",
  "ValidationError",
  "WebhookMiddleware",
  "abort",
  "app",
  "basePath",
  "buildCookie",
  // Deliberate kernel additions: the doctor's check registry is a provider-facing
  // seam (registerDoctorCheck contributions run through runDoctor), like the
  // convention concerns it mirrors.
  "builtinDoctorChecks",
  "camelCase",
  "collect",
  "config",
  "createFacade",
  "currentApp",
  "currentPage",
  "data_get",
  "deepMerge",
  "deployEnv",
  "devSurfacesEnabled",
  "env",
  "file",
  "fluent",
  "hmacHex",
  "html",
  "inject",
  "isDevSurfaceAllowed",
  "isProdLike",
  "json",
  "make",
  "markdown",
  "parseCookieHeader",
  "pageElements",
  "pipe",
  "pipeAsync",
  "pluralize",
  "readCookie",
  "redirect",
  "redirectTo",
  "registerAppScope",
  // Deliberate. A package that owns an error class registers a diagnoser so the
  // dev error page can say what to do about it, and the registration happens in
  // a provider's `onRegister()` — the same place as `registerFileRouteResolver`
  // below, and the same family as `runDoctor`, which is already here. Putting it
  // behind a subpath would mean every provider importing a second entry point to
  // contribute one function.
  "registerErrorDiagnoser",
  "registerFileRouteResolver",
  "request",
  "requireEnv",
  "rescue",
  "rescueSync",
  "route",
  "runDoctor",
  "safeEqual",
  "safeRedirectPath",
  "scanFileRoutes",
  "setAppEnv",
  "setCurrentPageResolver",
  "setImplicitModelResolver",
  "sha256Hex",
  "singularize",
  "snakeCase",
  "startZerotal",
  "tableNameFor",
  "tap",
  "tapAsync",
  "tryCurrentApp",
  "view",
  "withApp",
  "withHeaders",
].sort();

describe("core barrel surface", () => {
  it("exports only the frozen lean kernel set (no silent re-growth)", () => {
    expect(Object.keys(barrel).sort()).toEqual(KERNEL_EXPORTS);
  });
});
