import { describe, it, expect } from "bun:test";
import { MailMessage } from "./MailMessage.ts";
import { MailChannel } from "../MailChannel.ts";
import { Notification } from "../Notification.ts";
import type { MailConfigShape, Notifiable } from "../types.ts";
import type { MailDriver, MailPayload } from "../drivers/MailDriver.ts";

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
