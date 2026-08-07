import { describe, it, afterEach } from "bun:test";
import { Emitter } from "@zerotal/core";
import { BroadcastingEvent, broadcastOnce } from "./BroadcastingEvent.ts";
import { Broadcast } from "./facades/Broadcast.ts";

class ServerCreated extends BroadcastingEvent {
  constructor(public readonly serverId: number) {
    super();
  }
  broadcastOn() {
    return `servers.${this.serverId}`;
  }
}

class PlainEvent {
  constructor(public readonly x: number) {}
}

describe("Events bus auto-broadcast (Phase 4)", () => {
  afterEach(() => {
    Broadcast.resetFake();
  });

  it("broadcasts a BroadcastingEvent emitted on the bus, even with no listeners", async () => {
    const fake = Broadcast.fake();

    const emitter = new Emitter();
    emitter.setBroadcaster((e) => broadcastOnce(e as never));
    await emitter.emit(new ServerCreated(5));

    fake.assertBroadcast("ServerCreated", "servers.5", { serverId: 5 });
    fake.assertBroadcastCount(1);
  });

  it("ignores plain (non-broadcastable) events", async () => {
    const fake = Broadcast.fake();

    const emitter = new Emitter();
    emitter.setBroadcaster((e) => broadcastOnce(e as never));
    await emitter.emit(new PlainEvent(1));

    fake.assertNothingBroadcast();
  });

  it("broadcastOnce dedupes the same event instance (guards against dispatch + hook double-send)", () => {
    const fake = Broadcast.fake();
    const event = new ServerCreated(9);
    broadcastOnce(event);
    broadcastOnce(event); // already sent -> no-op
    fake.assertBroadcastCount(1);
  });
});
