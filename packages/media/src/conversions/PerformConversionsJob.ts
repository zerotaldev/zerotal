import { Job } from "@zerotal/queue";
import { performConversions } from "./queueBridge.ts";
import { mediaState } from "../state.ts";

/**
 * Generates a media item's conversions on a worker instead of in the request.
 *
 * Only reachable when `@zerotal/queue` is installed — `MediaProvider` imports
 * this module lazily, inside the branch that has already found a `queue`
 * binding. Apps without a queue generate every conversion inline and never load
 * this file.
 */
export class PerformConversionsJob extends Job {
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

  static fromPayload(payload: Record<string, unknown>): PerformConversionsJob {
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
}
