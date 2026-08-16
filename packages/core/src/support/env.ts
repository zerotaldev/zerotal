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
 * Environment variable holding the *runtime mode* — `web`, `worker`, `console`.
 *
 * Separate from `APP_ENV`, which holds the deployment name, because they answer
 * different questions and one variable cannot hold both. It used to try: every
 * boot overwrote `APP_ENV` with the mode, so `APP_ENV=production` read back as
 * `"console"` inside a CLI command and a guard written `if (env("APP_ENV") ===
 * "production") refuse()` was inert exactly where destructive commands live.
 *
 * Written by `setAppEnv()`; read through {@link runtimeMode}. Settable by hand to
 * force a mode — `APP_TYPE=web bun zt.ts something` — which is what the dev
 * orchestrator does for the server it supervises.
 */
export const RUNTIME_MODE_VAR = "APP_TYPE";

/**
 * The values of `APP_ENV` that name a runtime *mode* rather than a deployment.
 * `setAppEnv()` writes these; {@link deployEnv} recognises them to know whether
 * `APP_ENV` still holds the deployment name.
 *
 * @internal
 */
export const RUNTIME_MODES: ReadonlySet<string> = new Set([
  "web",
  "worker",
  "console",
  "test",
  "testing",
  "repl",
]);

/**
 * The deployment name this process was started with — `production`, `staging`,
 * `local`, whatever the operator set — as opposed to the runtime *mode*.
 *
 * `APP_ENV` used to carry both meanings, and the second destroyed the first:
 * `setAppEnv()` overwrote it with `web` / `console` / `worker` before the app
 * booted, so a gate asking `isProdLike(Bun.env["APP_ENV"])` after startup was
 * asking whether `"web"` is production and always getting no. That was not
 * theoretical — it silently disabled the weak-`APP_KEY` refusal and left the
 * ORM's N+1 detector wrapping every query in production, and it later made
 * `env("APP_ENV")` return `"console"` inside a seeder.
 *
 * The mode now lives in its own variable ({@link RUNTIME_MODE_VAR}) and `APP_ENV`
 * is left alone, so this is usually just a read of it. The runtime-mode branch
 * below stays for a process started by an older launcher, or one where somebody
 * still exports `APP_ENV=web` by hand.
 *
 * @internal
 */
export function deployEnv(): string {
  // eslint-disable-next-line no-restricted-syntax -- this IS deployEnv — it decides whether APP_ENV still holds the deployment name
  const current = Bun.env["APP_ENV"] ?? "";
  // If `APP_ENV` still holds a deployment name, it has not been overwritten yet —
  // or something set it deliberately since — so it is the freshest answer. Only
  // once it holds a runtime mode is the preserved copy the better one.
  //
  // Preferring the preserved copy unconditionally made it sticky for the life of
  // the process: anything that set `APP_ENV` afterwards was ignored, which is
  // wrong in itself and which leaked between test files sharing one process.
  if (current && !RUNTIME_MODES.has(current.toLowerCase())) return current;
  return Bun.env[DEPLOY_ENV_VAR] ?? current;
}

/**
 * How this process is running — `web`, `worker`, or `console`.
 *
 * The other half of what `APP_ENV` used to mean. Providers are filtered on it
 * (`static environments = ["console"]`), which is why getting it wrong is not a
 * cosmetic problem: a provider is simply never asked to register, with no error
 * and nothing missing from the logs.
 *
 * `fallback` is what an unset environment means, and it differs by caller:
 * `setAppEnv()` treats a process that never declared itself as a script
 * (`console`), while `Application.create()` has always treated one as a server
 * (`web`) — an app constructed directly, in a test or a script, expects its
 * web providers to register.
 */
export function runtimeMode(fallback = "console"): string {
  const mode = (Bun.env[RUNTIME_MODE_VAR] ?? "").toLowerCase();
  if (RUNTIME_MODES.has(mode)) return mode;

  // A process started by an older launcher, which put the mode in `APP_ENV`.
  // eslint-disable-next-line no-restricted-syntax -- reading the legacy location is the fallback's entire job
  const legacy = (Bun.env["APP_ENV"] ?? "").toLowerCase();
  return RUNTIME_MODES.has(legacy) ? legacy : fallback;
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
