/**
 * The application kernel: the central object that wires the IoC container,
 * registers and boots service providers through the framework lifecycle, loads
 * configuration and routes, and starts the HTTP/worker server.
 */
import { Container } from "../container/Container.ts";
import { frameworkLog } from "../logger/frameworkLog.ts";
import { ServiceProvider } from "../provider/ServiceProvider.ts";
import type { AuthenticatedUser } from "../auth/AuthenticatedUser.ts";
import * as DevWsServer from "../dev/DevWsServer.ts";
import { DevReloadMiddleware, setDevReloadClientActive } from "../dev/DevReloadMiddleware.ts";
import { onGracefulStopRequest } from "../dev/devShutdown.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";
import { Pipeline } from "../pipeline/Pipeline.ts";
import { ExceptionHandler } from "./ExceptionHandler.ts";
import { Router, RouterState } from "../router/Router.ts";
import { defineRouteMethods, defineRoutes } from "../router/routes.ts";
import type { StaticOptions } from "../router/Router.ts";
import { Health, resolveHealthConfig, checkHealthAccess } from "../health/Health.ts";
import type { HealthConfigShape } from "../health/Health.ts";
import { scanFileRoutes } from "../router/FileRouter.ts";
import {
  runConventions,
  importConventionModules,
  type ConcernDescriptor,
  type ConcernContext,
} from "../conventions/ConventionLoader.ts";
import { builtinConcerns } from "../conventions/builtinConcerns.ts";
import { ConfigManager } from "../config/ConfigManager.ts";
import { DEFAULT_MAX_REQUEST_BODY_SIZE } from "../config/AppConfig.ts";
import {
  SecureHeadersMiddleware,
  staticSecurityHeaders,
} from "../middleware/SecureHeadersMiddleware.ts";
import { isAllowedOrigin, allowedOriginsFrom } from "../http/originGuard.ts";
import { rescueSync } from "../helpers/index.ts";
import {
  configureAssets,
  setAssetVersion,
  assetVersion,
  deriveAssetVersion,
} from "../assets/assets.ts";
import { ConfigLoader, type ConfigMap } from "../config/ConfigLoader.ts";
import { Emitter } from "../events/Emitter.ts";
import { FrameworkEvents, AppBooted } from "../events/FrameworkEvents.ts";
import type { Pipe, NextFn } from "../pipeline/types.ts";
import { NotFoundError } from "../errors/HttpError.ts";
import type { ContainerBindings } from "../container/types.ts";
import { dispatchRequest } from "../router/RouteHandler.ts";
import type { ProviderHooks } from "../router/RouteHandler.ts";
import { isProdLike, deployEnv, runtimeMode } from "../support/env.ts";
import { appKeyStrengthWarning } from "../support/appKey.ts";
import { runBootDoctor } from "./BootDoctor.ts";
import { runConfigValidators } from "../config/validation.ts";
import { pathToFileURL } from "node:url";
import { unroutedRoutesWarning } from "../support/unroutedRoutes.ts";
import type { DoctorCheck } from "../doctor/AppDoctor.ts";
import { defaultApp, setDefaultApp } from "./currentApp.ts";
import type { ConfigValidator, RegisteredConfigValidator } from "../config/validation.ts";
import type { ClassRef } from "../support/classRef.ts";

// ── Convention config discovery ───────────────────────────────────────────────

async function _discoverConfig(dir: string): Promise<Record<string, Record<string, unknown>>> {
  const configDir = `${dir}/config`;
  const map: Record<string, Record<string, unknown>> = {};
  try {
    const glob = new Bun.Glob("*.{ts,js}");
    for await (const file of glob.scan({ cwd: configDir, onlyFiles: true })) {
      const key = file.replace(/\.(ts|js)$/, "");
      try {
        const module = await import(`${configDir}/${file}`);
        const value = module.default ?? module;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          map[key] = value as Record<string, unknown>;
        }
      } catch {
        // Skip files that error on import (missing env vars, etc.)
      }
    }
  } catch {
    // config/ directory doesn't exist — fine for minimal apps
  }
  return map;
}

// ── Routing config types ──────────────────────────────────────────────────────

/**
 * A single entry in a `routing()` config map.
 *
 * Short form (string): just the file path — defaults apply for "web" and "api" keys.
 * Long form (object): explicit file + optional prefix/middleware overrides.
 *
 * Built-in defaults:
 *   "web" → prefix: "",     middleware: ["web"]
 *   "api" → prefix: "/api", middleware: ["api"]
 * Custom keys must declare both `prefix` and `middleware` explicitly.
 *
 * @internal
 */
export type RoutingEntry = string | { file: string; prefix?: string; middleware?: MiddlewareInput };

/** Map of named route groups to their source files. */
export type RoutingConfig = Record<string, RoutingEntry>;

/**
 * A single entry in a `fileBasedRouting()` config map.
 * Same semantics as `RoutingEntry` but points to a directory instead of a file.
 *
 * @internal
 */
export type FileRoutingEntry =
  string | { dir: string; prefix?: string; middleware?: MiddlewareInput };

/** Map of named route groups to their file-route directories. */
export type FileRoutingConfig = Record<string, FileRoutingEntry>;

/**
 * Middleware accepted by a routing entry: a named middleware group (string), an
 * array of names, a middleware class, or an array mixing names and classes.
 * Mirrors `Router.group({ middleware })`, so e.g. `[TenancyMiddleware]` works.
 */
export type MiddlewareInput = string | string[] | PipeClass | PipeClass[];

// ── Route group resolver ──────────────────────────────────────────────────────

/**
 * Resolve the prefix/middleware for a named route group. "web" and "api" have
 * built-in defaults; any other key must declare both explicitly. `label` names
 * the calling API (`routing` / `fileBasedRouting`) in error messages.
 */
function _resolveGroupOptions(
  label: "routing" | "fileBasedRouting",
  key: string,
  explicit: { prefix?: string; middleware?: MiddlewareInput },
): { prefix: string; middleware: MiddlewareInput } {
  if (key === "web" || key === "api") {
    return {
      prefix: explicit.prefix ?? (key === "web" ? "" : "/api"),
      middleware: explicit.middleware != null ? explicit.middleware : [key],
    };
  }
  if (explicit.prefix === undefined)
    throw new Error(`[Zerotal] ${label}() group "${key}" must declare an explicit prefix`);
  if (explicit.middleware == null)
    throw new Error(`[Zerotal] ${label}() group "${key}" must declare explicit middleware`);
  return { prefix: explicit.prefix, middleware: explicit.middleware };
}

function _resolveRouteGroup(
  key: string,
  entry: RoutingEntry,
): { file: string; prefix: string; middleware: MiddlewareInput } {
  const file = typeof entry === "string" ? entry : entry.file;
  const explicit = typeof entry === "object" ? entry : {};
  return { file, ..._resolveGroupOptions("routing", key, explicit) };
}

function _resolveFileRouteGroup(
  key: string,
  entry: FileRoutingEntry,
): { dir: string; prefix: string; middleware: MiddlewareInput } {
  const dir = typeof entry === "string" ? entry : entry.dir;
  const explicit = typeof entry === "object" ? entry : {};
  return { dir, ..._resolveGroupOptions("fileBasedRouting", key, explicit) };
}

type ProviderClass = new (app: Application) => ServiceProvider;
type DeferrableProviderClass = ProviderClass & {
  provides: readonly (keyof ContainerBindings)[];
};
type Environment = "web" | "console" | "worker" | "test" | "repl";
// `args: any[]`, the codebase's standard constructor shape — the same reasoning
// `container/types.ts` already writes down for `ClassToken`: `unknown[]` fails
// constructor-parameter contravariance at the call site, so any middleware class
// with a typed constructor is rejected. Every provider that registers one worked
// around it the same way, `useOnce(Middleware)`, eleven times across eight
// packages — a cast the framework was asking for rather than one anybody wanted.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- middleware classes carry their own constructor shapes
type PipeClass = new (...args: any[]) => Pipe<HttpContext>;

/** Options form for `Application.create({ ... })`. */
export interface CreateOptions {
  providers?: ProviderClass[] | undefined;
  env?: Environment | undefined;
  config?: ConfigLoader | ConfigMap | undefined;
  /**
   * Drop {@link SecureHeadersMiddleware} from the front of the pipeline.
   *
   * It is registered by default because a freshly scaffolded app otherwise ships with no
   * clickjacking protection, no MIME-sniffing protection and no referrer policy — headers
   * whose absence nothing surfaces and which cost nothing to send. Configure it through
   * `config('app.secureHeaders')`; turn it off only when a proxy in front of the app is
   * already emitting the same headers.
   */
  secureHeaders?: false | undefined;
}

function _normaliseEnv(raw: string): Environment {
  switch (raw.toLowerCase()) {
    case "local":
    case "development":
    case "dev":
    case "production":
    case "staging":
      // Deployment-environment names: the app is still a web server.
      return "web";
    default:
      return raw as Environment;
  }
}

/** A static directory mount, as recorded by {@link Router.static}. */
type StaticMount = { prefix: string; rootDir: string; options?: StaticOptions | undefined };

/**
 * @internal Exported for tests.
 *
 * Look a GET up against the directories served by per-request disk lookup, and
 * return the file when one of them has it.
 *
 * Every dir whose prefix matches is tried, not just the first: the conventional
 * `public → /` mount matches every path, so stopping there would make a second
 * mount (an app with a custom asset outDir) unreachable.
 */
