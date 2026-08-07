import type { OverlapLockOptions, ScheduledTask } from "./ScheduledTask.ts";
import type { SchedulerBuilder } from "./SchedulerManager.ts";

/**
 * Base class for convention-based scheduled tasks. Drop a subclass in `app/schedules/` and it is
 * auto-registered at boot (worker + console environments) by the scheduler's convention loader.
 *
 * Define the cadence with either `cron` or the fluent `frequency()` method, put the work in
 * `handle()`, and tune behaviour with the declarative settings below.
 *
 * @example
 * import { Schedule } from "@zerotal/scheduler";
 *
 * export class SendDailyReports extends Schedule {
 *   cron = "0 8 * * *";          // every day at 08:00
 *   timezone = "Africa/Johannesburg";
 *   withoutOverlapping = true;
 *
 *   async handle(): Promise<void> {
 *     await Queue.dispatch(new SendReportsJob());
 *   }
 * }
 *
 * @example  // fluent cadence instead of a raw cron string
 * export class PruneTempFiles extends Schedule {
 *   frequency(every) { return every.dailyAt("02:30"); }
 *   async handle() { ... }
 * }
 */
export abstract class Schedule {
  /** The work performed on each run. Required. */
  abstract handle(): void | Promise<void>;

  /**
   * Cron expression (5- or 6-field). Set this OR override {@link frequency}.
   * Examples: `"* * * * *"` (every minute), `"0 8 * * 1"` (Mondays at 08:00).
   */
  cron?: string;

  /**
   * Build the cadence fluently using the scheduler's frequency helpers, instead of a raw
   * cron string. Return the configured task.
   *
   * @example frequency(every) { return every.everyFiveMinutes(); }
   */
  frequency?(every: SchedulerBuilder): ScheduledTask;

  /** Task name shown in `schedule:list` and logs. Defaults to the class name. */
  name?: string;

  /** IANA timezone the cron expression is evaluated in (default: system timezone). */
  timezone?: string;

  /**
   * Prevent overlapping runs. `true` skips a tick while a previous run is still active and,
   * when a lock driver is configured, also takes a cross-process lock. Pass
   * `{ crossProcess: false }` to guard within this process only.
   */
  withoutOverlapping?: boolean | OverlapLockOptions;

  /** Only run when `APP_ENV` is one of these values. */
  environments?: string[];

  /** Run the body without blocking the scheduler tick (fire-and-forget). */
  inBackground?: boolean;

  /** Only run between `["HH:MM", "HH:MM"]`. */
  between?: [string, string];

  /** Never run between `["HH:MM", "HH:MM"]`. */
  unlessBetween?: [string, string];

  /** Health-check pings (e.g. healthchecks.io). URLs are fetched at each lifecycle point. */
  pingBefore?: string;
  pingAfter?: string;
  pingOnSuccess?: string;
  pingOnFailure?: string;

  /** Append captured console output to a file. */
  appendOutputTo?: string;

  /** Email captured console output (requires an output mailer to be configured). */
  emailOutputTo?: string;

  /** Dynamic guard — the task runs only when this resolves truthy. */
  when?(): boolean | Promise<boolean>;

  /** Dynamic guard — the task is skipped when this resolves truthy. */
  skip?(): boolean | Promise<boolean>;
}
