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
}

export interface MailDriver {
  send(message: MailPayload): Promise<void>;
}
