import type { Notifiable } from "./types.ts";
import type { Notification } from "./Notification.ts";
import { NotificationDeliveryError, NotificationChannelNotConfiguredError } from "./errors.ts";

/**
 * Payload returned by notification.toSlack().
 *
 * @example
 * toSlack(_notifiable: Notifiable): SlackMessage {
 *   return {
 *     webhookUrl: 'https://hooks.slack.com/services/...',
 *     text:       `Order #${this.order.id} was shipped!`,
 *     // Optional Block Kit blocks for rich formatting:
 *     // blocks: [{ type: 'section', text: { type: 'mrkdwn', text: '...' } }],
 *   };
 * }
 */
export interface SlackMessage {
  /**
   * Incoming webhook URL. Optional when the notifiable routes `"slack"` or
   * `config.slack.webhook` is set — the message value wins over both.
   */
  webhookUrl?: string;
  /** Fallback plain text (required by Slack even when blocks are present). */
  text: string;
  /** Optional Block Kit blocks for rich formatting. */
  blocks?: unknown[];
}

/**
 * Slack notification channel — POSTs a JSON payload to an incoming webhook URL.
 *
 * No npm dependencies — uses the global fetch API.
 *
 * Usage in a Notification:
 *   channels() { return ['slack']; }
 *   toSlack(_notifiable: Notifiable): SlackMessage {
 *     return { webhookUrl: 'https://hooks.slack.com/...', text: 'Hello!' };
 *   }
 */
export class SlackChannel {
  constructor(private readonly config: { webhook?: string } = {}) {}

  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const message = await notification.toSlack(notifiable);

    // Most specific wins: the message's own URL, then the recipient's route,
    // then the global webhook from config/notifications.ts.
    const webhookUrl =
      message.webhookUrl ?? notifiable.routeNotificationFor?.("slack") ?? this.config.webhook;

    if (!webhookUrl) {
      throw new NotificationChannelNotConfiguredError(
        "slack",
        `No webhook URL for ${notification.constructor.name}. Return one from toSlack(), ` +
          `route it on the notifiable, or set slack: { webhook: "..." } in config/notifications.ts.`,
      );
    }

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: message.text,
        ...(message.blocks ? { blocks: message.blocks } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new NotificationDeliveryError(
        `[Zerotal/notifications] Slack webhook returned ${res.status}: ${body}`,
      );
    }
  }
}
