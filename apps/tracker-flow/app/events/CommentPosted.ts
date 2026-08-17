import { BroadcastingEvent, privateChannel } from "@zerotal/broadcasting";

/**
 * A comment landed on an issue — feature 7.
 *
 * The payload is the rendered shape the thread draws, not the model. A broadcast
 * crosses a process boundary and lands in a browser, so sending the row would
 * ship whatever columns the table happens to have to every subscriber; naming
 * the four fields keeps that decision here, where it can be read.
 *
 * Private rather than public: the channel name contains an issue id, and an id
 * is not a secret but the thread on it might be. `routes/channels.ts` decides
 * who may listen.
 */
export class CommentPosted extends BroadcastingEvent {
  constructor(
    public readonly issueId: number,
    public readonly comment: {
      id: number;
      body: string;
      author: { name: string } | null;
      createdAt: string | null;
    },
  ) {
    super();
  }

  broadcastOn() {
    return privateChannel(`issues.${this.issueId}`);
  }

  broadcastWith() {
    return { comment: this.comment };
  }
}
