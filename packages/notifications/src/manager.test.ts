import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Application, FrameworkEvents } from "@zerotal/core";
import { _setDbConnection } from "@zerotal/orm";
import { Notification } from "./Notification.ts";
import { NotificationManager } from "./NotificationManager.ts";
import { NotificationConfig } from "./config.ts";
import { NotificationFake } from "./NotificationFake.ts";
import { NotificationSent } from "./events.ts";
import { MailMessage } from "./messages/MailMessage.ts";
import { NotificationDispatchError, UnknownNotificationChannelError } from "./errors.ts";
import { _resetStats, channelStats, installNotificationStats, recentDeliveries } from "./stats.ts";
import type { Notifiable, NotificationChannel } from "./types.ts";
import type { SlackMessage } from "./SlackChannel.ts";
import type { SmsMessage } from "./SmsChannel.ts";

// ── bun:sqlite → SQLInstance adapter (mirrors notifications.test.ts) ──────────

function makeSQLiteInstance(dbPath: string): { db: SQLInstance; close(): void } {
  const sqlite = new Database(dbPath);
  const fn = function <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
    const parts = Array.from(strings);
    const sql = parts.reduce((q, part, i) => q + (i > 0 ? "?" : "") + part, "");
    const stmt = sqlite.prepare(sql);
    return Promise.resolve(stmt.all(...(values as Parameters<typeof stmt.all>)) as T[]);
  };
  return { db: fn as unknown as SQLInstance, close: () => sqlite.close() };
}

let adapter: { db: SQLInstance; close(): void };
let db: SQLInstance;

beforeAll(() => {
  adapter = makeSQLiteInstance(":memory:");
  db = adapter.db;
  _setDbConnection(db as never);
});

afterAll(() => {
  _setDbConnection(null as never);
  adapter.close();
});

const user: Notifiable = { id: 1, email: "alice@example.com", name: "Alice" };

class StoredNotification extends Notification {
  channels() {
    return ["database"];
  }
  toDatabase() {
    return { ok: true };
  }
}

function manager(table: string, overrides = {}): NotificationManager {
  return new NotificationManager(NotificationConfig({ database: { table }, ...overrides }));
}

// ── Channel failure isolation ────────────────────────────────────────────────

describe("NotificationManager — channel failure isolation", () => {
  class MultiChannel extends Notification {
    channels() {
      return ["database", "flaky", "recorder"];
    }
    toDatabase() {
      return { ok: true };
    }
  }

  it("delivers every other channel when one fails, then reports the failure", async () => {
    const mgr = manager("iso_notifications");
    const recorded: string[] = [];

    mgr.extend("flaky", () => ({
      async send() {
        throw new Error("webhook exploded");
      },
    }));
    mgr.extend("recorder", () => ({
      async send() {
        recorded.push("delivered");
      },
    }));

    await new Promise<void>((r) => setTimeout(r, 10));
    await db`DELETE FROM iso_notifications`;

    const error = await mgr.send(user, new MultiChannel()).catch((e: unknown) => e);

    // The channels after the failing one still ran.
    expect(recorded).toEqual(["delivered"]);
    const rows = await db`SELECT * FROM iso_notifications`;
    expect(rows.length).toBe(1);

    expect(error).toBeInstanceOf(NotificationDispatchError);
    const dispatch = error as NotificationDispatchError;
    expect(dispatch.failures).toHaveLength(1);
    expect(dispatch.failures[0]!.channel).toBe("flaky");
    expect(dispatch.delivered).toEqual(["database", "recorder"]);
    expect(dispatch.message).toContain("webhook exploded");
  });

  it("rethrows the original error when a single channel fails alone", async () => {
    const mgr = manager("solo_notifications");
    class OnlyFlaky extends Notification {
      channels() {
        return ["flaky"];
      }
    }
    mgr.extend("flaky", () => ({
      async send() {
        throw new TypeError("very specific failure");
      },
    }));

    await expect(mgr.send(user, new OnlyFlaky())).rejects.toThrow(TypeError);
    await expect(mgr.send(user, new OnlyFlaky())).rejects.toThrow("very specific failure");
  });

  it("emits one NotificationSent per channel, marking the failure", async () => {
    const mgr = manager("evt_notifications");
    mgr.extend("flaky", () => ({
      async send() {
        throw new Error("nope");
      },
    }));
    mgr.extend("recorder", () => ({ async send() {} }));

    const seen: NotificationSent[] = [];
    const off = FrameworkEvents.on(NotificationSent, (e) => seen.push(e));
    await mgr.send(user, new MultiChannel()).catch(() => undefined);
    off();

    expect(seen).toHaveLength(3);
    expect(seen.map((e) => e.channel)).toEqual(["database", "flaky", "recorder"]);
    expect(seen.map((e) => e.ok)).toEqual([true, false, true]);
    expect(seen[1]!.error).toBe("nope");
  });
});

