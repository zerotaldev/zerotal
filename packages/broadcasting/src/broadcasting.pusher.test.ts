import { describe, it, expect, beforeEach } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createHmac } from "node:crypto";
import { PusherCompatManager } from "./PusherCompatManager.ts";
import type { WsConnectionData } from "./types.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const APP_KEY = "test-app-key";
const APP_SECRET = "test-app-secret";

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

function sign(socketId: string, channel: string, channelData?: string): string {
  // Mirrors PusherCompatManager.signAuth, which keeps Pusher's `:`-joined wire format for
  // protocol compatibility. Delimiter injection is prevented by rejecting `:` in channel names
  // at subscribe time rather than by changing the signed encoding.
  const str = channelData ? `${socketId}:${channel}:${channelData}` : `${socketId}:${channel}`;
  const sig = createHmac("sha256", APP_SECRET).update(str).digest("hex");
  return `${APP_KEY}:${sig}`;
}

// ── Connection established ────────────────────────────────────────────────────

describe("PusherCompatManager — connection", () => {
  let m: PusherCompatManager;
  beforeEach(() => {
    m = new PusherCompatManager(APP_KEY, APP_SECRET);
  });

  it("sends pusher:connection_established on open", () => {
    const { ws, sent } = makeWs();
    m.handleOpen(ws);
    const msg = JSON.parse(sent[0]!) as { event: string; data: string };
    expect(msg.event).toBe("pusher:connection_established");
    const data = JSON.parse(msg.data) as { socket_id: string; activity_timeout: number };
    expect(data.socket_id).toBe(ws.data.id);
    expect(data.activity_timeout).toBe(120);
  });

  it("tracks the connection", () => {
    const { ws } = makeWs();
    m.handleOpen(ws);
    expect(m.connectionCount()).toBe(1);
  });
});

// ── Ping / pong ───────────────────────────────────────────────────────────────

describe("PusherCompatManager — ping/pong", () => {
  it("responds to pusher:ping with pusher:pong", async () => {
    const m = new PusherCompatManager(APP_KEY, APP_SECRET);
    const { ws, sent } = makeWs();
    m.handleOpen(ws);
    await m.handleMessage(ws, JSON.stringify({ event: "pusher:ping", data: {} }));
    const last = JSON.parse(sent.at(-1)!) as { event: string };
    expect(last.event).toBe("pusher:pong");
  });
});

// ── Public channel subscribe ──────────────────────────────────────────────────

describe("PusherCompatManager — public channel", () => {
  let m: PusherCompatManager;
  beforeEach(() => {
    m = new PusherCompatManager(APP_KEY, APP_SECRET);
  });

  it("sends pusher_internal:subscription_succeeded", async () => {
    const { ws, sent } = makeWs();
    m.handleOpen(ws);
    await m.handleMessage(
      ws,
      JSON.stringify({
        event: "pusher:subscribe",
        data: { channel: "posts" },
      }),
    );
    const last = JSON.parse(sent.at(-1)!) as { event: string; channel: string; data: string };
    expect(last.event).toBe("pusher_internal:subscription_succeeded");
    expect(last.channel).toBe("posts");
    expect(last.data).toBe("{}");
  });

  it("tracks subscriber count", async () => {
    const { ws } = makeWs();
    m.handleOpen(ws);
    await m.handleMessage(
      ws,
      JSON.stringify({ event: "pusher:subscribe", data: { channel: "posts" } }),
    );
    expect(m.subscriberCount("posts")).toBe(1);
  });

  it("delivers broadcast events with JSON-stringified data", async () => {
    const { ws, sent } = makeWs();
    m.handleOpen(ws);
    await m.handleMessage(
      ws,
      JSON.stringify({ event: "pusher:subscribe", data: { channel: "posts" } }),
    );

    m.to("posts", "PostCreated", { id: 42 });

    const last = JSON.parse(sent.at(-1)!) as { event: string; channel: string; data: string };
    expect(last.event).toBe("PostCreated");
    expect(last.channel).toBe("posts");
    expect(JSON.parse(last.data)).toEqual({ id: 42 });
  });

  it("pusher:unsubscribe removes subscriber silently", async () => {
    const { ws } = makeWs();
    m.handleOpen(ws);
    await m.handleMessage(
      ws,
      JSON.stringify({ event: "pusher:subscribe", data: { channel: "posts" } }),
    );
    await m.handleMessage(
      ws,
      JSON.stringify({ event: "pusher:unsubscribe", data: { channel: "posts" } }),
    );
    expect(m.subscriberCount("posts")).toBe(0);
  });
});

// ── Private channel subscribe (HMAC auth) ─────────────────────────────────────

