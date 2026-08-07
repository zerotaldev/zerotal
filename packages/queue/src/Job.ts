import type { SerializedJob } from "./Batch.ts";

export abstract class Job {
  /** Queue name — override in subclass to route to specific queues */
  readonly queue: string = "default";

  /** Max retry attempts before moving to failed queue */
  readonly maxAttempts: number = 3;

  /** Milliseconds to wait between retry attempts */
  readonly retryDelay: number = 1000;

  /** Set by Bus.batch() — tracks which batch this job belongs to. */
  batchId: string | undefined = undefined;

  /** Set by Bus.chain() — remaining jobs to dispatch after this one succeeds. */
  _chain: SerializedJob[] | undefined = undefined;

  /** The job's work — implement this in every subclass */
  abstract handle(): Promise<void>;

  /**
   * Serialize job state to a plain object for storage.
   * Override in subclasses that have constructor arguments.
   */
  payload(): Record<string, unknown> {
    return {};
  }

  /**
   * The class name used as the serialization key.
   * Must match what JobRegistry.register() stores.
   */
  get className(): string {
    return this.constructor.name;
  }
}
