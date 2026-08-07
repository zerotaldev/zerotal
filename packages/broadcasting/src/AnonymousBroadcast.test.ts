import { describe, it, expect, afterEach } from "bun:test";
import { Broadcast } from "./facades/Broadcast.ts";

describe("Anonymous broadcasts (Broadcast.on/private/presence)", () => {
  afterEach(() => Broadcast.resetFake());

  it("on() broadcasts a public channel with default event + data", () => {
    const fake = Broadcast.fake();
    Broadcast.on("orders.1").send();
    const rec = fake.recorded();
    expect(rec[0]!.channel).toBe("orders.1");
    expect(rec[0]!.event).toBe("AnonymousEvent");
    expect(rec[0]!.data).toEqual({});
  });

  it("as().with() customize the event name and payload", () => {
    const fake = Broadcast.fake();
    Broadcast.on("orders.1").as("OrderPlaced").with({ id: 1, total: 100 }).send();
    fake.assertBroadcast("OrderPlaced", "orders.1", { id: 1, total: 100 });
  });

  it("private()/presence() prefix the channel", () => {
    const fake = Broadcast.fake();
    Broadcast.private("orders.1").as("OrderPlaced").with({ id: 1 }).send();
    Broadcast.presence("chat.5").as("Joined").with({ userId: 9 }).send();
    expect(fake.recorded()[0]!.channel).toBe("private-orders.1");
    expect(fake.recorded()[1]!.channel).toBe("presence-chat.5");
  });

  it("sendNow() is an alias for send()", () => {
    const fake = Broadcast.fake();
    Broadcast.on("orders.1").as("X").sendNow();
    fake.assertBroadcastCount(1);
  });
});
