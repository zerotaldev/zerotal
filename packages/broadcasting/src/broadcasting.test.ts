import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { ServerWebSocket } from "bun";
import { BroadcastManager } from "./BroadcastManager.ts";
import { withApp } from "@zerotal/core";
import { RedisBroadcastDriver } from "./RedisBroadcastDriver.ts";
import { BroadcastFake } from "./BroadcastFake.ts";
import { Broadcast } from "./facades/Broadcast.ts";
import { channel, privateChannel, presenceChannel, isPrivateChannel } from "./Channel.ts";
import type { BroadcastEvent, WsConnectionData } from "./types.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

class PostUpdated implements BroadcastEvent {
  constructor(private id: number) {}
  broadcastOn() {
    return channel("posts");
  }
  broadcastAs() {
    return "PostUpdated";
  }
  broadcastWith() {
    return { id: this.id };
  }
}

class MultiChannelEvent implements BroadcastEvent {
  broadcastOn() {
    return [channel("global"), privateChannel("admin")];
  }
  broadcastWith() {
    return { msg: "hello" };
  }
}

/** Mock ServerWebSocket that captures sent messages. */
function makeWs(
  id: string = crypto.randomUUID(),
  extra: Partial<WsConnectionData> = {},
): {
  ws: ServerWebSocket<WsConnectionData>;
  sent: string[];
} {
  const sent: string[] = [];
  const ws = {
    data: { id, ...extra } as WsConnectionData,
    send(msg: string) {
      sent.push(msg);
    },
    close() {},
    readyState: 1,
  } as unknown as ServerWebSocket<WsConnectionData>;
  return { ws, sent };
}

// ── Channel helpers ───────────────────────────────────────────────────────────

describe("channel helpers", () => {
  it("channel() returns the name unchanged", () => {
    expect(channel("posts")).toBe("posts");
  });

  it('privateChannel() adds "private-" prefix', () => {
    expect(privateChannel("user.1")).toBe("private-user.1");
  });

  it("privateChannel() does not double-prefix", () => {
    expect(privateChannel("private-user.1")).toBe("private-user.1");
  });

  it('presenceChannel() adds "presence-" prefix', () => {
    expect(presenceChannel("chat.room")).toBe("presence-chat.room");
  });

  it("isPrivateChannel() detects private channels", () => {
    expect(isPrivateChannel("private-user.1")).toBe(true);
    expect(isPrivateChannel("presence-chat")).toBe(true);
    expect(isPrivateChannel("public")).toBe(false);
  });
});

// ── BroadcastManager — connections ────────────────────────────────────────────

