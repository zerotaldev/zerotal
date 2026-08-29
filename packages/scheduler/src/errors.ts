import { ZerotalError } from "@zerotal/core";

/** Base class for all @zerotal/scheduler errors. */
export class SchedulerError extends ZerotalError {
  constructor(
    message: string,
    code = "E_SCHEDULER",
    status = 500,
    context?: Record<string, unknown>,
  ) {
    super(message, code, status, context);
  }
}

/**
 * Thrown when a task declares a timezone this runtime does not know.
 *
 * Raised at registration rather than at the first tick, because a `RangeError`
 * thrown once a minute from inside a cron callback names the formatter and not the
 * task — and a typo'd zone would otherwise be a task that silently never runs.
 */
export class UnknownTimeZoneError extends SchedulerError {
  constructor(task: string, timezone: string) {
    super(
      `[Zerotal Scheduler] Task "${task}" declares timezone "${timezone}", which this runtime ` +
        `does not know. Use an IANA name, e.g. "Africa/Johannesburg" or "UTC".`,
      "E_SCHEDULER_UNKNOWN_TIMEZONE",
      500,
      { task, timezone },
    );
  }
}
