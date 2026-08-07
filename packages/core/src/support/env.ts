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
 * @example
 * if (!isProdLike(Bun.env["APP_ENV"] ?? "")) return renderDevErrorPage(error);
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
 *     it, whatever deployment name the developer configured is gone.
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
  return isDevSurfaceAllowed(Bun.env["APP_ENV"] ?? "");
}
