import type { Notifiable } from "./types.ts";

/** Per-channel destinations for a recipient with no model behind it. */
export interface OnDemandRoutes {
  /** Email address for the `mail` channel. */
  mail?: string;
  /** E.164 phone number for the `sms` channel. */
  sms?: string;
  /** Incoming webhook URL for the `slack` channel. */
  slack?: string;
  /** Broadcast channel name for the `broadcast` channel. */
  broadcast?: string;
  /** Destination for a channel registered with `extend()`. */
  [channel: string]: string | undefined;
}

/**
 * A recipient addressed directly rather than looked up — `Notify.route({ mail:
 * "ops@acme.test" })`.
 *
 * It satisfies `Notifiable` without being a model, so every channel works
 * unchanged. The `database` channel is the exception worth knowing about: rows
 * it writes are keyed to a random id nothing can query back, which is why an
 * on-demand notification normally declares only transport channels.
 */
export class OnDemandNotifiable implements Notifiable {
  readonly id: string;
  readonly email?: string;
  readonly phone?: string;

  constructor(private readonly _routes: OnDemandRoutes) {
    this.id = `on-demand:${crypto.randomUUID()}`;
    // Assigned only when present: `exactOptionalPropertyTypes` distinguishes an
    // absent optional field from one explicitly set to undefined.
    if (_routes.mail !== undefined) this.email = _routes.mail;
    if (_routes.sms !== undefined) this.phone = _routes.sms;
  }

  routeNotificationFor(channel: string): string | undefined {
    return this._routes[channel];
  }

  receivesBroadcastNotificationsOn(): string {
    return this._routes.broadcast ?? `notifications.${this.id}`;
  }
}
