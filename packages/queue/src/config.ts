import { deepMerge } from "@zerotal/core";
import type { ConfigValidator, ConfigIssue } from "@zerotal/core/config";

export interface QueueConfigShape {
  /** Queue driver. Default: 'sqlite' */
  driver: "sqlite" | "redis" | "sync";
  /** How often the worker polls for new jobs (ms). Default: 500 */
  pollInterval: number;
  /** Queue names the worker listens on. Default: ['default'] */
  queues: string[];
  /**
   * Number of Bun Worker threads to spawn for job execution.
   * When > 0, the HTTP server process processes jobs in background OS threads
   * instead of on the main event loop - preserving HTTP throughput.
   * Default: 0 (main-thread only; use queue:work command instead).
   */
  workers: number;
  /**
   * Absolute path or file URL to a module that imports all job classes.
   * Each imported file must call `JobRegistry.register(MyJob)` (jobs do this automatically
   * via the self-registration pattern). Required when `workers > 0`.
   *
   * @example
   * workerBootstrap: new URL('../bootstrap/queue-worker.ts', import.meta.url).href
   */
  workerBootstrap?: string | undefined;
}

const defaults: QueueConfigShape = {
  driver: "sqlite",
  pollInterval: 500,
  queues: ["default"],
  workers: 0,
};

/**
 * Create a typed queue configuration object with defaults.
 *
 * @example
 * import { QueueConfig } from '@zerotal/queue';
 * export default QueueConfig({ driver: 'sqlite', queues: ['default', 'emails'] });
 */
export function QueueConfig(options: Partial<QueueConfigShape> = {}): QueueConfigShape {
  return deepMerge(defaults, options);
}

const DRIVERS = new Set<string>(["sqlite", "redis", "sync"]);

/**
 * Validate the `queue` config namespace at boot. Structural mistakes (an
 * unknown driver, a worker pool with no bootstrap module, a poll interval that
 * would busy-loop) are errors in any environment; a `sync` driver in production
 * — where every dispatched job runs inline on the request — is flagged as a
 * warning. Registered by {@link QueueProvider} via
 * `app.registerConfigValidator("queue", …)`.
 */
export const validateQueueConfig: ConfigValidator = (value, { isProduction }) => {
  const cfg = value as Partial<QueueConfigShape> | undefined;
  const issues: ConfigIssue[] = [];
  const driver = cfg?.driver ?? "sqlite";

  if (!DRIVERS.has(driver)) {
    issues.push({
      level: "error",
      message: `queue.driver "${driver}" is unknown — use "sqlite", "redis", or "sync".`,
    });
  }

  const poll = cfg?.pollInterval;
  if (poll !== undefined && (!Number.isFinite(poll) || poll < 1)) {
    issues.push({
      level: "error",
      message: `queue.pollInterval must be a positive number of milliseconds, got ${String(poll)}.`,
    });
  }

  const workers = cfg?.workers;
  if (workers !== undefined && (!Number.isInteger(workers) || workers < 0)) {
    issues.push({
      level: "error",
      message: `queue.workers must be a non-negative integer, got ${String(workers)}.`,
    });
  } else if ((workers ?? 0) > 0 && !cfg?.workerBootstrap) {
    issues.push({
      level: "error",
      message:
        "queue.workers is set but queue.workerBootstrap is not — worker threads cannot " +
        "deserialize jobs without a bootstrap module that imports every job class.",
    });
  }

  if (cfg?.queues !== undefined && cfg.queues.length === 0) {
    issues.push({
      level: "warning",
      message:
        "queue.queues is an empty list — a worker started with this config listens on " +
        "nothing and every queued job waits forever.",
    });
  }

  if (isProduction && driver === "sync") {
    issues.push({
      level: "warning",
      message:
        'queue.driver is "sync" in production — every dispatched job runs inline on the ' +
        "request that queued it. Use the sqlite or redis driver for real background work.",
    });
  }

  return issues;
};

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    queue: QueueConfigShape;
  }
}
