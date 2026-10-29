/**
 * Mail delivery layer for the notification system's `mail` channel.
 *
 * A `MailDriver` is the transport (log / SMTP / Resend). It receives a fully-resolved
 * `MailPayload` — the wire shape of one email — and delivers it. The fluent
 * {@link MailMessage} a notification returns from `toMail()` is rendered into this
 * payload by `MailChannel`, so drivers never deal with templates or notifiables.
 */

import { InvalidMailAddressError } from "../errors.ts";

export interface MailAddress {
  address: string;
  name?: string;
}

export type AddressInput = string | MailAddress;

/**
 * Every control character (C0, DEL and C1, so NEL too) and the Unicode line and
 * paragraph separators. Some reader of an address or a display name — a mail
 * server, a log viewer, a JSON consumer — takes each of these as the end of a line.
 */
// eslint-disable-next-line no-control-regex -- control characters are what this looks for
const LINE_BREAKING = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;

/** RFC 5321's limit on a forward or reverse path, less the two angle brackets. */
const MAX_ADDRESS_LENGTH = 254;

/**
 * Refuse an address that could not be written into a mail envelope as one address.
 *
 * SMTP sends each address as the argument of a command — `MAIL FROM:<…>`,
 * `RCPT TO:<…>` — so a CR or LF in one ends that command and starts another, and
 * whitespace or an angle bracket closes the argument early. An API driver takes a
 * recipient as a string that may be a list, so a comma or semicolon makes one
 * address two. Display names and header values can be folded to a single line and
 * still mean what was written; an address cannot, so it is refused rather than
 * cleaned.
 *
 * Only those characters are refused. A second `@` is left alone, since an RFC 5321
 * quoted local part may contain one, and the mail server stays the judge of
 * whether an address exists.
 *
 * @param address - The bare address, without a display name or angle brackets.
 * @throws {InvalidMailAddressError} When the address is not a string, or contains a
 *   control character (`\x00`–`\x1f`, `\x7f`–`\x9f`), a Unicode line or paragraph
 *   separator, whitespace, `<`, `>`, `,` or `;`, or is longer than 254 characters.
 *
 * @example
 * ```ts
 * assertMailAddress("ada@example.com"); // returns
 * assertMailAddress("ada@example.com\r\nRSET"); // throws InvalidMailAddressError
 * ```
 */
export function assertMailAddress(address: unknown): asserts address is string {
  if (typeof address !== "string") {
    throw new InvalidMailAddressError(address, "it is not a string");
  }
  if (LINE_BREAKING.test(address)) {
    throw new InvalidMailAddressError(address, "it contains a control character");
  }
  if (/\s/.test(address)) {
    throw new InvalidMailAddressError(address, "it contains whitespace");
  }
  if (/[<>]/.test(address)) {
    throw new InvalidMailAddressError(address, "it contains '<' or '>'");
  }
  if (/[,;]/.test(address)) {
    throw new InvalidMailAddressError(
      address,
      "it contains ',' or ';', which would make it a list",
    );
  }
  if (address.length > MAX_ADDRESS_LENGTH) {
    throw new InvalidMailAddressError(
      address.slice(0, 64) + "…",
      `it is longer than ${MAX_ADDRESS_LENGTH} characters`,
    );
  }
}

/**
 * `Display Name <local@domain>`: an optional quoted or unquoted name, then one
 * non-empty address in angle brackets, with only spaces and tabs around them. The
 * name may not hold `<`, `>` or a `"` of its own, quoted or not: a string holding a
 * second bracket or quote can be split more than one way, and the split this makes
 * need not be the one the writer meant. A name with those characters in it can
 * still be sent, as the `name` of an object, which is never split.
 */
const DISPLAY_FORM = /^[ \t]*(?:"([^"<>]*)"|([^"<>]*?))[ \t]*<([^<>]+)>[ \t]*$/;

/**
 * Normalise a string or object address to a `MailAddress`.
 *
 * Accepts a bare address, or one written with its display name as
 * `Display Name <local@domain>` (the name may be quoted). The display form is split
 * into `{ name, address }`, and the address alone is then checked with
 * {@link assertMailAddress}. The same applies to the `address` of an object, so a
 * configured sender or a notifiable's `email` may be written either way; a name
 * written inside the address takes the place of the object's own `name`.
 *
 * Every display name is checked too, the object's own `name` as much as one written
 * into the address: it usually comes from user data — a profile name on the
 * notifiable — and a line break in it is refused like one in the address. Any
 * other character is allowed in an object's `name`, quotes and angle brackets
 * included, because the drivers write a name as one quoted or encoded word.
 *
 * @throws {InvalidMailAddressError} When the address fails {@link assertMailAddress},
 *   a display name is not a string or contains a control character or a Unicode
 *   line or paragraph separator, or the value holds `<` or `>` without being exactly
 *   the display form.
 *
 * @example
 * ```ts
 * resolveAddress("ada@example.com"); // { address: "ada@example.com" }
 * resolveAddress("Ada Lovelace <ada@example.com>"); // { name: "Ada Lovelace", address: "ada@example.com" }
 * ```
 */