// ── Custom channels ──────────────────────────────────────────────────────────

describe("NotificationManager — extend()", () => {
  it("registers a custom channel and routes to it", async () => {
    const mgr = manager("ext_notifications");
    const sent: Array<{ to: string | number; body: unknown }> = [];

    class DiscordChannel implements NotificationChannel {
      async send(notifiable: Notifiable, notification: Notification) {
        sent.push({
          to: notifiable.id,
          body: (notification as unknown as { toDiscord(): unknown }).toDiscord(),
        });
      }
    }

    class DeployFinished extends Notification {
      channels() {
        return ["discord"];
      }
      toDiscord() {
        return { content: "Deploy finished" };
      }
    }

    mgr.extend("discord", () => new DiscordChannel());
    await mgr.send(user, new DeployFinished());

    expect(sent).toEqual([{ to: 1, body: { content: "Deploy finished" } }]);
    expect(mgr.channels()).toContain("discord");
  });

  it("constructs a channel once, lazily, and not at all if unused", async () => {
    const mgr = manager("lazy_notifications");
    let constructed = 0;

    mgr.extend("counted", () => {
      constructed++;
      return { async send() {} };
    });

    expect(constructed).toBe(0);

    class Counted extends Notification {
      channels() {
        return ["counted"];
      }
    }
    await mgr.send(user, new Counted());
    await mgr.send(user, new Counted());
    expect(constructed).toBe(1);
  });

  it("can replace a built-in channel", async () => {
    const mgr = manager("replace_notifications");
    const captured: string[] = [];
    mgr.extend("database", () => ({
      async send(_n, notification) {
        captured.push(notification.constructor.name);
      },
    }));

    await mgr.send(user, new StoredNotification());
    expect(captured).toEqual(["StoredNotification"]);
  });

  it("names the registered channels when one is unknown", async () => {
    const mgr = manager("unknown_notifications");
    class Pigeon extends Notification {
      channels() {
        return ["carrier-pigeon"];
      }
    }

    const error = await mgr.send(user, new Pigeon()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnknownNotificationChannelError);
    expect((error as Error).message).toContain("carrier-pigeon");
    expect((error as Error).message).toContain("mail");
  });
});

// ── Per-recipient routing ────────────────────────────────────────────────────

describe("Notification.channels(notifiable)", () => {
  it("lets one notification route differently per recipient", async () => {
    const mgr = manager("pref_notifications");
    const hits: Record<string, string[]> = { a: [], b: [] };

    mgr.extend("push", () => ({
      async send(n) {
        hits[String(n.id)]!.push("push");
      },
    }));
    mgr.extend("digest", () => ({
      async send(n) {
        hits[String(n.id)]!.push("digest");
      },
    }));

    class Preference extends Notification {
      channels(notifiable?: Notifiable) {
        return (notifiable as { wantsPush?: boolean })?.wantsPush ? ["push"] : ["digest"];
      }
    }

    await mgr.send({ id: "a", wantsPush: true } as Notifiable, new Preference());
    await mgr.send({ id: "b", wantsPush: false } as Notifiable, new Preference());

    expect(hits["a"]).toEqual(["push"]);
    expect(hits["b"]).toEqual(["digest"]);
  });
});

// ── sendMany ─────────────────────────────────────────────────────────────────

