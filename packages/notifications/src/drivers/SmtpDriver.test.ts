import { describe, it, expect, afterEach } from "bun:test";
import { SmtpDriver } from "./SmtpDriver.ts";
import { SmtpResponseError, SmtpConnectionError, InvalidMailAddressError } from "../errors.ts";
import type { MailPayload } from "./MailDriver.ts";
import { MailMessage } from "../messages/MailMessage.ts";
import { MailChannel } from "../MailChannel.ts";
import { Notification } from "../Notification.ts";

/**
 * A scripted SMTP server.
 *
 * The driver's job is protocol handling — framing multi-line replies, checking
 * status codes, refusing to leak credentials — and none of that can be asserted
 * against a stub that only records calls. These tests talk real SMTP over a real
 * socket.
 */
interface FakeServer {
  port: number;
  /** Everything the client sent, in order. */
  received: string[];
  /** The full DATA block, once the client sends one. */
  body: string;
  stop(): void;
}

/**
 * @param script - Reply for each client command, in order. A reply may contain
 *   CRLFs to emulate a multi-line response, and `null` means "send nothing".
 */
function startServer(options: {
  greeting?: string;
  ehlo?: string;
  onCommand?: (cmd: string, index: number) => string | null | undefined;
  closeAfter?: number;
}): FakeServer {
  const received: string[] = [];
  let body = "";
  let inData = false;
  let commandCount = 0;

  const server = Bun.listen<undefined>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.write(`${options.greeting ?? "220 test.local ESMTP ready"}\r\n`);
      },
      data(socket, raw) {
        const text = new TextDecoder().decode(raw);

        if (inData) {
          body += text;
          if (body.includes("\r\n.\r\n")) {
            inData = false;
            socket.write("250 2.0.0 Ok: queued\r\n");
          }
          return;
        }

        for (const line of text.split("\r\n").filter((l) => l.length > 0)) {
          received.push(line);
          const index = commandCount++;

          if (options.closeAfter !== undefined && index >= options.closeAfter) {
            socket.end();
            return;
          }

          const scripted = options.onCommand?.(line, index);
          if (scripted === null) return;
          if (scripted !== undefined) {
            socket.write(`${scripted}\r\n`);
            continue;
          }

          const verb = line.split(/[ :]/)[0]?.toUpperCase();
          switch (verb) {
            case "EHLO":
              socket.write(
                `${options.ehlo ?? "250-test.local\r\n250-SIZE 10240000\r\n250 HELP"}\r\n`,
              );
              break;
            case "MAIL":
            case "RCPT":
              socket.write("250 2.1.0 Ok\r\n");
              break;
            case "DATA":
              inData = true;
              socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
              break;
            case "QUIT":
              socket.write("221 2.0.0 Bye\r\n");
              socket.end();
              break;
            case "AUTH":
              socket.write("235 2.7.0 Authentication successful\r\n");
              break;
            default:
              socket.write("250 2.0.0 Ok\r\n");
          }
        }
      },
    },
  });

  return {
    port: server.port,
    received,
    get body() {
      return body;
    },
    stop: () => server.stop(true),
  };
}

function payload(overrides: Partial<MailPayload> = {}): MailPayload {
  return {
    to: [{ address: "ada@test.local", name: "Ada" }],
    from: { address: "app@test.local", name: "Zerotal" },
    subject: "Hello",
    text: "Plain body",
    ...overrides,
  };
}

/** The first header line of the raw message with this name. */
function headerLine(raw: string, name: string): string {
  const headers = raw.slice(0, raw.indexOf("\r\n\r\n")).split("\r\n");
  return headers.find((l) => l.startsWith(`${name}: `)) ?? "";
}

/**
 * The addresses a reader of a To or Cc header finds: quoted strings (with their
 * quoted-pairs) skipped, then every `<…>` left over.
 */
function mailboxes(header: string): string[] {
  return [...header.replace(/"(?:[^"\\]|\\.)*"/g, "").matchAll(/<([^>]*)>/g)].map((m) => m[1]!);
}

/** The body of a single-part message as the receiver sees it, dot-stuffing undone. */
function singlePartBody(raw: string): string {
  const start = raw.indexOf("\r\n\r\n") + 4;
  return raw.slice(start, raw.lastIndexOf("\r\n.\r\n")).replace(/\r\n\.\./g, "\r\n.");
}

