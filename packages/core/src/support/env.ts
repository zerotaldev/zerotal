/**
 * Shared deployment-environment predicates.
 *
 * These exist so "are we in production?" is answered exactly once. The 2026-07
 * code review found two divergent copies — one accepting only "production",
 * one also accepting "prod" — which meant APP_ENV=prod or staging deployments
 * served full stack traces on 500s from one code path but not the other.
 */

/**
 * Whether `env` names a production-like deployment environment — one where
 * debug output (stack traces, dev error pages, open health details) must be
 * suppressed. Accepts `"production"`, `"prod"`, and `"staging"`,
 * case-insensitively.
 *
 * Pass {@link deployEnv}, not `Bun.env["APP_ENV"]` — after `setAppEnv()` the latter
 * holds a runtime mode, and `isProdLike("web")` is `false` for every deployment.
 *
 * @internal
 * @example
 * if (!isProdLike(deployEnv())) return renderDevErrorPage(error);
 */
export function isProdLike(env: string): boolean {
  const normalized = env.trim().toLowerCase();
  return normalized === "production" || normalized === "prod" || normalized === "staging";
}

/**
 * Whether `env` names an environment where dev-only surfaces (the devtools
 * trace inspector, the monitor panel's default open access, dev error pages)
 * may be exposed without authentication.
 *
 * Only *explicitly* non-production environments qualify. Unset or unknown
 * values return `false` — the gate fails closed, so a production deploy that
 * forgets to set `APP_ENV` (or sets `staging`) never accidentally exposes an
 * internal surface. This is the inverse-but-stricter companion to
 * {@link isProdLike}: `isProdLike("")` is `false`, but so is this.
 */
export function isDevSurfaceAllowed(env: string): boolean {
  const n = env.trim().toLowerCase();
  return n === "development" || n === "dev" || n === "local" || n === "test" || n === "testing";
}

/**
 * Environment variable the dev orchestrator sets on the server it supervises.
 * @internal
 */
export const DEV_WORKER_ENV_VAR = "ZT_DEV";

/**
 * Where `setAppEnv()` parks the deployment name before overwriting `APP_ENV`.
 * @internal
 */
export const DEPLOY_ENV_VAR = "ZT_APP_ENV";

/**
 * The deployment name this process was started with — `production`, `staging`,
 * `local`, whatever the operator set — as opposed to the runtime *mode*.
 *
 * `APP_ENV` carries both meanings, and the second one destroys the first:
 * `setAppEnv()` overwrites it with `web` / `console` / `worker` before the app
 * boots, so a gate that asks `isProdLike(Bun.env["APP_ENV"])` after startup is
 * asking whether `"web"` is production and always getting no. That was not
 * theoretical — it silently disabled the weak-`APP_KEY` refusal and left the
 * ORM's N+1 detector wrapping every query in production.
 *
 * `setAppEnv()` now preserves the original value, and this reads it back. Prefer
 * it to `Bun.env["APP_ENV"]` for **any** production decision. Config is an
 * equally correct source where it is available (`config("app.env")`), but this
 * works before config is loaded and in processes that have none.
 *
 * @internal
 */
export function deployEnv(): string {
  return Bun.env[DEPLOY_ENV_VAR] ?? Bun.env["APP_ENV"] ?? "";
}

/**
 * Whether *this process* may expose dev-only surfaces — the stack-trace error
 * page, the trace inspector, an open monitor panel.
 *
 * Two things qualify a process, and both are needed because they answer
 * different questions:
 *
 *   - `serve --dev` supervises this process. The orchestrator only ever runs
 *     from a developer's terminal (it watches the filesystem and rebundles
 *     assets — nothing a deployment does), so its worker is a dev machine by
 *     construction. This is the case that carries dev mode, because `APP_ENV`
 *     cannot: `setAppEnv()` overwrites it with a *runtime mode* (`web`,
 *     `worker`, `console`) before the app boots, so by the time any gate reads
 *     `APP_ENV` it holds the mode rather than the deployment name. (The name
 *     itself is not lost — `setAppEnv()` parks it, and {@link deployEnv} reads
 *     it back. What is lost is the ability to learn it from `APP_ENV`.)
 *
 *   - `APP_ENV` still names an explicitly non-production environment. This
 *     covers processes started outside the CLI — the test harness, and any
 *     embedder that sets `APP_ENV` itself rather than through `setAppEnv()`.
 *
 * Anything else fails closed, so a production deploy that sets no `APP_ENV`
 * exposes nothing.
 */
export function devSurfacesEnabled(): boolean {
  if (Bun.env[DEV_WORKER_ENV_VAR] === "1") return true;
  // `deployEnv()`, not `Bun.env["APP_ENV"]` — by the time anything asks, `setAppEnv()`
  // has replaced that with the runtime mode, and `isDevSurfaceAllowed("web")` is false.
  // An app with `APP_ENV=development` in its `.env` was therefore getting production
  // error pages from a plain `zt serve`.
  return isDevSurfaceAllowed(deployEnv());
}

/**
 * Whether a `DevOrchestrator` owns asset builds for this process.
 *
 * View providers build their bundles once at boot so assets are ready before
 * the first request. Under `serve --dev` that is redundant three times over:
 * the orchestrator process boots the app (registering hooks, and building), then
 * runs the hooks itself, then spawns a worker that boots the app and builds
 * again. Every backend save paid for two of those.
 *
 * Both processes are recognised, for different reasons:
 *
 *   - The supervised worker carries {@link DEV_WORKER_ENV_VAR}. The orchestrator
 *     has already built and pruned before spawning it, so its assets are on disk
 *     before it binds a port.
 *   - The orchestrator itself is recognised from `argv`, not an environment
 *     variable, because providers boot *before* `ServeCommand.run()` gets to set
 *     one — the flag would always arrive too late to be read.
 *
 * Anything else — a plain `serve`, a queue worker, a test — is unsupervised and
 * still builds at boot.
 *
 * @param env  Environment to read; defaults to the process environment.
 * @param argv Command line to read; defaults to the process command line.
 * @internal
 */
export function isDevOrchestrated(
  env: Record<string, string | undefined> = Bun.env,
  argv: readonly string[] = Bun.argv,
): boolean {
  if (env[DEV_WORKER_ENV_VAR] === "1") return true;
  return argv.includes("serve") && argv.includes("--dev");
}
