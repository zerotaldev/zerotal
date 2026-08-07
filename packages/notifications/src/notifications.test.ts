import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { Application } from "@zerotal/core";
import { Notification } from "./Notification.ts";
import { DatabaseChannel } from "./DatabaseChannel.ts";
import { NotificationManager } from "./NotificationManager.ts";
import { Notifiable } from "./Notifiable.ts";
import { NotificationFake } from "./NotificationFake.ts";
import { NotificationConfig } from "./config.ts";
import { SlackChannel } from "./SlackChannel.ts";
import { SmsChannel } from "./SmsChannel.ts";
import { _setDbConnection } from "@zerotal/orm";
import type { SlackMessage } from "./SlackChannel.ts";
import type { SmsMessage } from "./SmsChannel.ts";

// ── bun:sqlite → SQLInstance adapter ─────────────────────────────────────
// Bun 1.3.x: `import { SQL } from 'bun'` causes a segfault.
// We instead use `bun:sqlite` and wrap it in the tagged-template interface
// that DatabaseChannel uses internally.

function makeSQLiteInstance(dbPath: string): { db: SQLInstance; close(): void } {
  const sqlite = new Database(dbPath);

  // Tagged-template implementation:
  //   strings = ['SELECT * FROM t WHERE id = ', ' AND foo = ', '']
  //   values  = [1, 'bar']
  //   →  'SELECT * FROM t WHERE id = ? AND foo = ?'
  const fn = function <T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]> {
    const parts = Array.from(strings);
    const sql = parts.reduce((q, part, i) => q + (i > 0 ? "?" : "") + part, "");
    const stmt = sqlite.prepare(sql);
    return Promise.resolve(stmt.all(...(values as Parameters<typeof stmt.all>)) as T[]);
  };

  return { db: fn as unknown as SQLInstance, close: () => sqlite.close() };
}

// ── In-memory database ────────────────────────────────────────────────────

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

// ── Fixtures ──────────────────────────────────────────────────────────────

const user: Notifiable = { id: 1, email: "alice@example.com", name: "Alice" };

class OrderShippedNotification extends Notification {
  constructor(private orderId: number) {
    super();
  }
  channels() {
    return ["database"];
  }
  toDatabase() {
    return { orderId: this.orderId, status: "shipped" };
  }
}

class MailOnlyNotification extends Notification {
  channels() {
    return ["mail"];
  }
}

// ── Notification base class ───────────────────────────────────────────────

describe("Notification", () => {
  it("channels() is abstract — subclass declares correctly", () => {
    const n = new OrderShippedNotification(42);
    expect(n.channels()).toEqual(["database"]);
  });

  it("toMail() throws if not implemented", () => {
    const n = new OrderShippedNotification(42);
    expect(() => n.toMail(user)).toThrow("toMail()");
  });

  it("toDatabase() throws if not implemented when called on base", () => {
    const n = new MailOnlyNotification();
    expect(() => n.toDatabase(user)).toThrow("toDatabase()");
  });
});

// ── NotificationConfig ────────────────────────────────────────────────────

describe("NotificationConfig", () => {
  it("defaults to notifications table", () => {
    const cfg = NotificationConfig();
    expect(cfg.database.table).toBe("notifications");
  });

  it("merges partial overrides", () => {
    const cfg = NotificationConfig({ database: { table: "user_notifications" } });
    expect(cfg.database.table).toBe("user_notifications");
  });
});

// ── DatabaseChannel ───────────────────────────────────────────────────────