/** Reverse RFC 2045 quoted-printable, written independently of the driver's encoder. */
function decodeQuotedPrintable(encoded: string): string {
  const joined = encoded.replace(/=\r\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    if (joined[i] === "=") {
      bytes.push(parseInt(joined.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(joined.charCodeAt(i));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

const servers: FakeServer[] = [];
afterEach(() => {
  while (servers.length) servers.pop()!.stop();
});

function serve(options: Parameters<typeof startServer>[0]): FakeServer {
  const s = startServer(options);
  servers.push(s);
  return s;
}

describe("SmtpDriver — protocol", () => {
  it("completes a full session and sends the message", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload());

    expect(server.received.some((l) => l.startsWith("EHLO"))).toBe(true);
    expect(server.received).toContain("MAIL FROM:<app@test.local>");
    expect(server.received).toContain("RCPT TO:<ada@test.local>");
    expect(server.received).toContain("DATA");
    expect(server.body).toContain("Subject: Hello");
    expect(server.body).toContain("Plain body");
  });

  it("parses a multi-line greeting without desyncing", async () => {
    const server = serve({
      ehlo: "250-test.local\r\n250-PIPELINING\r\n250-SIZE 1000\r\n250-8BITMIME\r\n250 HELP",
    });
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload());
    expect(server.received).toContain("MAIL FROM:<app@test.local>");
  });

  it("addresses every recipient including cc and bcc", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(
      payload({
        to: [{ address: "a@test.local" }],
        cc: [{ address: "b@test.local" }],
        bcc: [{ address: "c@test.local" }],
      }),
    );

    expect(server.received).toContain("RCPT TO:<a@test.local>");
    expect(server.received).toContain("RCPT TO:<b@test.local>");
    expect(server.received).toContain("RCPT TO:<c@test.local>");

    // Bcc must not appear in the headers the recipients can read. Asserted
    // against the header lines rather than the whole body: `Message-ID` is a
    // random UUID at `@test.local`, so a plain substring check failed whenever
    // that UUID happened to end in "c" — a one-in-sixteen flake.
    const headers = server.body.split("\r\n\r\n")[0]!;
    const recipientLines = headers
      .split("\r\n")
      .filter((line) => /^(To|Cc|Bcc):/i.test(line))
      .join("\n");
    expect(recipientLines).toContain("a@test.local");
    expect(recipientLines).toContain("b@test.local");
    expect(recipientLines).not.toContain("c@test.local");
    expect(headers).not.toMatch(/^Bcc:/im);
  });
});

describe("SmtpDriver — response codes", () => {
  it("throws when the server rejects a recipient", async () => {
    const server = serve({
      onCommand: (cmd) => (cmd.startsWith("RCPT") ? "550 5.1.1 No such user" : undefined),
    });
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await expect(driver.send(payload())).rejects.toThrow(SmtpResponseError);
    await expect(driver.send(payload())).rejects.toThrow("550");
  });

  it("throws when authentication is rejected", async () => {
    const server = serve({
      ehlo: "250-test.local\r\n250 AUTH PLAIN LOGIN",
      onCommand: (cmd) => (cmd.startsWith("AUTH") ? "535 5.7.8 Bad credentials" : undefined),
    });
    const driver = new SmtpDriver("127.0.0.1", server.port, "user", "pass", false, {
      allowInsecureAuth: true,
    });

    await expect(driver.send(payload())).rejects.toThrow("535");
  });

  it("throws when the server refuses to accept message data", async () => {
    const server = serve({
      onCommand: (cmd) => (cmd === "DATA" ? "554 5.6.0 Message rejected" : undefined),
    });
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await expect(driver.send(payload())).rejects.toThrow("554");
  });

  it("accepts 251 as a successful forward for a non-local recipient", async () => {
    const server = serve({
      onCommand: (cmd) => (cmd.startsWith("RCPT") ? "251 User not local; will forward" : undefined),
    });
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await expect(driver.send(payload())).resolves.toBeUndefined();
  });

  it("reports an unexpected disconnect rather than reporting success", async () => {
    const server = serve({ closeAfter: 1 });
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await expect(driver.send(payload())).rejects.toThrow(SmtpConnectionError);
  });

  it("times out instead of hanging when the server never replies", async () => {
    const server = serve({ onCommand: (cmd) => (cmd.startsWith("EHLO") ? null : undefined) });
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false, { timeoutMs: 150 });

    await expect(driver.send(payload())).rejects.toThrow("Timed out");
  });
});

