import { tryCurrentApp } from "@zerotal/core";
import {
  resolveAddress,
  type AddressInput,
  type MailAddress,
  type MailAttachment,
  type MailPayload,
} from "../drivers/MailDriver.ts";

/**
 * Make an action URL absolute.
 *
 * A browser resolves `/projects/4` against the page it is on. An email client
 * has no page, so a root-relative href in a delivered message is simply dead —
 * and this is the one place the base URL cannot be left to the caller, because
 * the caller is usually a queue job with no request to read an origin from.
 *
 * `config.app.url` is the origin the app already declares for exactly this.
 * Resolution happens at render rather than in `action()` so a message can still
 * be constructed outside an application — a unit test, or a driver being
 * exercised on its own — where it is returned untouched.
 *
 * Anything already absolute is left alone, `mailto:` and `tel:` included.
 */
function _absoluteUrl(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("//")) return url;

  const base = tryCurrentApp()?.container.tryMake("config")?.get<string>("app.url");
  if (!base) return url;

  try {
    return new URL(url, base).toString();
  } catch {
    // A base that is not a URL is a config error, not this message's problem.
    return url;
  }
}

/** Inline text styling applied to a whole line or to a single run within a line. */
export interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  /** Any CSS color, e.g. "#dc2626" or "red". */
  color?: string;
  /** Font size in pixels. */
  size?: number;
}

/** One styled run of text. */
interface TextSegment {
  text: string;
  style?: TextStyle;
}

/** A line is one or more styled runs rendered into a single paragraph. */
type Line = TextSegment[];

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Escape a value placed inside a double-quoted HTML attribute (prevents breakout). */
const escapeAttribute = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const styleToCss = (style?: TextStyle): string => {
  if (!style) return "";
  const css: string[] = [];
  if (style.bold) css.push("font-weight:600");
  if (style.italic) css.push("font-style:italic");
  if (style.color) css.push(`color:${style.color}`);
  if (style.size) css.push(`font-size:${style.size}px`);
  return css.join(";");
};

/**
 * Fluent builder for a single line composed of differently-styled runs of text.
 * Passed to the callback form of `MailMessage.line()`.
 *
 * @example
 * .line((t) => t
 *   .text("Your order ")
 *   .bold("#1234")
 *   .text(" is ")
 *   .color("on its way", "#16a34a"))
 */
export class RichLine {
  /** @internal Collected runs, read by MailMessage during rendering. */
  readonly segments: TextSegment[] = [];

  /** Append an unstyled run. */
  text(content: string): this {
    this.segments.push({ text: content });
    return this;
  }

  /** Append a bold run. */
  bold(content: string): this {
    this.segments.push({ text: content, style: { bold: true } });
    return this;
  }

  /** Append an italic run. */
  italic(content: string): this {
    this.segments.push({ text: content, style: { italic: true } });
    return this;
  }

  /** Append a coloured run. `color` is any CSS color. */
  color(content: string, color: string): this {
    this.segments.push({ text: content, style: { color } });
    return this;
  }

  /** Append a run with an explicit font size in pixels. */
  size(content: string, px: number): this {
    this.segments.push({ text: content, style: { size: px } });
    return this;
  }

  /** Append a run with an arbitrary combination of styles. */
  styled(content: string, style: TextStyle): this {
    this.segments.push({ text: content, style });
    return this;
  }
}

/**
 * The fluent representation a notification returns from `toMail()` — symmetric with
 * `toSms() → SmsMessage` and `toSlack() → SlackMessage`. Compose a branded email from
 * a greeting, lines, and an optional call-to-action button, or drop to `.html()` for a
 * fully custom body.
 *
 * Lines accept inline styling. Pass a `TextStyle` to style a whole line, or use the
 * callback form to mix differently-styled runs within one line.
 *
 * The recipient is normally the notifiable (its `email`), so you don't set `to()` —
 * `MailChannel` fills it in. Use `to()`/`cc()`/`bcc()`/`from()`/`replyTo()` only to
 * override.
 *
 * @example
 * toMail(n: Notifiable): MailMessage {
 *   return new MailMessage()
 *     .subject("Your order shipped")
 *     .greeting(`Hi ${n.name ?? "there"},`, { bold: true })
 *     .line("Your order is on its way.")
 *     .line("Action required", { bold: true, color: "#dc2626", size: 18 })
 *     .line((t) => t.text("Tracking number: ").bold(this.order.tracking))
 *     .action("Track package", `https://app.test/orders/${this.order.id}`)
 *     .line("Thanks for shopping with us!");
 * }
 */
