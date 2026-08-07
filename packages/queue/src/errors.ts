import { ZerotalError } from "@zerotal/core";

/** Base class for all @zerotal/queue errors. */
export class QueueError extends ZerotalError {
  constructor(message: string, code = "E_QUEUE", status = 500, context?: Record<string, unknown>) {
    super(message, code, status, context);
  }
}

/** Thrown when the Bus facade is used before QueueProvider is registered. */
export class QueueNotInitializedError extends QueueError {
  constructor() {
    super(
      "[Zerotal] Bus is not initialized. Register QueueProvider first.",
      "E_QUEUE_NOT_INITIALIZED",
      500,
    );
  }
}

/** Thrown when dispatching while the manager is shutting down. */
export class QueueShuttingDownError extends QueueError {
  constructor(className: string) {
    super(
      `Cannot dispatch ${className} — QueueManager is shutting down.`,
      "E_QUEUE_SHUTTING_DOWN",
      503,
      { className },
    );
  }
}

/** Thrown when batching is requested on a driver that does not support it. */
export class QueueBatchingUnsupportedError extends QueueError {
  constructor() {
    super(
      "[Zerotal] The current queue driver does not support job batching. Use SqliteDriver.",
      "E_QUEUE_BATCHING_UNSUPPORTED",
      500,
    );
  }
}
