import { describe, it, expect } from "bun:test";
import { MailMessage } from "./MailMessage.ts";
import { MailChannel } from "../MailChannel.ts";
import { Notification } from "../Notification.ts";
import type { MailConfigShape, Notifiable } from "../types.ts";
import type { MailDriver, MailPayload } from "../drivers/MailDriver.ts";
import { InvalidMailAddressError } from "../errors.ts";

const from = { address: "app@test.local", name: "Zerotal" };

const config: MailConfigShape = {
  driver: "log",
  from,
  smtp: { host: "localhost", port: 1025, secure: false, username: "", password: "" },
  resend: { apiKey: "" },
  log: { channel: "console" },
};

/** Swap the channel's driver for one that records the resolved payload. */
function capturing(channel: MailChannel): { channel: MailChannel; sent: MailPayload[] } {
  const sent: MailPayload[] = [];
  const driver: MailDriver = {
    async send(payload) {
      sent.push(payload);
    },
  };
  (channel as unknown as { _driver: MailDriver })._driver = driver;
  return { channel, sent };
}

describe("MailMessage — attachments", () => {
  it("carries an attachment into the payload", () => {
    const payload = new MailMessage()
      .subject("Invoice")
      .attach({ filename: "invoice.pdf", content: "PDF", contentType: "application/pdf" })
      .toPayload(from, [{ address: "ada@test.local" }]);

    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments![0]!.filename).toBe("invoice.pdf");
    expect(payload.attachments![0]!.contentType).toBe("application/pdf");
  });

  it("omits the key entirely when there are no attachments", () => {
    const payload = new MailMessage().subject("Plain").toPayload(from, []);
    expect(payload.attachments).toBeUndefined();
  });

  it("marks an embedded part inline with its content id", () => {
    const payload = new MailMessage()
      .html('<img src="cid:logo">')
      .embed("logo", { filename: "logo.png", content: new Uint8Array([1]) })
      .toPayload(from, []);

    expect(payload.attachments![0]!.inline).toBe(true);
    expect(payload.attachments![0]!.cid).toBe("logo");
  });

  it("reads a file from disk with attachFile()", async () => {
    const path = `${import.meta.dir}/MailMessage.test.ts`;
    const message = await new MailMessage().subject("Source").attachFile(path);
    const payload = message.toPayload(from, []);

    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments![0]!.filename).toBe("MailMessage.test.ts");
    expect(payload.attachments![0]!.content.length).toBeGreaterThan(0);
  });
});

describe("Notification — async to*() methods", () => {
  it("awaits a toMail() that returns a promise", async () => {
    class AsyncMail extends Notification {
      channels() {
        return ["mail"];
      }
      async toMail(_n: Notifiable): Promise<MailMessage> {
        // Building the message needs I/O — an attachment read from disk.
        return new MailMessage()
          .subject("Async subject")
          .attach({ filename: "a.txt", content: "hi" });
      }
    }

    const { channel, sent } = capturing(new MailChannel(config));
    await channel.send({ id: 1, email: "ada@test.local" }, new AsyncMail());

    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("Async subject");
    expect(sent[0]!.attachments).toHaveLength(1);
  });

  it("still accepts a plain synchronous toMail()", async () => {
    class SyncMail extends Notification {
      channels() {
        return ["mail"];
      }
      toMail(): MailMessage {
        return new MailMessage().subject("Sync subject");
      }
    }

    const { channel, sent } = capturing(new MailChannel(config));
    await channel.send({ id: 1, email: "ada@test.local" }, new SyncMail());

    expect(sent[0]!.subject).toBe("Sync subject");
  });
});

describe("MailMessage — recipients", () => {
  it("falls back to the notifiable when no recipient is set", async () => {
    class Simple extends Notification {
      channels() {
        return ["mail"];
      }
      toMail(): MailMessage {
        return new MailMessage().subject("Hi");
      }
    }

    const { channel, sent } = capturing(new MailChannel(config));
    await channel.send({ id: 1, email: "ada@test.local", name: "Ada" }, new Simple());

    expect(sent[0]!.to).toEqual([{ address: "ada@test.local", name: "Ada" }]);
  });

  it("honours routeNotificationFor('mail') over the email field", async () => {
    class Simple extends Notification {
      channels() {
        return ["mail"];
      }
      toMail(): MailMessage {
        return new MailMessage().subject("Hi");
      }
    }

    const { channel, sent } = capturing(new MailChannel(config));
    await channel.send(
      {
        id: 1,
        email: "personal@test.local",
        routeNotificationFor: (c) => (c === "mail" ? "billing@test.local" : undefined),
      },
      new Simple(),
    );

    expect(sent[0]!.to[0]!.address).toBe("billing@test.local");
  });

  it("an explicit to() on the message wins over both", async () => {
    class Explicit extends Notification {
      channels() {
        return ["mail"];
      }
      toMail(): MailMessage {
        return new MailMessage().subject("Hi").to("someone@else.local");
      }
    }

    const { channel, sent } = capturing(new MailChannel(config));
    await channel.send({ id: 1, email: "ada@test.local" }, new Explicit());

    expect(sent[0]!.to[0]!.address).toBe("someone@else.local");
  });
});