describe("DatabaseChannel", () => {
  let channel: DatabaseChannel;

  beforeAll(async () => {
    channel = new DatabaseChannel("test_notifications", db);
    // Give ensureTable() a tick to complete
    await new Promise<void>((r) => setTimeout(r, 10));
  });

  beforeEach(async () => {
    await db`DELETE FROM test_notifications`;
  });

  it("creates the table automatically", async () => {
    const rows = await db<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type='table' AND name='test_notifications'
    `;
    expect(rows.length).toBe(1);
  });

  it("inserts a notification row", async () => {
    const n = new OrderShippedNotification(99);
    await channel.send(user, n);

    const rows = await db<{ type: string; data: string }>`
      SELECT type, data FROM test_notifications
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.type).toBe("OrderShippedNotification");
    const data = JSON.parse(rows[0]!.data as string) as Record<string, unknown>;
    expect(data).toEqual({ orderId: 99, status: "shipped" });
  });

  it("stores notifiable_id correctly", async () => {
    await channel.send(user, new OrderShippedNotification(1));
    const rows = await db<{ notifiable_id: string }>`
      SELECT notifiable_id FROM test_notifications
    `;
    expect(rows[0]!.notifiable_id).toBe("1");
  });

  it("unread() returns only unread rows", async () => {
    await channel.send(user, new OrderShippedNotification(1));
    await channel.send(user, new OrderShippedNotification(2));

    const unread = await channel.unread(user);
    expect(unread.length).toBe(2);
  });

  it("markAsRead() sets read_at", async () => {
    await channel.send(user, new OrderShippedNotification(10));
    const [row] = await channel.unread(user);
    await channel.markAsRead(row!.id);

    const unread = await channel.unread(user);
    expect(unread.length).toBe(0);
  });

  it("unread() does not return other users notifications", async () => {
    const other: Notifiable = { id: 99 };
    await channel.send(other, new OrderShippedNotification(5));

    const unread = await channel.unread(user);
    expect(unread.length).toBe(0);
  });

  it("rejects invalid table names", () => {
    expect(() => new DatabaseChannel("bad; DROP TABLE--", db)).toThrow("Invalid table name");
  });
});

// ── NotificationManager ───────────────────────────────────────────────────

describe("NotificationManager", () => {
  let manager: NotificationManager;
  let channel: DatabaseChannel;

  beforeAll(async () => {
    manager = new NotificationManager(
      NotificationConfig({ database: { table: "mgr_notifications" } }),
    );
    channel = manager.database;
    await new Promise<void>((r) => setTimeout(r, 10));
  });

  beforeEach(async () => {
    await db`DELETE FROM mgr_notifications`;
  });

  it("send() dispatches to database channel", async () => {
    await manager.send(user, new OrderShippedNotification(7));

    const unread = await channel.unread(user);
    expect(unread.length).toBe(1);
    expect(unread[0]!.type).toBe("OrderShippedNotification");
  });

  it("send() emits a NotificationSent event per channel", async () => {
    const { FrameworkEvents } = await import("@zerotal/core");
    const { NotificationSent } = await import("./events.ts");
    const seen: InstanceType<typeof NotificationSent>[] = [];
    const off = FrameworkEvents.on(NotificationSent, (e) => seen.push(e));

    await manager.send(user, new OrderShippedNotification(7));
    off();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.className).toBe("OrderShippedNotification");
    expect(seen[0]!.channel).toBe("database");
    expect(seen[0]!.notifiable).toBe("alice@example.com");
    expect(seen[0]!.ok).toBe(true);
  });

  it("send() throws on truly unknown channel", async () => {
    class UnknownChannelNotification extends Notification {
      channels() {
        return ["carrier-pigeon"];
      }
    }
    await expect(manager.send(user, new UnknownChannelNotification())).rejects.toThrow(
      "Unknown notification channel: 'carrier-pigeon'",
    );
  });

  it("send() with mail channel throws if Mail facade not wired", async () => {
    await expect(manager.send(user, new MailOnlyNotification())).rejects.toThrow();
  });

  it("send() with slack channel throws if slack not configured", async () => {
    class SlackNotification extends Notification {
      channels() {
        return ["slack"];
      }
      toSlack(): SlackMessage {
        return { webhookUrl: "https://hooks.slack.com/x", text: "hello" };
      }
    }
    await expect(manager.send(user, new SlackNotification())).rejects.toThrow("slack");
  });

  it("send() with sms channel throws if sms not configured", async () => {
    class SmsNotification extends Notification {
      channels() {
        return ["sms"];
      }
      toSms(): SmsMessage {
        return { to: "+15551234567", body: "hi" };
      }
    }
    await expect(manager.send(user, new SmsNotification())).rejects.toThrow("sms");
  });
});

// ── SlackChannel ──────────────────────────────────────────────────────────

