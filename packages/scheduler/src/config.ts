import { deepMerge } from "@zerotal/core";
import { DEFAULT_RUN_LOG_KEEP, DEFAULT_RUN_LOG_PATH } from "./runLog.ts";

export interface SchedulerConfigShape {
  /** Timezone for cron expressions. Informational only - Bun.cron uses
   *  the system timezone. Default: 'UTC' */
  timezone: string;
  /** Durable run history — read with `schedule:runs` (see runLog.ts). */
  runLog: {
    /** Default: on, except under `APP_ENV=test`. */
    enabled?: boolean;
    /** JSONL file path, relative to the app root. */
    path: string;
    /** Records kept after compaction; the file is compacted at 2× this. */
    keep: number;
  };
}

const defaults: SchedulerConfigShape = {
  timezone: "UTC",
  runLog: {
    path: DEFAULT_RUN_LOG_PATH,
    keep: DEFAULT_RUN_LOG_KEEP,
  },
};

/**
 * Create a typed scheduler configuration object with defaults.
 *
 * @example
 * import { SchedulerConfig } from '@zerotal/scheduler';
 * export default SchedulerConfig({ timezone: 'Africa/Johannesburg' });
 */
export function SchedulerConfig(options: Partial<SchedulerConfigShape> = {}): SchedulerConfigShape {
  return deepMerge(defaults, options);
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    scheduler: SchedulerConfigShape;
  }
}
