import { describe, it, expect, beforeEach } from "bun:test";
import type { ServerWebSocket } from "bun";
import { TypedBroadcastManager } from "./TypedBroadcastManager.ts";
import { RedisBroadcastDriver } from "./RedisBroadcastDriver.ts";
import type {
  BroadcastChannelMap,
  ChannelParams,
  ChannelParamRecord,
  EventsOf,
  PayloadOf,
  StaticChannels,
  ParameterizedChannels,
  TypedBroadcastEvent,
} from "./TypedBroadcastManager.ts";
import type { WsConnectionData } from "./types.ts";

// ── Test channel map ──────────────────────────────────────────────────────────

interface Channels extends BroadcastChannelMap {
  posts: {
    PostCreated: { id: number; title: string };
    PostDeleted: { id: number };
  };
  global: {
    Announcement: { message: string };
  };
  "private-orders.[orderId]": {
    OrderShipped: { orderId: number; trackingCode: string };
    OrderCancelled: { orderId: number; reason: string };
  };
  "presence-room.[roomId]": {
    MessageSent: { userId: number; text: string };
  };
}

// ── Mock WebSocket ────────────────────────────────────────────────────────────

function makeWs(id: string = crypto.randomUUID()): {
  ws: ServerWebSocket<WsConnectionData>;
  sent: string[];
} {
  const sent: string[] = [];
  const ws = {
    data: { id } as WsConnectionData,
    send(msg: string) {
      sent.push(msg);
    },
    close() {},
    readyState: 1,
  } as unknown as ServerWebSocket<WsConnectionData>;
  return { ws, sent };
}

// ── TypeScript type-level tests (compile-time) ────────────────────────────────
// These assertions live in type positions; if the types are wrong, tsc fails.

type _ChannelParamsTest1 = ChannelParams<"private-orders.[orderId]">;
//   ^? 'orderId'
type _ChannelParamsTest2 = ChannelParams<"posts">;
//   ^? never
type _ChannelParamsTest3 = ChannelParams<"presence-room.[roomId]">;
//   ^? 'roomId'

type _StaticChannelsTest = StaticChannels<Channels>;
//   ^? 'posts' | 'global'
type _ParamChannelsTest = ParameterizedChannels<Channels>;
//   ^? 'private-orders.[orderId]' | 'presence-room.[roomId]'

type _EventsOfPosts = EventsOf<Channels, "posts">;
//   ^? 'PostCreated' | 'PostDeleted'
type _PayloadOfPostCreated = PayloadOf<Channels, "posts", "PostCreated">;
//   ^? { id: number; title: string }

type _ParamRecord = ChannelParamRecord<"private-orders.[orderId]">;
//   ^? { orderId: string | number }
type _NoParamRecord = ChannelParamRecord<"posts">;
//   ^? undefined

// ── Runtime: to() for static channels ────────────────────────────────────────

describe("TypedBroadcastManager — to() static channels", () => {
  let manager: TypedBroadcastManager<Channels>;

  beforeEach(() => {
    manager = new TypedBroadcastManager<Channels>();
  });

  it("delivers to all channel subscribers", async () => {
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "posts" }));

    manager.to("posts", "PostCreated", { id: 1, title: "Hello" });

    const last = JSON.parse(sent.at(-1)!) as { event: string; data: { id: number; title: string } };
    expect(last.event).toBe("PostCreated");
    expect(last.data.id).toBe(1);
    expect(last.data.title).toBe("Hello");
  });

  it("sends the correct event name", async () => {
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "posts" }));

    manager.to("posts", "PostDeleted", { id: 5 });

    const last = JSON.parse(sent.at(-1)!) as { event: string; data: unknown };
    expect(last.event).toBe("PostDeleted");
  });

  it("is a no-op when nobody is subscribed", () => {
    expect(() => manager.to("posts", "PostCreated", { id: 1, title: "x" })).not.toThrow();
  });

  it("broadcasts to multiple subscribers simultaneously", async () => {
    const { ws: ws1, sent: s1 } = makeWs();
    const { ws: ws2, sent: s2 } = makeWs();
    manager.handleOpen(ws1);
    manager.handleOpen(ws2);
    await manager.handleMessage(ws1, JSON.stringify({ event: "subscribe", channel: "global" }));
    await manager.handleMessage(ws2, JSON.stringify({ event: "subscribe", channel: "global" }));

    manager.to("global", "Announcement", { message: "System update" });

    const parse = (s: string[]) => JSON.parse(s.at(-1)!) as { event: string };
    expect(parse(s1).event).toBe("Announcement");
    expect(parse(s2).event).toBe("Announcement");
  });
});

