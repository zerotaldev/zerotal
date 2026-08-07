/**
 * The scheduler package's framework events, emitted on core's {@link FrameworkEvents}
 * bus. Observability packages subscribe to them by kind (their class name).
 */

/**
 * Emitted after a scheduled task finishes running.
 * @category Scheduler
 */
export class TaskRan {
  constructor(
    readonly name: string,
    readonly durationMs: number,
    readonly ok: boolean,
  ) {}
}

/**
 * Emitted when a scheduled task throws during execution.
 * @category Scheduler
 */
export class TaskFailed {
  constructor(
    readonly name: string,
    readonly durationMs: number,
    readonly error: string,
  ) {}
}

/**
 * Emitted when a scheduled task is skipped before running; `reason` records
 * which guard skipped it (env, time window, `when()` condition, explicit skip,
 * overlap prevention, or a held lock).
 * @category Scheduler
 */
export class TaskSkipped {
  constructor(
    readonly name: string,
    readonly reason: "env" | "window" | "when" | "skip" | "overlap" | "lock",
  ) {}
}
