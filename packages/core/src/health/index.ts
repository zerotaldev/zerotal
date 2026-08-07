/**
 * Health checks and their configuration (the `@zerotal/core/health` subpath).
 * {@link Health} is a registry of named probes behind the framework's `/health`
 * endpoint; `critical` checks drive overall readiness and the HTTP 503 response,
 * while non-critical failures degrade the report without failing readiness.
 *
 * @example
 * ```ts
 * import { Health } from "@zerotal/core/health";
 *
 * Health.register("database", async () => {
 *   await DB.raw("select 1");
 * }, { critical: true });
 * ```
 *
 * @packageDocumentation
 */
export { Health } from "./Health.ts";
export type {
  HealthStatus,
  HealthResult,
  HealthCheckFn,
  HealthReport,
  HealthCheckReport,
  HealthConfigShape,
  ResolvedHealthConfig,
} from "./Health.ts";