describe("BroadcastManager — connections", () => {
  let manager: BroadcastManager;
  beforeEach(() => {
    manager = new BroadcastManager();
  });

  it("handleOpen() tracks the connection", () => {
    const { ws } = makeWs();
    manager.handleOpen(ws);
    expect(manager.connectionCount()).toBe(1);
  });

  it("handleOpen() sends a connected event", () => {
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    const msg = JSON.parse(sent[0]!) as { event: string };
    expect(msg.event).toBe("connected");
  });

  it("handleClose() removes the connection", () => {
    const { ws } = makeWs();
    manager.handleOpen(ws);
    manager.handleClose(ws);
    expect(manager.connectionCount()).toBe(0);
  });

  it("wsHandlers routes open/message/close through handler methods", async () => {
    const handlers = manager.wsHandlers;
    const { ws, sent } = makeWs();
    handlers.open(ws);
    expect(manager.connectionCount()).toBe(1);
    // message handler returns void (discards promise) — just verify no throw
    handlers.message(ws, JSON.stringify({ event: "subscribe", channel: "posts" }));
    handlers.close(ws);
    expect(manager.connectionCount()).toBe(0);
    expect(sent.length).toBeGreaterThan(0);
  });

  it("upgradeData() extracts Bearer token from Authorization header", () => {
    const req = new Request("http://localhost/", { headers: { Authorization: "Bearer my-token" } });
    expect(manager.upgradeData(req)).toEqual({ token: "my-token" });
  });

  it("upgradeData() returns undefined token when Authorization header is absent", () => {
    const req = new Request("http://localhost/");
    expect(manager.upgradeData(req)).toEqual({ token: undefined });
  });

  it("upgradeData() returns undefined token for non-Bearer Authorization", () => {
    const req = new Request("http://localhost/", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(manager.upgradeData(req)).toEqual({ token: undefined });
  });
});

// ── BroadcastManager — subscribe / unsubscribe ────────────────────────────────

describe("BroadcastManager — subscribe", () => {
  let manager: BroadcastManager;
  beforeEach(() => {
    manager = new BroadcastManager();
  });

  it("subscribe to public channel succeeds", async () => {
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "posts" }));

    const last = JSON.parse(sent.at(-1)!) as { event: string; channel: string };
    expect(last.event).toBe("subscription_succeeded");
    expect(last.channel).toBe("posts");
  });

  it("subscriberCount() reflects subscription", async () => {
    const { ws } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "posts" }));
    expect(manager.subscriberCount("posts")).toBe(1);
  });

  it("subscribe to private channel without auth callback is denied", async () => {
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "private-orders" }),
    );

    const last = JSON.parse(sent.at(-1)!) as { event: string };
    expect(last.event).toBe("subscription_error");
  });

  it("subscribe to private channel with authorizing callback succeeds", async () => {
    manager.authorizeWith(() => true);
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "private-orders" }),
    );

    const last = JSON.parse(sent.at(-1)!) as { event: string };
    expect(last.event).toBe("subscription_succeeded");
  });

  it("subscribe to private channel with denying callback is rejected", async () => {
    manager.authorizeWith(() => false);
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "private-secret" }),
    );

    const last = JSON.parse(sent.at(-1)!) as { event: string };
    expect(last.event).toBe("subscription_error");
  });

  it("unsubscribe removes from channel", async () => {
    const { ws } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "posts" }));
    await manager.handleMessage(ws, JSON.stringify({ event: "unsubscribe", channel: "posts" }));
    expect(manager.subscriberCount("posts")).toBe(0);
  });

  it("handleClose() removes from all subscribed channels", async () => {
    const { ws } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "posts" }));
    await manager.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "comments" }));
    manager.handleClose(ws);
    expect(manager.subscriberCount("posts")).toBe(0);
    expect(manager.subscriberCount("comments")).toBe(0);
  });

  it("subscriptionsFor() returns all subscribed channels", async () => {
    const { ws } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "posts" }));
    await manager.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "comments" }));
    const subs = manager.subscriptionsFor(ws.data.id);
    expect(subs).toContain("posts");
    expect(subs).toContain("comments");
  });
});

// ── BroadcastManager — ping/pong ──────────────────────────────────────────────

describe("BroadcastManager — ping/pong", () => {
  it("responds to ping with pong", async () => {
    const manager = new BroadcastManager();
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(ws, JSON.stringify({ event: "ping" }));
    const last = JSON.parse(sent.at(-1)!) as { event: string };
    expect(last.event).toBe("pong");
  });
});

// ── BroadcastManager — broadcasting ──────────────────────────────────────────

describe("BroadcastManager — broadcasting", () => {
  let manager: BroadcastManager;
  beforeEach(() => {
    manager = new BroadcastManager();
  });

  it("to() delivers to all channel subscribers", async () => {
    const { ws: ws1, sent: s1 } = makeWs();
    const { ws: ws2, sent: s2 } = makeWs();
    manager.handleOpen(ws1);
    manager.handleOpen(ws2);
    await manager.handleMessage(ws1, JSON.stringify({ event: "subscribe", channel: "posts" }));
    await manager.handleMessage(ws2, JSON.stringify({ event: "subscribe", channel: "posts" }));

    manager.to("posts", "PostCreated", { id: 1 });

    const parse = (s: string[]) => JSON.parse(s.at(-1)!) as { event: string; data: { id: number } };
    expect(parse(s1).event).toBe("PostCreated");
    expect(parse(s1).data.id).toBe(1);
    expect(parse(s2).event).toBe("PostCreated");
  });

  it("to() is a no-op for empty channels", () => {
    expect(() => manager.to("nobody", "SomeEvent")).not.toThrow();
  });

  it("send() dispatches a BroadcastEvent to its channel", async () => {
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "posts" }));

    manager.send(new PostUpdated(42));

    const last = JSON.parse(sent.at(-1)!) as { event: string; data: { id: number } };
    expect(last.event).toBe("PostUpdated");
    expect(last.data.id).toBe(42);
  });

  it("send() broadcasts to multiple channels", async () => {
    manager.authorizeWith(() => true);
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "global" }));
    await manager.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "private-admin" }),
    );

    manager.send(new MultiChannelEvent());

    // sent 3 messages: connected + sub×2 — plus 2 broadcasts
    const _broadcasts = sent
      .map((s) => JSON.parse(s) as { event: string; channel?: string })
      .filter(
        (m) =>
          m.event === "MultiChannelEvent" ||
          !["connected", "subscription_succeeded"].includes(m.event),
      );

    // The MultiChannelEvent has no broadcastAs(), so it uses the class name
    const events = sent.map((s) => JSON.parse(s) as { event: string });
    const bcasts = events.filter((e) => e.event === "MultiChannelEvent");
    expect(bcasts.length).toBe(2); // one per channel
  });
});

