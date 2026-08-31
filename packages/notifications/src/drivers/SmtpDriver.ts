import type { MailDriver, MailPayload, MailAddress } from "./MailDriver.ts";
import { resolveHeaders } from "./MailDriver.ts";
import { SmtpResponseError, SmtpConnectionError } from "../errors.ts";

/** How long to wait for any single SMTP reply before giving up. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * SMTP driver — raw TCP via `Bun.connect()`, with TLS.
 *
 * Three transport modes, chosen by `secure` and what the server advertises:
 *
 * - `secure: true` — implicit TLS from the first byte (SMTPS, usually port 465).
 * - `secure: false` on a server advertising STARTTLS — connects in the clear,
 *   then upgrades before authenticating (submission, usually port 587).
 * - `secure: false` on a server without STARTTLS — stays plaintext. Credentials
 *   are refused in this mode unless `allowInsecureAuth` is set, because `AUTH
 *   LOGIN` is base64, not encryption.
 *
 * Every reply is parsed and its status code checked, so a rejected recipient or a
 * failed authentication raises {@link SmtpResponseError} instead of being
 * mistaken for a successful send.
 *
 * Certificate verification is enforced here rather than by the runtime. Bun does
 * not honour `rejectUnauthorized` on either `Bun.connect()` or `upgradeTLS()` — it
 * reports the peer as authorized and puts the real reason beside it — so both
 * transports check the handshake result themselves and fail closed. See
 * `_certificateFailure`.
 */
export class SmtpDriver implements MailDriver {
  constructor(
    private _host: string,
    private _port: number,
    private _username: string,
    private _password: string,
    private _secure: boolean = false,
    private _options: {
      /** Permit AUTH over an unencrypted connection. Off by default. */
      allowInsecureAuth?: boolean;
      /** Reject servers presenting an untrusted certificate. Default: true. */
      rejectUnauthorized?: boolean;
      /** Per-reply timeout in milliseconds. Default: 30000. */
      timeoutMs?: number;
      /** Name sent in EHLO. Default: "zerotal". */
      clientName?: string;
    } = {},
  ) {}

  async send(message: MailPayload): Promise<void> {
    const conn = await SmtpConnection.open(this._host, this._port, {
      tls: this._secure,
      rejectUnauthorized: this._options.rejectUnauthorized ?? true,
      timeoutMs: this._options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    try {
      await conn.expect(220);

      const clientName = this._options.clientName ?? "zerotal";
      let capabilities = await this._ehlo(conn, clientName);

      // Upgrade an unencrypted submission connection before anything sensitive.
      if (!this._secure && capabilities.includes("STARTTLS")) {
        conn.send("STARTTLS");
        await conn.expect(220);
        await conn.upgradeTLS(this._host, this._options.rejectUnauthorized ?? true);
        capabilities = await this._ehlo(conn, clientName);
      }

      if (this._username && this._password) {
        if (!conn.encrypted && !this._options.allowInsecureAuth) {
          throw new SmtpConnectionError(
            `Refusing to send SMTP credentials over an unencrypted connection to ${this._host}:${this._port}. ` +
              `Use secure: true (port 465), a server offering STARTTLS (port 587), or set ` +
              `mail.smtp.allowInsecureAuth to accept the risk.`,
          );
        }
        await this._authenticate(conn, capabilities);
      }

      conn.send(`MAIL FROM:<${message.from.address}>`);
      await conn.expect(250);

      const recipients = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])];
      if (recipients.length === 0) {
        throw new SmtpConnectionError("Refusing to send a message with no recipients.");
      }
      for (const rcpt of recipients) {
        conn.send(`RCPT TO:<${rcpt.address}>`);
        // 251 = "not local, will forward" — a success.
        await conn.expect(250, 251);
      }

      conn.send("DATA");
      await conn.expect(354);

      conn.write(`${buildRawMessage(message)}\r\n.\r\n`);
      await conn.expect(250);

      conn.send("QUIT");
      // A server that drops the connection instead of replying 221 has still
      // accepted the message — the 250 above was the commit point.
      await conn.expect(221).catch(() => undefined);
    } finally {
      conn.close();
    }
  }

  /** Send EHLO and return the advertised capability lines, uppercased. */
  private async _ehlo(conn: SmtpConnection, clientName: string): Promise<string[]> {
    conn.send(`EHLO ${clientName}`);
    const reply = await conn.expect(250);
    return reply.lines.map((l) => l.slice(4).toUpperCase());
  }

  private async _authenticate(conn: SmtpConnection, capabilities: string[]): Promise<void> {
    const authLine = capabilities.find((c) => c.startsWith("AUTH"));
    const mechanisms = authLine ? authLine.split(/\s+/).slice(1) : [];

    // PLAIN is a single round trip; LOGIN is the fallback for servers without it.
    if (mechanisms.length === 0 || mechanisms.includes("PLAIN")) {
      const token = btoa(`\0${this._username}\0${this._password}`);
      conn.send(`AUTH PLAIN ${token}`);
      await conn.expect(235);
      return;
    }

    if (mechanisms.includes("LOGIN")) {
      conn.send("AUTH LOGIN");
      await conn.expect(334);
      conn.send(btoa(this._username));
      await conn.expect(334);
      conn.send(btoa(this._password));
      await conn.expect(235);
      return;
    }

    throw new SmtpConnectionError(
      `No supported SMTP auth mechanism. Server offers: ${mechanisms.join(", ") || "none"}; ` +
        `this driver supports PLAIN and LOGIN.`,
    );
  }
}

