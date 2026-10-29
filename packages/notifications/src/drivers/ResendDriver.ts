import type { MailDriver, MailPayload } from "./MailDriver.ts";
import { resolveHeaders, _assertPayloadAddresses, _formatMailbox } from "./MailDriver.ts";
import { NotificationDeliveryError } from "../errors.ts";

/**
 * Resend driver — sends via https://api.resend.com/emails. Zero npm dependencies
 * (native fetch). Get an API key at https://resend.com (free tier available).
 */
export class ResendDriver implements MailDriver {
  constructor(private _apiKey: string) {}

  async send(message: MailPayload): Promise<void> {
    // Checked before the request: a payload can reach a driver without being built
    // by MailMessage, and Resend reads a recipient string as a list, so an address
    // holding a comma would be delivered to every address in it.
    _assertPayloadAddresses(message);

    // Resend reads "Name <addr>" back apart, so a name written into it bare could
    // carry a comma and a bracketed address of its own and become a second
    // recipient. The name is quoted or encoded, as it is in an SMTP header.
    const body: Record<string, unknown> = {
      from: _formatMailbox(message.from),
      to: message.to.map(_formatMailbox),
      subject: message.subject,
    };

    if (message.cc?.length) body["cc"] = message.cc.map((a) => a.address);
    if (message.bcc?.length) body["bcc"] = message.bcc.map((a) => a.address);
    if (message.replyTo) body["reply_to"] = message.replyTo.address;
    // Resend takes custom headers as an object and sets the rest itself, so the
    // reserved names are refused here too rather than handed to the API to
    // silently drop or duplicate.
    if (message.headers && Object.keys(message.headers).length > 0) {
      body["headers"] = resolveHeaders(message.headers);
    }
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