describe("SlackChannel", () => {
  it("calls the webhook URL with correct payload", async () => {
    const captured: { url: string; body: unknown }[] = [];

    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async (
      url: string,
      init: { method: string; headers: Record<string, string>; body: string },
    ) => {
      captured.push({ url, body: JSON.parse(init.body) });
      return new Response("ok", { status: 200 });
    };

    const channel = new SlackChannel();
    class AlertNotification extends Notification {
      channels() {
        return ["slack"];
      }
      toSlack(): SlackMessage {
        return { webhookUrl: "https://hooks.slack.com/test", text: "Server is down!" };
      }
    }

    await channel.send(user, new AlertNotification());
    globalThis.fetch = originalFetch;

    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe("https://hooks.slack.com/test");
    expect((captured[0]!.body as { text: string }).text).toBe("Server is down!");
  });

  it("throws when webhook returns non-200", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async () =>
      new Response("invalid_token", { status: 400 });

    const channel = new SlackChannel();
    class FailNotification extends Notification {
      channels() {
        return ["slack"];
      }
      toSlack(): SlackMessage {
        return { webhookUrl: "https://hooks.slack.com/bad", text: "x" };
      }
    }

    await expect(channel.send(user, new FailNotification())).rejects.toThrow("400");
    globalThis.fetch = originalFetch;
  });

  it("includes blocks when provided", async () => {
    const captured: unknown[] = [];
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async (
      _url: string,
      init: { body: string },
    ) => {
      captured.push(JSON.parse(init.body));
      return new Response("ok", { status: 200 });
    };

    const channel = new SlackChannel();
    const blocks = [{ type: "section", text: { type: "mrkdwn", text: "*Bold*" } }];
    class BlockNotification extends Notification {
      channels() {
        return ["slack"];
      }
      toSlack(): SlackMessage {
        return { webhookUrl: "https://hooks.slack.com/x", text: "Fallback", blocks };
      }
    }

    await channel.send(user, new BlockNotification());
    globalThis.fetch = originalFetch;

    expect((captured[0] as { blocks: unknown[] }).blocks).toEqual(blocks);
  });

  it("toSlack() throws by default on Notification base", () => {
    class NoSlack extends Notification {
      channels() {
        return ["slack"];
      }
    }
    expect(() => new NoSlack().toSlack(user)).toThrow("toSlack()");
  });

  it("send() swallows res.text() error and still throws with status code", async () => {
    const orig = globalThis.fetch;
    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 503,
      text: async () => {
        throw new Error("body read error");
      },
    });
    const channel = new SlackChannel();
    class AnyNotif extends Notification {
      channels() {
        return ["slack"];
      }
      toSlack(): SlackMessage {
        return { webhookUrl: "https://x", text: "x" };
      }
    }
    await expect(channel.send(user, new AnyNotif())).rejects.toThrow("503");
    (globalThis as any).fetch = orig;
  });
});

// ── SmsChannel (Twilio) ───────────────────────────────────────────────────

describe("SmsChannel (Twilio)", () => {
  const twilioConfig = {
    driver: "twilio" as const,
    twilio: { accountSid: "ACtest", authToken: "token", from: "+15550000000" },
  };

  it("POSTs to Twilio API with correct params", async () => {
    const captured: { url: string; body: string }[] = [];
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async (
      url: string,
      init: { body: URLSearchParams | string },
    ) => {
      captured.push({ url: String(url), body: String(init.body) });
      return new Response(JSON.stringify({ sid: "SM123", status: "queued" }), { status: 201 });
    };

    const channel = new SmsChannel(twilioConfig);
    class CodeNotification extends Notification {
      channels() {
        return ["sms"];
      }
      toSms(): SmsMessage {
        return { to: "+15551234567", body: "Your code: 1234" };
      }
    }

    await channel.send(user, new CodeNotification());
    globalThis.fetch = originalFetch;

    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toContain("ACtest");
    expect(captured[0]!.body).toContain("Your+code%3A+1234");
    expect(captured[0]!.body).toContain("%2B15551234567");
  });

  it("uses per-message from when provided", async () => {
    const captured: string[] = [];
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async (
      _url: string,
      init: { body: URLSearchParams | string },
    ) => {
      captured.push(String(init.body));
      return new Response("{}", { status: 201 });
    };

    const channel = new SmsChannel(twilioConfig);
    class CustomFromNotification extends Notification {
      channels() {
        return ["sms"];
      }
      toSms(): SmsMessage {
        return { to: "+15559999", body: "hi", from: "+15550011111" };
      }
    }

    await channel.send(user, new CustomFromNotification());
    globalThis.fetch = originalFetch;

    expect(captured[0]).toContain("15550011111");
  });

  it("throws when Twilio returns non-200", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async () =>
      new Response(JSON.stringify({ message: "Auth failed" }), { status: 401 });

    const channel = new SmsChannel(twilioConfig);
    class FailSms extends Notification {
      channels() {
        return ["sms"];
      }
      toSms(): SmsMessage {
        return { to: "+1555", body: "x" };
      }
    }

    await expect(channel.send(user, new FailSms())).rejects.toThrow();
    globalThis.fetch = originalFetch;
  });

  it("toSms() throws by default on Notification base", () => {
    class NoSms extends Notification {
      channels() {
        return ["sms"];
      }
    }
    expect(() => new NoSms().toSms(user)).toThrow("toSms()");
  });

  it("throws on unknown SMS driver", async () => {
    const channel = new SmsChannel({ driver: "carrier-pigeon" as never });
    class AnyNotification extends Notification {
      channels() {
        return ["sms"];
      }
      toSms(): SmsMessage {
        return { to: "+1555", body: "hi" };
      }
    }
    await expect(channel.send(user, new AnyNotification())).rejects.toThrow(
      "Unknown SMS driver: 'carrier-pigeon'",
    );
  });

  it("throws when vonage config is missing", async () => {
    const channel = new SmsChannel({ driver: "vonage" } as never);
    class VonageNotification extends Notification {
      channels() {
        return ["sms"];
      }
      toSms(): SmsMessage {
        return { to: "+1555", body: "hi" };
      }
    }
    await expect(channel.send(user, new VonageNotification())).rejects.toThrow("vonage");
  });
});