describe("MailMessage — address checks", () => {
  class Simple extends Notification {
    channels() {
      return ["mail"];
    }
    toMail(): MailMessage {
      return new MailMessage().subject("Hi");
    }
  }

  it("refuses an address with a line break when it is set", () => {
    const bad = "ada@test.local\r\nRSET";
    expect(() => new MailMessage().to(bad)).toThrow(InvalidMailAddressError);
    expect(() => new MailMessage().cc([{ address: bad }])).toThrow(InvalidMailAddressError);
    expect(() => new MailMessage().bcc(bad)).toThrow(InvalidMailAddressError);
    expect(() => new MailMessage().from(bad)).toThrow(InvalidMailAddressError);
    expect(() => new MailMessage().replyTo(bad)).toThrow(InvalidMailAddressError);
  });

  it("refuses a notifiable's email that never passed through to()", async () => {
    const { channel, sent } = capturing(new MailChannel(config));

    const error = await channel
      .send({ id: 1, email: "ada@test.local\r\nRSET" }, new Simple())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidMailAddressError);
    expect(sent).toEqual([]);
  });

  it("refuses a notifiable's email that holds a list of addresses", async () => {
    const { channel, sent } = capturing(new MailChannel(config));

    const error = await channel
      .send({ id: 1, email: "ada@test.local,eve@evil.test" }, new Simple())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidMailAddressError);
    expect(sent).toEqual([]);
  });

  it("refuses a routed address the same way", async () => {
    const { channel, sent } = capturing(new MailChannel(config));

    const error = await channel
      .send({ id: 1, routeNotificationFor: () => "billing@test.local\nRSET" }, new Simple())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InvalidMailAddressError);
    expect(sent).toEqual([]);
  });

  it("accepts 'Name <address>' on to, cc, bcc, from and replyTo", () => {
    const payload = new MailMessage()
      .subject("Hi")
      .to("Ada Lovelace <ada@test.local>")
      .cc(['"Babbage, Charles" <charles@test.local>'])
      .bcc("  Audit <audit@test.local>  ")
      .from("Billing <billing@test.local>")
      .replyTo({ address: "Support <support@test.local>" })
      .toPayload(from, []);

    expect(payload.to).toEqual([{ address: "ada@test.local", name: "Ada Lovelace" }]);
    expect(payload.cc).toEqual([{ address: "charles@test.local", name: "Babbage, Charles" }]);
    expect(payload.bcc).toEqual([{ address: "audit@test.local", name: "Audit" }]);
    expect(payload.from).toEqual({ address: "billing@test.local", name: "Billing" });
    expect(payload.replyTo).toEqual({ address: "support@test.local", name: "Support" });
  });

  it("accepts a notifiable's email and the default sender written as 'Name <address>'", async () => {
    const { channel, sent } = capturing(
      new MailChannel({ ...config, from: { address: "App <app@test.local>", name: "Default" } }),
    );

    await channel.send({ id: 1, email: "Ada <ada@test.local>", name: "A. L." }, new Simple());

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual([{ address: "ada@test.local", name: "Ada" }]);
    expect(sent[0]!.from).toEqual({ address: "app@test.local", name: "App" });
  });

  it("refuses 'Name <address>' with a line break in the name or the address", async () => {
    for (const bad of [
      "Ada\r\nBcc: spy@test.local <ada@test.local>",
      "Ada <ada@test.local\r\nRSET>",
      "Ada\n<ada@test.local>",
    ]) {
      expect(() => new MailMessage().to(bad)).toThrow(InvalidMailAddressError);
      expect(() => new MailMessage().cc([bad])).toThrow(InvalidMailAddressError);
      expect(() => new MailMessage().bcc(bad)).toThrow(InvalidMailAddressError);
      expect(() => new MailMessage().from(bad)).toThrow(InvalidMailAddressError);
      expect(() => new MailMessage().replyTo(bad)).toThrow(InvalidMailAddressError);

      const { channel, sent } = capturing(new MailChannel(config));
      const error = await channel.send({ id: 1, email: bad }, new Simple()).catch((e) => e);
      expect(error).toBeInstanceOf(InvalidMailAddressError);
      expect(sent).toEqual([]);
    }
  });

  it("refuses malformed angle brackets", () => {
    for (const bad of [
      "Ada <ada@test.local",
      "Ada ada@test.local>",
      "Ada <<ada@test.local>>",
      "Ada <ada@test.local> <spy@test.local>",
    ]) {
      expect(() => new MailMessage().to(bad)).toThrow(InvalidMailAddressError);
      expect(() => new MailMessage().from(bad)).toThrow(InvalidMailAddressError);
      expect(() => new MailMessage().subject("Hi").toPayload({ address: bad }, [])).toThrow(
        InvalidMailAddressError,
      );
      expect(() => new MailMessage().subject("Hi").toPayload(from, [{ address: bad }])).toThrow(
        InvalidMailAddressError,
      );
    }
  });

  it("refuses a default sender with whitespace in it", () => {
    expect(() =>
      new MailMessage().subject("Hi").toPayload({ address: "app @test.local" }, []),
    ).toThrow(InvalidMailAddressError);
  });

  it("refuses a line break in any display name, the notifiable's and the default sender's included", async () => {
    const breaks = ["\r\n", "\n", ...[0x85, 0x2028, 0x2029].map((c) => String.fromCharCode(c))];
    for (const lineBreak of breaks) {
      const name = `Ada${lineBreak}Bcc: spy@test.local`;
      const mailbox = { address: "ada@test.local", name };
      expect(() => new MailMessage().to(mailbox)).toThrow(InvalidMailAddressError);
      expect(() => new MailMessage().cc([mailbox])).toThrow(InvalidMailAddressError);
      expect(() => new MailMessage().bcc(mailbox)).toThrow(InvalidMailAddressError);
      expect(() => new MailMessage().from(mailbox)).toThrow(InvalidMailAddressError);
      expect(() => new MailMessage().replyTo(mailbox)).toThrow(InvalidMailAddressError);
      expect(() => new MailMessage().subject("Hi").toPayload(mailbox, [])).toThrow(
        InvalidMailAddressError,
      );
      expect(() => new MailMessage().subject("Hi").toPayload(from, [mailbox])).toThrow(
        InvalidMailAddressError,
      );

      // The profile name on a notifiable is user data, and MailChannel makes it the
      // recipient's display name.
      const { channel, sent } = capturing(new MailChannel(config));
      const error = await channel
        .send({ id: 1, email: "ada@test.local", name }, new Simple())
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InvalidMailAddressError);
      expect(sent).toEqual([]);
    }
  });

  it("keeps a profile name with quotes, a comma or angle brackets as the name", async () => {
    const { channel, sent } = capturing(new MailChannel(config));

    await channel.send(
      { id: 1, email: "ada@test.local", name: 'x <spy@evil.test>, "y"\\' },
      new Simple(),
    );

    expect(sent[0]!.to).toEqual([{ address: "ada@test.local", name: 'x <spy@evil.test>, "y"\\' }]);
  });
});

