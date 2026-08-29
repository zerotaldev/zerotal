import { deepMerge } from "@zerotal/core";
import { DEFAULT_RUN_LOG_KEEP, DEFAULT_RUN_LOG_PATH } from "./runLog.ts";

export interface SchedulerConfigShape {
  /**
   * IANA timezone every schedule's cron expression is read in, unless the task
   * sets its own with `.timezone(tz)`.
   *
   * Defaults to the system zone, so an app that does not set this keeps whatever
   * its server does. Setting it is the usual case for a business that operates in
   * one country and is not on UTC — one line instead of a `.timezone()` on every
   * task.
   */
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
  // The system zone rather than a hardcoded "UTC": the default has to be what the
  // app already does, or turning this key from decoration into behaviour would have
  // moved every schedule in every app that never set it.
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