describe("SmtpDriver — credential safety", () => {
  it("refuses to authenticate over an unencrypted connection by default", async () => {
    const server = serve({ ehlo: "250-test.local\r\n250 AUTH PLAIN LOGIN" });
    const driver = new SmtpDriver("127.0.0.1", server.port, "user", "hunter2", false);

    await expect(driver.send(payload())).rejects.toThrow(
      /Refusing to send SMTP credentials over an unencrypted connection/,
    );
    // The password must never have reached the wire.
    expect(server.received.join("\n")).not.toContain(btoa("hunter2"));
    expect(server.received.some((l) => l.startsWith("AUTH"))).toBe(false);
  });

  it("authenticates over plaintext when explicitly allowed", async () => {
    const server = serve({ ehlo: "250-test.local\r\n250 AUTH PLAIN" });
    const driver = new SmtpDriver("127.0.0.1", server.port, "user", "pass", false, {
      allowInsecureAuth: true,
    });

    await driver.send(payload());
    expect(server.received.some((l) => l.startsWith("AUTH PLAIN"))).toBe(true);
  });

  it("sends no credentials at all when none are configured", async () => {
    const server = serve({ ehlo: "250-test.local\r\n250 AUTH PLAIN LOGIN" });
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload());
    expect(server.received.some((l) => l.startsWith("AUTH"))).toBe(false);
  });

  it("falls back to AUTH LOGIN when the server offers only that", async () => {
    // LOGIN is a three-step challenge: 334, 334, then the result.
    let authStep = 0;
    const server = serve({
      ehlo: "250-test.local\r\n250 AUTH LOGIN",
      onCommand: (cmd) => {
        if (cmd === "AUTH LOGIN") {
          authStep = 1;
          return "334 VXNlcm5hbWU6";
        }
        if (authStep === 1) {
          authStep = 2;
          return "334 UGFzc3dvcmQ6";
        }
        if (authStep === 2) {
          authStep = 3;
          return "235 2.7.0 Authentication successful";
        }
        return undefined;
      },
    });
    const driver = new SmtpDriver("127.0.0.1", server.port, "user", "pass", false, {
      allowInsecureAuth: true,
    });

    await driver.send(payload());
    expect(server.received).toContain("AUTH LOGIN");
    expect(server.received).toContain(btoa("user"));
    expect(server.received).toContain(btoa("pass"));
  });
});

describe("SmtpDriver — header safety", () => {
  it("strips CRLF from a subject so headers cannot be injected", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload({ subject: "Hi\r\nBcc: attacker@evil.test\r\nX-Injected: yes" }));

    // The payload survives as inert text on the Subject line — what must not
    // happen is it becoming a header line of its own.
    const lines = server.body.split("\r\n");
    expect(lines.some((l) => l.startsWith("Bcc:"))).toBe(false);
    expect(lines.some((l) => l.startsWith("X-Injected:"))).toBe(false);
    expect(lines).toContain("Subject: Hi Bcc: attacker@evil.test X-Injected: yes");
  });

  it("refuses a display name with a line break before connecting", async () => {
    const breaks = [
      "\r\n",
      "\n",
      "\r",
      ...[0x85, 0x2028, 0x2029].map((c) => String.fromCharCode(c)),
    ];
    for (const lineBreak of breaks) {
      const server = serve({});
      const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false, { timeoutMs: 2000 });

      const error = await driver
        .send(
          payload({ from: { address: "app@test.local", name: `App${lineBreak}Bcc: evil@test` } }),
        )
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InvalidMailAddressError);
      expect(server.received).toEqual([]);
    }
  });

  it("writes a profile name holding a comma and a bracketed address as one recipient", async () => {
    const server = serve({});
    const channel = new MailChannel({
      driver: "smtp",
      from: { address: "app@test.local", name: "App" },
      smtp: { host: "127.0.0.1", port: server.port, secure: false, username: "", password: "" },
      resend: { apiKey: "" },
      log: { channel: "console" },
    });

    await channel.send(
      { id: 1, email: "victim@test.local", name: "x <spy@evil.test>, y" },
      new (class extends Notification {
        channels() {
          return ["mail"];
        }
        toMail(): MailMessage {
          return new MailMessage().subject("Your reset link").text("secret");
        }
      })(),
    );

    expect(server.received.filter((l) => l.startsWith("RCPT TO:"))).toEqual([
      "RCPT TO:<victim@test.local>",
    ]);
    const to = headerLine(server.body, "To");
    expect(to).toBe('To: "x <spy@evil.test>, y" <victim@test.local>');
    expect(mailboxes(to)).toEqual(["victim@test.local"]);
  });

  it("escapes a trailing backslash so the quoted name still ends", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(
      payload({
        to: [
          { address: "ada@test.local", name: "Victim\\" },
          { address: "bo@test.local", name: "x" },
        ],
        replyTo: { address: "user@test.local", name: "Bob\\" },
      }),
    );

    // Unescaped, `"Victim\" <ada@test.local>, "x" <bo@test.local>` is one quoted
    // string running on into the next mailbox; escaped, each mailbox stands alone.
    const to = headerLine(server.body, "To");
    expect(to).toBe(String.raw`To: "Victim\\" <ada@test.local>, "x" <bo@test.local>`);
    expect(headerLine(server.body, "Reply-To")).toBe(
      String.raw`Reply-To: "Bob\\" <user@test.local>`,
    );
    expect(mailboxes(to)).toEqual(["ada@test.local", "bo@test.local"]);
  });

  it("escapes a double quote in the name instead of dropping it", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload({ to: [{ address: "ada@test.local", name: 'Ada "the" Countess' }] }));

    expect(headerLine(server.body, "To")).toBe(
      String.raw`To: "Ada \"the\" Countess" <ada@test.local>`,
    );
  });

  it("encodes a non-ASCII name as encoded-words outside quotes", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload({ to: [{ address: "j@test.local", name: "Jörg" }] }));

    // An encoded-word inside a quoted-string is not decoded by a mail client.
    expect(headerLine(server.body, "To")).toBe(
      `To: =?UTF-8?B?${Buffer.from("Jörg").toString("base64")}?= <j@test.local>`,
    );
  });

  it("encodes a non-ASCII subject as RFC 2047 rather than raw UTF-8", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload({ subject: "Rechnung für Ada ☕" }));

    expect(server.body).toContain("=?UTF-8?B?");
    expect(server.body).not.toContain("Rechnung für Ada");
  });

  it("dot-stuffs a body line that would otherwise terminate DATA", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload({ text: "first line\n.\nlast line" }));

    // The lone dot is doubled on the wire, so the body is not truncated.
    expect(server.body).toContain("\r\n..\r\n");
    expect(server.body).toContain("last line");
  });
});

