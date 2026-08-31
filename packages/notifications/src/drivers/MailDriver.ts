/**
 * Mail delivery layer for the notification system's `mail` channel.
 *
 * A `MailDriver` is the transport (log / SMTP / Resend). It receives a fully-resolved
 * `MailPayload` — the wire shape of one email — and delivers it. The fluent
 * {@link MailMessage} a notification returns from `toMail()` is rendered into this
 * payload by `MailChannel`, so drivers never deal with templates or notifiables.
 */

export interface MailAddress {
  address: string;
  name?: string;
}

export type AddressInput = string | MailAddress;

/** Normalise a string or object address to a `MailAddress`. */
export function resolveAddress(input: AddressInput): MailAddress {
  return typeof input === "string" ? { address: input } : input;
}

/** A file carried alongside the message body. */
export interface MailAttachment {
  /** Name the recipient sees. */
  filename: string;
  /** File bytes, or a string for text content. */
  content: string | Uint8Array;
  /** MIME type. Default: `application/octet-stream`. */
  contentType?: string;
  /**
   * Reference the part from the HTML body instead of listing it as a download.
   * Set `cid` too and use `<img src="cid:the-id">`.
   */
  inline?: boolean;
  /** Content-ID for an inline part, without the angle brackets. */
  cid?: string;
}

/**
 * Header names a driver builds itself, which a custom header may not set.
 *
 * Two reasons, and both are about a message that arrives wrong rather than one
 * that fails to send. `Content-Type`, `MIME-Version` and
 * `Content-Transfer-Encoding` describe the body a driver is assembling — a second
 * copy makes the structure ambiguous and clients disagree about which to believe.
 * The rest already have a dedicated method on {@link MailMessage}; setting one
 * here would duplicate the header rather than replace it, because the driver has
 * no way to know which was meant.
 *
 * Compared case-insensitively — header names are not case-sensitive, so
 * `content-type` has to be refused as readily as `Content-Type`.
 */
export const RESERVED_MAIL_HEADERS: readonly string[] = [
  "bcc",
  "cc",
  "content-transfer-encoding",
  "content-type",
  "date",
  "from",
  "message-id",
  "mime-version",
  "reply-to",
  "subject",
  "to",
];

/**
 * Custom headers, sanitised and checked against {@link RESERVED_MAIL_HEADERS}.
 *
 * @param headers - Header names to values, as written by the caller.
 * @returns The same headers with CR and LF removed from every value.
 * @throws When a name is reserved, or a name is not a legal header token.
 */
export function resolveHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const trimmed = name.trim();
    if (RESERVED_MAIL_HEADERS.includes(trimmed.toLowerCase())) {
      throw new Error(
        `[Zerotal/notifications] "${trimmed}" is set by the mail driver and cannot be ` +
          `passed as a custom header — it would be sent twice rather than replaced. ` +
          `Use the MailMessage method for it (.subject(), .from(), .to(), .cc(), .bcc(), ` +
          `.replyTo()) where there is one.`,
      );
    }
    // RFC 5322 field names are printable ASCII except colon. A name carrying a
    // colon, a space or a newline does not become a header — it becomes a way to
    // write the rest of the message.
    if (!/^[!-9;-~]+$/.test(trimmed)) {
      throw new Error(
        `[Zerotal/notifications] "${trimmed}" is not a valid header name — a header name is ` +
          `printable ASCII with no spaces, colons or line breaks.`,
      );
    }
    // CR/LF in a value ends the header and lets the remainder be read as further
    // headers. Stripped rather than refused: unlike the name, a value is often
    // built from content, and folding it to one line keeps the message intact.
    out[trimmed] = value.replace(/[\r\n]+/g, " ").trim();
  }
  return out;
}

/** The resolved, ready-to-send shape of a single email. */
export interface MailPayload {
  to: MailAddress[];
  from: MailAddress;
  subject: string;
  text?: string;
  html?: string;
  cc?: MailAddress[];
  bcc?: MailAddress[];
  replyTo?: MailAddress;
  attachments?: MailAttachment[];
  /**
   * Extra headers to put on the message, beyond the ones the driver builds.
   *
   * The reason this exists is `List-Unsubscribe`: Gmail and Yahoo draw their
   * native unsubscribe control beside the sender from that header, and there is
   * no way to ask for it other than sending it. A footer link is a different
   * thing in a different place, and bulk senders are required to send the header.
   *
   * Names in {@link RESERVED_MAIL_HEADERS} are refused — see there for why.
   *
   * @example
   * ```ts
   * new MailMessage()
   *   .subject("Your weekly digest")
   *   .header("List-Unsubscribe", `<https://app.test/unsubscribe/${token}>`)
   *   .header("List-Unsubscribe-Post", "List-Unsubscribe=One-Click");
   * ```
   */
  headers?: Record<string, string>;
}

export interface MailDriver {
  send(message: MailPayload): Promise<void>;
}
