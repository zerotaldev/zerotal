/**
 * The queue package's framework events, emitted on core's {@link FrameworkEvents}
 * bus. Observability packages subscribe to them by kind (their class name).
 */

/**
 * Emitted at each stage of a background job's life — `status` is one of
 * `dispatched`, `completed`, `failed`, or `retried`, with `error` set on
 * failure. A single job fires several of these over its lifetime.
 *
 * @category Queue
 */
export class JobRan {
  constructor(
    readonly className: string,
    readonly queue: string,
    readonly status: "dispatched" | "completed" | "failed" | "retried",
    readonly durationMs: number,
    readonly error?: string,
  ) {}
}
