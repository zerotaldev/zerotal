import { deepMerge } from "@zerotal/core";

export interface SchedulerConfigShape {
  /** Timezone for cron expressions. Informational only - Bun.cron uses
   *  the system timezone. Default: 'UTC' */
  timezone: string;
}

const defaults: SchedulerConfigShape = {
  timezone: "UTC",
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
