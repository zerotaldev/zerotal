import { describe, it, expect, beforeEach } from "bun:test";
import type { ServerWebSocket } from "bun";
import { BroadcastManager } from "./BroadcastManager.ts";
import type { WsConnectionData } from "./types.ts";

function makeWs(id: string): { ws: ServerWebSocket<WsConnectionData>; sent: string[] } {
  const sent: string[] = [];
  const ws = {
    data: { id } as WsConnectionData,
    send: (m: string) => void sent.push(m),
    close() {},
    readyState: 1,
  } as unknown as ServerWebSocket<WsConnectionData>;
  return { ws, sent };
}

const lastEvent = (sent: string[]) => JSON.parse(sent[sent.length - 1] ?? "{}");

describe("per-subscription signatures (native protocol)", () => {
  let manager: BroadcastManager;
  beforeEach(() => {
    manager = new BroadcastManager();
    manager.setAuthSecret("test-secret");
  });

  it("accepts a private subscription with a valid signature", async () => {
    const { ws, sent } = makeWs("sock-1");
    manager.handleOpen(ws);
    const auth = manager.signAuth("sock-1", "private-orders.42");

    await manager.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "private-orders.42", auth }),
    );

    expect(lastEvent(sent).event).toBe("subscription_succeeded");
    expect(manager.subscriberCount("private-orders.42")).toBe(1);
  });

  it("rejects a private subscription with a bad signature", async () => {
    const { ws, sent } = makeWs("sock-1");
    manager.handleOpen(ws);

    await manager.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "private-orders.42", auth: "deadbeef" }),
    );

    expect(lastEvent(sent).event).toBe("subscription_error");
    expect(manager.subscriberCount("private-orders.42")).toBe(0);
  });

  it("rejects a signature minted for a different socket id (binds to the socket)", async () => {
    const { ws, sent } = makeWs("sock-1");
    manager.handleOpen(ws);
    const wrong = manager.signAuth("sock-OTHER", "private-orders.42");

    await manager.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "private-orders.42", auth: wrong }),
    );

    expect(lastEvent(sent).event).toBe("subscription_error");
  });

  it("authorizes presence and takes the member from the signed channelData", async () => {
    const { ws, sent } = makeWs("sock-1");
    manager.handleOpen(ws);
    const channelData = JSON.stringify({ id: 7, info: { name: "Alice" } });
    const auth = manager.signAuth("sock-1", "presence-chat.1", channelData);

    await manager.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "presence-chat.1", auth, channelData }),
    );

    const frame = lastEvent(sent);
    expect(frame.event).toBe("subscription_succeeded");
    expect(frame.data.members).toEqual([{ id: 7, info: { name: "Alice" } }]);
    expect(manager.getMembers("presence-chat.1")).toEqual([{ id: 7, info: { name: "Alice" } }]);
  });

  it("rejects presence when channelData is tampered with (not covered by the signature)", async () => {
    const { ws, sent } = makeWs("sock-1");
    manager.handleOpen(ws);
    const signed = JSON.stringify({ id: 7, info: {} });
    const auth = manager.signAuth("sock-1", "presence-chat.1", signed);
    const tampered = JSON.stringify({ id: 999, info: { admin: true } });

    await manager.handleMessage(
      ws,
      JSON.stringify({
        event: "subscribe",
        channel: "presence-chat.1",
        auth,
        channelData: tampered,
      }),
    );

    expect(lastEvent(sent).event).toBe("subscription_error");
  });

  it("denies the signed path when no secret is configured", async () => {
    const noSecret = new BroadcastManager(); // setAuthSecret never called
    const { ws, sent } = makeWs("sock-1");
    noSecret.handleOpen(ws);

    await noSecret.handleMessage(
      ws,
      JSON.stringify({ event: "subscribe", channel: "private-x", auth: "anything" }),
    );

    expect(lastEvent(sent).event).toBe("subscription_error");
  });

  it("still supports connection-level auth when no signature is sent (back-compat)", async () => {
    manager.authorizeWith(() => true);
    const { ws, sent } = makeWs("sock-1");
    manager.handleOpen(ws);

    await manager.handleMessage(ws, JSON.stringify({ event: "subscribe", channel: "private-x" }));

    expect(lastEvent(sent).event).toBe("subscription_succeeded");
  });
});
