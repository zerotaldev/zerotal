/**
 * The Resend HTTP mail driver.
 *
 * Unlike SMTP, this driver's correctness is entirely about the shape of one JSON
 * request, and every way of getting it wrong is quiet in development: a missing
 * `bcc`, an attachment that is not base64, or a `reply_to` under the wrong key
 * all produce a 200 from a stub and a wrong or rejected email in production.
 *
 * The other half is failure. A non-2xx must raise — a mail driver that swallows
 * a 401 reports every send as successful while nothing is ever delivered, which
 * is the worst outcome available to it.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { ResendDriver } from "./ResendDriver.ts";
import { InvalidMailAddressError, NotificationDeliveryError } from "../errors.ts";
import type { MailPayload } from "./MailDriver.ts";
import { MailChannel } from "../MailChannel.ts";
import { MailMessage } from "../messages/MailMessage.ts";
import { Notification } from "../Notification.ts";
import type { MailConfigShape } from "../types.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function payload(over: Partial<MailPayload> = {}): MailPayload {
  return {
    from: { address: "sender@example.com" },
    to: [{ address: "to@example.com" }],
    subject: "Hello",
    ...over,
  } as MailPayload;
}

/** Record the outgoing request; answer with `status`. */
function capture(status = 200, body = "{}") {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return calls;
}

const sentBody = (calls: Array<{ init: RequestInit }>) => JSON.parse(String(calls[0]!.init.body));

describe("ResendDriver — request", () => {
  it("posts to the Resend endpoint with a bearer token", async () => {
    const calls = capture();
    await new ResendDriver("re_test_key").send(payload());

    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer re_test_key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("formats a named address as a quoted name and the address, a bare one as the address", async () => {
    const calls = capture();
    await new ResendDriver("k").send(
      payload({
        from: { address: "sender@example.com", name: "Acme Billing" },
        to: [{ address: "a@example.com", name: "Alice" }, { address: "b@example.com" }],
      }),
    );

    const body = sentBody(calls);
    expect(body.from).toBe('"Acme Billing" <sender@example.com>');
    expect(body.to).toEqual(['"Alice" <a@example.com>', "b@example.com"]);
  });

  it("omits optional fields entirely rather than sending empty ones", async () => {
    // Resend rejects `cc: []`; the driver has to leave the key out.
    const calls = capture();
    await new ResendDriver("k").send(payload({ cc: [], bcc: [] }));

    const body = sentBody(calls);
    expect("cc" in body).toBe(false);
    expect("bcc" in body).toBe(false);
    expect("reply_to" in body).toBe(false);
    expect("attachments" in body).toBe(false);
  });

  it("maps replyTo to the API's snake_case key", async () => {
    // Sending `replyTo` instead of `reply_to` is accepted and silently ignored,
    // so replies would go to the sender address instead.
    const calls = capture();
    await new ResendDriver("k").send(
      payload({ replyTo: { address: "support@example.com" } } as Partial<MailPayload>),
    );
    expect(sentBody(calls).reply_to).toBe("support@example.com");
  });

  it("sends cc and bcc as bare addresses when present", async () => {
    const calls = capture();
    await new ResendDriver("k").send(
      payload({
        cc: [{ address: "cc@example.com", name: "Carbon" }],
        bcc: [{ address: "bcc@example.com" }],
      } as Partial<MailPayload>),
    );
    const body = sentBody(calls);
    expect(body.cc).toEqual(["cc@example.com"]);
    expect(body.bcc).toEqual(["bcc@example.com"]);
  });

  it("carries both html and text bodies when both are set", async () => {
    const calls = capture();
    await new ResendDriver("k").send(
      payload({ html: "<p>hi</p>", text: "hi" } as Partial<MailPayload>),
    );
    const body = sentBody(calls);
    expect(body.html).toBe("<p>hi</p>");
    expect(body.text).toBe("hi");
  });
});

describe("ResendDriver — attachments", () => {
  it("base64-encodes a string attachment", async () => {
    const calls = capture();
    await new ResendDriver("k").send(
      payload({
        attachments: [{ filename: "note.txt", content: "hello" }],
      } as Partial<MailPayload>),
    );
    const [a] = sentBody(calls).attachments;
    expect(a.filename).toBe("note.txt");
    expect(a.content).toBe(Buffer.from("hello", "utf8").toString("base64"));
  });

  it("base64-encodes binary content", async () => {
    // Sending raw bytes as JSON would corrupt the file silently.
    const calls = capture();
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    await new ResendDriver("k").send(
      payload({
        attachments: [{ filename: "blob.bin", content: bytes }],
      } as Partial<MailPayload>),
    );
    expect(sentBody(calls).attachments[0].content).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("passes contentType and cid under the API's own key names", async () => {
    const calls = capture();
    await new ResendDriver("k").send(
      payload({
        attachments: [
          { filename: "logo.png", content: "x", contentType: "image/png", cid: "logo@cid" },
        ],
      } as Partial<MailPayload>),
    );
    const [a] = sentBody(calls).attachments;
    expect(a.content_type).toBe("image/png");
    expect(a.content_id).toBe("logo@cid");
  });
});

describe("ResendDriver — failure", () => {
  it("throws on a non-2xx, naming the status and the API's message", async () => {
    // Swallowing this would report every send as delivered while nothing arrives.
    capture(401, "invalid api key");
    await expect(new ResendDriver("bad").send(payload())).rejects.toThrow(
      NotificationDeliveryError,
    );
    await expect(new ResendDriver("bad").send(payload())).rejects.toThrow(/401/);
    await expect(new ResendDriver("bad").send(payload())).rejects.toThrow(/invalid api key/);
  });

  it("still throws when the error body cannot be read", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 500,
        text: async () => {
          throw new Error("stream already consumed");
        },
      }) as unknown as Response) as unknown as typeof fetch;

    await expect(new ResendDriver("k").send(payload())).rejects.toThrow(/500/);
  });

  it("resolves quietly on success", async () => {
    capture(200);
    await expect(new ResendDriver("k").send(payload())).resolves.toBeUndefined();
  });
});

