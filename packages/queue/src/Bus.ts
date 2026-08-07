import type { Job } from "./Job.ts";
import { QueueNotInitializedError } from "./errors.ts";
import type { Batch } from "./Batch.ts";
import type { QueueManager } from "./QueueManager.ts";
import { PendingBatch } from "./PendingBatch.ts";

export class Bus {
  private static _manager: QueueManager | undefined;

  static setManager(manager: QueueManager): void {
    Bus._manager = manager;
  }

  /** Dispatch a set of jobs as a batch. Returns a fluent builder to attach callbacks. */
  static batch(jobs: Job[]): PendingBatch {
    const manager = Bus._manager;
    if (!manager) throw new QueueNotInitializedError();
    return new PendingBatch(jobs, {
      dispatchBatch: (pending) => manager.dispatchBatch(pending),
    });
  }

  /**
   * Chain jobs sequentially — each job runs only after the previous one succeeds.
   * If any job fails the chain is stopped (no subsequent jobs are dispatched).
   */
  static chain(jobs: Job[]): { dispatch(): Promise<void> } {
    const manager = Bus._manager;
    if (!manager) throw new QueueNotInitializedError();
    return {
      async dispatch(): Promise<void> {
        if (jobs.length === 0) return;
        const [first, ...rest] = jobs;
        if (!first) return;
        if (rest.length > 0) {
          first._chain = rest.map((j) => ({ className: j.className, payload: j.payload() }));
        }
        await manager.dispatch(first);
      },
    };
  }

  /** Reset the manager reference (for testing). */
  static reset(): void {
    Bus._manager = undefined;
  }
}

export type { Batch };
