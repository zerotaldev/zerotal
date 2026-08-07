import { FrameworkEvents } from "@zerotal/core";
import { MessageSent, MessageFailed } from "./events.ts";
import type { Notifiable, MailConfigShape } from "./types.ts";
import type { Notification } from "./Notification.ts";
import type { MailAddress, MailDriver } from "./drivers/MailDriver.ts";
import { LogDriver } from "./drivers/LogDriver.ts";
import { SmtpDriver } from "./drivers/SmtpDriver.ts";
import { ResendDriver } from "./drivers/ResendDriver.ts";

/**
 * The `mail` notification channel — renders a notification's `toMail()` MailMessage and
 * delivers it through the configured driver (log / SMTP / Resend). Built-in to
 * @zerotal/notifications, so the mail channel works without any extra package.
 */
export class MailChannel {
  private readonly _driver: MailDriver;
  private readonly _from: MailAddress;

  constructor(config: MailConfigShape) {
    this._from = config.from;
    this._driver = MailChannel._buildDriver(config);
  }

  private static _buildDriver(config: MailConfigShape): MailDriver {
    switch (config.driver) {
      case "smtp":
        return new SmtpDriver(
          config.smtp.host,
          config.smtp.port,
          config.smtp.username,
          config.smtp.password,
          config.smtp.secure,
          {
            ...(config.smtp.allowInsecureAuth !== undefined
              ? { allowInsecureAuth: config.smtp.allowInsecureAuth }
              : {}),
            ...(config.smtp.rejectUnauthorized !== undefined
              ? { rejectUnauthorized: config.smtp.rejectUnauthorized }
              : {}),
            ...(config.smtp.timeoutMs !== undefined ? { timeoutMs: config.smtp.timeoutMs } : {}),
            ...(config.smtp.clientName !== undefined ? { clientName: config.smtp.clientName } : {}),
          },
        );
      case "resend":
        return new ResendDriver(config.resend.apiKey);
      case "log":
      default:
        return new LogDriver(config.log.channel);
    }
  }

  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const message = await notification.toMail(notifiable);
    // The recipient defaults to the notifiable's email unless the MailMessage set
    // one, or the notifiable routes 'mail' somewhere else (e.g. a billing address).
    const address = notifiable.routeNotificationFor?.("mail") ?? notifiable.email;
    const fallbackTo: MailAddress[] = address
      ? [{ address, ...(notifiable.name ? { name: notifiable.name } : {}) }]
      : [];
    const payload = message.toPayload(this._from, fallbackTo);

    // Mail telemetry — these FrameworkEvents are what feeds the monitor's Mail tab.
    // The notification class is the "mailer" identity; recipients/subject/body come
    // from the resolved payload so the panel mirrors exactly what was put on the wire.
    const className = notification.constructor?.name ?? "Notification";
    const to = payload.to.map((a) => a.address);
    const startedAt = performance.now();
    try {
      await this._driver.send(payload);
      FrameworkEvents.emit(
        new MessageSent(
          className,
          to,
          payload.subject,
          payload.html ?? payload.text ?? "",
          performance.now() - startedAt,
          false,
        ),
      );
    } catch (error) {
      FrameworkEvents.emit(
        new MessageFailed(
          className,
          to,
          payload.subject,
          performance.now() - startedAt,
          error instanceof Error ? error.message : String(error),
        ),
      );
      throw error;
    }
  }
}