describe("NotificationManager — sendMany()", () => {
  it("sends to every recipient", async () => {
    const mgr = manager("many_notifications");
    const seen: Array<number | string> = [];
    mgr.extend("rec", () => ({
      async send(n) {
        seen.push(n.id);
      },
    }));

    class Broadcastish extends Notification {
      channels() {
        return ["rec"];
      }
    }

    await mgr.sendMany([{ id: 1 }, { id: 2 }, { id: 3 }], new Broadcastish());
    expect(seen).toEqual([1, 2, 3]);
  });

  it("keeps going when one recipient fails and reports it at the end", async () => {
    const mgr = manager("many_fail_notifications");
    const seen: Array<number | string> = [];
    mgr.extend("rec", () => ({
      async send(n) {
        if (n.id === 2) throw new Error("recipient 2 is broken");
        seen.push(n.id);
      },
    }));

    class Broadcastish extends Notification {
      channels() {
        return ["rec"];
      }
    }

    const error = await mgr
      .sendMany([{ id: 1 }, { id: 2 }, { id: 3 }], new Broadcastish())
      .catch((e: unknown) => e);

    expect(seen).toEqual([1, 3]);
    expect(error).toBeInstanceOf(NotificationDispatchError);
    expect((error as Error).message).toContain("recipient 2 is broken");
  });
});

// ── On-demand routing ────────────────────────────────────────────────────────

describe("NotificationManager — route()", () => {
  it("delivers mail to a bare address with no model behind it", async () => {
    const mgr = manager("ondemand_notifications");
    const delivered: string[][] = [];

    mgr.extend("mail", () => ({
      async send(notifiable, notification) {
        const message = (notification as unknown as { toMail(n: Notifiable): MailMessage }).toMail(
          notifiable,
        );
        const address = notifiable.routeNotificationFor?.("mail") ?? notifiable.email;
        const payload = message.toPayload({ address: "app@test" }, address ? [{ address }] : []);
        delivered.push(payload.to.map((a) => a.address));
      },
    }));

    class Alert extends Notification {
      channels() {
        return ["mail"];
      }
      toMail() {
        return new MailMessage().subject("Deploy finished");
      }
    }

    await mgr.route({ mail: "ops@acme.test" }).notify(new Alert());
    expect(delivered).toEqual([["ops@acme.test"]]);
  });

  it("routes each channel to its own destination", async () => {
    const mgr = manager("ondemand2_notifications");
    const routes: Record<string, string | undefined> = {};

    mgr.extend("sms", () => ({
      async send(n) {
        routes["sms"] = n.routeNotificationFor?.("sms");
      },
    }));
    mgr.extend("slack", () => ({
      async send(n) {
        routes["slack"] = n.routeNotificationFor?.("slack");
      },
    }));

    class Page extends Notification {
      channels() {
        return ["sms", "slack"];
      }
    }

    await mgr.route({ sms: "+15551234567", slack: "https://hooks.slack.com/x" }).notify(new Page());

    expect(routes["sms"]).toBe("+15551234567");
    expect(routes["slack"]).toBe("https://hooks.slack.com/x");
  });
});

// ── Delivery stats ───────────────────────────────────────────────────────────

describe("delivery stats", () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    dispose?.();
    _resetStats();
    dispose = installNotificationStats();
  });

  afterAll(() => dispose?.());

  it("counts sends and failures per channel", async () => {
    const mgr = manager("stats_notifications");
    mgr.extend("ok", () => ({ async send() {} }));
    mgr.extend("bad", () => ({
      async send() {
        throw new Error("down");
      },
    }));

    class Both extends Notification {
      channels() {
        return ["ok", "bad"];
      }
    }

    await mgr.send(user, new Both()).catch(() => undefined);
    await mgr.send(user, new Both()).catch(() => undefined);

    const stats = Object.fromEntries(channelStats().map((s) => [s.channel, s]));
    expect(stats["ok"]!.sent).toBe(2);
    expect(stats["ok"]!.failed).toBe(0);
    expect(stats["bad"]!.sent).toBe(0);
    expect(stats["bad"]!.failed).toBe(2);

    const recent = recentDeliveries();
    expect(recent).toHaveLength(4);
    expect(recent[0]!.channel).toBe("bad");
    expect(recent[0]!.error).toBe("down");
  });
});

// ── NotificationFake ─────────────────────────────────────────────────────────

