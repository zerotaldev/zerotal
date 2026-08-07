import { describe, it, expect, afterEach } from "bun:test";
import { FrameworkEvents } from "@zerotal/core";
import { MessageSent, MessageFailed } from "./events.ts";
import { MailChannel } from "./MailChannel.ts";
import { Notification } from "./Notification.ts";
import { MailMessage } from "./messages/MailMessage.ts";
import type { MailConfigShape, Notifiable } from "./types.ts";
import type { MailDriver, MailPayload } from "./drivers/MailDriver.ts";

const config: MailConfigShape = {
  driver: "log",
  from: { address: "noreply@zerotal.test", name: "Zerotal" },
  smtp: { host: "", port: 587, secure: false, username: "", password: "" },
  resend: { apiKey: "" },
  log: { channel: "console" },
};

class WelcomeNotification extends Notification {
  channels() {
    return ["mail"];
  }
  toMail(_n: Notifiable): MailMessage {
    return new MailMessage().subject("Welcome aboard").line("Glad to have you.");
  }
}

const user: Notifiable = { email: "ada@zerotal.test", name: "Ada" };

/** Swap the channel's private driver for a stub so the test controls success/failure. */
function withDriver(channel: MailChannel, driver: MailDriver): MailChannel {
  (channel as unknown as { _driver: MailDriver })._driver = driver;
  return channel;
}

describe("MailChannel — monitor telemetry", () => {
  const offFns: Array<() => void> = [];

  afterEach(() => {
    while (offFns.length) offFns.pop()!();
  });

  it("emits MessageSent after the driver delivers", async () => {
    const sent: MessageSent[] = [];
    offFns.push(FrameworkEvents.on(MessageSent, (e) => sent.push(e)));

    let delivered: MailPayload | undefined;
    const channel = withDriver(new MailChannel(config), {
      async send(payload) {
        delivered = payload;
      },
    });

    await channel.send(user, new WelcomeNotification());

    expect(delivered?.subject).toBe("Welcome aboard");
    expect(sent).toHaveLength(1);
    const e = sent[0]!;
    expect(e.className).toBe("WelcomeNotification");
    expect(e.to).toEqual(["ada@zerotal.test"]);
    expect(e.subject).toBe("Welcome aboard");
    expect(e.html).toContain("Glad to have you.");
    expect(e.queued).toBe(false);
    expect(e.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("emits MessageFailed and rethrows when the driver throws", async () => {
    const failed: MessageFailed[] = [];
    const sent: MessageSent[] = [];
    offFns.push(FrameworkEvents.on(MessageFailed, (e) => failed.push(e)));
    offFns.push(FrameworkEvents.on(MessageSent, (e) => sent.push(e)));

    const channel = withDriver(new MailChannel(config), {
      async send() {
        throw new Error("smtp refused connection");
      },
    });

    await expect(channel.send(user, new WelcomeNotification())).rejects.toThrow(
      "smtp refused connection",
    );

    expect(sent).toHaveLength(0);
    expect(failed).toHaveLength(1);
    const e = failed[0]!;
    expect(e.className).toBe("WelcomeNotification");
    expect(e.to).toEqual(["ada@zerotal.test"]);
    expect(e.subject).toBe("Welcome aboard");
    expect(e.error).toBe("smtp refused connection");
  });
});
