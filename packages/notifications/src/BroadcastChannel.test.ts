import { describe, it, expect, afterEach } from "bun:test";
import { Notification } from "./Notification.ts";
import { BroadcastChannel, BROADCAST_NOTIFICATION_EVENT } from "./BroadcastChannel.ts";
import { BroadcastMessage } from "./BroadcastMessage.ts";
import type { Notifiable } from "./types.ts";
import { Broadcast } from "@zerotal/broadcasting";

class InvoicePaid extends Notification {
  constructor(private invoiceId: number) {
    super();
  }
  channels() {
    return ["broadcast"];
  }
  override toBroadcast() {
    return new BroadcastMessage({ invoiceId: this.invoiceId });
  }
  override broadcastType() {
    return "invoice.paid";
  }
}

class PlainNote extends Notification {
  channels() {
    return ["broadcast"];
  }
  override toBroadcast() {
    return { hello: "world" };
  }
}

describe("BroadcastChannel", () => {
  afterEach(() => Broadcast.resetFake());

  it("broadcasts on the notifiable's private channel with type + data + envelope", async () => {
    const fake = Broadcast.fake();
    await new BroadcastChannel().send({ id: 7 } as Notifiable, new InvoicePaid(99));

    const rec = fake.recorded();
    expect(rec).toHaveLength(1);
    expect(rec[0]!.channel).toBe("private-notifications.7");
    expect(rec[0]!.event).toBe(BROADCAST_NOTIFICATION_EVENT);
    expect(rec[0]!.data.invoiceId).toBe(99);
    expect(rec[0]!.data.type).toBe("invoice.paid");
    expect(rec[0]!.data.readAt).toBeNull();
    expect(typeof rec[0]!.data.id).toBe("string");
    expect(typeof rec[0]!.data.createdAt).toBe("string");
  });

  it("accepts a plain object from toBroadcast() and defaults broadcastType to the class name", async () => {
    const fake = Broadcast.fake();
    await new BroadcastChannel().send({ id: 2 } as Notifiable, new PlainNote());
    expect(fake.recorded()[0]!.data.hello).toBe("world");
    expect(fake.recorded()[0]!.data.type).toBe("PlainNote");
  });

  it("honors receivesBroadcastNotificationsOn() on the notifiable", async () => {
    const fake = Broadcast.fake();
    const notifiable = {
      id: 3,
      receivesBroadcastNotificationsOn: () => "users.3",
    } as Notifiable;
    await new BroadcastChannel().send(notifiable, new InvoicePaid(1));
    expect(fake.recorded()[0]!.channel).toBe("private-users.3");
  });
});