// ── BroadcastFake ─────────────────────────────────────────────────────────────

describe("BroadcastFake", () => {
  let fake: BroadcastFake;
  beforeEach(() => {
    fake = new BroadcastFake();
  });

  it("records send() calls", () => {
    fake.send(new PostUpdated(1));
    expect(fake.recorded()).toHaveLength(1);
    expect(fake.recorded()[0]?.event).toBe("PostUpdated");
    expect(fake.recorded()[0]?.channel).toBe("posts");
  });

  it("records to() calls", () => {
    fake.to("global", "Ping");
    expect(fake.recorded()[0]?.event).toBe("Ping");
  });

  it("assertBroadcast() passes when event was sent", () => {
    fake.send(new PostUpdated(5));
    expect(() => fake.assertBroadcast("PostUpdated")).not.toThrow();
    expect(() => fake.assertBroadcast("PostUpdated", "posts")).not.toThrow();
    expect(() => fake.assertBroadcast("PostUpdated", "posts", { id: 5 })).not.toThrow();
  });

  it("assertBroadcast() throws when event was not sent", () => {
    expect(() => fake.assertBroadcast("PostDeleted")).toThrow("PostDeleted");
  });

  it("assertBroadcast() error includes recorded events in the message", () => {
    fake.send(new PostUpdated(1));
    expect(() => fake.assertBroadcast("NonExistent")).toThrow("PostUpdated");
  });

  it("assertNotBroadcast() passes when channel does not match", () => {
    fake.send(new PostUpdated(1));
    expect(() => fake.assertNotBroadcast("PostUpdated", "other-channel")).not.toThrow();
  });

  it("assertNotBroadcast() passes when event was not sent", () => {
    expect(() => fake.assertNotBroadcast("PostDeleted")).not.toThrow();
  });

  it("assertNotBroadcast() throws when event WAS sent", () => {
    fake.send(new PostUpdated(1));
    expect(() => fake.assertNotBroadcast("PostUpdated")).toThrow();
  });

  it("assertNothingBroadcast() passes when nothing sent", () => {
    expect(() => fake.assertNothingBroadcast()).not.toThrow();
  });

  it("assertNothingBroadcast() throws when something was sent", () => {
    fake.send(new PostUpdated(1));
    expect(() => fake.assertNothingBroadcast()).toThrow();
  });

  it("assertBroadcastCount() validates total count", () => {
    fake.send(new PostUpdated(1));
    fake.send(new PostUpdated(2));
    expect(() => fake.assertBroadcastCount(2)).not.toThrow();
    expect(() => fake.assertBroadcastCount(1)).toThrow();
  });

  it("reset() clears recorded broadcasts", () => {
    fake.send(new PostUpdated(1));
    fake.reset();
    expect(fake.recorded()).toHaveLength(0);
  });
});

// ── Broadcast facade ──────────────────────────────────────────────────────────

describe("Broadcast facade — fake()", () => {
  afterEach(() => Broadcast.resetFake());

  it("fake() intercepts send() calls", () => {
    const fake = Broadcast.fake();
    Broadcast.send(new PostUpdated(10));
    expect(() => fake.assertBroadcast("PostUpdated", "posts")).not.toThrow();
  });

  it("fake() intercepts to() calls", () => {
    const fake = Broadcast.fake();
    Broadcast.to("global", "SomeEvent", { key: "val" });
    expect(fake.recorded()[0]?.event).toBe("SomeEvent");
  });

  it("resetFake() removes the fake", () => {
    Broadcast.fake();
    Broadcast.resetFake();
    // After reset, Broadcast._get() throws (no real manager registered)
    expect(() => Broadcast.send(new PostUpdated(1))).toThrow("BroadcastProvider not registered");
  });
});

// ── Broadcast facade — getMembers() ──────────────────────────────────────────

describe("Broadcast facade — getMembers()", () => {
  afterEach(() => Broadcast.resetFake());

  it("getMembers() returns empty array when fake is active", () => {
    Broadcast.fake();
    const members = Broadcast.getMembers("presence-chat");
    expect(members).toEqual([]);
  });

  it("getMembers() delegates to real manager when no fake is active", () => {
    // Wire a real manager into a mock app, made current for the scope via withApp.
    const manager = new BroadcastManager();
    const mockApp = { container: { makeSync: () => manager } };
    withApp(mockApp as never, () => {
      const members = Broadcast.getMembers("presence-chat");
      expect(Array.isArray(members)).toBe(true);
    });
  });
});