describe("SmtpDriver — envelope safety", () => {
  // A line break in an address would end MAIL FROM or RCPT TO early and put the
  // rest on the wire as a command of its own. Each case runs against a fresh
  // recording server, so anything that reached it is in `received`.
  const smuggled = "ada@test.local>\r\nRCPT TO:<spy@evil.test";
  const cases: Array<[string, Partial<MailPayload>]> = [
    ["to", { to: [{ address: smuggled }] }],
    ["from", { from: { address: smuggled } }],
    ["cc", { cc: [{ address: smuggled }] }],
    ["bcc", { bcc: [{ address: smuggled }] }],
    ["replyTo", { replyTo: { address: smuggled } }],
    ["to, bare LF", { to: [{ address: "ada@test.local>\nRCPT TO:<spy@evil.test" }] }],
    ["to, bare CR", { to: [{ address: "ada@test.local>\rRCPT TO:<spy@evil.test" }] }],
  ];

  for (const [field, overrides] of cases) {
    it(`refuses a line break in ${field} before connecting`, async () => {
      const server = serve({});
      const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false, { timeoutMs: 2000 });

      const error = await driver.send(payload(overrides)).catch((e: unknown) => e);

      expect(server.received.filter((l) => /spy@evil\.test/i.test(l))).toEqual([]);
      expect(server.received).toEqual([]);
      expect(error).toBeInstanceOf(InvalidMailAddressError);
    });
  }

  it("refuses an address it was handed with a space or angle bracket in it", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false, { timeoutMs: 2000 });

    for (const address of ["ada @test.local", "Ada <ada@test.local>"]) {
      const error = await driver.send(payload({ to: [{ address }] })).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidMailAddressError);
    }
    expect(server.received).toEqual([]);
  });

  it("sends 'Name <address>' once MailMessage has split it", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(
      new MailMessage()
        .subject("Hello")
        .text("Plain body")
        .from("Billing <billing@test.local>")
        .toPayload({ address: "app@test.local" }, [{ address: "Ada Lovelace <ada@test.local>" }]),
    );

    expect(server.received).toContain("MAIL FROM:<billing@test.local>");
    expect(server.received).toContain("RCPT TO:<ada@test.local>");
    expect(server.body).toContain('To: "Ada Lovelace" <ada@test.local>');
    expect(server.body).toContain('From: "Billing" <billing@test.local>');
  });

  it("still sends to a quoted local part containing a second @", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload({ to: [{ address: '"ada@home"@test.local' }] }));

    expect(server.received).toContain('RCPT TO:<"ada@home"@test.local>');
  });
});

