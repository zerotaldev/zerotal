/**
 * A serialisable wrapper that lets an event listener be deferred to a queue:
 * it captures the listener name and event payload, can round-trip through a
 * plain object, and re-dispatches the listener when the worker runs it.
 */
import { currentApp } from "../application/currentApp.ts";

/** A queued event listener, carrying everything the worker needs to run it later. */
export class CallQueuedListener {
  readonly queue: string;
  readonly maxAttempts: number;
  readonly retryDelay: number;

  constructor(
    public readonly listenerName: string,
    public readonly eventName: string,
    public readonly eventPayload: any,
    queueName: string | boolean = "default",
    maxAttempts = 3,
    retryDelay = 1000,
  ) {
    this.queue = typeof queueName === "string" ? queueName : "default";
    this.maxAttempts = maxAttempts;
    this.retryDelay = retryDelay;
  }

  /** Serialise this listener to a plain object for storage on the queue. */
  payload(): Record<string, unknown> {
    return {
      listenerName: this.listenerName,
      eventName: this.eventName,
      eventPayload: this.eventPayload,
      queue: this.queue,
      maxAttempts: this.maxAttempts,
      retryDelay: this.retryDelay,
    };
  }

  /** The job class name the queue uses to route this listener back to {@link fromPayload}. */
  get className(): string {
    return "CallQueuedListener";
  }

  /** Reconstruct a queued listener from the plain object produced by {@link payload}. */
  static fromPayload(payload: Record<string, unknown>) {
    return new CallQueuedListener(
      payload.listenerName as string,
      payload.eventName as string,
      payload.eventPayload,
      payload.queue as string,
      payload.maxAttempts as number,
      payload.retryDelay as number,
    );
  }

  /** Run the wrapped listener through the live emitter. No-op if no emitter is bound. */
  async handle(): Promise<void> {
    const application = currentApp();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the events binding has no cross-package type here; the dispatch method is checked at the call site.
    const emitter = application.container.tryMake("events") as any;
    if (!emitter) return;

    // Emitter needs to expose a way to execute a listener by name with a raw payload
    await emitter.dispatchQueuedListener(this.listenerName, this.eventPayload);
  }
}
