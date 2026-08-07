import type { MailDriver, MailPayload } from "./MailDriver.ts";
import { NotificationDeliveryError } from "../errors.ts";

/**
 * Resend driver — sends via https://api.resend.com/emails. Zero npm dependencies
 * (native fetch). Get an API key at https://resend.com (free tier available).
 */
export class ResendDriver implements MailDriver {
  constructor(private _apiKey: string) {}

  async send(message: MailPayload): Promise<void> {
    const formatAddr = (a: { address: string; name?: string }) =>
      a.name ? `${a.name} <${a.address}>` : a.address;

    const body: Record<string, unknown> = {
      from: formatAddr(message.from),
      to: message.to.map(formatAddr),
      subject: message.subject,
    };

    if (message.cc?.length) body["cc"] = message.cc.map((a) => a.address);
    if (message.bcc?.length) body["bcc"] = message.bcc.map((a) => a.address);
    if (message.replyTo) body["reply_to"] = message.replyTo.address;
    if (message.html !== undefined) body["html"] = message.html;
    if (message.text !== undefined) body["text"] = message.text;
    if (message.attachments?.length) {
      body["attachments"] = message.attachments.map((a) => ({
        filename: a.filename,
        content:
          typeof a.content === "string"
            ? Buffer.from(a.content, "utf8").toString("base64")
            : Buffer.from(a.content).toString("base64"),
        ...(a.contentType ? { content_type: a.contentType } : {}),
        ...(a.cid ? { content_id: a.cid } : {}),
      }));
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this._apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "unknown error");
      throw new NotificationDeliveryError(
        `[Zerotal/notifications] Resend API error ${res.status}: ${err}`,
      );
    }
  }
}