describe("MailMessage.header()", () => {
  it("carries custom headers into the payload", () => {
    const payload = new MailMessage()
      .subject("Digest")
      .header("List-Unsubscribe", "<https://app.test/u/abc>")
      .header("List-Unsubscribe-Post", "List-Unsubscribe=One-Click")
      .toPayload({ address: "app@test" }, [{ address: "ada@test" }]);

    expect(payload.headers).toEqual({
      "List-Unsubscribe": "<https://app.test/u/abc>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("omits the key entirely when no header is set", () => {
    const payload = new MailMessage()
      .subject("Plain")
      .toPayload({ address: "app@test" }, [{ address: "ada@test" }]);

    expect(payload.headers).toBeUndefined();
  });

  it("replaces rather than duplicates on a repeated name", () => {
    const payload = new MailMessage()
      .header("X-Run", "first")
      .header("X-Run", "second")
      .toPayload({ address: "app@test" }, [{ address: "ada@test" }]);

    expect(payload.headers).toEqual({ "X-Run": "second" });
  });

  it("throws where the value is written, not at send time", () => {
    // The stack of a queue worker three hops away names the worker, not the code
    // that set the header.
    expect(() => new MailMessage().header("Subject", "sneaky")).toThrow("set by the mail driver");
    expect(() => new MailMessage().header("X-A\r\nBcc", "evil")).toThrow("not a valid header name");
  });

  it("folds CRLF in a value to a space", () => {
    const payload = new MailMessage()
      .header("X-Trace", "a\r\nb")
      .toPayload({ address: "app@test" }, [{ address: "ada@test" }]);

    expect(payload.headers).toEqual({ "X-Trace": "a b" });
  });
});
