import { BroadcastingEvent, privateChannel } from "@zerotal/broadcasting";

/**
 * A file landed on an issue — feature 8, carried live because feature 7 is.
 *
 * The thread and the file list sit on one page, so a comment arriving by itself
 * while an attachment needs a reload is a difference the reader experiences as
 * the page being unreliable, not as two features with different specs. Whatever
 * a build does for one, it does for both: the two socket builds append, and the
 * view build — which has no socket for either — still shows both on next load.
 *
 * The payload is the rendered shape, not the model, for the same reason
 * `CommentPosted` names its four fields: a broadcast crosses a process boundary
 * and lands in a browser, and sending the row would ship whatever columns the
 * table happens to have to every subscriber. It carries the superset the two
 * builds draw between them rather than either one's own row type — `mime` and
 * `createdAt` are unused by Flow today, and an event that has to grow a field to
 * support the next reader is an event the other build has to redeploy for.
 *
 * Same private channel as the comment: one issue, one subscription, one
 * authorization rule in `channels.ts`.
 */
export class AttachmentAdded extends BroadcastingEvent {
  constructor(
    public readonly issueId: number,
    public readonly attachment: {
      id: number;
      name: string;
      mime: string;
      size: number;
      uploader: { name: string } | null;
      createdAt: string | null;
    },
  ) {
    super();
  }

  broadcastOn() {
    return privateChannel(`issues.${this.issueId}`);
  }

  broadcastWith() {
    return { attachment: this.attachment };
  }
}
