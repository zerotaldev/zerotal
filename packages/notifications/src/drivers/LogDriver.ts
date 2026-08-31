import type { MailDriver, MailPayload } from "./MailDriver.ts";

/**
 * Log driver — writes email content to the console or a log file. The safe default
 * for development and tests; no email is actually sent.
 */
export class LogDriver implements MailDriver {
  constructor(private _channel: "console" | string = "console") {}

  async send(message: MailPayload): Promise<void> {
    const lines = [
      "────────────────────────────────────",
      `[Mail] ${new Date().toISOString()}`,
      `To:      ${message.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ")}`,
      `From:    ${message.from.name ? `${message.from.name} <${message.from.address}>` : message.from.address}`,
      `Subject: ${message.subject}`,
      ...(message.cc?.length ? [`CC:      ${message.cc.map((a) => a.address).join(", ")}`] : []),
      // Printed because the reason to set one is that a mail client does
      // something with it, and the log driver is where that gets checked before
      // anything is sent for real.
      ...Object.entries(message.headers ?? {}).map(([n, v]) => `${n}: ${v}`),
      ...(message.attachments?.length
        ? [
            `Files:   ${message.attachments
              .map((a) => `${a.filename}${a.inline ? " (inline)" : ""}`)
              .join(", ")}`,
          ]
        : []),
      "",
      ...(message.text ? [`[Text]\n${message.text}`] : []),
      ...(message.html ? [`[HTML]\n${message.html}`] : []),
      "────────────────────────────────────",
    ].join("\n");

    if (this._channel === "console") {
      console.log(lines);
      return;
    }

    const existing = await Bun.file(this._channel)
      .text()
      .catch(() => "");
    await Bun.write(this._channel, existing + lines + "\n");
  }
}