// ── Runtime: toChannel() for parameterised channels ───────────────────────────

describe("TypedBroadcastManager — toChannel()", () => {
  let manager: TypedBroadcastManager<Channels>;

  beforeEach(() => {
    manager = new TypedBroadcastManager<Channels>();
    manager.authorizeWith(() => true); // allow private/presence subscriptions in tests
  });

  it("interpolates channel pattern and delivers to subscribers", async () => {
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    // Subscribe to the interpolated channel name
    await manager.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "private-orders.42" }),
    );

    manager.toChannel("private-orders.[orderId]", { orderId: 42 }, "OrderShipped", {
      orderId: 42,
      trackingCode: "UPS-TRACK-001",
    });

    const last = JSON.parse(sent.at(-1)!) as {
      event: string;
      channel: string;
      data: { orderId: number; trackingCode: string };
    };
    expect(last.event).toBe("OrderShipped");
    expect(last.channel).toBe("private-orders.42");
    expect(last.data.orderId).toBe(42);
    expect(last.data.trackingCode).toBe("UPS-TRACK-001");
  });

  it("does not deliver to subscribers on different channel instances", async () => {
    const { ws: ws42, sent: sent42 } = makeWs();
    const { ws: ws99, sent: sent99 } = makeWs();
    manager.handleOpen(ws42);
    manager.handleOpen(ws99);
    await manager.handleMessage(
      ws42,
      JSON.stringify({ event: "subscribe", channel: "private-orders.42" }),
    );
    await manager.handleMessage(
      ws99,
      JSON.stringify({ event: "subscribe", channel: "private-orders.99" }),
    );

    manager.toChannel("private-orders.[orderId]", { orderId: 42 }, "OrderCancelled", {
      orderId: 42,
      reason: "Out of stock",
    });

    const last42 = JSON.parse(sent42.at(-1)!) as { event: string };
    expect(last42.event).toBe("OrderCancelled"); // ws42 gets it

    // ws99's most recent message is subscription_succeeded, not the broadcast
    const last99 = JSON.parse(sent99.at(-1)!) as { event: string };
    expect(last99.event).toBe("subscription_succeeded"); // ws99 does NOT get it
  });

  it("supports presence channel patterns", async () => {
    manager.authorizePresenceWith((_ch, ws) => ({ id: ws.data.id, info: {} }));
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "presence-room.lobby" }),
    );

    manager.toChannel("presence-room.[roomId]", { roomId: "lobby" }, "MessageSent", {
      userId: 1,
      text: "Hello everyone",
    });

    const messages = sent.map((s) => JSON.parse(s) as { event: string });
    const broadcast = messages.find((m) => m.event === "MessageSent");
    expect(broadcast).toBeDefined();
  });

  it("throws when a required channel param is missing", () => {
    expect(() => {
      manager.toChannel(
        "private-orders.[orderId]",
        // @ts-expect-error — deliberately passing wrong params
        {},
        "OrderShipped",
        { orderId: 1, trackingCode: "x" },
      );
    }).toThrow("Missing channel parameter");
  });
});

// ── send() with TypedBroadcastEvent ──────────────────────────────────────────

describe("TypedBroadcastManager — send() with TypedBroadcastEvent", () => {
  class PostCreated implements TypedBroadcastEvent<Channels, "posts", "PostCreated"> {
    constructor(
      private readonly id: number,
      private readonly title: string,
    ) {}
    broadcastOn() {
      return "posts" as const;
    }
    broadcastAs() {
      return "PostCreated" as const;
    }
    broadcastWith() {
      return { id: this.id, title: this.title };
    }
  }

  class OrderShipped implements TypedBroadcastEvent<
    Channels,
    "private-orders.[orderId]",
    "OrderShipped"
  > {
    constructor(
      private readonly orderId: number,
      private readonly trackingCode: string,
    ) {}
    broadcastOn() {
      return `private-orders.${this.orderId}`;
    }
    broadcastAs() {
      return "OrderShipped" as const;
    }
    broadcastWith() {
      return { orderId: this.orderId, trackingCode: this.trackingCode };
    }
  }

  let manager: TypedBroadcastManager<Channels>;
  beforeEach(() => {
    manager = new TypedBroadcastManager<Channels>();
    manager.authorizeWith(() => true);
  });

  it("dispatches a TypedBroadcastEvent to the correct channel", async () => {
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "posts" }));

    manager.send(new PostCreated(7, "Typed Event Works"));

    const last = JSON.parse(sent.at(-1)!) as { event: string; data: { id: number; title: string } };
    expect(last.event).toBe("PostCreated");
    expect(last.data.id).toBe(7);
    expect(last.data.title).toBe("Typed Event Works");
  });

  it("dispatches to a dynamically-named channel from broadcastOn()", async () => {
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "private-orders.55" }),
    );

    manager.send(new OrderShipped(55, "FEDEX-999"));

    const last = JSON.parse(sent.at(-1)!) as { event: string; data: { trackingCode: string } };
    expect(last.event).toBe("OrderShipped");
    expect(last.data.trackingCode).toBe("FEDEX-999");
  });

  it("only delivers to the correct channel", async () => {
    const { ws: wsPosts, sent: sentPosts } = makeWs();
    const { ws: wsOther, sent: sentOther } = makeWs();
    manager.handleOpen(wsPosts);
    manager.handleOpen(wsOther);
    await manager.handleMessage(wsPosts, JSON.stringify({ event: "subscribe", channel: "posts" }));
    await manager.handleMessage(wsOther, JSON.stringify({ event: "subscribe", channel: "global" }));

    manager.send(new PostCreated(10, "Only posts"));

    const lastPosts = JSON.parse(sentPosts.at(-1)!) as { event: string };
    expect(lastPosts.event).toBe("PostCreated");

    const lastOther = JSON.parse(sentOther.at(-1)!) as { event: string };
    expect(lastOther.event).toBe("subscription_succeeded"); // NOT PostCreated
  });
});

