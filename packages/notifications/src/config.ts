import { deepMerge } from "@zerotal/core";
import { NotificationConfigError } from "./errors.ts";
import type { NotificationConfigShape } from "./types.ts";

/** Recursively-optional view of the config, so callers can override just the keys they care about. */
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const defaults: NotificationConfigShape = {
  database: {
    table: "notifications",
  },
  mail: {
    driver: "log",
    from: { address: "hello@example.com", name: "Zerotal App" },
    smtp: { host: "localhost", port: 1025, secure: false, username: "", password: "" },
    resend: { apiKey: "" },
    log: { channel: "console" },
  },
};

/**
 * Create a typed notification configuration object with defaults.
 *
 * @example
 * import { NotificationConfig } from '@zerotal/notifications';
 *
 * export default NotificationConfig({
 *   database: { table: 'notifications' },
 *
 *   // Slack incoming webhook
 *   slack: { webhook: Bun.env['SLACK_WEBHOOK'] ?? '' },
 *
 *   // SMS via Twilio
 *   sms: {
 *     driver: 'twilio',
 *     twilio: {
 *       accountSid: Bun.env['TWILIO_ACCOUNT_SID'] ?? '',
 *       authToken:  Bun.env['TWILIO_AUTH_TOKEN']  ?? '',
 *       from:       Bun.env['TWILIO_FROM']         ?? '',
 *     },
 *   },
 * });
 */
export function NotificationConfig(
  options: DeepPartial<NotificationConfigShape> = {},
): NotificationConfigShape {
  const config = deepMerge(defaults, options as Partial<NotificationConfigShape>);
  validateNotificationConfig(config);
  return config;
}

/**
 * Check the config for combinations that would only fail at send time.
 *
 * A missing Resend key or an SMS driver without its credential block is a
 * deployment mistake, and the cheapest place to notice one is here — at boot,
 * naming the key — rather than on the first password-reset email of the day.
 *
 * @throws {NotificationConfigError} on the first inconsistency found.
 */
export function validateNotificationConfig(config: NotificationConfigShape): void {
  const { mail, sms } = config;

  if (!["log", "smtp", "resend"].includes(mail.driver)) {
    throw new NotificationConfigError(
      `Unknown mail driver '${mail.driver}'. Expected 'log', 'smtp', or 'resend'.`,
      { driver: mail.driver },
    );
  }

  if (mail.driver === "resend" && !mail.resend.apiKey) {
    throw new NotificationConfigError(
      "mail.driver is 'resend' but mail.resend.apiKey is empty. Set RESEND_API_KEY.",
    );
  }

  if (mail.driver === "smtp") {
    if (!mail.smtp.host) {
      throw new NotificationConfigError("mail.driver is 'smtp' but mail.smtp.host is empty.");
    }
    if (mail.smtp.username && !mail.smtp.password) {
      throw new NotificationConfigError(
        "mail.smtp.username is set but mail.smtp.password is empty.",
      );
    }
  }

  if (!mail.from.address.includes("@")) {
    throw new NotificationConfigError(
      `mail.from.address '${mail.from.address}' is not an email address.`,
      { address: mail.from.address },
    );
  }

  if (sms !== undefined) {
    if (sms.driver === "twilio" && !sms.twilio) {
      throw new NotificationConfigError(
        "sms.driver is 'twilio' but sms.twilio is missing. Provide accountSid, authToken, and from.",
      );
    }
    if (sms.driver === "vonage" && !sms.vonage) {
      throw new NotificationConfigError(
        "sms.driver is 'vonage' but sms.vonage is missing. Provide apiKey, apiSecret, and from.",
      );
    }
    if (sms.driver !== "twilio" && sms.driver !== "vonage") {
      throw new NotificationConfigError(
        `Unknown SMS driver '${String(sms.driver)}'. Expected 'twilio' or 'vonage'.`,
        { driver: sms.driver },
      );
    }
  }
}

// Register this package's config namespace for typed config() dot-paths.
declare module "@zerotal/core" {
  interface ConfigRegistry {
    notifications: NotificationConfigShape;
  }
}
