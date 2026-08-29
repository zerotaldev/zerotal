/**
 * Health checks — a small registry of named probes plus the report/route logic
 * behind the framework's `/health` endpoint.
 *
 * A check returns (or resolves to) a {@link HealthResult}; throwing, or
 * returning `{ status: 'down' }`, marks it unhealthy. Checks flagged `critical`
 * drive the overall status (and the HTTP 503 response); non-critical failures
 * degrade the report without failing readiness.
 *
 * @example
 * import { Health } from '@zerotal/core';
 *
 * Health.register('database', async () => {
 *   await DB.raw('select 1');
 * }, { critical: true });
 *
 * Health.register('cache', async () => {
 *   await Cache.put('__health', '1', 5);
 *   return { meta: { driver: 'redis' } };
 * });
 */

/** Overall and per-check health status. */
export type HealthStatus = "ok" | "degraded" | "down";

/** What a health check returns to describe its own state. */
export interface HealthResult {
  /** Defaults to `ok` when a check returns without throwing. */
  status?: HealthStatus;
  message?: string;
  meta?: Record<string, unknown>;
}

/** A single health probe; may run sync or async and may return nothing for "ok". */
export type HealthCheckFn = () => Promise<HealthResult | void> | HealthResult | void;

/** The outcome of running one check, as it appears in the aggregate report. */
export interface HealthCheckReport {
  status: HealthStatus;
  message?: string;
  durationMs: number;
  critical: boolean;
  meta?: Record<string, unknown>;
}

/** The full health report returned by the endpoint. */
export interface HealthReport {
  status: HealthStatus;
  app: { name: string; version: string; environment: string; bootMs?: number };
  /** Seconds since the process started. */
  uptime: number;
  timestamp: string;
  checks: Record<string, HealthCheckReport>;
}

/** Application metadata the report needs that the registry can't know on its own. */
export interface HealthRunMeta {
  name: string;
  version: string;
  environment: string;
  uptime: number;
  /** Wall-clock boot time in milliseconds, surfaced in the report's `app` block. */
  bootMs?: number;
}

class HealthRegistry {
  private readonly _checks = new Map<string, { fn: HealthCheckFn; critical: boolean }>();

  /** Register (or replace) a named check. `critical` checks can fail readiness. */
  register(name: string, fn: HealthCheckFn, options: { critical?: boolean } = {}): this {
    this._checks.set(name, { fn, critical: options.critical ?? false });
    return this;
  }

  /** Remove a previously registered check by name. */
  remove(name: string): this {
    this._checks.delete(name);
    return this;
  }
  /** Remove every registered check. */
  clear(): this {
    this._checks.clear();
    return this;
  }
  /** Whether a check is registered under the given name. */
  has(name: string): boolean {
    return this._checks.has(name);
  }
  /** The names of all registered checks. */
  get names(): string[] {
    return [...this._checks.keys()];
  }

  /** Run every check and assemble the aggregate report. */
  async run(meta: HealthRunMeta): Promise<HealthReport> {
    const checks: Record<string, HealthCheckReport> = {};
    let anyCriticalDown = false;
    let anyDegraded = false;

    await Promise.all(
      [...this._checks.entries()].map(async ([name, { fn, critical }]) => {
        const startedAt = Date.now();
        let report: HealthCheckReport;
        try {
          const result = (await fn()) ?? {};
          const status = result.status ?? "ok";
          report = {
            status,
            durationMs: Date.now() - startedAt,
            critical,
            ...(result.message ? { message: result.message } : {}),
            ...(result.meta ? { meta: result.meta } : {}),
          };
        } catch (error) {
          report = {
            status: "down",
            durationMs: Date.now() - startedAt,
            critical,
            message: (error as Error)?.message ?? String(error),
          };
        }
        if (report.status === "down" && critical) anyCriticalDown = true;
        else if (report.status === "down" || report.status === "degraded") anyDegraded = true;
        checks[name] = report;
      }),
    );

    const status: HealthStatus = anyCriticalDown ? "down" : anyDegraded ? "degraded" : "ok";
    return {
      status,
      app: {
        name: meta.name,
        version: meta.version,
        environment: meta.environment,
        ...(meta.bootMs !== undefined ? { bootMs: meta.bootMs } : {}),
      },
      uptime: meta.uptime,
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}

/** Global health-check registry. */
export const Health = new HealthRegistry();

// ── Endpoint configuration + access control ───────────────────────────────────

/** The health config, authored under the `health` key of `config/app.ts`. */
export interface HealthConfigShape {
  /** Serve the endpoint. Default: on outside production, off in production. */
  enabled?: boolean | undefined;
  /** Route path. Default: `/health`. */
  path?: string | undefined;
  /** Shared secret. Required in production; supplied via `?key=` or `X-Health-Key`. */
  secret?: string | undefined;
  /** Include per-check details. Set false for a bare `{ status }` body. Default: true. */
  showDetails?: boolean | undefined;
}

/** The health config after defaults and back-compat have been applied. */
export interface ResolvedHealthConfig {
  enabled: boolean;
  path: string;
  secret?: string | undefined;
  showDetails: boolean;
}

/**
 * Resolve the health config against the environment. `legacyEnabled` maps the
 * older `app.health` boolean onto `enabled` for back-compat.
 */
export function resolveHealthConfig(
  raw: HealthConfigShape | undefined,
  isProduction: boolean,
  legacyEnabled?: boolean,
): ResolvedHealthConfig {
  const enabled = raw?.enabled ?? legacyEnabled ?? !isProduction;
  return {
    enabled,
    path: raw?.path ?? "/health",
    showDetails: raw?.showDetails ?? true,
    ...(raw?.secret ? { secret: raw.secret } : {}),
  };
}

/** The result of an access-control decision for the health endpoint. */
export interface HealthAccess {
  allowed: boolean;
  /** HTTP status to use when `allowed` is false. */
  code?: number;
  reason?: string;
}

/**
 * Decide whether a request may read the endpoint.
 *  - A configured `secret` is always enforced (`?key=` or `X-Health-Key`).
 *  - In production with no secret the endpoint is refused (503) — it must be
 *    protected before it can be exposed.
 *  - Otherwise (development, no secret) access is open.
 */
export function checkHealthAccess(
  request: Request,
  config: ResolvedHealthConfig,
  isProduction: boolean,
): HealthAccess {
  if (config.secret) {
    const provided =
      new URL(request.url).searchParams.get("key") ?? request.headers.get("x-health-key");
    if (provided === config.secret) return { allowed: true };
    return { allowed: false, code: 401, reason: "Invalid or missing health key." };
  }
  if (isProduction) {
    return {
      allowed: false,
      code: 503,
      reason: "Health endpoint requires `app.health.secret` in production.",
    };
  }
  return { allowed: true };
}
