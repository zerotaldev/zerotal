import { describe, it, expect, beforeEach } from "bun:test";
import { Socket, PresenceChannel, type SocketLike, type PresenceMember } from "./Socket.ts";

// ── Fake WebSocket ────────────────────────────────────────────────────────────
class FakeWS implements SocketLike {
  static last: FakeWS | undefined;
  static count = 0;
  sent: string[] = [];
  readyState = 0; // CONNECTING
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  constructor(readonly url: string) {
    FakeWS.last = this;
    FakeWS.count++;
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }

  // ── test drivers ──
  open(): void {
    this.readyState = 1; // OPEN
    this.onopen?.({});
  }
  recv(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  /** Simulate an unexpected drop (server/network close, not user-initiated). */
  drop(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
  /** Last message it sent, parsed. */
  lastSent(): Record<string, unknown> {
    return JSON.parse(this.sent[this.sent.length - 1] ?? "{}");
  }
  sentEvents(): string[] {
    return this.sent.map((s) => JSON.parse(s).event);
  }
}

function newSocket(opts = {}) {
  return new Socket({
    host: "example.test",
    port: 3000,
    pingInterval: 0, // disable heartbeat unless a test opts in
    authEndpoint: false, // connection-level auth by default; signature tests opt in
    WebSocket: FakeWS as unknown as new (url: string) => SocketLike,
    ...opts,
  });
}

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}
/** A fetch mock that records calls and returns `response` (with `ok`). */
function makeFetch(response: unknown, ok = true) {
  const calls: FetchCall[] = [];
  const fn = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return { ok, json: async () => response };
  }) as unknown as typeof fetch & { calls: FetchCall[] };
  fn.calls = calls;
  return fn;
}
/** Let queued microtasks (the auth fetch + subscribe) settle. */
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Bring a freshly-constructed socket to the "connected" state with a socket id. */
function connect(socketId = "sock-1"): { ws: FakeWS } {
  const ws = FakeWS.last!;
  ws.open();
  ws.recv({ event: "connected", data: { socketId } });
  return { ws };
}

beforeEach(() => {
  FakeWS.last = undefined;
  FakeWS.count = 0;
});

describe("Socket connection", () => {
  it("builds a ws:// URL from host/port/path and connects", () => {
    newSocket({ path: "/app/ws" });
    expect(FakeWS.last!.url).toBe("ws://example.test:3000/app/ws");
  });

  it("uses wss + appends auth params", () => {
    newSocket({ scheme: "wss", auth: { params: { token: "abc" } } });
    expect(FakeWS.last!.url).toBe("wss://example.test:3000/app/ws?token=abc");
  });

  it("becomes connected and exposes the server-assigned socket id", () => {
    const s = newSocket();
    expect(s.state).toBe("connecting");
    const { ws } = connect("sock-42");
    expect(s.state).toBe("connected");
    expect(s.socketId()).toBe("sock-42");
    void ws;
  });

  it("fires the 'connected' state callback", () => {
    const s = newSocket();
    let fired = false;
    s.on("connected", () => (fired = true));
    connect();
    expect(fired).toBe(true);
  });
});

describe("public channels", () => {
  it("subscribes and dispatches events to listeners", () => {
    const s = newSocket();
    const { ws } = connect();
    const seen: unknown[] = [];
    s.channel("posts").listen("PostPublished", (e) => seen.push(e));

    expect(ws.lastSent()).toEqual({ event: "subscribe", channel: "posts" });
    ws.recv({ event: "PostPublished", channel: "posts", data: { id: 1 } });
    expect(seen).toEqual([{ id: 1 }]);
  });

  it("defers subscribe until connected, then flushes on the 'connected' frame", () => {
    const s = newSocket();
    s.channel("posts"); // before connected
    const ws = FakeWS.last!;
    expect(ws.sent).toHaveLength(0);

    ws.open();
    ws.recv({ event: "connected", data: { socketId: "x" } });
    expect(ws.lastSent()).toEqual({ event: "subscribe", channel: "posts" });
  });

  it("re-uses the same Channel object for the same name", () => {
    const s = newSocket();
    connect();
    expect(s.channel("posts")).toBe(s.channel("posts"));
  });

  it("stopListening removes a listener", () => {
    const s = newSocket();
    const { ws } = connect();
    const seen: unknown[] = [];
    const cb = (e: unknown) => seen.push(e);
    const ch = s.channel("posts").listen("E", cb);
    ch.stopListening("E", cb);
    ws.recv({ event: "E", channel: "posts", data: 1 });
    expect(seen).toEqual([]);
  });

  it("fires subscribed() / error() callbacks", () => {
    const s = newSocket();
    const { ws } = connect();
    let ok = false;
    let err: unknown;
    s.channel("posts")
      .subscribed(() => (ok = true))
      .error((m) => (err = m));

    ws.recv({ event: "subscription_succeeded", channel: "posts" });
    expect(ok).toBe(true);

    ws.recv({ event: "subscription_error", channel: "posts", message: "nope" });
    expect(err).toBe("nope");
  });
});