export async function _lazyStaticResponse(
  url: string,
  dirs: ReadonlyArray<StaticMount>,
): Promise<Response | undefined> {
  let pathname: string;
  try {
    // Decode so `/assets/my%20app.js` finds `my app.js` on disk. A malformed
    // escape throws and belongs to no file.
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return undefined;
  }

  // The URL parser resolves `..` segments, so one surviving here arrived
  // percent-encoded — someone reaching outside the served directory.
  if (pathname.split("/").includes("..")) return undefined;

  for (const { prefix, rootDir, options } of dirs) {
    const trimmedPrefix = prefix.replace(/\/$/, "");
    const underPrefix =
      pathname.startsWith(trimmedPrefix + "/") || (trimmedPrefix === "" && pathname !== "/");
    if (!underPrefix) continue;

    const relative = pathname.slice(trimmedPrefix.length).replace(/^\//, "");
    const file = Bun.file(`${rootDir}/${relative}`);
    if (await file.exists()) {
      // The same headers Bun's native static routes carry (see Router.compile).
      // This path returns before the pipeline runs, so without it a file served
      // lazily — every file under the dev worker — would be the one response in
      // the app with no security headers on it.
      return new Response(file as unknown as BodyInit, {
        headers: { ...staticSecurityHeaders(), ...options?.headers },
      });
    }
  }
  return undefined;
}

/** Minimal WebSocket handler shape accepted by Bun.serve(). */
export interface WebSocketHandlers {
  /** Seconds a connection may go quiet before Bun closes it. Bun's default is 10. */
  idleTimeout?: number;
  open?(ws: unknown): void;
  message(ws: unknown, message: string | Uint8Array): void;
  close?(ws: unknown, code: number, reason: string): void;
  drain?(ws: unknown): void;
}

/**
 * Installs application-scoped state and returns a teardown function that
 * restores the previous state when the application is reset.
 *
 * @internal
 */
export type AppScopeInstaller = () => () => void;

/**
 * What one provider cost to boot, and what it contributed.
 *
 * @see Application.providerReport
 */
export interface ProviderReport {
  /** Provider class name. The array is in boot order. */
  name: string;
  /**
   * Wall-clock milliseconds across all three lifecycle hooks.
   *
   * `onBooted` runs concurrently across providers, so these do not sum to the
   * application's boot time — they overlap, and the report reports that rather
   * than serialising the boot to produce a tidier number.
   */
  durationMs: number;
  /** Container tokens this provider bound, as names. */
  bindings: string[];
}

/**
 * A container token as a readable name.
 *
 * Tokens are class constructors or plain strings; the map keys are neither
 * sorted nor serialisable as they stand, and a reader wants `CacheManager`, not
 * `[class CacheManager]`.
 */
function _tokenName(token: unknown): string {
  if (typeof token === "string") return token;
  if (typeof token === "function") return token.name || "‹anonymous›";
  return String(token);
}

const _appScopeInstallers: AppScopeInstaller[] = [];

/**
 * @internal Register an installer run when an {@link Application} is created and
 * torn down on reset — used by framework packages to bind per-app global state.
 */
export function registerAppScope(installer: AppScopeInstaller): void {
  _appScopeInstallers.push(installer);
}

/**
 * The application kernel: container, provider lifecycle, routing, and server.
 *
 * `Application` is the process-wide singleton that owns the IoC {@link Container},
 * registers and boots {@link ServiceProvider}s through the framework lifecycle,
 * loads configuration and routes, and binds the Bun HTTP server. Build one with
 * the fluent {@link Application.create} factory, chain configuration/routing
 * calls, then {@link start} (web) or {@link bootAsWorker} (queue worker).
 *
 * @remarks
 * The full lifecycle is: `boot()` runs phases REGISTERING → BOOTING → BOOTED
 * (config, provider graph, routes, conventions); `start()` then runs STARTING →
 * STARTED and binds `Bun.serve()`; `stop()`/`close()` run STOPPING → STOPPED in
 * LIFO order. `start()` boots first if it has not already.
 *
 * @example
 * ```ts
 * // bootstrap/app.ts
 * import { Application } from "@zerotal/core";
 *
 * export const app = Application.create({ providers: [AppServiceProvider] })
 *   .useConfig(configLoader("./config"))
 *   .routing({ web: "./routes/web.ts", api: "./routes/api.ts" })
 *   .use([CorsMiddleware]);
 *
 * await app.start(3000); // boots, then serves on :3000
 * ```
 */
export class Application {
  /**
   * The application's IoC {@link Container}. Providers bind services here in
   * `onRegister()`, and code resolves them with `container.make(token)`.
   *
   * @category Container
   */
  readonly container = new Container();

  private _providers: ProviderClass[] = [];
  /** @internal The resolved, ordered provider instances driving the lifecycle after boot. */
  _activeProviders: ServiceProvider[] = [];
  /** Middleware auto-registered by providers via useOnce() — runs first. */
  private _autoMiddleware: PipeClass[] = [];
  /** Middleware registered via explicit .use() calls — runs after provider middleware. */
  private _middleware: PipeClass[] = [];
  /** @internal The runtime environment; read via the {@link environment} getter. */
  _env: Environment = "web";
  private _booted = false;
  private _bootDurationMs: number | undefined = undefined;
  /** Per-provider boot cost and container provenance; see {@link providerReport}. */
  private _providerReport: ProviderReport[] = [];
  private _static?: ReturnType<typeof Bun.serve>;
  private _configMap: Record<string, Record<string, unknown>> | undefined = undefined;
  /** Tracks where config came from, to reject conflicting overrides via useConfig(). */
  private _configSource: "create" | "useConfig" | undefined = undefined;
  /** Resolved explicit-route groups, accumulated across `routing()` calls. */
  private _routeGroups: Array<{ file: string; prefix: string; middleware: MiddlewareInput }> = [];
  /** Resolved file-route groups, accumulated across `fileBasedRouting()` calls. */
  private _fileRouteGroups: Array<{ dir: string; prefix: string; middleware: MiddlewareInput }> =
    [];
  private _exceptionHandler: ExceptionHandler | undefined = undefined;
  /**
   * WebSocket handlers registered by providers, multiplexed by path so several endpoints
   * coexist (e.g. flow's `/__flow/ws` and broadcasting's `/app/ws`). A registration without
   * a `path` is a catch-all. Each connection is tagged with `_wsPath` on upgrade and dispatched
   * to the matching registration.
   */
  /** Transport paths declared by providers in any runtime. See `declareWebSocketPath`. */
  private _declaredWsPaths = new Set<string>();

  private _wsRegistrations: Array<{
    path?: string | undefined;
    handlers: WebSocketHandlers;
    upgradeData?: ((req: Request, server?: unknown) => Record<string, unknown>) | undefined;
  }> = [];
  /** Set by ServeCommand --dev-worker to enable the /__dev/ws HMR endpoint. */
  private _devWsEnabled = false;
  /** Tracks provider-auto-registered middleware to prevent double-registration. */
  private readonly _autoMiddlewareSet = new Set<ClassRef>();
  private _providerHooks: ProviderHooks | undefined = undefined;
  /** @internal The auth user-resolver registered via {@link withUserResolver}; called by AuthMiddleware. */
  _userResolver: ((id: number) => Promise<AuthenticatedUser | null>) | undefined = undefined;
  /** Convention descriptors contributed by providers (models, observers, policies, …). */
  private _concerns: ConcernDescriptor[] = [];
  /**
   * Namespace validators contributed by providers; run once at boot (see
   * {@link registerConfigValidator}).
   *
   * Readable, not private, so `zt deploy:<env>` can re-run them against the target
   * environment before a release. Boot already ran them — but on a machine that is
   * not the deployment, where `isProduction` was false and every finding was a
   * warning. Re-running them with production semantics is how a deploy reports the
   * problems that would otherwise refuse the boot after the cutover.
   *
   * @internal
   */
  readonly _configValidators: RegisteredConfigValidator[] = [];
  /** Bootstrap container-registration callbacks queued via `bind()`; run during boot(). */
  private _bindCallbacks: Array<(container: Container) => void> = [];
  /** Doctor checks contributed by providers (see {@link registerDoctorCheck}). */
  private _doctorChecks: DoctorCheck[] = [];

  private constructor() {}

  /**
   * Register a convention descriptor for auto-discovery at boot. Providers call this in
   * `onRegister()`/`onBooting()`; the loader runs all descriptors during the convention phase.
   *
   * @category Providers
   */
  registerConcern(descriptor: ConcernDescriptor): this {
    this._concerns.push(descriptor);
    return this;
  }

  /**
   * Contribute a check to `zt doctor`. Providers call this in `onRegister()`;
   * the doctor runs the built-in checks plus everything contributed here.
   *
   * @category Providers
   */
  registerDoctorCheck(check: DoctorCheck): this {
    this._doctorChecks.push(check);
    return this;
  }

  /** The provider-contributed doctor checks (read by `runDoctor`). */
  get doctorChecks(): readonly DoctorCheck[] {
    return this._doctorChecks;
  }

  /**
   * The files loaded by `routing()` groups — what actually serves explicit routes.
   * Read by the unrouted-`routes/` boot warning and the doctor.
   */
  get routedFiles(): string[] {
    return this._routeGroups.map((g) => g.file);
  }

  /**
   * Attach a validator to a config namespace. Providers call this in
   * `onRegister()`; the boot sequence runs every validator once — after
   * providers register, before they boot. In a production-like deployment an
   * `error`-level issue refuses boot; elsewhere issues are logged as warnings.
   *
   * @example
   * // In a provider's onRegister():
   * this.app.registerConfigValidator("session", (value, { isProduction }) => {
   *   const cfg = value as SessionConfigShape | undefined;
   *   return isProduction && cfg?.secure !== true
   *     ? [{ level: "error", message: "session.secure must be true in production." }]
   *     : [];
   * });
   *
   * @category Configuration
   */
  registerConfigValidator(namespace: string, validate: ConfigValidator): this {
    this._configValidators.push({ namespace, validate });
    return this;
  }

  /** @internal This application's isolated router state, swapped in as the active state on create. */
  readonly routerState = new RouterState();
  private _scopeRestores: Array<() => void> = [];

  // ── Static factory / singleton ────────────────────────────────────────
  // The process-default application is owned by `currentApp.ts`, so there is
  // exactly one ambient "current app" in the framework.

  /**
   * Create the process's application.
   *
   * There is exactly one application per process. Calling `create()` a second
   * time is an error — retrieve the existing app with {@link currentApp}, and
   * call {@link Application._resetInstance} before creating another (tests). The
   * environment defaults to `APP_ENV`.
   *
   * @param options - `{ providers?, env?, config? }`.
   * @throws {Error} When an application already exists in this process.
   * @category Lifecycle
   * @example
   * ```ts
   * const app = Application.create({ providers: [AppServiceProvider], env: "web" });
   * ```
   */
  static create(options: CreateOptions = {}): Application {
    if (defaultApp()) {
      throw new Error(
        "[Zerotal] An application already exists in this process. Use currentApp() to retrieve it; " +
          "call Application._resetInstance() before creating another.",
      );
    }

    // The runtime mode, which is what provider filtering is keyed on. Reading
    // `APP_ENV` here used to be right only because `setAppEnv()` had overwritten
    // it with the mode; now the mode has its own variable and this asks for it
    // directly. `_normaliseEnv` still maps a deployment name onto a mode, for an
    // explicit `options.env`.
    const rawEnv = options.env ?? runtimeMode("web");
    const resolvedEnv: Environment = _normaliseEnv(rawEnv);

    const app = new Application();
    app._env = resolvedEnv;
    if (options.secureHeaders === false) app._kernelMiddleware = [];
    if (options.providers) for (const provider of options.providers) app._addProvider(provider);
    if (options.config) {
      app._configMap =
        options.config instanceof ConfigLoader ? options.config.all() : options.config;
      app._configSource = "create";
    }
    app._scopeRestores = _appScopeInstallers.map((install) => install());
    setDefaultApp(app);
    return app;
  }

  /**
   * Pre-load config into the container before providers boot. Accepts a raw namespace map, the
   * generated configs barrel, or a {@link ConfigLoader} from `configLoader("./config")`.
   *
   * If config was already provided via `Application.create({ config })`, this call is **ignored**
   * (create() wins). That lets the framework-managed `zerotal.ts` always call `useConfig(...)`
   * without conflicting when an app chose to pass config to `create()` instead.
   *
   * @category Configuration
   * @example
   * Application.create().useConfig(configLoader("./config")).register([...]);
   */
  useConfig(input: ConfigMap | ConfigLoader): this {
    if (this._configSource === "create") {
      // Config came from Application.create({ config }) — that's the source of truth; ignore.
      return this;
    }
    this._configMap = input instanceof ConfigLoader ? input.all() : input;
    this._configSource = "useConfig";
    return this;
  }

  /**
   * Declare explicit route files for one or more named groups.
   *
   * Each key is a group name; the value is the route file path (or an object
   * with explicit `prefix` and `middleware` overrides).
   *
   * Built-in defaults (no overrides required):
   *   "web" → prefix: "",     middleware: ["web"]
   *   "api" → prefix: "/api", middleware: ["api"]
   *
   * Custom group names must declare both `prefix` and `middleware` explicitly
   * or an error is thrown at boot time.
   *
   * Routes are loaded after all providers have finished `onRegister()`, so
   * middleware groups are always available when route files run.
   *
   * Three forms, and the call is **additive** — each invocation appends more
   * groups, so you can chain calls to register several route sources:
   *
   *   .routing('./routes/web.ts')                                  // bare file → "web" group
   *   .routing({ file: './routes/api.ts', prefix: '/api', middleware: ['api'] })  // single group
   *   .routing({ web: './routes/web.ts', api: './routes/api.ts' }) // named map
   *
   * @example
   * // bootstrap/app.ts
   * Application.create({ providers })
   *   .routing({
   *     web: './routes/web.ts',
   *     api: './routes/api.ts',
   *   });
   *
   * @category Routing
   * @throws {Error} At call time when a custom (non web/api) group omits an explicit `prefix` or `middleware`.
   */
  routing(config: string | RoutingConfig | (RoutingEntry & { file: string })): this {
    if (typeof config === "string" || typeof (config as { file?: unknown }).file === "string") {
      this._routeGroups.push(_resolveRouteGroup("web", config as RoutingEntry));
    } else {
      for (const [key, entry] of Object.entries(config as RoutingConfig)) {
        this._routeGroups.push(_resolveRouteGroup(key, entry));
      }
    }
    return this;
  }

  /**
   * Declare file-based route directories for one or more named groups.
   *
   * Same key semantics as `routing()` (built-in defaults for "web" / "api").
   * Each directory is scanned at boot time and every exported HTTP-method
   * function is registered as a route.
   *
   * Three forms, and the call is **additive** — each invocation appends more
   * groups, so a tenant-scoped app can chain a plain surface group with a
   * prefixed tenant group:
   *
   *   .fileBasedRouting(basePath('app/flow/pages/surface'))          // bare dir → "web" group
   *   .fileBasedRouting({                                           // single group, explicit
   *     dir: basePath('app/flow/pages/[tenancy]'),
   *     prefix: '/:tenancy',
   *     middleware: [TenancyMiddleware],
   *   })
   *   .fileBasedRouting({ web: './app/routes' })                    // named map
   *
   * @example
   * // bootstrap/app.ts
   * Application.create({ providers })
   *   .fileBasedRouting(basePath('app/flow/pages/surface'))
   *   .fileBasedRouting({
   *     dir: basePath('app/flow/pages/[tenancy]'),
   *     prefix: '/:tenancy',
   *     middleware: [TenancyMiddleware],
   *   });
   *
   * @category Routing
   * @throws {Error} At call time when a custom (non web/api) group omits an explicit `prefix` or `middleware`.
   */
  fileBasedRouting(
    config: string | FileRoutingConfig | (FileRoutingEntry & { dir: string }),
  ): this {
    if (typeof config === "string" || typeof (config as { dir?: unknown }).dir === "string") {
      this._fileRouteGroups.push(_resolveFileRouteGroup("web", config as FileRoutingEntry));
    } else {
      for (const [key, entry] of Object.entries(config as FileRoutingConfig)) {
        this._fileRouteGroups.push(_resolveFileRouteGroup(key, entry));
      }
    }
    return this;
  }

  /**
   * Whether `boot()` has completed. Once booted the container is considered
   * locked for app-level registration (see {@link ContainerLockedError}).
   *
   * @category Lifecycle
   */
  get booted(): boolean {
    return this._booted;
  }

  /**
   * Wall-clock time the application took to boot, in milliseconds (undefined until booted).
   *
   * @category Lifecycle
   */
  get bootDurationMs(): number | undefined {
    return this._bootDurationMs;
  }

  /**
   * What each provider cost to boot, and what it put in the container.
   *
   * `bootDurationMs` says the app took 240ms and nothing said which provider
   * spent it; the container lists a hundred bindings and nothing said who bound
   * them. Both are answered here, in boot order — which is itself the answer to
   * a third question, since provider order decides who wins a contested binding.
   *
   * Empty until `boot()` runs. Populated in every environment: it costs one
   * `performance.now()` pair and one registry diff per provider at boot, and a
   * report that only exists in development is one you cannot ask for when a
   * staging boot is the slow one.
   *
   * @category Lifecycle
   */
  get providerReport(): readonly ProviderReport[] {
    return this._providerReport;
  }

  /**
   * Time one provider lifecycle hook and attribute anything it bound.
   *
   * Accumulates across the three phases, so a provider that binds in
   * `onRegister` and spends its time in `onBooting` reads as one row.
   */
  private _recordProviderWork<T>(provider: ServiceProvider, work: () => T): T {
    const name = provider.constructor.name;
    let row = this._providerReport.find((entry) => entry.name === name);
    if (!row) {
      row = { name, durationMs: 0, bindings: [] };
      this._providerReport.push(row);
    }
    const before = new Set(this.container.registry.keys());
    const started = performance.now();
    const finish = (): T => {
      row!.durationMs = Math.round((row!.durationMs + performance.now() - started) * 100) / 100;
      for (const token of this.container.registry.keys()) {
        if (!before.has(token)) row!.bindings.push(_tokenName(token));
      }
      return undefined as T;
    };
    const result = work();
    // An async hook is only finished when its promise is — timing it
    // synchronously would report every `await` in it as free.
    if (result instanceof Promise) {
      return result.then((value: unknown) => {
        finish();
        return value;
      }) as T;
    }
    finish();
    return result;
  }

  /**
   * The runtime environment this application is running in.
   *
   * @category Environment
   */
  get environment(): Environment {
    return this._env;
  }

  /** @internal Reset the process-default app — use in tests between cases. */
  static _resetInstance(): void {
    const instance = defaultApp();
    if (instance) {
      for (const restore of [...instance._scopeRestores].reverse()) restore();
      instance._scopeRestores = [];
    }
    setDefaultApp(undefined);
  }

  /**
   * @internal Re-establish this already-created app as the singleton and
   * reinstall its app scope (router state + facade resolution).
   *
   * `create()` self-adopts, so this is a no-op for a fresh app. It exists for
   * the case where a module-cached `bootstrap/app.ts` returns its top-level
   * app after the singleton was torn down — e.g. a second `createTestApp()` in
   * the same process (multiple test files). Without it, facades resolve against
   * no current instance and throw `E_FACADE_BEFORE_BOOT`.
   */
  adoptAsCurrent(): this {
    if (defaultApp() === this) return this;
    Application._resetInstance();
    this._scopeRestores = _appScopeInstallers.map((install) => install());
    setDefaultApp(this);
    return this;
  }

  // ── Provider registration ─────────────────────────────────────────────

  /**
   * Register service providers to boot through the full lifecycle.
   *
   * Idempotent by class identity: a provider already registered (here, in
   * `create()`, discovered from `app/providers/*`, or pulled in via another
   * provider's `static dependsOn`) is not registered again, so explicit and
   * automatic registration can safely overlap. The first registration wins its
   * position; ordering across dependencies is resolved at boot.
   *
   * @category Providers
   * @example
   * ```ts
   * Application.create()
   *   .register([DatabaseProvider, AuthProvider])
   *   .register([AppServiceProvider]); // additive; duplicates are ignored
   * ```
   */
  register(providers: ProviderClass[]): this {
    for (const provider of providers) this._addProvider(provider);
    return this;
  }

  /** Append a provider unless it is already registered (idempotent by class identity). */
  private _addProvider(provider: ProviderClass): void {
    if (!this._providers.includes(provider)) this._providers.push(provider);
  }

  /**
   * Register container bindings without authoring a {@link ServiceProvider}.
   *
   * The callback receives the live {@link Container} and runs once during
   * `boot()` — after the core singletons are registered and before any
   * provider's `onRegister()`, so providers can still override these bindings.
   * Ideal for app-level singletons, interface→implementation bindings, and
   * contextual bindings that don't warrant a full provider.
   *
   * @example
   * // bootstrap/app.ts
   * Application.create({ providers })
   *   .bind((c) => {
   *     c.singleton(Clock, () => new SystemClock());
   *     c.for(ReportService).give(Clock, () => new FixedClock());
   *   })
   *   .fileBasedRouting({ web: basePath("app/flow/pages") });
   *
   * @category Container
   */
  bind(callback: (container: Container) => void): this {
    this._bindCallbacks.push(callback);
    return this;
  }

  /**
   * Register one or more ServiceProviders as deferred — each boots only
   * the first time one of its bindings is resolved.
   *
   * @example
   * // Single token:
   * app.defer('cache', CacheProvider);
   *
   * // Object map:
   * app.defer({ cache: CacheProvider, mail: MailProvider });
   *
   * // Array — each provider must declare static provides = ['token'] as const:
   * app.defer([CacheProvider, AuthProvider, QueueProvider]);
   *
   * @category Providers
   */
  defer(token: keyof ContainerBindings, Provider: ProviderClass): this;
  defer(map: Partial<Record<keyof ContainerBindings, ProviderClass>>): this;
  defer(providers: DeferrableProviderClass[]): this;
  defer(
    tokenOrMap:
      | keyof ContainerBindings
      | Partial<Record<keyof ContainerBindings, ProviderClass>>
      | DeferrableProviderClass[],
    Provider?: ProviderClass,
  ): this {
    if (Array.isArray(tokenOrMap)) {
      for (const DeferredProvider of tokenOrMap) {
        for (const token of DeferredProvider.provides) {
          this.container.defer(token, DeferredProvider as new (app: unknown) => unknown);
        }
      }
    } else if (typeof tokenOrMap === "string") {
      if (Provider) this.container.defer(tokenOrMap, Provider as new (app: unknown) => unknown);
    } else {
      for (const [alias, deferredProvider] of Object.entries(tokenOrMap)) {
        if (deferredProvider)
          this.container.defer(alias as never, deferredProvider as new (app: unknown) => unknown);
      }
    }
    return this;
  }

  /**
   * Register one or more global middleware classes.
   * Middleware runs in array order on every request.
   *
   * @category Server
   * @example
   * app.use([CorsMiddleware.with({ origin: '*' }), InertiaMiddleware]);
   */
  use(middleware: PipeClass | PipeClass[]): this {
    if (Array.isArray(middleware)) {
      this._middleware.push(...middleware);
    } else {
      this._middleware.push(middleware);
    }
    return this;
  }

  /**
   * Register middleware exactly once — idempotent.
   * Used by providers in onBooting() to auto-register their required middleware.
   *
   * @internal
   */
  useOnce(middlewareClass: PipeClass): void {
    if (this._autoMiddlewareSet.has(middlewareClass)) return;
    const hasSubclass = this._middleware.some(
      (registered) =>
        registered !== middlewareClass &&
        registered.prototype instanceof (middlewareClass as ClassRef),
    );
    if (hasSubclass) return;
    this._autoMiddlewareSet.add(middlewareClass);
    this._autoMiddleware.push(middlewareClass);
  }

  /**
   * Middleware the framework installs ahead of everything else.
   *
   * `SecureHeadersMiddleware` is here rather than left to each app because its defaults
   * are right for essentially every app, its absence is invisible, and the alternative —
   * documenting it and hoping — shipped every scaffold with no clickjacking protection and
   * no MIME-sniffing protection. Cleared by `Application.create({ secureHeaders: false })`.
   */
  private _kernelMiddleware: PipeClass[] = [SecureHeadersMiddleware];

  /** Resolved middleware pipeline: kernel → provider auto → explicit .use() */
  private get _pipeline(): PipeClass[] {
    // An app that registers its own SecureHeadersMiddleware — usually `.with({ secure: true })`
    // or a subclass — replaces the kernel copy rather than stacking a second one on top.
    const overridden = [...this._autoMiddleware, ...this._middleware].some(
      (registered) =>
        registered === SecureHeadersMiddleware ||
        registered.prototype instanceof SecureHeadersMiddleware,
    );
    const kernel = overridden ? [] : this._kernelMiddleware;
    return [...kernel, ...this._autoMiddleware, ...this._middleware];
  }

  /**
   * Read-only copy of the resolved global middleware pipeline
   * (kernel → provider auto → explicit .use(), in execution order).
   *
   * @category Server
   */
  get globalMiddleware(): PipeClass[] {
    return [...this._pipeline];
  }

  /**
   * Register the callback used to load an authenticated user from their session ID.
   * Called by AuthMiddleware on every request that has a `user_id` in the session.
   *
   * @example
   * // bootstrap/app.ts
   * Application.create({ providers })
   *   .withUserResolver((id) => User.find(id));
   *
   * @category Configuration
   */
  withUserResolver(fn: (id: number) => Promise<AuthenticatedUser | null>): this {
    this._userResolver = fn;
    return this;
  }

  /**
   * Register a custom exception handler for all unhandled route errors.
   *
   * @example
   * // bootstrap/app.ts
   * import { Handler } from './app/exceptions/Handler.ts';
   * app.withExceptionHandler(Handler);
   *
   * @category Configuration
   */
  withExceptionHandler(Handler: new () => ExceptionHandler): this {
    this._exceptionHandler = new Handler();
    return this;
  }

  /**
   * Swap in an already-constructed exception handler and return the one it
   * replaced.
   *
   * {@link withExceptionHandler} constructs the handler itself, which is right
   * for an application naming its own class but leaves no way to install a
   * specific instance or to wrap the existing one. `@zerotal/testing` needs
   * both, so a request's exception stays reachable from the test that made it.
   *
   * @internal
   */
  _swapExceptionHandler(handler: ExceptionHandler | undefined): ExceptionHandler | undefined {
    const previous = this._exceptionHandler;
    this._exceptionHandler = handler;
    return previous;
  }

  /**
   * Enable the /__dev/ws WebSocket HMR endpoint.
   * Called by ServeCommand when running as --dev-worker.
   *
   * @category Server
   */
  enableDevWs(): this {
    this._devWsEnabled = true;
    // Inject the live-reload client (and any registered dev snippets) into HTML
    // responses, so auto-reload works for every view layer, not just Inertia.
    setDevReloadClientActive(true);
    this.useOnce(DevReloadMiddleware);
    return this;
  }

  /**
   * Live server concurrency straight from Bun: HTTP requests currently being
   * processed and open WebSocket connections. Zeroes when no server is bound
   * (e.g. console/test runs). See https://bun.com/docs/runtime/http/metrics.
   *
   * @category Server
   */
  serverMetrics(): { pendingRequests: number; pendingWebSockets: number } {
    const s = this._static as { pendingRequests?: number; pendingWebSockets?: number } | undefined;
    return {
      pendingRequests: s?.pendingRequests ?? 0,
      pendingWebSockets: s?.pendingWebSockets ?? 0,
    };
  }

  /**
   * Register WebSocket handlers so Bun.serve() enables the WS protocol. Multiple providers may
   * register — each for its own `path` (e.g. `/__flow/ws`, `/app/ws`) — and connections are
   * routed to the matching handler by request path. Omit `path` for a catch-all. Called by
   * FlowProvider and BroadcastProvider before the server binds.
   *
   * @category Server
   */
  withWebSocket(
    handlers: WebSocketHandlers,
    upgradeData?: (req: Request, server?: unknown) => Record<string, unknown>,
    path?: string,
  ): this {
    this._wsRegistrations.push({ path, handlers, upgradeData });
    return this;
  }

  /**
   * Declare a WebSocket path this app serves, without wiring any handlers for it.
   *
   * Handlers are only registered in the web runtime, so a CLI process — which is what
   * `bun zt doctor` is — has no idea the app has a transport at all. Providers call this
   * from `onRegister()`, which runs in every mode, so the paths are knowable from the
   * console even though nothing is listening there.
   *
   * @category Server
   */
  declareWebSocketPath(path: string): this {
    this._declaredWsPaths.add(path);
    return this;
  }

  /**
   * Every WebSocket path this app serves: those declared via
   * {@link Application.declareWebSocketPath} plus those actually registered. A catch-all
   * registration (no path) is reported as `"*"`.
   *
   * Exposed for tooling that has to reach the transport from outside the process — `bun zt
   * doctor --url=…` probes each of these through the real proxy, because a handshake a
   * browser cannot complete is invisible from in here.
   *
   * @category Server
   */
  webSocketPaths(): string[] {
    return [
      ...new Set([...this._declaredWsPaths, ...this._wsRegistrations.map((r) => r.path ?? "*")]),
    ];
  }

  /** Find the WS registration handling a connection's path (exact match, else a catch-all). */
  private _wsRegFor(wsPath: unknown): (typeof this._wsRegistrations)[number] | undefined {
    return (
      this._wsRegistrations.find((r) => r.path === wsPath) ??
      this._wsRegistrations.find((r) => r.path === undefined)
    );
  }

  /**
   * Extra origins accepted for credentialed endpoints that bypass the middleware pipeline
   * (WebSocket upgrades and raw routes). Configured as `app.allowedOrigins`; empty means
   * same-origin only.
   *
   * @internal
   */
  _allowedOrigins(): string[] {
    return rescueSync(
      () => allowedOriginsFrom((this.container.makeSync("config") as ConfigManager).get("app")),
      [] as string[],
    );
  }

  // ── Internals ─────────────────────────────────────────────────────────

  private _buildWsConfig(): WebSocketHandlers | undefined {
    const devEnabled = this._devWsEnabled;

    if (!devEnabled && this._wsRegistrations.length === 0) return undefined;

    type AnyWS = {
      data: { _dev?: boolean; _wsPath?: string; [key: string]: unknown };
      send(message: string): void;
    };

    return {
      // Bun closes an idle WebSocket after 10 seconds by default, and the client
      // pings every 30 — so a connection that is merely *quiet* was being cut
      // before it ever had reason to speak, taking its channel subscriptions
      // with it. Nothing surfaced: the page stayed rendered, the client kept its
      // channel objects, and broadcasts simply stopped arriving for anyone who
      // had been reading for more than ten seconds.
      //
      // 120s leaves room for four missed pings before a genuinely dead socket is
      // reaped, which is the direction to err: a stale connection costs memory,
      // a reaped live one costs the feature.
      idleTimeout: 120,
      open: (ws: unknown) => {
        if ((ws as AnyWS).data._dev) {
          DevWsServer.open(ws as AnyWS);
          // Tell the tab which build this worker is serving. A tab that
          // reconnects after a backend restart compares this against the token
          // it saw on its first connect and reloads itself when they differ —
          // the rebuild that came with the restart has no other way to reach it,
          // because the push arrives while the socket is down.
          try {
            (ws as AnyWS).send(`version:${assetVersion()}`);
          } catch {
            /* socket closed between upgrade and open — the tab will reconnect */
          }
        } else this._wsRegFor((ws as AnyWS).data._wsPath)?.handlers.open?.(ws);
      },
      message: (ws: unknown, message: string | Uint8Array) => {
        if (!(ws as AnyWS).data._dev)
          this._wsRegFor((ws as AnyWS).data._wsPath)?.handlers.message(ws, message);
      },
      close: (ws: unknown, code: number, reason: string) => {
        if ((ws as AnyWS).data._dev) DevWsServer.close(ws as AnyWS);
        else this._wsRegFor((ws as AnyWS).data._wsPath)?.handlers.close?.(ws, code, reason);
      },
    };
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /**
   * Run the boot sequence — phases 1–3: REGISTERING → BOOTING → BOOTED.
   *
   * @remarks
   * Discovers config and `app/providers/*`, resolves the provider dependency
   * graph, runs every provider's `onRegister`/`onBooting`/`onBooted`, loads
   * routes, and runs the convention loader. Idempotent — a second call after
   * booting returns immediately. Called automatically by {@link start} and
   * {@link bootAsWorker} if not already booted.
   *
   * @throws {Error} When a provider dependency cycle is detected, or in a production-like deployment when `APP_KEY` is too weak.
   * @category Lifecycle
   */
  async boot(): Promise<void> {
    if (this._booted) return;
    const _bootStart = performance.now();
    this.container._app = this;

    // Auto-discover config when useConfig() was not called explicitly.
    // Scans <cwd>/config/*.ts and loads each file's default export.
    // Gracefully skips missing or unreadable files.
    if (this._configMap === undefined) {
      this._configMap = await _discoverConfig(process.cwd());
    }

    // Built-in core singletons (overridable by providers via last-write-wins)
    this.container.singleton("config", () => new ConfigManager());
    this.container.singleton("events", () => new Emitter(this.container));

    if (this._configMap !== undefined) {
      const configManager = new ConfigManager();
      for (const [key, value] of Object.entries(this._configMap)) {
        configManager.load(key, value);
      }
      this.container.value("config", configManager);
    }

    // Auto-discover app/providers/* BEFORE the register phase so they run the full lifecycle.
    await this._discoverProviders(process.cwd());

    // Expand each provider's `static dependsOn` (transitively, de-duped) and topo-sort so
    // dependencies boot before their dependents. Providers excluded by `static environments`
    // — and any dependency only those needed — are dropped. Cycles throw with the path.
    this._activeProviders = this._resolveProviderGraph(this._providers).map(
      (ProviderClassEntry) => new ProviderClassEntry(this),
    );

    // Build per-request provider hooks now that _activeProviders is populated.
    this._providerHooks = this._buildProviderHooks();

    // Bootstrap bindings registered via app.bind(cb) — run before providers'
    // onRegister() so providers can still override (last-write-wins).
    for (const callback of this._bindCallbacks) callback(this.container);

    // Phase 1 — synchronous, binds into container.
    //
    // Timed, and the container is diffed around each provider, so the inspector
    // can answer "who bound `cache`, and what did booting it cost". Provenance
    // by diff rather than by having the container record a registrar: it keeps
    // the cost at boot instead of on every binding, and adds no mutable state to
    // the container for a question only a debugging tool asks.
    for (const provider of this._activeProviders) {
      this._recordProviderWork(provider, () => provider.onRegister());
    }

    // Config validation — providers have registered their namespace validators
    // in onRegister; run them before anything boots. In a production-like
    // deployment an insecure/invalid value refuses boot (named culprits);
    // elsewhere it warns. Skipped in the test harness to keep output clean.
    if (this._env !== "test" && this._configValidators.length > 0) {
      const configManager = this.container.makeSync("config") as ConfigManager;
      const appEnv = configManager.get<string>("app.env", deployEnv() || "development");
      runConfigValidators(this._configValidators, configManager, isProdLike(appEnv));
    }

    // Phase 2 — sequential in registration order.
    for (const provider of this._activeProviders) {
      await this._recordProviderWork(provider, () => provider.onBooting());
    }

    // Phase 3 — async, all providers have finished booting.
    //
    // These run concurrently, so the recorded durations overlap and do not sum
    // to the phase. That is the truth about this phase and the report says so
    // rather than serialising the boot to make a tidier number.
    await Promise.all(
      this._activeProviders.map((provider) =>
        this._recordProviderWork(provider, () => provider.onBooted()),
      ),
    );

    // Ensure config and events are resolved so makeSync() works below.
    await this.container.make("config");
    await this.container.make("events");

    // Boot-time doctor — verify every provider's declared `provides` is wired,
    // and in real runtimes eager-resolve them so facades work at first access and
    // any construction error surfaces here (a named boot failure) rather than
    // mid-request. Skipped for eager-resolution in test/repl to avoid side
    // effects; the cheap "is it bound?" check still runs in every environment.
    await runBootDoctor(this._activeProviders, this.container, {
      eagerResolve: this._env !== "test" && this._env !== "repl",
    });

    // Auto-discover app/middleware/* as named groups before routes can reference them.
    await this._discoverMiddleware(process.cwd());

    // Load explicit route files (after all providers have registered middleware groups).
    if (this._routeGroups.length) {
      await this._loadRoutes();
    }

    // Load file-based route directories.
    if (this._fileRouteGroups.length) {
      await this._loadFileRoutes();
    }

    // Install the route table for `zerotal/routes`, now that every route is
    // registered.
    //
    // That module is the standalone URL builder a browser bundle imports, so it
    // cannot reach for `Router` itself — importing the router would drag the
    // server into every client bundle. The dependency therefore points this way:
    // the server, which already has both, pushes the table in.
    //
    // Without this, `route()` threw on the server for any app that renders its
    // own markup — a `view` build produces every href and form action there —
    // and the fix was a `defineRoutes()` call each app had to know to write.
    // A browser entry still calls it; that is a different process with no router
    // to read. See T24.
    this._installRouteTable();

    // A routes/ directory nobody routed is a silent 404 for every path in it — the file
    // imports cleanly and registers nothing, which looks identical to a typo'd URL.
    this._warnUnroutedRoutesDir(process.cwd());

    // Convention phase — worker jobs/schedules + public static files.
    await this._bootConventions();

    // Fail loud on a weak APP_KEY: in a production-like deployment a short key is
    // a refuse-to-boot error; elsewhere (bar the test harness) it's a warning.
    //
    // `deployEnv()`, not `Bun.env["APP_ENV"]`. `setAppEnv()` overwrites that
    // variable with the runtime mode (`web`/`console`/`worker`) before the app is
    // created, so this read was always `"web"` under the CLI — meaning a weak key
    // in production only ever warned, and the refusal this block exists for had
    // never once fired.
    if (this._env !== "test") {
      const _keyWarning = appKeyStrengthWarning(Bun.env["APP_KEY"]);
      if (_keyWarning) {
        if (isProdLike(deployEnv())) throw new Error(_keyWarning);
        console.warn(_keyWarning);
      }
    }

    this._booted = true;
    this._bootDurationMs = performance.now() - _bootStart;

    // Announce boot completion so observers (Health page, telemetry, logger) can
    // surface startup cost. Fired once per application boot.
    FrameworkEvents.emit(
      new AppBooted(this._bootDurationMs, this._env, this._activeProviders.length),
    );
  }

  private async _loadRoutes(): Promise<void> {
    for (const { file, prefix, middleware } of this._routeGroups) {
      await Router.groupAsync({ prefix, middleware }, () => import(_toImportable(file)));
    }
  }

  /**
   * Warn when `routes/` exists on disk but no `routing()` group points inside it.
   * Web only: workers and the console don't answer HTTP, and the test harness
   * routinely boots apps with no routes at all.
   */
  private _warnUnroutedRoutesDir(root: string): void {
    if (this._env !== "web") return;
    const warning = unroutedRoutesWarning(
      root,
      this._routeGroups.map((g) => g.file),
    );
    if (warning) frameworkLog("app").warn(warning);
  }

  /**
   * Hand the registered routes to the standalone `route()` builder.
   *
   * Name → pattern for the URLs, and name → verb for `action()`. `RouteDefinition`
   * carries its own `name` beside `method`, so the pair comes from one record —
   * a path join would be wrong, since `GET /login` and `POST /login` share a path.
   */
  private _installRouteTable(): void {
    const methods = new Map<string, string>();
    for (const definition of Router.routes.values()) {
      if (definition.name) methods.set(definition.name, definition.method);
    }

    defineRoutes(Router.namedRoutes);
    defineRouteMethods(Object.fromEntries(methods));
  }

  private async _loadFileRoutes(): Promise<void> {
    for (const { dir, prefix, middleware } of this._fileRouteGroups) {
      await Router.groupAsync({ prefix, middleware }, () => scanFileRoutes(dir).then(() => {}));
    }
  }

  /**
   * Cache-Control for statically-served files.
   *
   * In dev (the `--dev-worker` child spawned by `serve --dev`) we send
   * `no-cache` so the browser always revalidates `app.js` / `app.css` and never
   * serves a stale bundle after a rebuild + HMR reload — the same effect Vite
   * achieves with hashed URLs in dev. In production the files are served without
   * an explicit header (browser heuristic caching).
   */
  private _staticCacheOptions(): { headers: Record<string, string> } | undefined {
    if (!process.argv.includes("--dev-worker")) return undefined;
    return { headers: { "Cache-Control": "no-cache" } };
  }

  private async _bootConventions(): Promise<void> {
    const dir = process.cwd();

    if (this._env === "web") {
      const staticOptions = this._staticCacheOptions();

      // Serve entire public/ directory at /
      Router.static("/", `${dir}/public`, staticOptions);

      // Serve a custom asset output dir / prefix when it isn't already covered
      // by the public → / mount above (e.g. outDir: "build", prefix: "/assets").
      const assets = this._assetsConfig();
      if (assets && (assets.outDir !== "public" || assets.prefix !== "/")) {
        Router.static(assets.prefix, `${dir}/${assets.outDir}`, staticOptions);
      }

      // Configure the asset() URL helper: honour the configured prefix, and in
      // dev (the --dev-worker child) append ?v=<version> for cache-busting. The
      // initial version comes from the orchestrator via ZT_ASSET_VERSION;
      // each rebuild ships a fresh token over the reload channel (see ServeCommand).
      const isDevWorker = process.argv.includes("--dev-worker");
      configureAssets({ prefix: assets?.prefix ?? "/", dev: isDevWorker });

      if (isDevWorker) {
        setAssetVersion(Bun.env["ZT_ASSET_VERSION"] ?? "");
      } else {
        // Production gets a token too, derived from the built files. `assets:build`
        // writes `app.js` under that name every deploy and the static handler sends
        // no `Cache-Control`, so without this a returning visitor keeps the bundle
        // their browser cached — through any number of deploys, while the server
        // reports success. Derived rather than random so a restart that changed no
        // assets does not invalidate every client's cache for nothing.
        setAssetVersion(deriveAssetVersion(`${dir}/${assets?.outDir ?? "public"}`));
      }
    }

    // Convention phase — discovers app/schedules (class-based), models, observers, jobs, etc.
    // (The `jobs` concern imports every app/jobs/*.ts, so job classes self-register here in
    // every environment, including the worker process — no generated barrel needed.)
    await this._runConventions(dir);
  }

  /** Read `config/app.ts` → `assets` (front-end bundling), or undefined when not configured. */
  private _assetsConfig(): { outDir: string; prefix: string } | undefined {
    try {
      const config = this.container.makeSync("config") as ConfigManager;
      return config.get("app.assets") as { outDir: string; prefix: string } | undefined;
    } catch {
      return undefined;
    }
  }

  /** Read `config/app.ts` → `conventions: { enabled, paths }` (auto-discovery settings). */
  private _conventionsConfig(): { enabled: boolean; paths: Record<string, string> } {
    let raw: { enabled?: boolean; paths?: Record<string, string> } = {};
    try {
      const config = this.container.makeSync("config") as ConfigManager;
      raw = (config.get("app.conventions") ?? {}) as typeof raw;
    } catch {
      /* config not resolvable yet — use defaults */
    }
    return { enabled: raw.enabled !== false, paths: raw.paths ?? {} };
  }

  /**
   * Auto-discover and register convention-based classes (models, observers, policies,
   * listeners, jobs, …) from the `app/*` directories. Built-in concerns plus any contributed
   * by providers via `registerConcern()`. Gated by `app.conventions.enabled` (default on).
   */
  private async _runConventions(root: string): Promise<void> {
    const { enabled, paths } = this._conventionsConfig();
    if (!enabled) return;

    const concerns = [...builtinConcerns, ...this._concerns];
    if (concerns.length === 0) return;

    const ctx: ConcernContext = {
      app: this,
      env: this._env,
      resolve: <T>(token: string): T | undefined =>
        this.container.tryMake(token as keyof ContainerBindings) as T | undefined,
    };

    await runConventions(concerns, { root, env: this._env, paths, ctx });
  }

  /**
   * Auto-discover `app/providers/*` BEFORE the register phase, so discovered providers run the
   * full lifecycle (onRegister/onBooting/onBooted) like explicitly-registered ones. Appended
   * after explicit providers (so app providers boot after framework providers) and de-duplicated.
   */
  private async _discoverProviders(root: string): Promise<void> {
    const { enabled, paths } = this._conventionsConfig();
    if (!enabled) return;
    const dir = `${root}/${paths["providers"] ?? "app/providers"}`;
    await importConventionModules(dir, "providers", (module) => {
      for (const exported of Object.values(module)) {
        if (
          typeof exported === "function" &&
          exported !== ServiceProvider &&
          (exported as { prototype?: unknown }).prototype instanceof ServiceProvider
        ) {
          this._addProvider(exported as ProviderClass);
        }
      }
    });
  }

  /** Whether a provider runs in the current environment (`static environments`, default all). */
  private _isActiveInEnv(provider: ProviderClass): boolean {
    const environments = (provider as unknown as { environments?: Environment[] }).environments;
    return !environments || environments.includes(this._env);
  }

  /**
   * Resolve the final, ordered provider list for boot. Each provider's `static dependsOn`
   * is pulled in transitively (a provider only has to register the feature it wants, not the
   * plumbing it needs), de-duplicated by class identity. Providers excluded by their
   * `static environments` are dropped — and a dependency is only included if it is itself
   * active in this environment, so a `web`-only provider is never dragged into a CLI boot.
   *
   * The result is topologically sorted so every provider boots after its dependencies; among
   * providers with no dependency relationship, order is `static priority` (lower first) then
   * first-registered. A dependency cycle throws here, at boot, with the offending path.
   */
  private _resolveProviderGraph(roots: ProviderClass[]): ProviderClass[] {
    const depsOf = (p: ProviderClass): ProviderClass[] =>
      (p as unknown as { dependsOn?: ProviderClass[] }).dependsOn ?? [];
    const priorityOf = (p: ProviderClass): number =>
      (p as unknown as { priority?: number }).priority ?? 0;

    // Transitive closure of env-active providers, remembering first-seen order.
    const included = new Set<ProviderClass>();
    const seenAt = new Map<ProviderClass, number>();
    let seq = 0;
    const collect = (p: ProviderClass): void => {
      if (included.has(p) || !this._isActiveInEnv(p)) return;
      included.add(p);
      seenAt.set(p, seq++);
      for (const dep of depsOf(p)) collect(dep);
    };
    for (const root of roots) collect(root);

    // Deterministic order for independent providers: priority asc, then registration order.
    const byRank = (a: ProviderClass, b: ProviderClass): number =>
      priorityOf(a) - priorityOf(b) || (seenAt.get(a) ?? 0) - (seenAt.get(b) ?? 0);

    const sorted: ProviderClass[] = [];
    const done = new Set<ProviderClass>();
    const onStack = new Set<ProviderClass>();
    const stack: ProviderClass[] = [];
    const visit = (p: ProviderClass): void => {
      if (done.has(p)) return;
      if (onStack.has(p)) {
        const cycle = [...stack.slice(stack.indexOf(p)), p].map((c) => c.name).join(" → ");
        throw new Error(`Circular provider dependency: ${cycle}`);
      }
      onStack.add(p);
      stack.push(p);
      for (const dep of depsOf(p)
        .filter((d) => included.has(d))
        .sort(byRank))
        visit(dep);
      onStack.delete(p);
      stack.pop();
      done.add(p);
      sorted.push(p);
    };
    for (const p of [...included].sort(byRank)) visit(p);

    return sorted;
  }

  /**
   * Auto-discover `app/middleware/*` before routes load. Each middleware class is registered as a
   * single-class named group (referenceable by its class name in `Router.group({ middleware })`),
   * so it isn't applied globally by default. A class with `static global = true` is added to the
   * global pipeline via `use()`.
   */
  private async _discoverMiddleware(root: string): Promise<void> {
    const { enabled, paths } = this._conventionsConfig();
    if (!enabled) return;
    const dir = `${root}/${paths["middleware"] ?? "app/middleware"}`;
    await importConventionModules(dir, "middleware", (module) => {
      for (const exported of Object.values(module)) {
        if (typeof exported !== "function") continue;
        const middlewareClass = exported as PipeClass & { global?: boolean };
        const prototype = (middlewareClass as { prototype?: { handle?: unknown } }).prototype;
        if (!prototype || typeof prototype.handle !== "function") continue; // Not a middleware.
        Router.middlewareGroup(middlewareClass.name, [middlewareClass] as never);
        if (middlewareClass.global === true) this.use(middlewareClass);
      }
    });
  }

  /**
   * Boot (if needed) and start the HTTP server — phases 4–5: STARTING → STARTED.
   *
   * @remarks
   * Boots first when not yet booted, runs providers' `onStarting`, binds
   * `Bun.serve()` on `port` (registering the health endpoint, compiled routes,
   * and any WebSocket handlers), then runs `onStarted`. Installs SIGTERM/SIGINT
   * handlers that call {@link stop} and a SIGUSR2 handler that hot-reloads routes.
   *
   * @param port - TCP port to bind; pass `0` to let the OS choose a free port.
   * @category Lifecycle
   * @example
   * ```ts
   * const app = Application.create({ providers }).routing({ web: "./routes/web.ts" });
   * await app.start(3000);
   * ```
   */
  async start(port = 3000): Promise<void> {
    if (!this._booted) await this.boot();

    // Phase 4 — STARTING (before server binds)
    await Promise.all(this._activeProviders.map((p) => p.onStarting()));

    this._registerHealthEndpoint();

    const configManager = this.container.makeSync("config") as ConfigManager;
    const http3 = configManager.get<boolean>("app.http3", false);
    const tlsConfig = configManager.get<{ cert?: unknown; key?: unknown } | undefined>("app.tls");

    const compiledRoutes = Router.compile(
      this.container,
      this._pipeline,
      this._exceptionHandler,
      this._providerHooks,
    );
    const wsConfig = this._buildWsConfig();

    // Eager static dirs are already pre-registered by Router.compile() as native
    // `Response(Bun.file)` routes, so Bun serves them without ever entering JS.
    // Only dirs that opted out with `eager: false` need the per-request lookup
    // below — for the default (eager) case this loop is skipped entirely, so an
    // unmatched GET no longer pays a wasted `exists()` stat before its 404.
    //
    // Under the dev worker every dir gets the fallback as well. That route table
    // is a snapshot of the directory taken when Bun.serve() started, and a dev
    // rebuild writes files it has never heard of: bundlers name code-split
    // chunks after their content, so each rebuild emits a fresh set of
    // `chunk-<hash>.js`. Without the fallback the running server 404s every one
    // of them until it restarts, and the page dies on its first dynamic import.
    // Bun still answers pre-registered paths natively, so this costs a stat only
    // on the files that are genuinely new.
    const devStatic = process.argv.includes("--dev-worker");
    const lazyStaticDirs = Router.staticDirs.filter(
      (dir) => devStatic || dir.options?.eager === false,
    );

    const extraOptions: Record<string, unknown> = {};
    if (http3) extraOptions.http3 = true;
    if (tlsConfig?.cert && tlsConfig?.key) extraOptions.tls = tlsConfig;

    // Bodies are fully buffered before a handler sees them, so this is the ceiling on
    // memory one request can claim. Bun's default is 128 MiB per request on every route,
    // authenticated or not — twenty concurrent POSTs is 2.5 GB resident.
    const maxRequestBodySize = configManager.get<number>(
      "app.maxRequestBodySize",
      DEFAULT_MAX_REQUEST_BODY_SIZE,
    );

    this._static = Bun.serve({
      port,
      maxRequestBodySize,
      routes: compiledRoutes,
      ...(Object.keys(extraOptions).length
        ? (extraOptions as unknown as Parameters<typeof Bun.serve>[0])
        : {}),
      fetch: async (req: Request, server: unknown): Promise<Response | undefined> => {
        // Lazy static file serving — for dirs registered with `eager: false`,
        // plus every dir under the dev worker (see `lazyStaticDirs` above).
        // Files already pre-registered are served by Bun as native routes and
        // never reach this fallback.
        if (req.method === "GET" && lazyStaticDirs.length) {
          const staticFile = await _lazyStaticResponse(req.url, lazyStaticDirs);
          if (staticFile) return staticFile;
        }

        if (req.headers.get("Upgrade") === "websocket") {
          const bunServer = server as {
            upgrade(req: Request, opts: { data: unknown }): boolean;
          };
          const pathname = new URL(req.url).pathname;

          if (this._devWsEnabled && pathname === "/__dev/ws") {
            const upgraded = bunServer.upgrade(req, {
              data: { _dev: true, id: crypto.randomUUID() },
            });
            if (upgraded) return undefined;
          }

          const wsReg = this._wsRegistrations.length ? this._wsRegFor(pathname) : undefined;
          if (wsReg) {
            // Cross-site WebSocket hijacking guard. The WS handshake is exempt from the
            // same-origin policy but still carries cookies, so without this any site the user
            // visits could open an authenticated socket to this server and drive every action
            // the session permits. Browsers always send Origin on a handshake and script
            // cannot forge it. Non-browser clients omit it and are allowed through.
            if (!isAllowedOrigin(req, this._allowedOrigins())) {
              return new Response("Forbidden origin.", { status: 403 });
            }
            const extraData = wsReg.upgradeData?.(req, bunServer) ?? {};
            // Tag the connection with its path so open/message/close route to this handler.
            const data = { id: crypto.randomUUID(), _wsPath: pathname, ...extraData };
            const upgraded = bunServer.upgrade(req, { data });
            if (upgraded) return undefined;
          }
        }

        // Shared request lifecycle (scoping, HttpContext, in-flight gauge,
        // events, exception handling, metrics) — same dispatcher as matched
        // routes, so instrumentation is applied uniformly.
        return dispatchRequest(req, server, {
          container: this.container,
          providerHooks: this._providerHooks,
          renderError: (error, ctx) => this._handleErrorAsync(error, ctx),
          execute: async (ctx) => {
            // An unmatched URL is routed through the same handler as a thrown
            // NotFoundError, so an app that registers its own ExceptionHandler
            // renders its own 404 page instead of the framework's default one.
            const renderNotFound = (innerCtx: HttpContext): Promise<Response> =>
              this._handleErrorAsync(new NotFoundError(), innerCtx);

            const notFoundCatcher = class implements Pipe<HttpContext> {
              async handle(innerCtx: HttpContext, next: NextFn): Promise<Response | void> {
                await next();
                if (!innerCtx.response) {
                  innerCtx.response = await renderNotFound(innerCtx);
                }
                return innerCtx.response;
              }
            };

            const finalCtx = await Pipeline.send<HttpContext>(ctx)
              .through([...this._pipeline, notFoundCatcher])
              .via(this.container)
              .thenReturn();

            return finalCtx.response!;
          },
        });
      },
      error: (_error: Error): Response =>
        Response.json({ message: "Internal Server Error" }, { status: 500 }),
      ...(wsConfig ? { websocket: wsConfig } : {}),
    } as Parameters<typeof Bun.serve>[0]);

    // Phase 5 — STARTED (server is accepting connections)
    await Promise.all(this._activeProviders.map((p) => p.onStarted()));
    frameworkLog("app").info(`Server listening on http://localhost:${port}`, { port });

    await this._writePidFile();

    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.on(signal, () => void this.stop());
    }

    // Windows cannot deliver either of those to a child, so `serve --dev` asks
    // over IPC instead and this is the ear for it. Silent anywhere there is no
    // supervisor on the other end.
    onGracefulStopRequest(() => void this.stop());

    process.on("SIGUSR2", () => void this._reloadRoutes());
  }

  /**
   * Boot the application in the `worker` environment and block for queue/worker use.
   *
   * @remarks
   * Sets the environment to `worker`, boots if needed, and runs providers'
   * `onStarting`/`onStarted` without binding an HTTP server. Installs
   * SIGTERM/SIGINT handlers that drain providers (LIFO `onStopping`/`onStopped`)
   * and then `process.exit(0)`.
   *
   * @category Lifecycle
   */
  async bootAsWorker(): Promise<void> {
    this._env = "worker";

    if (!this._booted) await this.boot();

    // Phase 4: STARTING
    await Promise.all(this._activeProviders.map((p) => p.onStarting()));

    // Phase 5: STARTED
    await Promise.all(this._activeProviders.map((p) => p.onStarted()));

    let stopping = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (stopping) return;
      stopping = true;
      frameworkLog("worker").info(`${signal} received — draining`);

      const reversed = [...this._activeProviders].reverse();
      for (const provider of reversed) {
        await provider.onStopping();
      }

      for (const provider of reversed) {
        provider.onStopped();
      }

      frameworkLog("worker").info("Shutdown complete");
      process.exit(0);
    };

    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
  }

  /**
   * Phases 6–7: STOPPING → STOPPED (LIFO order).
   *
   * By default the process exits once shutdown completes (CLI behaviour).
   * Pass `{ exit: false }` for embedded use or in-process test teardown, where
   * the caller owns the process lifetime.
   *
   * @example
   * await app.stop();                 // CLI: stops providers, then process.exit(0)
   * await app.stop({ exit: false }); // embedded/tests: stops without exiting
   *
   * @category Lifecycle
   */
  async stop(options: { exit?: boolean } = {}): Promise<void> {
    this._static?.stop(false);
    const reversed = [...this._activeProviders].reverse();
    for (const provider of reversed) await provider.onStopping();

    for (const provider of reversed) await provider.onStopped();
    await this._removePidFile();
    frameworkLog("app").info("Server stopped");
    if (options.exit !== false) process.exit(0);
  }

  /**
   * Gracefully shut the application down **without** exiting the process.
   *
   * The embedded/test-friendly counterpart to {@link stop}: it runs the same
   * STOPPING → STOPPED teardown (server + providers, LIFO) but never calls
   * `process.exit`, so the caller keeps ownership of the process lifetime. This
   * is the method to reach for in in-process tests, REPLs, and when hosting the
   * app inside a larger program. Equivalent to `stop({ exit: false })`.
   *
   * @example
   * const app = await Application.create().register([...]).start(0);
   * // …exercise the app…
   * await app.close(); // tears down, process stays alive
   *
   * @category Lifecycle
   */
  async close(): Promise<void> {
    await this.stop({ exit: false });
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  private _registerHealthEndpoint(): void {
    if (this._env !== "web" && this._env !== "worker") return;

    const configManager = (() => {
      try {
        return this.container.makeSync("config") as ConfigManager;
      } catch {
        return undefined;
      }
    })();
    const appEnv = configManager?.get<string>("app.env", "development") ?? "development";
    const isProduction = isProdLike(appEnv);

    // Health config lives under `app.health` (an object). For back-compat we also
    // honour a legacy `health` config namespace (config/health.ts) and a bare
    // `app.health` boolean enable-flag. Precedence: app.health object → health
    // namespace → app.health boolean → environment default.
    const appHealth = configManager?.get<boolean | HealthConfigShape>("app.health");
    const namespacedHealth = configManager?.get<HealthConfigShape>("health", {}) ?? {};
    const healthConfigRaw =
      appHealth && typeof appHealth === "object" ? appHealth : namespacedHealth;
    const legacyHealthFlag = typeof appHealth === "boolean" ? appHealth : undefined;
    const config = resolveHealthConfig(healthConfigRaw, isProduction, legacyHealthFlag);
    if (!config.enabled) return;

    const appName =
      configManager?.get<string>("app.name", Bun.env["APP_NAME"] ?? "zerotal-app") ?? "zerotal-app";
    const appVersion =
      configManager?.get<string>("app.version", Bun.env["APP_VERSION"] ?? Bun.version) ??
      Bun.version;

    // Built-in runtime probe — memory, Bun version, in-flight request count.
    Health.register("runtime", () => ({
      status: "ok",
      meta: {
        memory: process.memoryUsage(),
        bun: Bun.version,
        pendingRequests:
          (this._static as { pendingRequests?: number } | undefined)?.pendingRequests ?? 0,
      },
    }));

    Router._registerFileHandler(
      "GET",
      config.path,
      async (http: HttpContext) => {
        const access = checkHealthAccess(http.request, config, isProduction);
        if (!access.allowed) {
          http.json({ status: "down", message: access.reason }, access.code ?? 403);
          return;
        }
        const report = await Health.run({
          name: appName,
          version: appVersion,
          environment: appEnv,
          uptime: Math.floor(process.uptime()),
          ...(this._bootDurationMs !== undefined
            ? { bootMs: Math.round(this._bootDurationMs) }
            : {}),
        });
        const code = report.status === "down" ? 503 : 200;
        http.json(config.showDetails ? report : { status: report.status }, code);
      },
      [],
    );
  }

  private get _pidFilePath(): string {
    return `${process.cwd()}/.zerotal/server.pid`;
  }

  private async _writePidFile(): Promise<void> {
    try {
      await Bun.write(this._pidFilePath, String(process.pid));
    } catch {
      // Non-fatal
    }
  }

  private async _removePidFile(): Promise<void> {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(this._pidFilePath);
    } catch {
      // Already removed or never written
    }
  }

  /**
   * Hot-reload route table triggered by SIGUSR2.
   */
  private async _reloadRoutes(): Promise<void> {
    try {
      frameworkLog("app").info("Reloading routes");

      Router.reset();
      const reloadId = String(Date.now());

      this._registerHealthEndpoint();

      // Re-run explicit route files with cache-busting imports
      for (const { file, prefix, middleware } of this._routeGroups) {
        await Router.groupAsync({ prefix, middleware }, () => import(`${file}?t=${reloadId}`));
      }

      // Re-run file-based routes with cache-busting imports
      for (const { dir, prefix, middleware } of this._fileRouteGroups) {
        await Router.groupAsync({ prefix, middleware }, () =>
          scanFileRoutes(dir, reloadId).then(() => {}),
        );
      }

      // Re-register public static files
      const dir = process.cwd();
      if (this._env === "web") {
        Router.static("/", `${dir}/public`, this._staticCacheOptions());
      }

      const newRoutes = Router.compile(
        this.container,
        this._pipeline,
        this._exceptionHandler,
        this._providerHooks,
      );
      this._static?.reload({ routes: newRoutes });

      frameworkLog("app").info("Routes reloaded (zero downtime)");
    } catch (error) {
      frameworkLog("app").error("Route reload failed", undefined, error);
    }
  }

  private async _handleErrorAsync(error: unknown, ctx: HttpContext): Promise<Response> {
    const handler = this._exceptionHandler;
    if (handler) {
      await handler.report(error, ctx);
      return handler.render(error, ctx);
    }
    frameworkLog("app").error("Unhandled error", undefined, error);
    return ExceptionHandler.defaultRender(error, ctx);
  }

  private _buildProviderHooks(): ProviderHooks {
    const providers = this._activeProviders;
    return {
      async onRequestReceived(ctx: HttpContext): Promise<void> {
        if (providers.length > 0)
          await Promise.all(providers.map((provider) => provider.onRequestReceived(ctx)));
      },
      async onRequestProcessed(ctx: HttpContext): Promise<void> {
        if (providers.length > 0)
          await Promise.all(providers.map((provider) => provider.onRequestProcessed(ctx)));
      },
      scheduleResponseSent(ctx: HttpContext): void {
        if (providers.length === 0) return;
        ctx.afterResponse(async () => {
          await Promise.all(providers.map((provider) => provider.onResponseSent(ctx)));
        });
      },
    };
  }
}

/**
 * Make a route-file path safe to hand to `import()`.
 *
 * `routing({ web: `${import.meta.dir}/../routes/index.ts` })` is the documented
 * way to point at a routes file, and on Windows that produces `C:\…\routes\…`.
 * Passed straight to `import()` the drive letter reads as a URL protocol, so the
 * module never loads and every route 404s with nothing logged. A `file://` URL
 * removes the ambiguity.
 *
 * Bare specifiers are left alone — someone may legitimately point at a package.
 */
function _toImportable(file: string): string {
  // Character checks rather than a regex: the separator can be either slash on
  // Windows, and an escaped one inside a character class is the kind of detail
  // that silently matches half of what it should.
  const sep = file[2];
  const isWindowsPath = file.length > 2 && file[1] === ":" && (sep === "\\" || sep === "/");
  const isPosixPath = file.startsWith("/");

  if (!isWindowsPath && !isPosixPath) return file;
  return pathToFileURL(file).href;
}