describe("SmtpDriver — message structure", () => {
  it("builds multipart/alternative when both html and text are present", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload({ text: "Plain", html: "<p>Rich</p>" }));

    expect(server.body).toContain("multipart/alternative");
    expect(server.body).toContain("text/plain; charset=utf-8");
    expect(server.body).toContain("text/html; charset=utf-8");
  });

  it("wraps the message in multipart/mixed when there are attachments", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(
      payload({
        attachments: [{ filename: "notes.txt", content: "hello world", contentType: "text/plain" }],
      }),
    );

    expect(server.body).toContain("multipart/mixed");
    expect(server.body).toContain('Content-Disposition: attachment; filename="notes.txt"');
    expect(server.body).toContain("Content-Transfer-Encoding: base64");
    expect(server.body).toContain(Buffer.from("hello world").toString("base64"));
  });

  it("marks an embedded image inline with its Content-ID", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(
      payload({
        html: '<img src="cid:logo">',
        attachments: [
          {
            filename: "logo.png",
            content: new Uint8Array([1, 2, 3]),
            contentType: "image/png",
            inline: true,
            cid: "logo",
          },
        ],
      }),
    );

    expect(server.body).toContain("Content-Disposition: inline");
    expect(server.body).toContain("Content-ID: <logo>");
  });

  it("includes a Message-ID and Reply-To when set", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload({ replyTo: { address: "support@test.local" } }));

    expect(server.body).toMatch(/Message-ID: <.+@test\.local>/);
    expect(server.body).toContain("Reply-To: support@test.local");
  });

  it("sends a short ASCII body as written, declared 7bit", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload({ text: "Plain body" }));

    expect(server.body).toContain("Content-Transfer-Encoding: 7bit\r\n\r\nPlain body\r\n");
  });

  it("keeps every line within the SMTP limit however long the body", async () => {
    // The incident: a mail layout rendered its HTML as one ~5 KB line, a relay cut
    // it at the 998-octet limit, and the customer read "sup pliers".
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);
    const html = `<p style="margin:0">${"Our local suppliers confirm every booking. ".repeat(120)}</p>`;

    const { to, from, subject } = payload();
    await driver.send({ to, from, subject, html });

    expect(server.body).toContain("Content-Transfer-Encoding: quoted-printable");
    for (const line of server.body.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
    const body = singlePartBody(server.body);
    for (const line of body.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    expect(decodeQuotedPrintable(body)).toBe(html);
  });

  it("encodes non-ASCII body text instead of putting raw UTF-8 on a 7bit wire", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);
    const text = "Café — total = R 1 200 \nThank you";

    await driver.send(payload({ text }));

    const body = singlePartBody(server.body);
    expect(server.body).not.toContain("Café");
    // `=` is escaped, and so is the space a relay could strip from a line's end.
    expect(body).toContain("=3D");
    expect(body).toContain("=20\r\n");
    expect(decodeQuotedPrintable(body)).toBe(text.replace(/\n/g, "\r\n"));
  });

  it("breaks before an escape rather than letting it overrun the line", async () => {
    // One literal then two-byte characters puts a three-character escape across
    // the 75th column, where a careless soft break would leave a 77-character line.
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);
    const text = `x${"é".repeat(100)}`;

    await driver.send(payload({ text }));

    const body = singlePartBody(server.body);
    for (const line of body.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
    expect(decodeQuotedPrintable(body)).toBe(text);
  });

  it("dot-stuffs an encoded body as well as a plain one", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload({ text: "Café\n.\nend" }));

    expect(server.body).toContain("Content-Transfer-Encoding: quoted-printable");
    expect(server.body).toContain("\r\n..\r\n");
  });

  it("encodes each alternative on its own terms", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload({ text: "Plain", html: `<p>${"Rich ".repeat(40)}</p>` }));

    expect(server.body).toContain(
      "text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\nPlain",
    );
    expect(server.body).toContain(
      "text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable",
    );
  });

  it("refuses a message with no recipients instead of sending a blank envelope", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await expect(driver.send(payload({ to: [] }))).rejects.toThrow("no recipients");
  });
});