export class MailMessage {
  private _subject = "";
  private _greeting?: Line;
  private _salutation?: Line;
  private _introLines: Line[] = [];
  private _outroLines: Line[] = [];
  private _actionText?: string;
  private _actionUrl?: string;
  private _html?: string;
  private _text?: string;
  private _to: MailAddress[] = [];
  private _cc: MailAddress[] = [];
  private _bcc: MailAddress[] = [];
  private _from?: MailAddress;
  private _replyTo?: MailAddress;
  private _attachments: MailAttachment[] = [];

  subject(text: string): this {
    this._subject = text;
    return this;
  }

  /**
   * Opening line, e.g. "Hi Ada,". Defaults to "Hello," when omitted. Accepts the same
   * styling forms as `line()`: a plain string, a string + `TextStyle`, or a `RichLine`
   * callback for mixed runs.
   */
  greeting(text: string): this;
  greeting(text: string, style: TextStyle): this;
  greeting(build: (t: RichLine) => void): this;
  greeting(arg: string | ((t: RichLine) => void), style?: TextStyle): this {
    this._greeting = this._toLine(arg, style);
    return this;
  }

  /**
   * Closing line, e.g. "Regards,". Defaults to "Regards,". Accepts the same styling
   * forms as `line()`.
   */
  salutation(text: string): this;
  salutation(text: string, style: TextStyle): this;
  salutation(build: (t: RichLine) => void): this;
  salutation(arg: string | ((t: RichLine) => void), style?: TextStyle): this {
    this._salutation = this._toLine(arg, style);
    return this;
  }

  /**
   * Add a paragraph. Lines before `action()` render above the button; lines after, below it.
   *
   * - Plain: `.line("Welcome aboard.")`
   * - Whole-line style: `.line("Heads up", { bold: true, color: "#dc2626", size: 18 })`
   * - Mixed runs: `.line((t) => t.text("Code: ").bold("AB12").color(" (expires soon)", "#6b7280"))`
   */
  line(text: string): this;
  line(text: string, style: TextStyle): this;
  line(build: (t: RichLine) => void): this;
  line(arg: string | ((t: RichLine) => void), style?: TextStyle): this {
    const segments = this._toLine(arg, style);
    if (this._actionText) this._outroLines.push(segments);
    else this._introLines.push(segments);
    return this;
  }

  /** A call-to-action button. At most one per message. */
  action(text: string, url: string): this {
    this._actionText = text;
    this._actionUrl = url;
    return this;
  }

  /** Provide a fully custom HTML body, bypassing the greeting/line/action template. */
  html(content: string): this {
    this._html = content;
    return this;
  }

  /** Provide an explicit plain-text body (otherwise one is derived from the lines). */
  text(content: string): this {
    this._text = content;
    return this;
  }

  to(address: AddressInput | AddressInput[]): this {
    return this._push(this._to, address);
  }

  cc(address: AddressInput | AddressInput[]): this {
    return this._push(this._cc, address);
  }

  bcc(address: AddressInput | AddressInput[]): this {
    return this._push(this._bcc, address);
  }

  from(address: AddressInput): this {
    this._from = resolveAddress(address);
    return this;
  }

  replyTo(address: AddressInput): this {
    this._replyTo = resolveAddress(address);
    return this;
  }

  /**
   * Attach a file to the message.
   *
   * @example
   * .attach({ filename: "invoice.pdf", content: pdfBytes, contentType: "application/pdf" })
   */
  attach(attachment: MailAttachment): this {
    this._attachments.push(attachment);
    return this;
  }