/** One parsed SMTP reply: its status code and every line of it. */
interface SmtpReply {
  code: number;
  lines: string[];
  text: string;
}

/**
 * Whether a completed handshake should be treated as a failure.
 *
 * **`rejectUnauthorized` is not enforced by the runtime.** Bun reports
 * `authorized: true` for a self-signed certificate whether the flag is on or off,
 * on `Bun.connect()` and on `upgradeTLS()` alike, and hands back the real reason in
 * `authorizationError` beside it. Trusting the flag made TLS decorative on both
 * paths: the connection was encrypted and would have accepted that encryption from
 * anyone in the network path, which is the property TLS exists to provide.
 *
 * So the error is the signal and the flag is not. Verification is the framework's
 * to enforce, and it fails closed.
 *
 * @param authorized - What the runtime claims about the peer.
 * @param authorizationError - Why it would not have been authorized, if anything.
 * @param rejectUnauthorized - Whether this connection asked for verification.
 * @returns The error to fail with, or `undefined` to accept the peer.
 */
function _certificateFailure(
  authorized: boolean,
  authorizationError: Error | null | undefined,
  rejectUnauthorized: boolean,
): Error | undefined {
  if (!rejectUnauthorized) return undefined;
  if (authorized && !authorizationError) return undefined;
  return authorizationError ?? new Error("the server's certificate could not be verified");
}

/**
 * A single SMTP session — owns the socket, buffers incoming bytes, and hands
 * back one complete reply at a time.
 *
 * SMTP replies are not one-per-packet: a multi-line greeting arrives as
 * `250-SIZE\r\n250-STARTTLS\r\n250 HELP\r\n`, possibly split across TCP reads or
 * coalesced with the next reply. Reading is therefore driven by the protocol's
 * own framing — a reply ends at the first line whose code is followed by a space
 * rather than a hyphen — not by packet boundaries.
 *
 * Exported for its tests only. The transport rules it enforces — a superseded
 * socket is not this session's, a reply is framed by the protocol and not by
 * packet boundaries — cannot be reached through `SmtpDriver.send()` without a
 * STARTTLS-capable peer, and Bun cannot be one: server-side TLS upgrade is not
 * supported, so no in-process fake can complete the handshake.
 *
 * @internal
 */
export class SmtpConnection {
  private _buffer = "";
  private _replies: SmtpReply[] = [];
  private _waiters: Array<{
    resolve: (r: SmtpReply) => void;
    reject: (e: Error) => void;
  }> = [];
  private _failure: Error | undefined;
  private _closed = false;
  private _encrypted: boolean;

