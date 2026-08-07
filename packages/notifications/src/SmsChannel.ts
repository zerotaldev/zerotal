import type { Notifiable } from "./types.ts";
import type { Notification } from "./Notification.ts";
import type { SmsConfigShape } from "./types.ts";
import {
  NotificationDeliveryError,
  NotificationChannelUnavailableError,
  UnknownSmsDriverError,
} from "./errors.ts";

/**
 * Payload returned by notification.toSms().
 *
 * @example
 * toSms(_notifiable: Notifiable): SmsMessage {
 *   return { body: `Your verification code is ${this.code}` };
 * }
 */
export interface SmsMessage {
  /**
   * Recipient phone number in E.164 format, e.g. '+15551234567'. Optional — it
   * defaults to the notifiable's `phone`, so most notifications omit it.
   */
  to?: string;
  /** Message body text. */
  body: string;
  /**
   * Sender number or alphanumeric ID.
   * Overrides the global `from` in config/notifications.ts when set.
   */
  from?: string;
}

/** An SmsMessage after the recipient has been resolved. */
interface ResolvedSms extends SmsMessage {
  to: string;
}

/**
 * SMS notification channel — sends via Twilio or Vonage REST APIs.
 *
 * No npm dependencies — uses the global fetch API.
 *
 * Configure in config/notifications.ts:
 *   sms: {
 *     driver: 'twilio',
 *     twilio: {
 *       accountSid: Bun.env['TWILIO_ACCOUNT_SID'] ?? '',
 *       authToken:  Bun.env['TWILIO_AUTH_TOKEN']  ?? '',
 *       from:       Bun.env['TWILIO_FROM']         ?? '',
 *     },
 *   }
 *
 * Usage in a Notification:
 *   channels() { return ['sms']; }
 *   toSms(_notifiable: Notifiable): SmsMessage {
 *     return { body: 'Your code is 1234' };   // delivered to notifiable.phone
 *   }
 */
export class SmsChannel {
  constructor(private readonly config: SmsConfigShape) {}

  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const message = await notification.toSms(notifiable);
    const driver = this.config.driver;

    // Mirror the mail channel: the recipient is the notifiable unless the
    // message names someone else.
    const to = message.to ?? notifiable.routeNotificationFor?.("sms") ?? notifiable.phone;
    if (!to) {
      throw new NotificationChannelUnavailableError(
        `[Zerotal/notifications] No SMS recipient for ${notification.constructor.name}: ` +
          `the notifiable has no 'phone' and toSms() did not set 'to'.`,
      );
    }
    const resolved: ResolvedSms = { ...message, to };

    if (driver === "twilio") {
      await this._sendTwilio(resolved);
    } else if (driver === "vonage") {
      await this._sendVonage(resolved);
    } else {
      throw new UnknownSmsDriverError(driver);
    }
  }

  // ── Twilio ──────────────────────────────────────────────────────────────────

  private async _sendTwilio(message: ResolvedSms): Promise<void> {
    const cfg = this.config.twilio;
    if (!cfg)
      throw new NotificationChannelUnavailableError(
        "[Zerotal/notifications] SMS driver is twilio but config.sms.twilio is not set.",
      );

    const from = message.from ?? cfg.from;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${cfg.accountSid}:${cfg.authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: from, To: message.to, Body: message.body }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new NotificationDeliveryError(
        `[Zerotal/notifications] Twilio returned ${res.status}: ${body.message ?? "unknown error"}`,
      );
    }
  }

  // ── Vonage ──────────────────────────────────────────────────────────────────

  private async _sendVonage(message: ResolvedSms): Promise<void> {
    const cfg = this.config.vonage;
    if (!cfg)
      throw new NotificationChannelUnavailableError(
        "[Zerotal/notifications] SMS driver is vonage but config.sms.vonage is not set.",
      );

    const from = message.from ?? cfg.from;
    const res = await fetch("https://rest.nexmo.com/sms/json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: cfg.apiKey,
        api_secret: cfg.apiSecret,
        from,
        to: message.to,
        text: message.body,
      }),
    });

    if (!res.ok) {
      throw new NotificationDeliveryError(`[Zerotal/notifications] Vonage returned ${res.status}`);
    }

    const data = (await res.json()) as {
      messages: Array<{ status: string; "error-text"?: string }>;
    };
    const first = data.messages[0];
    if (first && first.status !== "0") {
      throw new NotificationDeliveryError(
        `[Zerotal/notifications] Vonage error: ${first["error-text"] ?? `status ${first.status}`}`,
      );
    }
  }
}
