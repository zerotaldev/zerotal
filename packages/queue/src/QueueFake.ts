import { Application, currentApp } from "@zerotal/core";
import type { Job } from "./Job.ts";

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
 * queue.restore(); // call in afterEach
 */
export class QueueFake {
  private readonly _dispatched: Job[] = [];
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

  async processNext(): Promise<boolean> {
    return false;
  }
  async drain(): Promise<void> {}
  async size(): Promise<number> {
    return this._dispatched.length;
  }
  async flush(): Promise<void> {
    this._dispatched.length = 0;
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