  /**
   * Which set of socket callbacks is the live one.
   *
   * `upgradeTLS()` does not detach the plaintext socket: its handlers go on
   * firing, and what they deliver from then on is the *undecrypted* TLS stream —
   * handshake records and ciphertext. Feeding that to `_onData` put binary in the
   * middle of the reply buffer, so the `250` after STARTTLS was never parsed and
   * every send died on the read timeout, with the server logging a connection
   * lost after STARTTLS. `close` and `error` were worse: the superseded socket
   * ending marked the live connection closed and rejected whatever was waiting on
   * it.
   *
   * Each set of callbacks captures the generation it was installed for, and an
   * upgrade bumps it. Anything from an older generation is somebody else's
   * stream. Identity comparison against the current socket would nearly work,
   * but a counter cannot be fooled by a runtime that hands the same object back.
   */
  private _generation = 0;

  private constructor(
    private _socket: import("bun").Socket<undefined>,
    private readonly _host: string,
    private readonly _port: number,
    private readonly _timeoutMs: number,
    encrypted: boolean,
  ) {
    this._encrypted = encrypted;
  }

  /** True once the transport is TLS, whether implicit or upgraded. */
  get encrypted(): boolean {
    return this._encrypted;
  }

  static async open(
    host: string,
    port: number,
    options: { tls: boolean; rejectUnauthorized: boolean; timeoutMs: number },
  ): Promise<SmtpConnection> {
    // The session, once there is one. A box rather than a bare `let`, because the
    // socket callbacks below are installed before it exists and have to see it
    // appear — `Bun.connect()` resolves after the socket is open, so the server's
    // 220 greeting can beat the `await` that produces it.
    const session: { conn?: SmtpConnection } = {};

    // Bytes that arrive in that window. Dropping the greeting deadlocks the session
    // on its own first read.
    const early: Uint8Array[] = [];

    let settle: (error?: Error) => void = () => {};
    const verified = options.tls
      ? new Promise<void>((resolve, reject) => {
          settle = (error) => (error ? reject(error) : resolve());
        })
      : undefined;

    let socket: import("bun").Socket<undefined>;
    try {
      socket = await Bun.connect<undefined>({
        hostname: host,
        port,
        ...(options.tls
          ? { tls: { rejectUnauthorized: options.rejectUnauthorized, serverName: host } }
          : {}),
        socket: {
          // Generation 0: the connection as opened. An upgrade supersedes it.
          data: (_s, data) => {
            if (session.conn) session.conn._onData(data, 0);
            else early.push(data);
          },
          error: (_s, err) => {
            settle(err);
            session.conn?._onError(err, 0);
          },
          close: () => {
            settle(new Error("the server closed the connection during the TLS handshake"));
            session.conn?._onClose(0);
          },
          handshake: (_s, authorized, authorizationError) =>
            settle(_certificateFailure(authorized, authorizationError, options.rejectUnauthorized)),
          open: () => {},
        },
      });
    } catch (error) {
      throw new SmtpConnectionError(
        `Could not connect to SMTP server ${host}:${port} — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const conn = new SmtpConnection(socket, host, port, options.timeoutMs, options.tls);
    session.conn = conn;
    for (const chunk of early) conn._onData(chunk, 0);

    // Implicit TLS (465) verifies here, for the same reason STARTTLS verifies in
    // `upgradeTLS`: `rejectUnauthorized` is not enforced by the runtime, so a
    // connection that asked for a verified certificate has to check that it got one.
    if (verified) {
      try {
        await conn._withTimeout(verified, `completing the TLS handshake with ${host}`);
      } catch (error) {
        conn.close();
        throw new SmtpConnectionError(
          `TLS connection to ${host}:${port} failed — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return conn;
  }

  /**
   * Upgrade a plaintext connection to TLS after a 220 response to STARTTLS.
   *
   * Resolves once the handshake has actually completed, and that is the whole
   * point of it being async. `upgradeTLS()` returns the new socket immediately,
   * while the handshake is still in flight, and **a write issued in that window is
   * dropped** — not buffered and flushed, not an error, just gone. The `EHLO` that
   * has to follow STARTTLS was written into that gap, so the server sat waiting
   * for a command that was never sent while the client sat waiting for a reply
   * that was never coming, until the read timed out thirty seconds later.
   *
   * What made it expensive to place is that everything either side looks right.
   * The handshake completes; the server logs a healthy TLS session and then a
   * connection lost. Port 465 is unaffected, because implicit TLS finishes its
   * handshake before `Bun.connect()` resolves and there is no window to write
   * into. So mail worked, on the port that is not the one every provider
   * documents, and configuring the documented 587 produced silence — no error, no
   * bounce, no log line, just password resets that never arrived.
   *
   * @param host - Hostname, used as the TLS server name.
   * @param rejectUnauthorized - Refuse a certificate that does not verify.
   * @throws {@link SmtpConnectionError} When the upgrade or the handshake fails.
   */
  async upgradeTLS(host: string, rejectUnauthorized: boolean): Promise<void> {
    try {
      // Bumped before the call, so the plaintext socket's callbacks are already
      // stale by the time the handshake can deliver its first record.
      const generation = ++this._generation;

      let settle!: (error?: Error) => void;
      const handshake = new Promise<void>((resolve, reject) => {
        settle = (error) => (error ? reject(error) : resolve());
      });

      const [, tls] = this._socket.upgradeTLS<undefined>({
        tls: { rejectUnauthorized, serverName: host },
        socket: {
          data: (_s, data) => this._onData(data, generation),
          error: (_s, err) => {
            settle(err);
            this._onError(err, generation);
          },
          close: () => {
            settle(new Error("the server closed the connection during the TLS handshake"));
            this._onClose(generation);
          },
          handshake: (_s, authorized, authorizationError) =>
            settle(_certificateFailure(authorized, authorizationError, rejectUnauthorized)),
          open: () => {},
        },
      });
      this._socket = tls;
      this._encrypted = true;
      // The post-upgrade session starts clean: anything buffered pre-handshake
      // belongs to the discarded plaintext stream.
      this._buffer = "";
      this._replies = [];

      await this._withTimeout(handshake, `completing the TLS handshake with ${host}`);
    } catch (error) {
      throw new SmtpConnectionError(
        `STARTTLS upgrade failed for ${host} — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Reject `work` if it has not settled within the session's reply timeout.
   *
   * A handshake that never completes and never errors is a hang with no reply to
   * time out on, so the read timeout that covers every other step does not cover
   * this one.
   *
   * @param work - The promise to bound.
   * @param what - Named in the timeout message.
   */
  private async _withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${this._timeoutMs}ms ${what}`)),
            this._timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Write a command plus its CRLF terminator. */
  send(command: string): void {
    this.write(`${command}\r\n`);
  }

  write(raw: string): void {
    this._socket.write(new TextEncoder().encode(raw));
  }

  /**
   * Read the next reply and require its code to be one of `codes`.
   *
   * @throws {SmtpResponseError} when the server answers with anything else.
   */
  async expect(...codes: number[]): Promise<SmtpReply> {
    const reply = await this.read();
    if (!codes.includes(reply.code)) {
      throw new SmtpResponseError(reply.code, reply.text, codes);
    }
    return reply;
  }

  /** Read the next complete reply, waiting for it if it has not arrived. */
  read(): Promise<SmtpReply> {
    const buffered = this._replies.shift();
    if (buffered) return Promise.resolve(buffered);
    if (this._failure) return Promise.reject(this._failure);
    if (this._closed) {
      return Promise.reject(
        new SmtpConnectionError(
          `SMTP server ${this._host}:${this._port} closed the connection unexpectedly.`,
        ),
      );
    }

    return new Promise<SmtpReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._waiters = this._waiters.filter((w) => w.resolve !== wrapped);
        reject(
          new SmtpConnectionError(
            `Timed out after ${this._timeoutMs}ms waiting for a reply from ${this._host}:${this._port}.`,
          ),
        );
      }, this._timeoutMs);

      const wrapped = (reply: SmtpReply): void => {
        clearTimeout(timer);
        resolve(reply);
      };
      this._waiters.push({
        resolve: wrapped,
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    try {
      this._socket.end();
    } catch {
      /* already gone */
    }
  }

  private _onData(data: Uint8Array, generation: number): void {
    if (generation !== this._generation) return; // ciphertext from a superseded socket
    this._buffer += new TextDecoder().decode(data);
    this._parse();
  }

  /** Split the buffer into complete replies, leaving any partial tail behind. */
  private _parse(): void {
    for (;;) {
      let cursor = 0;
      let end = -1;

      for (;;) {
        const nl = this._buffer.indexOf("\n", cursor);
        if (nl === -1) break;
        const line = this._buffer.slice(cursor, nl).replace(/\r$/, "");
        // `250 ` terminates; `250-` continues. A bare code is also terminal.
        if (/^\d{3}(?: |$)/.test(line)) {
          end = nl;
          break;
        }
        cursor = nl + 1;
      }

      if (end === -1) return;

      const raw = this._buffer.slice(0, end).replace(/\r$/, "");
      this._buffer = this._buffer.slice(end + 1);

      const lines = raw.split("\n").map((l) => l.replace(/\r$/, ""));
      const last = lines[lines.length - 1] ?? "";
      const reply: SmtpReply = {
        code: Number.parseInt(last.slice(0, 3), 10),
        lines,
        text: lines
          .map((l) => l.slice(4))
          .join(" ")
          .trim(),
      };

      const waiter = this._waiters.shift();
      if (waiter) waiter.resolve(reply);
      else this._replies.push(reply);
    }
  }

  private _onError(error: Error, generation: number): void {
    if (generation !== this._generation) return;
    this._failure = new SmtpConnectionError(
      `SMTP socket error on ${this._host}:${this._port} — ${error.message}`,
    );
    this._rejectAll(this._failure);
  }

  private _onClose(generation: number): void {
    // The plaintext socket ends as a matter of course once TLS takes over, and
    // treating that as the connection dropping killed the session that replaced it.
    if (generation !== this._generation) return;
    this._closed = true;
    if (this._waiters.length > 0) {
      this._rejectAll(
        new SmtpConnectionError(
          `SMTP server ${this._host}:${this._port} closed the connection unexpectedly.`,
        ),
      );
    }
  }

  private _rejectAll(error: Error): void {
    const waiters = this._waiters;
    this._waiters = [];
    for (const w of waiters) w.reject(error);
  }
}

/**
 * Strip CR and LF from a header value.
 *
 * A subject or display name is attacker-influenced often enough to matter: left
 * raw, an embedded CRLF ends the header and lets the rest of the string be read
 * as new headers (a `Bcc:` of the sender's choosing, or a second body).
 */
function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Encode a header value as RFC 2047 base64 when it contains non-ASCII.
 * Headers are 7-bit; a raw UTF-8 subject arrives mangled otherwise.
 */
function encodeHeaderValue(value: string): string {
  const clean = sanitizeHeader(value);
  // eslint-disable-next-line no-control-regex -- matching non-ASCII by definition
  if (!/[^\x00-\x7F]/.test(clean)) return clean;
  const base64 = Buffer.from(clean, "utf8").toString("base64");
  return `=?UTF-8?B?${base64}?=`;
}

function formatAddr(a: MailAddress): string {
  const address = sanitizeHeader(a.address);
  return a.name ? `"${encodeHeaderValue(a.name).replace(/"/g, "")}" <${address}>` : address;
}

/**
 * Escape a line beginning with a period.
 *
 * A bare `.` on its own line ends the DATA block, so any body line starting with
 * one is doubled on the wire and halved again by the receiver (RFC 5321 §4.5.2).
 * Without this a message containing such a line is silently truncated.
 */
function dotStuff(body: string): string {
  return body.replace(/\r?\n\./g, "\r\n..").replace(/^\./, "..");
}

/** Normalise bare LF to CRLF — SMTP requires canonical line endings. */
function toCrlf(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
}

function buildRawMessage(msg: MailPayload): string {
  const lines: string[] = [];

  lines.push(`From: ${formatAddr(msg.from)}`);
  lines.push(`To: ${msg.to.map(formatAddr).join(", ")}`);
  if (msg.cc?.length) lines.push(`Cc: ${msg.cc.map(formatAddr).join(", ")}`);
  if (msg.replyTo) lines.push(`Reply-To: ${formatAddr(msg.replyTo)}`);
  lines.push(`Subject: ${encodeHeaderValue(msg.subject)}`);
  lines.push(`Date: ${new Date().toUTCString()}`);
  lines.push(
    `Message-ID: <${crypto.randomUUID()}@${msg.from.address.split("@")[1] ?? "localhost"}>`,
  );
  lines.push("MIME-Version: 1.0");

  // Re-validated here, not just in `MailMessage.header()`, because a payload can
  // reach a driver without ever passing through the builder — a job deserialising
  // one, or an app constructing a MailPayload literal. Placing them after the
  // headers this function owns would not be enough on its own: a second `Subject`
  // is still a second `Subject`, wherever it sits.
  for (const [name, value] of Object.entries(resolveHeaders(msg.headers ?? {}))) {
    lines.push(`${name}: ${encodeHeaderValue(value)}`);
  }

  const attachments = msg.attachments ?? [];
  const body = renderBody(msg);

  if (attachments.length === 0) {
    lines.push(body.headers);
    lines.push("");
    lines.push(body.content);
    return toCrlf(lines.join("\r\n"));
  }

  // Attachments wrap the whole body in multipart/mixed, with the text/html
  // alternative (if any) nested as the first part.
  const mixed = `zerotal-mixed-${crypto.randomUUID()}`;
  lines.push(`Content-Type: multipart/mixed; boundary="${mixed}"`);
  lines.push("");
  lines.push(`--${mixed}`);
  lines.push(body.headers);
  lines.push("");
  lines.push(body.content);

  for (const attachment of attachments) {
    lines.push(`--${mixed}`);
    lines.push(
      `Content-Type: ${sanitizeHeader(attachment.contentType ?? "application/octet-stream")}`,
    );
    lines.push("Content-Transfer-Encoding: base64");
    const disposition = attachment.inline ? "inline" : "attachment";
    lines.push(
      `Content-Disposition: ${disposition}; filename="${encodeHeaderValue(attachment.filename).replace(/"/g, "")}"`,
    );
    if (attachment.cid) lines.push(`Content-ID: <${sanitizeHeader(attachment.cid)}>`);
    lines.push("");
    lines.push(chunk76(toBase64(attachment.content)));
  }

  lines.push(`--${mixed}--`);
  return toCrlf(lines.join("\r\n"));
}

/** The body part: either a single type, or a multipart/alternative pair. */
function renderBody(msg: MailPayload): { headers: string; content: string } {
  if (msg.html && msg.text) {
    const alt = `zerotal-alt-${crypto.randomUUID()}`;
    const content = [
      `--${alt}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      dotStuff(msg.text),
      `--${alt}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      dotStuff(msg.html),
      `--${alt}--`,
    ].join("\r\n");
    return { headers: `Content-Type: multipart/alternative; boundary="${alt}"`, content };
  }
  if (msg.html) {
    return { headers: "Content-Type: text/html; charset=utf-8", content: dotStuff(msg.html) };
  }
  return {
    headers: "Content-Type: text/plain; charset=utf-8",
    content: dotStuff(msg.text ?? ""),
  };
}

function toBase64(content: string | Uint8Array): string {
  return typeof content === "string"
    ? Buffer.from(content, "utf8").toString("base64")
    : Buffer.from(content).toString("base64");
}

/** Base64 in a MIME part is wrapped at 76 characters. */
function chunk76(base64: string): string {
  return (base64.match(/.{1,76}/g) ?? []).join("\r\n");
}