describe("PusherCompatManager — private channel", () => {
  let m: PusherCompatManager;
  beforeEach(() => {
    m = new PusherCompatManager(APP_KEY, APP_SECRET);
  });

  it("denies subscription without auth token", async () => {
    const { ws, sent } = makeWs();
    m.handleOpen(ws);
    await m.handleMessage(
      ws,
      JSON.stringify({
        event: "pusher:subscribe",
        data: { channel: "private-orders" },
      }),
    );
    const last = JSON.parse(sent.at(-1)!) as { event: string; data: string };
    expect(last.event).toBe("pusher:error");
    expect(JSON.parse(last.data)).toMatchObject({ code: 4009 });
  });

  it("denies subscription with wrong auth token", async () => {
    const { ws, sent } = makeWs("socket-1");
    m.handleOpen(ws);
    await m.handleMessage(
      ws,
      JSON.stringify({
        event: "pusher:subscribe",
        data: { channel: "private-orders", auth: "bad-key:bad-sig" },
      }),
    );
    const last = JSON.parse(sent.at(-1)!) as { event: string };
    expect(last.event).toBe("pusher:error");
  });

  it("allows subscription with valid HMAC auth token", async () => {
    const { ws, sent } = makeWs("socket-1");
    m.handleOpen(ws);
    const auth = sign("socket-1", "private-orders");
    await m.handleMessage(
      ws,
      JSON.stringify({
        event: "pusher:subscribe",
        data: { channel: "private-orders", auth },
      }),
    );
    const last = JSON.parse(sent.at(-1)!) as { event: string; channel: string };
    expect(last.event).toBe("pusher_internal:subscription_succeeded");
    expect(last.channel).toBe("private-orders");
  });

  it("signAuth() generates the correct HMAC", () => {
    const m2 = new PusherCompatManager(APP_KEY, APP_SECRET);
    const token = m2.signAuth("socket-abc", "private-test");
    expect(token).toBe(sign("socket-abc", "private-test"));
  });
});

// ── Presence channel subscribe ────────────────────────────────────────────────

describe("PusherCompatManager — presence channel", () => {
  let m: PusherCompatManager;
  beforeEach(() => {
    m = new PusherCompatManager(APP_KEY, APP_SECRET);
  });

  function subscribePresence(
    ws: ServerWebSocket<WsConnectionData>,
    channel: string,
    userId: string,
    socketId: string,
  ) {
    const channelData = JSON.stringify({ user_id: userId, user_info: { name: userId } });
    const auth = sign(socketId, channel, channelData);
    return m.handleMessage(
      ws,
      JSON.stringify({
        event: "pusher:subscribe",
        data: { channel, auth, channel_data: channelData },
      }),
    );
  }

  it("subscription_succeeded includes presence data", async () => {
    const { ws, sent } = makeWs("sock-1");
    m.handleOpen(ws);
    await subscribePresence(ws, "presence-chat", "user-1", "sock-1");

    const last = JSON.parse(sent.at(-1)!) as { event: string; data: string; channel: string };
    expect(last.event).toBe("pusher_internal:subscription_succeeded");
    expect(last.channel).toBe("presence-chat");
    const data = JSON.parse(last.data) as {
      presence: { count: number; ids: string[]; hash: Record<string, unknown> };
    };
    expect(data.presence.count).toBe(1);
    expect(data.presence.ids).toContain("user-1");
  });

  it("notifies existing members when a new one joins (pusher_internal:member_added)", async () => {
    const { ws: ws1, sent: s1 } = makeWs("sock-1");
    const { ws: ws2 } = makeWs("sock-2");
    m.handleOpen(ws1);
    m.handleOpen(ws2);

    await subscribePresence(ws1, "presence-chat", "user-1", "sock-1");
    await subscribePresence(ws2, "presence-chat", "user-2", "sock-2");

    const last = JSON.parse(s1.at(-1)!) as { event: string; data: string };
    expect(last.event).toBe("pusher_internal:member_added");
    const data = JSON.parse(last.data) as { user_id: string };
    expect(data.user_id).toBe("user-2");
  });

  it("notifies remaining members when one disconnects (pusher_internal:member_removed)", async () => {
    const { ws: ws1, sent: s1 } = makeWs("sock-1");
    const { ws: ws2 } = makeWs("sock-2");
    m.handleOpen(ws1);
    m.handleOpen(ws2);

    await subscribePresence(ws1, "presence-chat", "user-1", "sock-1");
    await subscribePresence(ws2, "presence-chat", "user-2", "sock-2");

    m.handleClose(ws2);

    const last = JSON.parse(s1.at(-1)!) as { event: string; data: string };
    expect(last.event).toBe("pusher_internal:member_removed");
    const data = JSON.parse(last.data) as { user_id: string };
    expect(data.user_id).toBe("user-2");
  });

  it("denies subscription with no auth", async () => {
    const { ws, sent } = makeWs("sock-1");
    m.handleOpen(ws);
    await m.handleMessage(
      ws,
      JSON.stringify({
        event: "pusher:subscribe",
        data: { channel: "presence-chat" },
      }),
    );
    const last = JSON.parse(sent.at(-1)!) as { event: string };
    expect(last.event).toBe("pusher:error");
  });

  it("getMembers() returns correct members", async () => {
    const { ws } = makeWs("sock-1");
    m.handleOpen(ws);
    await subscribePresence(ws, "presence-chat", "alice", "sock-1");
    const members = m.getMembers("presence-chat");
    expect(members).toHaveLength(1);
    expect(members[0]?.id).toBe("alice");
  });
});

