/**
 * The broadcastable representation of a notification, returned from `Notification.toBroadcast()`.
 * Wraps the data payload plus optional queue routing.
 *
 * @example
 * toBroadcast() {
 *   return new BroadcastMessage({ invoiceId: this.invoice.id, amount: this.invoice.amount });
 * }
 */
export class BroadcastMessage {
  /** Queue to deliver this broadcast on. Unset means deliver inline. */
  queue: string | undefined = undefined;

  constructor(public readonly data: Record<string, unknown>) {}

  /**
   * Deliver this broadcast from a queue rather than inline.
   *
   * Worth doing when the broadcast fans out to many connections and the
   * request should not wait for it. The trade is latency: a queued broadcast
   * arrives whenever a worker picks it up.
   *
   * @example
   * toBroadcast() {
   *   return new BroadcastMessage({ id: this.report.id }).onQueue("broadcasts");
   * }
   */
  onQueue(queue: string): this {
    this.queue = queue;
    return this;
  }
}
