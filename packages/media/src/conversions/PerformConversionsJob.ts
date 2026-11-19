import { performConversions } from "./queueBridge.ts";
import type { QueueJob, QueueJobBase } from "./queueBridge.ts";
import { mediaState } from "../state.ts";

/** The job's name on the wire, written into every queued payload. */
const JOB_NAME = "PerformConversionsJob";

/**
 * Build the job that generates a media item's conversions on a worker instead
 * of in the request.
 *
 * A factory rather than a class that `extends Job` at the top of the file:
 * `@zerotal/queue` is an optional peer, so this package may not import it
 * statically, nor for its types. The queue bridge loads it, then hands its
 * `Job` base class in here. Apps without a queue never load this file.
 *
 * The class declares its `jobName`, because the name is in every payload already
 * queued and must not depend on how the class came to be defined.
 *
 * @param Job - `Job` from `@zerotal/queue`.
 * @returns The job class, ready to register and dispatch.
 */
export function definePerformConversionsJob(Job: QueueJobBase) {
  return class PerformConversionsJob extends Job {
    static jobName = JOB_NAME;

    override readonly queue: string;

    constructor(
      readonly mediaId: number,
      readonly conversions: string[],
      queue?: string,
    ) {
      super();
      this.queue = queue ?? mediaState().config.queue;
    }

    override payload(): Record<string, unknown> {
      return { mediaId: this.mediaId, conversions: this.conversions, queue: this.queue };
    }

    static fromPayload(payload: Record<string, unknown>): QueueJob {
      return new PerformConversionsJob(
        Number(payload["mediaId"]),
        (payload["conversions"] as string[] | undefined) ?? [],
        payload["queue"] as string | undefined,
      );
    }

    /**
     * A media row deleted between dispatch and execution makes this a no-op, not a
     * failure: retrying cannot bring the row back, so throwing would just burn
     * every attempt before landing in the failed queue for no one to act on.
     */
    async handle(): Promise<void> {
      await performConversions(this.mediaId, this.conversions);
    }
  };
}