// ── signAuth / resolvePresenceWith ────────────────────────────────────────────

describe("PusherCompatManager — signAuth + resolvePresenceWith", () => {
  it("signAuth includes channel_data in signature when provided", () => {
    const m = new PusherCompatManager(APP_KEY, APP_SECRET);
    const data = '{"user_id":"1","user_info":{}}';
    expect(m.signAuth("s", "presence-x", data)).toBe(sign("s", "presence-x", data));
  });

  it("resolvePresenceWith callback is called by resolvePresence()", async () => {
    const m = new PusherCompatManager(APP_KEY, APP_SECRET);
    m.resolvePresenceWith((_req, _ch) => ({ id: 99, info: { name: "Bob" } }));
    const result = await m.resolvePresence(new Request("http://localhost/"), "presence-x");
    expect(result).toMatchObject({ id: 99 });
  });

  it("resolvePresence returns false when no resolver is set", async () => {
    const m = new PusherCompatManager(APP_KEY, APP_SECRET);
    expect(await m.resolvePresence(new Request("http://localhost/"), "presence-x")).toBe(false);
  });
});

// ── Client events forwarding ──────────────────────────────────────────────────

describe("PusherCompatManager — client events", () => {
  const CH = "private-chat";

  /** Open a socket and subscribe it to the private channel with a valid auth token. */
  async function joined(m: PusherCompatManager, id: string) {
    const { ws, sent } = makeWs(id);
    m.handleOpen(ws);
    await m.handleMessage(
      ws,
      JSON.stringify({
        event: "pusher:subscribe",
        data: { channel: CH, auth: sign(id, CH) },
      }),
    );
    return { ws, sent };
  }

  it("forwards client-* events to other subscribers but not sender", async () => {
    const m = new PusherCompatManager(APP_KEY, APP_SECRET);
    const { ws: ws1, sent: s1 } = await joined(m, "sock-1");
    const { sent: s2 } = await joined(m, "sock-2");

    await m.handleMessage(ws1, JSON.stringify({ event: "client-typing", channel: CH, data: {} }));

    const s2Last = JSON.parse(s2.at(-1)!) as { event: string };
    expect(s2Last.event).toBe("client-typing");

    // ws1's last sent message should still be subscription_succeeded, not client-typing
    const s1Last = JSON.parse(s1.at(-1)!) as { event: string };
    expect(s1Last.event).not.toBe("client-typing");
  });

  it("rejects a client event from a socket that never subscribed to the channel", async () => {
    // Regression guard. _forwardClientEvent used to check only the `client-` event-name
    // prefix, so an unsubscribed — and unauthenticated — socket could inject a frame into a
    // private channel and every genuine subscriber received it as a peer message.
    const m = new PusherCompatManager(APP_KEY, APP_SECRET);
    const { sent: sMember } = await joined(m, "member");

    const { ws: intruder } = makeWs("intruder");
    m.handleOpen(intruder); // connected, but never subscribed and never authenticated

    await m.handleMessage(
      intruder,
      JSON.stringify({ event: "client-message", channel: CH, data: { evil: true } }),
    );

    expect(sMember.map((raw) => (JSON.parse(raw) as { event: string }).event)).not.toContain(
      "client-message",
    );
  });

  it("rejects client events on public channels, as real Pusher does", async () => {
    const m = new PusherCompatManager(APP_KEY, APP_SECRET);
    const { ws: ws1 } = makeWs("pub-1");
    const { ws: ws2, sent: s2 } = makeWs("pub-2");
    m.handleOpen(ws1);
    m.handleOpen(ws2);

    for (const ws of [ws1, ws2]) {
      await m.handleMessage(
        ws,
        JSON.stringify({ event: "pusher:subscribe", data: { channel: "chat" } }),
      );
    }

    await m.handleMessage(
      ws1,
      JSON.stringify({ event: "client-typing", channel: "chat", data: {} }),
    );

    expect(s2.map((raw) => (JSON.parse(raw) as { event: string }).event)).not.toContain(
      "client-typing",
    );
  });
});

// ── handleClose cleans up ────────────────────────────────────────────────────

describe("PusherCompatManager — handleClose", () => {
  it("removes connection and all subscriptions", async () => {
    const m = new PusherCompatManager(APP_KEY, APP_SECRET);
    const { ws } = makeWs();
    m.handleOpen(ws);
    await m.handleMessage(
      ws,
      JSON.stringify({ event: "pusher:subscribe", data: { channel: "news" } }),
    );
    m.handleClose(ws);
    expect(m.connectionCount()).toBe(0);
    expect(m.subscriberCount("news")).toBe(0);
  });
});