// ── Inheritance from BroadcastManager ────────────────────────────────────────

describe("TypedBroadcastManager — BroadcastManager APIs still work", () => {
  let manager: TypedBroadcastManager<Channels>;
  beforeEach(() => {
    manager = new TypedBroadcastManager<Channels>();
  });

  it("handleOpen / handleClose track connections", () => {
    const { ws } = makeWs();
    manager.handleOpen(ws);
    expect(manager.connectionCount()).toBe(1);
    manager.handleClose(ws);
    expect(manager.connectionCount()).toBe(0);
  });

  it("subscribe / unsubscribe work through handleMessage", async () => {
    const { ws } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "posts" }));
    expect(manager.subscriberCount("posts")).toBe(1);
    await manager.handleMessage(ws, JSON.stringify({ event: "unsubscribe", channel: "posts" }));
    expect(manager.subscriberCount("posts")).toBe(0);
  });

  it("authorizeWith auth callback is still honoured", async () => {
    manager.authorizeWith(() => false);
    const { ws, sent } = makeWs();
    manager.handleOpen(ws);
    await manager.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "private-orders.1" }),
    );
    const last = JSON.parse(sent.at(-1)!) as { event: string };
    expect(last.event).toBe("subscription_error");
  });

  it("wsHandlers getter returns open/message/close handlers", () => {
    const handlers = manager.wsHandlers;
    expect(typeof handlers.open).toBe("function");
    expect(typeof handlers.message).toBe("function");
    expect(typeof handlers.close).toBe("function");
  });
});

describe("toOthers() survives every driver, not just the in-memory one", () => {
  it("TypedBroadcastManager forwards the exclusion instead of dropping it", () => {
    // The override declared three parameters and omitted the fourth — not a type error, so
    // the exclusion silently vanished for anything routed through this class.
    const manager = new TypedBroadcastManager();
    const sent: Array<{ id: string; msg: string }> = [];
    const conn = (id: string) => ({ send: (msg: string) => sent.push({ id, msg }) });

    // Drive the private connection/subscription maps directly — this is about `to()`
    // forwarding its fourth argument, not about the subscribe handshake.
    const internals = manager as unknown as {
      _conns: Map<string, { send(msg: string): void }>;
      _subs: Map<string, Set<string>>;
    };
    internals._conns.set("a", conn("a"));
    internals._conns.set("b", conn("b"));
    internals._subs.set("room", new Set(["a", "b"]));

    manager.to("room", "Ping", {}, { exceptSocketId: "a" });

    expect(sent.map((s) => s.id)).toEqual(["b"]);
  });

  it("the Redis envelope carries the excluded socket across the pub/sub hop", () => {
    // Without a field for it, the exclusion could not survive the hop even in principle —
    // and Redis is the driver documented for horizontal scaling.
    const published: string[] = [];
    const driver = new RedisBroadcastDriver("redis://localhost:6379");
    (driver as unknown as { _pub: { publish(t: string, m: string): Promise<void> } })._pub = {
      publish: async (_t, m) => {
        published.push(m);
      },
    };

    driver.to("room", "Ping", { x: 1 }, { exceptSocketId: "a" });

    expect(JSON.parse(published[0]!)).toMatchObject({
      channel: "room",
      event: "Ping",
      exceptSocketId: "a",
    });
  });
});