describe("private channels", () => {
  it("prefixes the channel with private-", () => {
    const s = newSocket();
    const { ws } = connect();
    const ch = s.private("orders.42");
    expect(ch.name).toBe("private-orders.42");
    expect(ws.lastSent()).toEqual({ event: "subscribe", channel: "private-orders.42" });
  });
});

describe("presence channels", () => {
  it("prefixes with presence- and reports members via here()/joining()/leaving()", () => {
    const s = newSocket();
    const { ws } = connect();
    const here: PresenceMember[][] = [];
    const joined: PresenceMember[] = [];
    const left: PresenceMember[] = [];

    const ch = s.presence("chat.1");
    expect(ch).toBeInstanceOf(PresenceChannel);
    expect(ch.name).toBe("presence-chat.1");
    ch.here((m) => here.push(m))
      .joining((m) => joined.push(m))
      .leaving((m) => left.push(m));

    const alice = { id: 1, info: { name: "Alice" } };
    const bob = { id: 2, info: { name: "Bob" } };

    ws.recv({
      event: "subscription_succeeded",
      channel: "presence-chat.1",
      data: { members: [alice] },
    });
    expect(here).toEqual([[alice]]);

    ws.recv({ event: "presence:member_added", channel: "presence-chat.1", data: { member: bob } });
    expect(joined).toEqual([bob]);

    ws.recv({
      event: "presence:member_removed",
      channel: "presence-chat.1",
      data: { member: bob },
    });
    expect(left).toEqual([bob]);
  });

  it("still delivers normal broadcast events on a presence channel", () => {
    const s = newSocket();
    const { ws } = connect();
    const msgs: unknown[] = [];
    s.presence("chat.1").listen("Message", (e) => msgs.push(e));
    ws.recv({ event: "Message", channel: "presence-chat.1", data: { text: "hi" } });
    expect(msgs).toEqual([{ text: "hi" }]);
  });

  it("join() is an alias for presence()", () => {
    const s = newSocket();
    connect();
    expect(s.join("chat.1")).toBe(s.presence("chat.1"));
  });
});

describe("leaving", () => {
  it("leaveChannel unsubscribes and drops the channel", () => {
    const s = newSocket();
    const { ws } = connect();
    s.channel("posts");
    s.leaveChannel("posts");
    expect(ws.lastSent()).toEqual({ event: "unsubscribe", channel: "posts" });
    expect(s.channels()).toHaveLength(0);
  });

  it("leave(name) unsubscribes the public/private/presence variants", () => {
    const s = newSocket();
    const { ws } = connect();
    s.private("room");
    s.leave("room");
    expect(ws.sentEvents().filter((e) => e === "unsubscribe").length).toBe(1);
    expect(s.channels()).toHaveLength(0);
  });
});