export function resolveAddress(input: AddressInput): MailAddress {
  const resolved = typeof input === "string" ? { address: input } : input;
  const raw: unknown = resolved.address;
  const ownName: unknown = typeof input === "string" ? undefined : input.name;
  const match = typeof raw === "string" ? DISPLAY_FORM.exec(raw) : null;
  if (!match) {
    assertMailAddress(raw);
    _assertDisplayName(ownName, raw);
    return resolved;
  }

  const address = match[3] ?? "";
  const written = match[1] ?? match[2] ?? "";
  // Checked before trimming, so a break at either end is refused too.
  _assertDisplayName(written, raw);
  assertMailAddress(address);
  _assertDisplayName(ownName, address);
  const name = written.trim();
  const fallbackName = typeof input === "string" ? undefined : input.name;
  const finalName = name !== "" ? name : fallbackName;
  return finalName !== undefined ? { address, name: finalName } : { address };
}

/**
 * Refuse a display name that is not a string or holds a line-breaking character.
 *
 * A name is written into a header, a log line and a provider's JSON. The drivers
 * quote or encode it, so `"`, `\`, `<`, `>` and `,` are harmless there; a line
 * break is not, in a log line or a reader that unfolds headers, so it is refused
 * wherever the name came from. `undefined` and `null` mean no name.
 *
 * @param name - The display name, as given.
 * @param address - What to quote in the error. The name itself is left out of it.
 * @internal
 */
export function _assertDisplayName(name: unknown, address: unknown): void {
  if (name === undefined || name === null) return;
  if (typeof name !== "string") {
    throw new InvalidMailAddressError(address, "its display name is not a string");
  }
  if (LINE_BREAKING.test(name)) {
    throw new InvalidMailAddressError(address, "its display name contains a control character");
  }
}

/**
 * One RFC 2047 encoded-word, UTF-8 and base64: `=?UTF-8?B?…?=`.
 *
 * Header text is 7-bit. A name or subject outside printable ASCII is sent in this
 * form and decoded by the mail client, and since the result is ASCII letters,
 * digits and `+/=?`, nothing in the original — a quote, a bracket, a comma, a line
 * break — survives to be read as header syntax.
 *
 * @internal
 */
export function _encodeWord(text: string): string {
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

/** Bytes of UTF-8 per encoded-word: 45 bytes is 60 base64 characters, 72 with the wrapper. */
const ENCODED_WORD_BYTES = 45;

/**
 * Write a display name so that nothing in it can be read as header syntax.
 *
 * A name in printable ASCII becomes an RFC 5322 quoted-string, with `\` and `"`
 * escaped as quoted-pairs, so a trailing backslash cannot escape the closing quote
 * and a comma or `<addr>` inside stays part of the name. Anything else becomes a
 * run of RFC 2047 encoded-words, each kept within the 75-character limit and cut on
 * a code-point boundary, separated by spaces that a decoder drops.
 *
 * @internal
 */
export function _formatDisplayName(name: string): string {
  if (/^[\x20-\x7e]*$/.test(name)) return `"${name.replace(/[\\"]/g, "\\$&")}"`;
  const words: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of name) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > ENCODED_WORD_BYTES && current !== "") {
      words.push(_encodeWord(current));
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  if (current !== "") words.push(_encodeWord(current));
  return words.join(" ");
}

/**
 * Write one mailbox as `"Name" <address>`, or the bare address when it has no name.
 *
 * Both the SMTP header and Resend's `"Name <addr>"` strings are built here, so a
 * name holding `x <spy@example.com>, y` names one recipient in both rather than
 * adding a second.
 *
 * @internal
 */
export function _formatMailbox(mailbox: MailAddress): string {
  const name = typeof mailbox.name === "string" ? mailbox.name.trim() : "";
  return name !== "" ? `${_formatDisplayName(name)} <${mailbox.address}>` : mailbox.address;
}

/**
 * Check every address on a payload, and its display name: sender, recipients and
 * reply-to.
 *
 * Runs when `MailMessage` builds the payload and again in the SMTP and Resend
 * drivers before they send, because a payload can reach a driver without passing through `resolveAddress` — the mail
 * channel's fallback recipient is the notifiable's own `email`, and a custom
 * channel or job can hand a driver a payload it built or deserialised itself.
 *
 * @internal
 */
export function _assertPayloadAddresses(payload: MailPayload): void {
  const check = (mailbox: MailAddress | undefined): void => {
    assertMailAddress(mailbox?.address);
    _assertDisplayName(mailbox?.name, mailbox?.address);
  };
  check(payload.from);
  for (const list of [payload.to, payload.cc, payload.bcc]) {
    for (const entry of list ?? []) check(entry);
  }
  if (payload.replyTo) check(payload.replyTo);
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