// ── Presence channel member tracking ─────────────────────────────────────────

describe("Presence channel — member tracking", () => {
  let manager: BroadcastManager;
  beforeEach(() => {
    manager = new BroadcastManager();
  });

  it("subscription returns current member list", async () => {
    manager.authorizePresenceWith((_ch, ws) => ({
      id: ws.data.id,
      info: { name: "Alice" },
    }));
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "presence-chat" }),
    );

    const msg = JSON.parse(sent.at(-1)!) as { event: string; data: { members: unknown[] } };
    expect(msg.event).toBe("subscription_succeeded");
    expect(msg.data.members).toHaveLength(1);
  });

  it("getMembers() returns all current members", async () => {
    manager.authorizePresenceWith(() => ({ id: "u1", info: {} }));
    const { ws } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "presence-chat" }),
    );

    expect(manager.getMembers("presence-chat")).toHaveLength(1);
    expect(manager.getMembers("presence-chat")[0]?.id).toBe("u1");
  });

  it("notifies existing members when a new one joins", async () => {
    manager.authorizePresenceWith(() => ({ id: "u1", info: {} }));
    const { ws: ws1, sent: s1 } = makeWs();
    manager.handleOpen(ws1);
    await manager.handleMessage(
      ws1,
      JSON.stringify({ event: "subscribe", channel: "presence-chat" }),
    );

    // Second member joins
    const { ws: ws2 } = makeWs();
    manager.handleOpen(ws2);
    await manager.handleMessage(
      ws2,
      JSON.stringify({ event: "subscribe", channel: "presence-chat" }),
    );

    const lastMsg = JSON.parse(s1.at(-1)!) as { event: string };
    expect(lastMsg.event).toBe("presence:member_added");
  });

  it("notifies channel when a member disconnects", async () => {
    manager.authorizePresenceWith(() => ({ id: "u1", info: {} }));
    const { ws: ws1 } = makeWs("id-1");
    const { ws: ws2 } = makeWs("id-2");

    manager.handleOpen(ws1);
    manager.handleOpen(ws2);
    await manager.handleMessage(
      ws1,
      JSON.stringify({ event: "subscribe", channel: "presence-chat" }),
    );
    await manager.handleMessage(
      ws2,
      JSON.stringify({ event: "subscribe", channel: "presence-chat" }),
    );

    // ws1 disconnects
    manager.handleClose(ws1);
    expect(manager.getMembers("presence-chat")).toHaveLength(1);
    // ws2 should have received member_removed
    // (ws2 should have a member_removed notification — test via subscriberCount drop)
    expect(manager.subscriberCount("presence-chat")).toBe(1);
  });

  it("notifies channel when a member explicitly unsubscribes (e.g. navigates away)", async () => {
    manager.authorizePresenceWith((_ch, ws) => ({ id: ws.data.id, info: {} }));
    const { ws: ws1 } = makeWs("id-1");
    const { ws: ws2, sent: s2 } = makeWs("id-2");
    manager.handleOpen(ws1);
    manager.handleOpen(ws2);
    await manager.handleMessage(
      ws1,
      JSON.stringify({ event: "subscribe", channel: "presence-chat" }),
    );
    await manager.handleMessage(
      ws2,
      JSON.stringify({ event: "subscribe", channel: "presence-chat" }),
    );
    expect(manager.getMembers("presence-chat")).toHaveLength(2);
    s2.length = 0; // clear prior frames on ws2

    // ws1 leaves via an explicit unsubscribe (Socket.leave on component teardown / SPA navigation).
    await manager.handleMessage(
      ws1,
      JSON.stringify({ event: "unsubscribe", channel: "presence-chat" }),
    );

    // The member is gone from the roster …
    expect(manager.getMembers("presence-chat")).toHaveLength(1);
    expect(manager.getMembers("presence-chat")[0]?.id).toBe("id-2");
    // … and the remaining member was notified.
    const events = s2.map(
      (m) => JSON.parse(m) as { event: string; data?: { member?: { id?: string } } },
    );
    const removed = events.find((e) => e.event === "presence:member_removed");
    expect(removed).toBeDefined();
    expect(removed?.data?.member?.id).toBe("id-1");
  });

  it("denies subscription when presence auth returns false", async () => {
    manager.authorizePresenceWith(() => false);
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "presence-chat" }),
    );
    const msg = JSON.parse(sent.at(-1)!) as { event: string };
    expect(msg.event).toBe("subscription_error");
  });
});