describe("SmtpDriver — line endings", () => {
  /**
   * Every CR in the DATA block followed by LF and every LF preceded by CR, and the
   * end-of-data line only once, at the end.
   */
  function expectCanonical(data: string): void {
    expect(data.match(/\r(?!\n)/g) ?? []).toEqual([]);
    expect(data.match(/(?<!\r)\n/g) ?? []).toEqual([]);
    expect(data.indexOf("\r\n.\r\n")).toBe(data.length - 5);
  }

  // A period after a lone CR, a lone LF and a CRLF; the first is the one the
  // receiving server and a relay after it may disagree about.
  const body = "hi\r.\r\nnext\r\nthen\n.\nlast\r";

  it("sends a lone CR in a plain body as a line break, never on its own", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload({ text: body }));

    expect(server.body).toContain("Content-Transfer-Encoding: 7bit");
    expectCanonical(server.body);
    expect(singlePartBody(server.body)).toBe("hi\r\n.\r\nnext\r\nthen\r\n.\r\nlast\r\n");
  });

  it("does the same for an encoded body", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload({ text: `Café ${body}` }));

    expect(server.body).toContain("Content-Transfer-Encoding: quoted-printable");
    expectCanonical(server.body);
    expect(decodeQuotedPrintable(singlePartBody(server.body))).toBe(
      "Café hi\r\n.\r\nnext\r\nthen\r\n.\r\nlast\r\n",
    );
  });

  it("does the same for html, both alternatives and a message with attachments", async () => {
    const { to, from, subject } = payload();
    const cases: MailPayload[] = [
      { to, from, subject, html: `<p>${body}</p>` },
      { to, from, subject, text: body, html: `<p>${body}</p>` },
      {
        to,
        from,
        subject,
        text: body,
        html: `<p>${body}</p>`,
        attachments: [{ filename: "a\r.txt", content: `x${body}`, contentType: "text/plain" }],
      },
    ];
    for (const message of cases) {
      const server = serve({});
      const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

      await driver.send(message);

      expectCanonical(server.body);
      expect(server.body).toContain("\r\n..\r\n");
    }
  });
});

describe("SmtpDriver — connection failures", () => {
  it("names the host and port when the connection is refused", async () => {
    // Port 1 is reserved and never listening.
    const driver = new SmtpDriver("127.0.0.1", 1, "", "", false, { timeoutMs: 500 });
    await expect(driver.send(payload())).rejects.toThrow(SmtpConnectionError);
  });
});

describe("SmtpDriver — custom headers", () => {
  it("puts List-Unsubscribe on the wire so a client can draw the button", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(
      payload({
        headers: {
          "List-Unsubscribe": "<https://app.test/u/abc>, <mailto:unsub@app.test>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    );

    const headers = server.body.split("\r\n\r\n")[0]!.split("\r\n");
    expect(headers).toContain(
      "List-Unsubscribe: <https://app.test/u/abc>, <mailto:unsub@app.test>",
    );
    expect(headers).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  });

  it("sends nothing extra when no headers are set", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload());

    expect(server.body).not.toContain("List-Unsubscribe");
  });

  it("strips CRLF from a header value so a value cannot open a new header", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload({ headers: { "X-Trace": "abc\r\nBcc: attacker@evil.test" } }));

    const headers = server.body.split("\r\n\r\n")[0]!.split("\r\n");
    expect(headers.some((l) => l.startsWith("Bcc:"))).toBe(false);
    expect(headers).toContain("X-Trace: abc Bcc: attacker@evil.test");
  });

  it("refuses a reserved header rather than sending it twice", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    // A second Subject is not an override — it is an ambiguous message, and which
    // one a client shows is its own business.
    await expect(driver.send(payload({ headers: { Subject: "Different" } }))).rejects.toThrow(
      "set by the mail driver",
    );
  });

  it("refuses a reserved header whatever its case", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await expect(
      driver.send(payload({ headers: { "content-type": "text/evil" } })),
    ).rejects.toThrow("set by the mail driver");
  });

  it("refuses a header name carrying a colon", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await expect(
      driver.send(payload({ headers: { "X-A: b\r\nBcc": "evil@test" } })),
    ).rejects.toThrow("not a valid header name");
  });

  it("encodes a non-ASCII header value rather than putting raw bytes on the wire", async () => {
    const server = serve({});
    const driver = new SmtpDriver("127.0.0.1", server.port, "", "", false);

    await driver.send(payload({ headers: { "X-Note": "café" } }));

    expect(server.body).toContain("X-Note: =?UTF-8?B?");
    expect(server.body).not.toContain("X-Note: café");
  });
});
