import { ZerotalError } from "@zerotal/core";

/** Base class for all @zerotal/notifications errors. */
export class NotificationError extends ZerotalError {
  constructor(
    message: string,
    code = "E_NOTIFICATION",
    status = 500,
    context?: Record<string, unknown>,
  ) {
    super(message, code, status, context);
  }
}

/** Thrown when a notification is routed to a channel the manager does not know. */
export class UnknownNotificationChannelError extends NotificationError {
  constructor(channel: string, known: string[] = []) {
    super(
      `Unknown notification channel: '${channel}'.` +
        (known.length > 0
          ? ` Registered: ${known.join(", ")}. Add your own with notifications.extend("${channel}", () => …).`
          : ""),
      "E_NOTIFICATION_UNKNOWN_CHANNEL",
      500,
      { channel, known },
    );
  }
}

/** Thrown when a channel is used but its config block is missing. */
export class NotificationChannelNotConfiguredError extends NotificationError {
  constructor(channel: string, hint = "") {
    super(
      `[Zerotal] Notifications ${channel} channel is not configured.${hint ? " " + hint : ""}`,
      "E_NOTIFICATION_CHANNEL_NOT_CONFIGURED",
      500,
      { channel },
    );
  }
}

/** Thrown when a channel's delivery to its provider fails (non-2xx response or provider error). */
export class NotificationDeliveryError extends NotificationError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "E_NOTIFICATION_DELIVERY", 502, context);
  }
}

/**
 * Thrown when a channel cannot run because an optional peer package or required
 * config is missing (e.g. the broadcast channel without `@zerotal/broadcasting`,
 * or the SMS driver's credential block).
 */
export class NotificationChannelUnavailableError extends NotificationError {
  constructor(message: string) {
    super(message, "E_NOTIFICATION_CHANNEL_UNAVAILABLE", 500);
  }
}

/**
 * Thrown when a notification routes to a channel whose representation method
 * (e.g. `toMail()`) hasn't been implemented on the notification class.
 */
export class NotificationContractError extends NotificationError {
  constructor(notification: string, method: string, channel: string) {
    super(
      `${notification} must implement ${method}() to use the '${channel}' channel.`,
      "E_NOTIFICATION_CONTRACT",
      500,
      { notification, method, channel },
    );
  }
}

/**
 * Thrown when a queued notification names a class the worker cannot find — the
 * notification lives outside `app/notifications/` and was never registered.
 */
export class UnknownNotificationTypeError extends NotificationError {
  constructor(type: string, known: string[]) {
    super(
      `Cannot rebuild queued notification '${type}' — no class of that name is registered. ` +
        `Notifications under app/notifications/ are found automatically; for one elsewhere, call ` +
        `NotificationRegistry.register(${type}) where it is defined.` +
        (known.length > 0 ? ` Known: ${known.join(", ")}.` : ""),
      "E_NOTIFICATION_UNKNOWN_TYPE",
      500,
      { type, known },
    );
  }
}

/**
 * Thrown when a notification finished dispatching but one or more channels
 * failed. Every channel is attempted regardless — a broken Slack webhook must
 * not cost the recipient their email — so this reports the failures together
 * once the rest have been delivered.
 */
export class NotificationDispatchError extends NotificationError {
  constructor(
    readonly notification: string,
    readonly failures: Array<{ channel: string; error: Error }>,
    readonly delivered: string[],
  ) {
    super(
      `${notification} failed on ${failures.length} of ${failures.length + delivered.length} channel(s): ` +
        failures.map((f) => `${f.channel} (${f.error.message})`).join("; ") +
        (delivered.length > 0 ? `. Delivered on: ${delivered.join(", ")}.` : "."),
      "E_NOTIFICATION_DISPATCH",
      500,
      {
        notification,
        failures: failures.map((f) => ({ channel: f.channel, error: f.error.message })),
        delivered,
      },
    );
  }
}

/**
 * Thrown when an SMTP server answers a command with an unexpected status code.
 * Carries the server's own text, which is usually the most useful part.
 */
export class SmtpResponseError extends NotificationError {
  constructor(
    readonly replyCode: number,
    readonly replyText: string,
    expected: number[],
  ) {
    super(
      `SMTP server replied ${replyCode} (${replyText || "no message"}); expected ${expected.join(" or ")}.`,
      "E_NOTIFICATION_SMTP_RESPONSE",
      502,
      { replyCode, replyText, expected },
    );
  }
}

/** Thrown when the SMTP transport itself fails — connect, TLS, timeout, or early close. */
export class SmtpConnectionError extends NotificationError {
  constructor(message: string) {
    super(`[Zerotal/notifications] ${message}`, "E_NOTIFICATION_SMTP_CONNECTION", 502);
  }
}

/** Thrown when `config/notifications.ts` is internally inconsistent. */
export class NotificationConfigError extends NotificationError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(`[Zerotal/notifications] ${message}`, "E_NOTIFICATION_CONFIG", 500, context);
  }
}

/** Thrown when the configured SMS driver name is not recognised. */
export class UnknownSmsDriverError extends NotificationError {
  constructor(driver: string) {
    super(
      `[Zerotal/notifications] Unknown SMS driver: '${driver}'`,
      "E_NOTIFICATION_UNKNOWN_SMS_DRIVER",
      500,
      { driver },
    );
  }
}