// ── SmsChannel (Vonage) ───────────────────────────────────────────────────

describe("SmsChannel (Vonage)", () => {
  const vonageConfig = {
    driver: "vonage" as const,
    vonage: { apiKey: "key123", apiSecret: "secret456", from: "RENO" },
  };

  it('POSTs to Vonage REST API and succeeds on status "0"', async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async () =>
      new Response(JSON.stringify({ messages: [{ status: "0" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const channel = new SmsChannel(vonageConfig);
    class VonageNotification extends Notification {
      channels() {
        return ["sms"];
      }
      toSms(): SmsMessage {
        return { to: "+15551234567", body: "Your code is 9999" };
      }
    }

    await channel.send(user, new VonageNotification());
    globalThis.fetch = originalFetch;
    // No throw = success
  });

  it("uses per-message from override", async () => {
    const captured: unknown[] = [];
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async (
      _url: string,
      init: { body: string },
    ) => {
      captured.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ messages: [{ status: "0" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const channel = new SmsChannel(vonageConfig);
    class FromNotification extends Notification {
      channels() {
        return ["sms"];
      }
      toSms(): SmsMessage {
        return { to: "+1555", body: "hi", from: "CUSTOM" };
      }
    }

    await channel.send(user, new FromNotification());
    globalThis.fetch = originalFetch;
    expect((captured[0] as { from: string }).from).toBe("CUSTOM");
  });

  it("throws when Vonage returns non-200 HTTP status", async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async () =>
      new Response("{}", { status: 403 });

    const channel = new SmsChannel(vonageConfig);
    class FailNotification extends Notification {
      channels() {
        return ["sms"];
      }
      toSms(): SmsMessage {
        return { to: "+1555", body: "x" };
      }
    }

    await expect(channel.send(user, new FailNotification())).rejects.toThrow("403");
    globalThis.fetch = originalFetch;
  });

  it('throws when Vonage messages[0].status !== "0"', async () => {
    const originalFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>)["fetch"] = async () =>
      new Response(
        JSON.stringify({ messages: [{ status: "5", "error-text": "Invalid API key" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const channel = new SmsChannel(vonageConfig);
    class FailNotification extends Notification {
      channels() {
        return ["sms"];
      }
      toSms(): SmsMessage {
        return { to: "+1555", body: "x" };
      }
    }

    await expect(channel.send(user, new FailNotification())).rejects.toThrow("Invalid API key");
    globalThis.fetch = originalFetch;
  });
});

// ── SendNotificationJob ───────────────────────────────────────────────────

describe("SendNotificationJob", () => {
  it("is registered with JobRegistry and has correct queue name", async () => {
    const { SendNotificationJob } = await import("./SendNotificationJob.ts");
    const { JobRegistry } = await import("@zerotal/queue");

    const job = new SendNotificationJob(user, new OrderShippedNotification(1));
    expect(job.queue).toBe("notifications");

    const ctor = JobRegistry.resolve(SendNotificationJob.name);
    expect(ctor).toBeDefined();
  });
});

// ── NotificationFake ──────────────────────────────────────────────────────

describe("NotificationFake", () => {
  let fake: NotificationFake;

  beforeAll(() => {
    // NotificationFake.install() resolves the current application.
    Application.create();
  });

  afterAll(() => {
    Application._resetInstance();
  });

  beforeEach(() => {
    fake = NotificationFake.install();
  });

  afterEach(() => {
    fake.restore();
  });

  it("send() captures notification without delivering it", async () => {
    await fake.send(user, new OrderShippedNotification(42));
    expect(fake.sent()).toHaveLength(1);
    expect(fake.sent()[0]!.notification).toBeInstanceOf(OrderShippedNotification);
  });

  it("queue() also captures notifications", async () => {
    await fake.queue(user, new OrderShippedNotification(99));
    expect(fake.sent()).toHaveLength(1);
  });

  it("assertSentTo() passes when notification was sent to user", async () => {
    await fake.send(user, new OrderShippedNotification(1));
    expect(() => fake.assertSentTo(user, OrderShippedNotification)).not.toThrow();
  });

  it("assertSentTo() fails when notification was not sent", () => {
    expect(() => fake.assertSentTo(user, OrderShippedNotification)).toThrow(
      "OrderShippedNotification",
    );
  });

  it("assertSentTo() with filter callback — passes when filter matches", async () => {
    await fake.send(user, new OrderShippedNotification(77));
    expect(() =>
      fake.assertSentTo(
        user,
        OrderShippedNotification,
        (n) => (n as unknown as { orderId: number }).orderId === 77,
      ),
    ).not.toThrow();
  });

  it("assertSentTo() with filter callback — fails when filter does not match", async () => {
    await fake.send(user, new OrderShippedNotification(77));
    expect(() =>
      fake.assertSentTo(
        user,
        OrderShippedNotification,
        (n) => (n as unknown as { orderId: number }).orderId === 99,
      ),
    ).toThrow("matching the given filter");
  });

  it("assertNotSentTo() passes when nothing sent", () => {
    expect(() => fake.assertNotSentTo(user, OrderShippedNotification)).not.toThrow();
  });

  it("assertNotSentTo() fails when notification was sent", async () => {
    await fake.send(user, new OrderShippedNotification(1));
    expect(() => fake.assertNotSentTo(user, OrderShippedNotification)).toThrow("NOT");
  });

  it("assertNothingSent() passes when queue is empty", () => {
    expect(() => fake.assertNothingSent()).not.toThrow();
  });

  it("assertNothingSent() fails when notifications were sent", async () => {
    await fake.send(user, new OrderShippedNotification(1));
    expect(() => fake.assertNothingSent()).toThrow("1 notification");
  });

  it("assertSentCount() passes with exact count", async () => {
    await fake.send(user, new OrderShippedNotification(1));
    await fake.send(user, new OrderShippedNotification(2));
    expect(() => fake.assertSentCount(2)).not.toThrow();
  });

  it("assertSentCount() fails with wrong count", async () => {
    await fake.send(user, new OrderShippedNotification(1));
    expect(() => fake.assertSentCount(5)).toThrow("Expected 5");
  });

  it("restore() removes fake from container", () => {
    fake.restore();
    // Calling restore() again should be idempotent (no throw)
    expect(() => fake.restore()).not.toThrow();
  });
});

// ── NotificationProvider — onRegister() ──────────────────────────────────────

describe("NotificationProvider — onRegister()", () => {
  it('registers a "notifications" singleton that returns a NotificationManager', async () => {
    const { NotificationProvider } = await import("./provider/NotificationProvider.ts");

    const singletonFns = new Map<string, () => unknown>();
    const configManager = {
      get: (_key: string, fallback: unknown) => fallback,
    };
    const app = {
      container: {
        singleton(key: string, fn: () => unknown) {
          singletonFns.set(key, fn);
        },
        makeSync(key: string) {
          if (key === "config") return configManager;
          const factory = singletonFns.get(key);
          return factory ? factory() : undefined;
        },
        async make(key: string) {
          return this.makeSync(key);
        },
      },
    };

    const provider = new (
      NotificationProvider as unknown as new (app: unknown) => {
        onRegister(): void;
        onBooted(): Promise<void>;
      }
    )(app);

    provider.onRegister();
    expect(singletonFns.has("notifications")).toBe(true);

    // The singleton factory should produce a NotificationManager
    const { NotificationManager } = await import("./NotificationManager.ts");
    const manager = singletonFns.get("notifications")!();
    expect(manager).toBeInstanceOf(NotificationManager);
  });

  it("onBooted() eagerly resolves the notifications singleton", async () => {
    const { NotificationProvider } = await import("./provider/NotificationProvider.ts");

    let makeCallCount = 0;
    const configManager = { get: (_: string, fb: unknown) => fb };
    const app = {
      container: {
        singleton(_key: string, fn: () => unknown) {
          // store factory
          (this as unknown as Record<string, unknown>)._factory = fn;
        },
        makeSync(key: string) {
          if (key === "config") return configManager;
          const factory = (this as unknown as Record<string, unknown>)._factory as
            (() => unknown) | undefined;
          return factory ? factory() : undefined;
        },
        async make(_key: string) {
          makeCallCount++;
          const factory = (this as unknown as Record<string, unknown>)._factory as
            (() => unknown) | undefined;
          return factory ? factory() : undefined;
        },
        tryMake(_key: string) {
          return undefined; // no observers bound in this unit test
        },
      },
    };

    const provider = new (
      NotificationProvider as unknown as new (app: unknown) => {
        onRegister(): void;
        onBooted(): Promise<void>;
      }
    )(app);

    provider.onRegister();
    await provider.onBooted();
    expect(makeCallCount).toBe(1);
  });
});

// ── NotificationManager.queue() + SendNotificationJob.handle() ───────────

describe("NotificationManager.queue() and SendNotificationJob.handle()", () => {
  let sentViaManager: Array<{ notifiable: Notifiable; notification: Notification }> = [];

  beforeAll(() => {
    const app = Application.create();

    // Stub the queue so Queue.dispatch() just runs the job synchronously
    const dispatched: unknown[] = [];
    app.container.value("queue", {
      dispatch: async (job: { handle(): Promise<void> }) => {
        dispatched.push(job);
        await job.handle(); // run inline so SendNotificationJob.handle() is covered
      },
      push: async () => {},
    });

    // Stub the notifications manager so SendNotificationJob.handle() can call send()
    sentViaManager = [];
    app.container.value("notifications", {
      send: async (notifiable: Notifiable, notification: Notification) => {
        sentViaManager.push({ notifiable, notification });
      },
    });
  });

  afterAll(() => {
    Application._resetInstance();
  });

  beforeEach(() => {
    sentViaManager.length = 0;
  });

  it("queue() dispatches a SendNotificationJob and handle() calls send()", async () => {
    const manager = new NotificationManager(
      NotificationConfig({ database: { table: "queue_test_notifications" } }),
    );

    await manager.queue(user, new OrderShippedNotification(55));

    // SendNotificationJob.handle() was called by our stub, which called manager.send()
    expect(sentViaManager).toHaveLength(1);
    expect(sentViaManager[0]!.notifiable).toEqual(user);
    expect(sentViaManager[0]!.notification).toBeInstanceOf(OrderShippedNotification);
  });

  it("queue() emits MessageQueued for a mailing notification (Mail tab shows it deferred)", async () => {
    const { FrameworkEvents } = await import("@zerotal/core");
    const { MessageQueued } = await import("./events.ts");
    const { MailMessage } = await import("./messages/MailMessage.ts");
    const manager = new NotificationManager(
      NotificationConfig({ database: { table: "queue_test_notifications" } }),
    );

    class WelcomeMail extends Notification {
      channels() {
        return ["mail"];
      }
      toMail() {
        return new MailMessage().subject("Welcome aboard").line("Hi there.");
      }
    }

    const seen: InstanceType<typeof MessageQueued>[] = [];
    const off = FrameworkEvents.on(MessageQueued, (e) => seen.push(e));
    await manager.queue(user, new WelcomeMail());
    off();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.subject).toBe("Welcome aboard");
    expect(seen[0]!.to).toContain(user.email);
  });
});

// ── Notifiable mixin ───────────────────────────────────────────────────

describe("Notifiable mixin", () => {
  class Base {
    id = 42;
    email = "zed@example.com";
    name = "Zed";
  }
  class User extends Notifiable(Base) {}

  beforeAll(() => {
    const app = Application.create();
    const manager = new NotificationManager(
      NotificationConfig({ database: { table: "mixin_notifications" } }),
    );
    app.container.value("notifications", manager as never);
  });
  afterAll(() => {
    Application._resetInstance();
  });

  it("notify() stores to the database channel; unread/all/markAsRead work", async () => {
    const u = new User();
    await u.notify(new OrderShippedNotification(7));

    expect((await u.unreadNotifications()).length).toBe(1);
    expect((await u.notifications()).length).toBe(1);

    await u.markNotificationsAsRead();
    expect((await u.unreadNotifications()).length).toBe(0);
    // Still present in the full list — just marked read.
    expect((await u.notifications()).length).toBe(1);
  });
});