  /**
   * Attach a file read from disk. Reads the bytes when called, so the message is
   * self-contained by the time a driver sends it.
   *
   * @example
   * await new MailMessage().subject("Your invoice").attachFile("./storage/invoice.pdf");
   */
  async attachFile(path: string, options: { filename?: string; contentType?: string } = {}) {
    const file = Bun.file(path);
    return this.attach({
      filename: options.filename ?? path.split(/[\\/]/).pop() ?? "attachment",
      content: new Uint8Array(await file.arrayBuffer()),
      contentType: options.contentType ?? file.type ?? "application/octet-stream",
    });
  }

  /**
   * Embed an image referenced from the HTML body as `<img src="cid:the-id">`,
   * rather than listing it as a download.
   */
  embed(cid: string, attachment: Omit<MailAttachment, "cid" | "inline">): this {
    return this.attach({ ...attachment, cid, inline: true });
  }

  private _push(target: MailAddress[], address: AddressInput | AddressInput[]): this {
    const arr = Array.isArray(address) ? address : [address];
    target.push(...arr.map(resolveAddress));
    return this;
  }

  private _toLine(arg: string | ((t: RichLine) => void), style?: TextStyle): Line {
    if (typeof arg === "function") {
      const rich = new RichLine();
      arg(rich);
      return rich.segments;
    }
    return [{ text: arg, ...(style ? { style } : {}) }];
  }

  /**
   * Resolve to the wire payload a driver sends. `defaultFrom` and `fallbackTo` come from
   * MailChannel (config default sender + the notifiable's address).
   */
  toPayload(defaultFrom: MailAddress, fallbackTo: MailAddress[]): MailPayload {
    const html = this._html ?? this._renderHtml();
    const text = this._text ?? this._renderText();
    return {
      to: this._to.length > 0 ? this._to : fallbackTo,
      from: this._from ?? defaultFrom,
      subject: this._subject,
      ...(html ? { html } : {}),
      ...(text ? { text } : {}),
      ...(this._cc.length > 0 ? { cc: this._cc } : {}),
      ...(this._bcc.length > 0 ? { bcc: this._bcc } : {}),
      ...(this._replyTo ? { replyTo: this._replyTo } : {}),
      ...(this._attachments.length > 0 ? { attachments: this._attachments } : {}),
    };
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private _renderHtml(): string {
    const parts: string[] = [];
    parts.push(this._paragraph(this._greeting ?? [{ text: "Hello," }]));
    for (const l of this._introLines) parts.push(this._paragraph(l));
    if (this._actionText && this._actionUrl) {
      parts.push(
        `<p style="margin:24px 0"><a href="${escapeHtml(_absoluteUrl(this._actionUrl))}" ` +
          `style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;` +
          `padding:12px 20px;border-radius:8px;font-size:14px;font-weight:600">${escapeHtml(this._actionText)}</a></p>`,
      );
    }
    for (const l of this._outroLines) parts.push(this._paragraph(l));
    parts.push(this._paragraph(this._salutation ?? [{ text: "Regards," }]));

    return (
      `<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:` +
      `-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${parts.join("")}</div>`
    );
  }

  private _paragraph(line: Line): string {
    const inner = line.map((seg) => this._span(seg)).join("");
    return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151">${inner}</p>`;
  }

  private _span(seg: TextSegment): string {
    const text = escapeHtml(seg.text);
    const css = styleToCss(seg.style);
    return css ? `<span style="${escapeAttribute(css)}">${text}</span>` : text;
  }

  private _renderText(): string {
    const parts: string[] = [this._lineText(this._greeting ?? [{ text: "Hello," }])];
    for (const l of this._introLines) parts.push(this._lineText(l));
    if (this._actionText && this._actionUrl)
      parts.push(`${this._actionText}: ${_absoluteUrl(this._actionUrl)}`);
    for (const l of this._outroLines) parts.push(this._lineText(l));
    parts.push(this._lineText(this._salutation ?? [{ text: "Regards," }]));
    return parts.join("\n\n");
  }

  private _lineText(line: Line): string {
    return line.map((seg) => seg.text).join("");
  }
}
