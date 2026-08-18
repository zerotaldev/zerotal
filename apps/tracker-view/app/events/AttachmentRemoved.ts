import { BroadcastingEvent, privateChannel } from "@zerotal/broadcasting";

/**
 * A file was taken off an issue — the other half of [[AttachmentAdded]].
 *
 * Adding without removing is the worse of the two states: a list that grows
 * live and shrinks only on reload shows readers a file that is already gone,
 * and offers them a download link for it. Whatever a build does for one, it
 * does for both.
 *
 * The payload is an id and nothing else. A removal has no row to draw — the
 * listener's whole job is to find that id and drop it — so sending the record
 * would ship a deleted file's name and size to every subscriber for no reason.
 *
 * Only the Flow build dispatches this today, because it is the only one with a
 * delete control; the event lives in all three because it is the app's
 * contract, not a page's, and a reader in any build should see the row go.
 */
export class AttachmentRemoved extends BroadcastingEvent {
  constructor(
    public readonly issueId: number,
    public readonly attachmentId: number,
  ) {
    super();
  }

  broadcastOn() {
    return privateChannel(`issues.${this.issueId}`);
  }

  broadcastWith() {
    return { attachmentId: this.attachmentId };
  }
}
