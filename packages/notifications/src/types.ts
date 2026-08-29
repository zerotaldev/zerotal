/** The entity receiving the notification (typically a user). */
export interface Notifiable {
  id: number | string;
  email?: string;
  name?: string;
  /** Phone number in E.164 format, required when using the sms channel. */
  phone?: string;
  /**
   * Override the channel this notifiable receives broadcast notifications on.
   * Default: `notifications.{id}` (broadcast as a private channel). Used by the 'broadcast' channel.
   */
  receivesBroadcastNotificationsOn?(): string;
  /**
   * Per-channel destination override, consulted before the default field.
   *
   * Return the address a channel should deliver to — an email for `"mail"`, an
   * E.164 number for `"sms"`, a webhook URL for `"slack"` — or `undefined` to
   * fall back. Lets one model route differently per channel without every
   * notification having to know how.
   *
   * @example
   * routeNotificationFor(channel: string) {
   *   return channel === "mail" ? this.billingEmail : undefined;
   * }
   */
  routeNotificationFor?(channel: string): string | undefined;
}

/**
 * A delivery channel. Every built-in channel implements this, and so does any
 * channel registered with `NotificationManager.extend()`.
 */
export interface NotificationChannel {
  send(notifiable: Notifiable, notification: NotificationLike): Promise<void>;
}

/**
 * The shape a channel sees. Declared structurally so `types.ts` stays free of a
 * runtime import of the `Notification` class.
 */
export interface NotificationLike {
  channels(notifiable?: Notifiable): string[];
  constructor: { name: string };
}

/** Mail-channel settings (driver selection + the default sender + credentials). */
export interface MailConfigShape {
  /** Transport for the mail channel. Default: 'log' (prints to console). */
  driver: "log" | "smtp" | "resend";
  /** Default From address, used unless a MailMessage overrides it with `from()`. */
  from: {
    address: string;
    name: string;
  };
  /** SMTP options (used when driver === 'smtp'). */
  smtp: {
    host: string;
    port: number;
    /** TLS on connect (port 465); false = plain, upgraded via STARTTLS when offered (port 587). */
    secure: boolean;
    username: string;
    password: string;
    /**
     * Send credentials even when the connection is not encrypted. Off by default:
     * `AUTH LOGIN`/`PLAIN` are base64, so a plaintext session hands the password
     * to anyone on the path. Turn on only for a trusted local relay.
     */
    allowInsecureAuth?: boolean;
    /** Reject servers presenting an untrusted certificate. Default: true. */
    rejectUnauthorized?: boolean;
    /** Per-reply timeout in milliseconds. Default: 30000. */
    timeoutMs?: number;
    /** Name sent in the EHLO greeting. Default: 'zerotal'. */
    clientName?: string;
  };
  /** Resend options (used when driver === 'resend'). */
  resend: {
    apiKey: string;
  };
  /** Log options (used when driver === 'log'). */
  log: {
    /** 'console' writes to stdout; a path writes to a file. */
    channel: "console" | string;
  };
}

export interface TwilioConfigShape {
  accountSid: string;
  authToken: string;
  from: string;
}

export interface VonageConfigShape {
  apiKey: string;
  apiSecret: string;
  from: string;
}

export interface SmsConfigShape {
  driver: "twilio" | "vonage";
  twilio?: TwilioConfigShape | undefined;
  vonage?: VonageConfigShape | undefined;
}

export interface NotificationConfigShape {
  database: {
    /** Table name for stored notifications. Default: 'notifications' */
    table: string;
  };
  /**
   * Mail-channel settings. Always present (defaults to the `log` driver), so the
   * `mail` channel works out of the box without extra configuration.
   */
  mail: MailConfigShape;
  /**
   * Slack incoming webhook settings.
   * The per-notification toSlack() method provides the webhookUrl, so this is
   * only needed if you want a global fallback URL.
   */
  slack?: {
    /** Default webhook URL — can be overridden per-notification in toSlack(). */
    webhook?: string;
  } | undefined;
  /**
   * SMS provider settings (Twilio or Vonage).
   * Required when any notification uses the 'sms' channel.
   */
  sms?: SmsConfigShape | undefined;
}
