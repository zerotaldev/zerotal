import { describe, it, expect } from "bun:test";
import { broadcastsModelEvents } from "./BroadcastsModelEvents.ts";
import { BroadcastingEvent } from "./BroadcastingEvent.ts";
import { privateChannel } from "./Channel.ts";

type EventMap = Record<string, new (model: unknown) => object>;

describe("broadcastsModelEvents", () => {
  it("populates dispatchesEvents for created/updated/deleted by default", () => {
    class Order {
      id = 7;
      static dispatchesEvents?: EventMap;
    }
    broadcastsModelEvents(Order, {
      channels: (order) => privateChannel(`orders.${order.id}`),
    });
    expect(Object.keys(Order.dispatchesEvents!).sort()).toEqual(["created", "deleted", "updated"]);
  });

  it("generates BroadcastingEvent subclasses with derived name, channel, and payload", () => {
    class Order {
      id = 7;
      status = "shipped";
      static dispatchesEvents?: EventMap;
    }
    broadcastsModelEvents(Order, {
      channels: (order) => privateChannel(`orders.${order.id}`),
    });

    const order = new Order();
    const Updated = Order.dispatchesEvents!["updated"]!;
    const event = new Updated(order) as BroadcastingEvent;

    expect(event).toBeInstanceOf(BroadcastingEvent);
    expect(event.broadcastAs()).toBe("OrderUpdated");
    expect(event.broadcastOn()).toBe("private-orders.7");
    expect(event.broadcastWith()).toEqual({ order });
  });

  it("honours events, as, and with overrides", () => {
    class Invoice {
      id = 1;
      static dispatchesEvents?: EventMap;
    }
    broadcastsModelEvents(Invoice, {
      events: ["created"],
      channels: () => "billing",
      as: (model, event) => `${model}.${event}`,
      with: (invoice) => ({ invoiceId: invoice.id }),
    });

    expect(Object.keys(Invoice.dispatchesEvents!)).toEqual(["created"]);
    const event = new Invoice.dispatchesEvents!["created"]!(new Invoice()) as BroadcastingEvent;
    expect(event.broadcastAs()).toBe("Invoice.created");
    expect(event.broadcastOn()).toBe("billing");
    expect(event.broadcastWith()).toEqual({ invoiceId: 1 });
  });

  it("merges with existing dispatchesEvents entries", () => {
    class Saved {
      constructor(public model: unknown) {}
    }
    class Post {
      static dispatchesEvents?: EventMap = { saved: Saved };
    }
    broadcastsModelEvents(Post, { events: ["created"], channels: () => "posts" });
    expect(Object.keys(Post.dispatchesEvents!).sort()).toEqual(["created", "saved"]);
  });
});
