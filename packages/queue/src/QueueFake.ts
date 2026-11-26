import { Application, currentApp } from "@zerotal/core";
import type { Job } from "./Job.ts";
import { QueueError } from "./errors.ts";
import { _resolveJob, _settleLimitError } from "./QueueManager.ts";
import type { QueueSettleOptions } from "./QueueManager.ts";

type Binding = unknown;

/**
 * Drop-in replacement for QueueManager that captures dispatched jobs instead
 * of persisting or executing them. Install at the start of a test; restore after.
 *
 * @example
 * const queue = QueueFake.install();
 *
 * await Queue.dispatch(new ProcessPaymentJob(order));
 *
 * queue.assertDispatched(ProcessPaymentJob);
 * queue.assertDispatchedCount(1);
 *
 * await queue.settle(); // now run them, and whatever they dispatch
 *
 * queue.restore(); // call in afterEach
 */
export class QueueFake {
  private readonly _dispatched: Job[] = [];
  /** How many captured jobs `settle()` has run, so a second call does not repeat them. */
  private _settled: number | undefined = undefined;
  private readonly _app: Application;
  private readonly _original: Binding;

  private constructor(app: Application, original: Binding) {
    this._app = app;
    this._original = original;
  }

  /** Replace the 'queue' container binding with this fake. */
  static install(): QueueFake {
    const app = currentApp();
    const original = app.container.registry.get("queue");
    const fake = new QueueFake(app, original);
    app.container.value("queue", fake);
    return fake;
  }

  /** Restore the original 'queue' binding. Call in afterEach. */
  restore(): void {
    if (this._original !== undefined) {
      this._app.container.registry.set("queue", this._original as never);
    } else {
      this._app.container.registry.delete("queue");
    }
  }

  // ── Queue manager interface ──────────────────────────────────────────────

  /** Capture the job — does NOT execute it. */
  async dispatch(job: Job): Promise<void> {
    this._dispatched.push(job);
  }

  get isShuttingDown(): boolean {
    return false;
  }

  /**
   * Always `false`: the fake captures jobs and runs nothing on its own, so a
   * worker loop pointed at it finds no work. To run what was captured, call
   * {@link settle}.
   */
  async processNext(): Promise<boolean> {
    return false;
  }

  /**
   * Run every captured job that has not run yet, in the order it was dispatched,
   * and resolve to how many ran.
   *
   * Jobs those jobs dispatch are captured as usual and run in the same call, and
   * a chained job's next link is dispatched when it succeeds, as a worker would.
   * Every job stays in {@link dispatched}, so the assertions still see it; a second
   * call runs only what arrived since the first.
   *
   * Each job runs once, with no retries. If any throws, the rest still run, and
   * then this throws a {@link QueueError} (`E_QUEUE_SETTLE_FAILED`) naming every
   * job that failed, with the first error as its `cause`. After `limit` jobs it
   * throws `E_QUEUE_SETTLE_LIMIT`, so a job that keeps dispatching itself ends the
   * test rather than hanging it.
   *
   * @example
   * const queue = QueueFake.install();
   * await Queue.dispatch(new ImportCsvJob(upload.id));
   * await queue.settle();
   * queue.assertDispatched(SendImportSummaryJob); // dispatched by ImportCsvJob
   */
  async settle(options: QueueSettleOptions = {}): Promise<number> {
    const limit = options.limit ?? 1000;
    const failures: { job: Job; error: unknown }[] = [];
    let count = 0;

    // A cursor rather than a set of jobs seen: the same instance dispatched twice
    // is two jobs, and runs twice.
    for (;;) {
      const index = this._settled ?? 0;
      const next = this._dispatched[index];
      if (!next) break;
      if (++count > limit) throw _settleLimitError(limit);
      this._settled = index + 1;
      try {
        await next.handle();
      } catch (error) {
        failures.push({ job: next, error });
        continue;
      }
      try {
        await this._dispatchNextInChain(next);
      } catch (error) {
        failures.push({ job: next, error });
      }
    }

    if (failures.length > 0) {
      const lines = failures.map(({ job, error }) => {
        const message = error instanceof Error ? error.message : String(error);
        return `  - ${job.className}: ${message}`;
      });
      const err = new QueueError(
        `settle() ran ${count} job(s) and ${failures.length} failed:\n${lines.join("\n")}`,
        "E_QUEUE_SETTLE_FAILED",
        500,
        { failed: failures.map((f) => f.job.className) },
      );
      (err as Error & { cause?: unknown }).cause = failures[0]!.error;
      throw err;
    }
    return count;
  }

  /** What a worker does when a chained job succeeds: dispatch the next link. */
  private async _dispatchNextInChain(job: Job): Promise<void> {
    const [next, ...rest] = job._chain ?? [];
    if (!next) return;
    const following = _resolveJob(next.className, next.payload);
    if (!following) {
      throw new Error(
        `the next job in its chain, "${next.className}", is not a registered job class; ` +
          `register it with JobRegistry.register()`,
      );
    }
    if (rest.length > 0) following._chain = rest;
    await this.dispatch(following);
  }
  async drain(): Promise<void> {}
  async size(): Promise<number> {
    return this._dispatched.length;
  }
  async flush(): Promise<void> {
    this._dispatched.length = 0;
    this._settled = 0;
  }

  // ── Assertions ───────────────────────────────────────────────────────────

  /** All captured jobs. */
  dispatched(): Job[] {
    return [...this._dispatched];
  }

  /**
   * Assert that a specific Job class was dispatched.
   * Pass an optional filter callback to narrow the assertion.
   *
   * @example
   * queue.assertDispatched(ProcessPaymentJob);
   * queue.assertDispatched(ProcessPaymentJob, (j) => j.orderId === 42);
   */
  assertDispatched<T extends Job>(
    JobClass: new (...args: never[]) => T,
    callback?: (job: T) => boolean,
  ): void {
    const matching = this._dispatched.filter(
      (j): j is T => j instanceof JobClass && (callback === undefined || callback(j)),
    );
    if (matching.length === 0) {
      const hint = callback ? " matching the given filter" : "";
      throw new Error(`Expected ${JobClass.name} to have been dispatched${hint}, but it was not.`);
    }
  }

  /** Assert that a Job class was NOT dispatched. */
  assertNotDispatched<T extends Job>(JobClass: new (...args: never[]) => T): void {
    const matching = this._dispatched.filter((j): j is T => j instanceof JobClass);
    if (matching.length > 0) {
      throw new Error(
        `Expected ${JobClass.name} NOT to have been dispatched, but it was (${matching.length}×).`,
      );
    }
  }

  /** Assert that no jobs were dispatched. */
  assertNothingDispatched(): void {
    if (this._dispatched.length > 0) {
      const names = this._dispatched.map((j) => j.constructor.name).join(", ");
      throw new Error(
        `Expected nothing to be dispatched, but ${this._dispatched.length} job(s) were: ${names}.`,
      );
    }
  }

  /** Assert the exact number of dispatched jobs. */
  assertDispatchedCount(count: number): void {
    if (this._dispatched.length !== count) {
      throw new Error(
        `Expected ${count} job(s) to be dispatched, but ${this._dispatched.length} were.`,
      );
    }
  }
}
