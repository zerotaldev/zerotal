import { describe, it, expect, afterEach } from "bun:test";
import { BroadcastingEvent } from "./BroadcastingEvent.ts";
import { broadcast } from "./PendingBroadcast.ts";
import { Broadcast } from "./facades/Broadcast.ts";
import { privateChannel } from "./Channel.ts";

class OrderShipmentStatusUpdated extends BroadcastingEvent {
  constructor(
    public readonly orderId: number,
    public readonly status: string,
  ) {
    super();
  }
  broadcastOn() {
    return privateChannel(`orders.${this.orderId}`);
  }
}

class BigOrderOnly extends BroadcastingEvent {
  constructor(public readonly total: number) {
    super();
  }
  broadcastOn() {
    return "orders";
  }
  override broadcastWhen() {
    return this.total > 100;
  }
}

describe("BroadcastingEvent", () => {
  afterEach(() => Broadcast.resetFake());

  it("defaults broadcastAs to the class name and broadcastWith to own props", () => {
    const e = new OrderShipmentStatusUpdated(7, "shipped");
    expect(e.broadcastAs()).toBe("OrderShipmentStatusUpdated");
    expect(e.broadcastWith()).toEqual({ orderId: 7, status: "shipped" });
    expect(e.broadcastOn()).toBe("private-orders.7");
  });

  it("dispatch() broadcasts the event", () => {
    const fake = Broadcast.fake();
    OrderShipmentStatusUpdated.dispatch(11, "delivered");
    fake.assertBroadcast("OrderShipmentStatusUpdated", "private-orders.11", {
      orderId: 11,
      status: "delivered",
    });
  });

  it("dispatch() respects broadcastWhen()", () => {
    const fake = Broadcast.fake();
    BigOrderOnly.dispatch(50); // below threshold -> suppressed
    fake.assertNothingBroadcast();

    BigOrderOnly.dispatch(500); // above threshold -> broadcast
    fake.assertBroadcast("BigOrderOnly", "orders");
    fake.assertBroadcastCount(1);
  });
});

describe("broadcast() helper", () => {
  afterEach(() => Broadcast.resetFake());

  it("sends when awaited", async () => {
    const fake = Broadcast.fake();
    await broadcast(new OrderShipmentStatusUpdated(3, "shipped"));
    fake.assertBroadcast("OrderShipmentStatusUpdated", "private-orders.3");
  });

  it("toOthers() still sends (no current socket in a unit test) and only once", async () => {
    const fake = Broadcast.fake();
    await broadcast(new OrderShipmentStatusUpdated(4, "shipped")).toOthers();
    fake.assertBroadcastCount(1);
  });
});
