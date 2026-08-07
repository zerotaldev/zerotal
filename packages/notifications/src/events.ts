/**
 * The notifications package's framework events (mail + notification delivery),
 * emitted on core's {@link FrameworkEvents} bus. Observability packages subscribe
 * to them by kind (their class name).
 */

/**
 * Emitted after a mail message is sent or queued. `queued` distinguishes an
 * immediate send from a deferred one.
 *
 * @category Mail
 */
export class MessageSent {
  constructor(
    readonly className: string,
    readonly to: string[],
    readonly subject: string,
    readonly html: string,
    readonly durationMs: number,
    readonly queued: boolean,
  ) {}
}

/**
 * Emitted when a mail message is pushed onto a queue (deferred send).
 * @category Mail
 */
export class MessageQueued {
  constructor(
    readonly className: string,
    readonly to: string[],
    readonly subject: string,
    readonly queue: string,
  ) {}
}

/**
 * Emitted when a mail message fails to send.
 * @category Mail
 */
export class MessageFailed {
  constructor(
    readonly className: string,
    readonly to: string[],
    readonly subject: string,
    readonly durationMs: number,
    readonly error: string,
  ) {}
}

/**
 * Emitted after a notification is delivered (or fails) through one channel —
 * distinct from `MessageSent`, which is mail-specific. One notification dispatched
 * to N channels fires N of these.
 *
 * @category Notifications
 */
export class NotificationSent {
  constructor(
    /** The notification class name, e.g. "OrderShippedNotification". */
    readonly className: string,
    /** The channel it went out on: "mail" | "database" | "slack" | "sms" | "broadcast". */
    readonly channel: string,
    /** The recipient identity (email or id). */
    readonly notifiable: string,
    readonly ok: boolean,
    readonly durationMs: number,
    readonly error?: string,
  ) {}
}