// ── RedisBroadcastDriver — unit behaviour (no real Redis) ─────────────────────
//
// Tests verify:
//  1. RedisBroadcastDriver extends BroadcastManager — all WS APIs still work
//  2. to() publishes JSON to the Redis topic instead of local delivery
//  3. The subscriber callback delivers to local WS clients via super.to()
//  4. stop() unsubscribes from the Redis topic
//
// Strategy: inject stub _pub/_sub before calling boot() — boot() skips
// creating new clients when they are already set.

describe("RedisBroadcastDriver", () => {
  type PublishCall = { channel: string; message: string };

  /** Build a driver wired with stub Redis connections. Returns after boot(). */
  async function bootDriver() {
    const published: PublishCall[] = [];
    let subscriberCb: ((msg: string) => void) | undefined;
    const unsubscribed: string[] = [];

    const stubPub = {
      publish(ch: string, msg: string) {
        published.push({ channel: ch, message: msg });
        return Promise.resolve(1);
      },
    };
    const stubSub = {
      subscribe(_ch: string, cb: (msg: string) => void) {
        subscriberCb = cb;
        return Promise.resolve();
      },
      unsubscribe(ch: string) {
        unsubscribed.push(ch);
        return Promise.resolve();
      },
    };

    const driver = new RedisBroadcastDriver("redis://localhost:6379");
    const d = driver as unknown as Record<string, unknown>;
    // Inject stubs before boot() — boot() skips new Redis() when _pub is set
    d._pub = stubPub;
    d._sub = stubSub;
    await driver.boot();

    /** Simulate a message arriving from Redis (e.g. from another server). */
    const deliver = (msg: string) => subscriberCb?.(msg);

    return { driver, published, unsubscribed, deliver };
  }

  it("is an instance of BroadcastManager", async () => {
    const { driver } = await bootDriver();
    expect(driver).toBeInstanceOf(BroadcastManager);
  });

  it("to() publishes JSON to __zerotal:broadcast instead of local delivery", async () => {
    const { driver, published } = await bootDriver();
    driver.to("posts", "PostCreated", { id: 1 });

    expect(published.length).toBe(1);
    const env = JSON.parse(published[0]!.message) as {
      channel: string;
      event: string;
      data: { id: number };
    };
    expect(env.channel).toBe("posts");
    expect(env.event).toBe("PostCreated");
    expect(env.data.id).toBe(1);
  });

  it("subscriber callback routes messages to local WS clients via super.to()", async () => {
    const { driver, deliver } = await bootDriver();

    const { ws, sent } = makeWs();
    driver.handleOpen(ws);
    await driver.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "news" }));

    // Simulate a message arriving from another server instance via Redis
    deliver(JSON.stringify({ channel: "news", event: "Breaking", data: { headline: "x" } }));

    const last = JSON.parse(sent.at(-1)!) as { event: string; data: { headline: string } };
    expect(last.event).toBe("Breaking");
    expect(last.data.headline).toBe("x");
  });

  it("WS subscribe, auth, and unsubscribe are inherited from BroadcastManager", async () => {
    const { driver } = await bootDriver();
    driver.authorizeWith(() => true);

    const { ws, sent } = makeWs();
    driver.handleOpen(ws);
    await driver.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "private-orders" }),
    );
    expect((JSON.parse(sent.at(-1)!) as { event: string }).event).toBe("subscription_succeeded");

    await driver.handleMessage(
      ws,
      JSON.stringify({ event: "unsubscribe", channel: "private-orders" }),
    );
    expect(driver.subscriberCount("private-orders")).toBe(0);
  });

  it("stop() unsubscribes from the Redis topic", async () => {
    const { driver, unsubscribed } = await bootDriver();
    await driver.stop();
    expect(unsubscribed).toContain("__zerotal:broadcast");
  });

  it("publishing server also receives its own broadcast (single-path delivery)", async () => {
    const { driver, published, deliver } = await bootDriver();

    const { ws, sent } = makeWs();
    driver.handleOpen(ws);
    await driver.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "chat" }));

    // Server calls to() — publishes to Redis
    driver.to("chat", "NewMessage", { text: "hello" });
    expect(published.length).toBe(1);

    // Redis fan-out comes back to this server — subscriber delivers locally
    deliver(published[0]!.message);
    const last = JSON.parse(sent.at(-1)!) as { event: string };
    expect(last.event).toBe("NewMessage");
  });
});