describe("ResendDriver — custom headers", () => {
  it("sends them as the API's headers object", async () => {
    const calls = capture();
    await new ResendDriver("k").send(
      payload({
        headers: {
          "List-Unsubscribe": "<https://app.test/u/abc>",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    );

    expect(sentBody(calls).headers).toEqual({
      "List-Unsubscribe": "<https://app.test/u/abc>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("omits the field when there are none, rather than sending an empty object", async () => {
    const calls = capture();
    await new ResendDriver("k").send(payload());

    expect(sentBody(calls)).not.toHaveProperty("headers");
  });

  it("refuses a reserved header rather than letting the API decide", async () => {
    capture();
    await expect(
      new ResendDriver("k").send(payload({ headers: { From: "someone@else.test" } })),
    ).rejects.toThrow("set by the mail driver");
  });

  it("strips CRLF from a value", async () => {
    const calls = capture();
    await new ResendDriver("k").send(payload({ headers: { "X-Trace": "a\r\nb" } }));

    expect(sentBody(calls).headers).toEqual({ "X-Trace": "a b" });
  });
});

describe("ResendDriver — display names", () => {
  class Welcome extends Notification {
    channels() {
      return ["mail"];
    }
    toMail(): MailMessage {
      return new MailMessage().subject("Your reset link").line("secret");
    }
  }

  /**
   * The addresses a reader of `"Name" <addr>, …` finds: quoted strings (with their
   * quoted-pairs) skipped, then every `<…>` left over.
   */
  const mailboxes = (value: string): string[] =>
    [...value.replace(/"(?:[^"\\]|\\.)*"/g, "").matchAll(/<([^>]*)>/g)].map((m) => m[1]!);

  const config: MailConfigShape = {
    driver: "resend",
    from: { address: "app@example.com", name: "App" },
    smtp: { host: "localhost", port: 1025, secure: false, username: "", password: "" },
    resend: { apiKey: "k" },
    log: { channel: "console" },
  };

  it("sends to one recipient when a profile name holds a comma and a bracketed address", async () => {
    // Resend reads "Name <addr>" back apart. Written bare, this name was a second
    // recipient: `x <spy@evil.test>, y <victim@example.com>`.
    const calls = capture();
    await new MailChannel(config).send(
      { id: 1, email: "victim@example.com", name: "x <spy@evil.test>, y" },
      new Welcome(),
    );

    const body = sentBody(calls);
    expect(body.to).toEqual(['"x <spy@evil.test>, y" <victim@example.com>']);
    expect(mailboxes(body.to[0])).toEqual(["victim@example.com"]);
  });

  it("escapes a quote and a trailing backslash in the name", async () => {
    const calls = capture();
    await new ResendDriver("k").send(
      payload({
        from: { address: "sender@example.com", name: 'Acme "Billing"' },
        to: [{ address: "a@example.com", name: "Alice\\" }],
      }),
    );

    const body = sentBody(calls);
    expect(body.from).toBe(String.raw`"Acme \"Billing\"" <sender@example.com>`);
    expect(body.to).toEqual([String.raw`"Alice\\" <a@example.com>`]);
    expect(mailboxes(body.to[0])).toEqual(["a@example.com"]);
  });

  it("encodes a name outside printable ASCII rather than writing it raw", async () => {
    const calls = capture();
    await new ResendDriver("k").send(
      payload({ to: [{ address: "j@example.com", name: "Jörg, <spy@evil.test>" }] }),
    );

    const [to] = sentBody(calls).to as string[];
    expect(to).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <j@example\.com>$/);
  });

  it("refuses a profile name with a Unicode line separator before sending", async () => {
    const calls = capture();
    const error = await new MailChannel(config)
      .send(
        { id: 1, email: "victim@example.com", name: `Ada${String.fromCharCode(0x2028)}x` },
        new Welcome(),
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidMailAddressError);
    expect(calls).toEqual([]);
  });
});

describe("ResendDriver — addresses", () => {
  // A payload can reach the driver without passing through MailMessage: a custom
  // channel or a job builds or deserialises one itself. Resend reads a recipient
  // string as a list, so the driver checks every address again before the request.
  const listed = "a@x.test,b@y.test";
  const unchecked: Array<[string, Partial<MailPayload>]> = [
    ["to", { to: [{ address: listed }] }],
    ["from", { from: { address: listed } }],
    ["cc", { cc: [{ address: "a@x.test;b@y.test" }] }],
    ["bcc", { bcc: [{ address: listed }] }],
    ["replyTo", { replyTo: { address: listed } }],
    ["to name", { to: [{ address: "a@x.test", name: "Ada\r\nBcc: spy@evil.test" }] }],
  ];

  for (const [field, overrides] of unchecked) {
    it(`refuses a payload whose ${field} was never checked, before any request`, async () => {
      const calls = capture();
      const error = await new ResendDriver("k").send(payload(overrides)).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InvalidMailAddressError);
      expect(calls).toEqual([]);
    });
  }
});