describe("per-subscription signatures (Pusher-style auth)", () => {
  it("fetches a signature from the auth endpoint and includes it in subscribe (private)", async () => {
    const f = makeFetch({ auth: "sig-1" });
    const s = newSocket({ authEndpoint: "/broadcasting/auth", fetch: f });
    const { ws } = connect("sock-1");
    s.private("orders.42");

    expect(ws.sentEvents()).not.toContain("subscribe"); // deferred until auth resolves
    await tick();

    expect(f.calls[0]).toMatchObject({
      url: "/broadcasting/auth",
      body: { socket_id: "sock-1", channel_name: "private-orders.42" },
    });
    expect(ws.lastSent()).toEqual({
      event: "subscribe",
      channel: "private-orders.42",
      auth: "sig-1",
    });
  });

  it("includes the signed channel_data for presence channels", async () => {
    const channelData = JSON.stringify({ id: 1, info: { name: "Alice" } });
    const f = makeFetch({ auth: "sig-2", channel_data: channelData });
    const s = newSocket({ authEndpoint: "/broadcasting/auth", fetch: f });
    const { ws } = connect();
    s.presence("chat.1");
    await tick();

    expect(ws.lastSent()).toEqual({
      event: "subscribe",
      channel: "presence-chat.1",
      auth: "sig-2",
      channelData,
    });
  });

  it("sends custom auth headers on the signature request", async () => {
    const f = makeFetch({ auth: "s" });
    const s = newSocket({
      authEndpoint: "/broadcasting/auth",
      fetch: f,
      auth: { headers: { "X-CSRF-TOKEN": "tok" } },
    });
    connect();
    s.private("x");
    await tick();
    expect(f.calls[0]!.headers["X-CSRF-TOKEN"]).toBe("tok");
  });

  it("dispatches subscription_error when the auth request fails", async () => {
    const f = makeFetch({ error: "denied" }, false);
    const s = newSocket({ authEndpoint: "/broadcasting/auth", fetch: f });
    const { ws } = connect();
    let err: unknown;
    s.private("x").error((m) => (err = m));
    await tick();
    expect(err).toBe("Authorization failed");
    expect(ws.sentEvents()).not.toContain("subscribe");
  });

  it("re-authorizes against the new socket id after a reconnect", async () => {
    const f = makeFetch({ auth: "sig" });
    const s = newSocket({
      authEndpoint: "/broadcasting/auth",
      fetch: f,
      reconnectDelay: 1,
      maxReconnectDelay: 1,
    });
    connect("sock-1");
    s.private("room");
    await tick();
    expect(f.calls[0]!.body["socket_id"]).toBe("sock-1");

    FakeWS.last!.drop();
    await new Promise((r) => setTimeout(r, 5));
    FakeWS.last!.open();
    FakeWS.last!.recv({ event: "connected", data: { socketId: "sock-2" } });
    await tick();

    expect(f.calls[f.calls.length - 1]!.body["socket_id"]).toBe("sock-2");
    void s;
  });

  it("authEndpoint:false skips the fetch and subscribes connection-level", async () => {
    const f = makeFetch({ auth: "x" });
    const s = newSocket({ authEndpoint: false, fetch: f });
    const { ws } = connect();
    s.private("x");
    await tick();
    expect(f.calls).toHaveLength(0);
    expect(ws.lastSent()).toEqual({ event: "subscribe", channel: "private-x" });
  });
});

describe("reconnection", () => {
  it("reconnects after an unexpected drop and re-subscribes", async () => {
    const s = newSocket({ reconnectDelay: 1, maxReconnectDelay: 1 });
    connect();
    s.channel("posts");
    expect(FakeWS.count).toBe(1);

    FakeWS.last!.drop(); // unexpected close
    expect(s.state).toBe("disconnected");

    await new Promise((r) => setTimeout(r, 5)); // let the reconnect timer fire
    expect(FakeWS.count).toBe(2); // a fresh socket was opened

    // New socket connects → channels re-subscribe automatically.
    FakeWS.last!.open();
    FakeWS.last!.recv({ event: "connected", data: { socketId: "sock-2" } });
    expect(FakeWS.last!.sentEvents()).toContain("subscribe");
    expect(s.socketId()).toBe("sock-2");
  });

  it("disconnect() does not reconnect", async () => {
    const s = newSocket({ reconnectDelay: 1 });
    connect();
    s.disconnect();
    expect(s.state).toBe("disconnected");
    await new Promise((r) => setTimeout(r, 5));
    expect(FakeWS.count).toBe(1); // no new socket
  });
});

describe("heartbeat", () => {
  it("sends a ping on the configured interval", async () => {
    const s = newSocket({ pingInterval: 2 });
    const { ws } = connect();
    await new Promise((r) => setTimeout(r, 6));
    expect(ws.sentEvents()).toContain("ping");
    s.disconnect();
  });
});