describe("NotificationFake — expanded assertions", () => {
  let fake: NotificationFake;

  beforeAll(() => {
    Application.create();
  });
  afterAll(() => Application._resetInstance());

  beforeEach(() => {
    fake = NotificationFake.install();
  });

  class Mailed extends Notification {
    channels() {
      return ["mail", "database"];
    }
    toMail() {
      return new MailMessage().subject("x");
    }
    toDatabase() {
      return {};
    }
  }

  it("records the declared channels and asserts on them", async () => {
    await fake.send(user, new Mailed());

    expect(() => fake.assertSentOn(user, Mailed, "mail")).not.toThrow();
    expect(() => fake.assertSentOn(user, Mailed, "database")).not.toThrow();
    expect(() => fake.assertSentOn(user, Mailed, "sms")).toThrow("but it declared: mail, database");
  });

  it("distinguishes queued from immediate", async () => {
    await fake.queue(user, new Mailed());
    expect(() => fake.assertQueued(user, Mailed)).not.toThrow();

    const other = NotificationFake.install();
    await other.send(user, new Mailed());
    expect(() => other.assertQueued(user, Mailed)).toThrow("it was sent immediately");
    other.restore();
  });

  it("counts sends of one class across recipients", async () => {
    await fake.send({ id: 1 }, new Mailed());
    await fake.send({ id: 2 }, new Mailed());
    expect(() => fake.assertSentTimes(Mailed, 2)).not.toThrow();
    expect(() => fake.assertSentTimes(Mailed, 3)).toThrow("but it was sent 2×");
  });

  it("captures sendMany and route()", async () => {
    await fake.sendMany([{ id: 1 }, { id: 2 }], new Mailed());
    await fake.route({ mail: "ops@acme.test" }).notify(new Mailed());
    expect(fake.sent()).toHaveLength(3);
  });

  it("exposes an inert database channel so inbox reads keep working", async () => {
    await fake.send(user, new Mailed());
    expect(await fake.database.unread()).toEqual([]);
    expect(await fake.database.unreadCount()).toBe(0);
    await expect(fake.database.markAllAsRead()).resolves.toBeUndefined();
  });

  it("lists what was actually sent when an assertion fails", async () => {
    await fake.send(user, new Mailed());
    expect(() => fake.assertSentCount(5)).toThrow("Mailed → #1 [mail, database]");
  });

  it("returns everything sent to one recipient", async () => {
    await fake.send({ id: 1 }, new Mailed());
    await fake.send({ id: 2 }, new Mailed());
    expect(fake.sentTo({ id: 1 })).toHaveLength(1);
  });
});

// ── Slack / SMS routing fallbacks ────────────────────────────────────────────

describe("channel destination fallbacks", () => {
  it("slack falls back to the configured global webhook", async () => {
    const captured: string[] = [];
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async (url: string) => {
      captured.push(String(url));
      return new Response("ok", { status: 200 });
    };

    const mgr = manager("slack_cfg_notifications", {
      slack: { webhook: "https://hooks.slack.com/global" },
    });

    class NoUrlSlack extends Notification {
      channels() {
        return ["slack"];
      }
      toSlack(): SlackMessage {
        return { text: "hello" };
      }
    }

    await mgr.send(user, new NoUrlSlack());
    globalThis.fetch = originalFetch;

    expect(captured).toEqual(["https://hooks.slack.com/global"]);
  });

  it("sms falls back to the notifiable's phone", async () => {
    const bodies: string[] = [];
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async (
      _url: string,
      init: { body: URLSearchParams | string },
    ) => {
      bodies.push(String(init.body));
      return new Response("{}", { status: 201 });
    };

    const mgr = manager("sms_cfg_notifications", {
      sms: {
        driver: "twilio",
        twilio: { accountSid: "AC", authToken: "t", from: "+15550000000" },
      },
    });

    class CodeSms extends Notification {
      channels() {
        return ["sms"];
      }
      toSms(): SmsMessage {
        return { body: "Your code is 1234" };
      }
    }

    await mgr.send({ id: 5, phone: "+15559998888" }, new CodeSms());
    globalThis.fetch = originalFetch;

    expect(bodies[0]).toContain("%2B15559998888");
  });

  it("sms names the problem when there is no recipient at all", async () => {
    const mgr = manager("sms_norecip_notifications", {
      sms: {
        driver: "twilio",
        twilio: { accountSid: "AC", authToken: "t", from: "+15550000000" },
      },
    });

    class CodeSms extends Notification {
      channels() {
        return ["sms"];
      }
      toSms(): SmsMessage {
        return { body: "hi" };
      }
    }

    await expect(mgr.send({ id: 6 }, new CodeSms())).rejects.toThrow(
      "the notifiable has no 'phone'",
    );
  });
});
