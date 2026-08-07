import { describe, it, expect, beforeEach } from "bun:test";
import { Notification } from "./Notification.ts";
import { MailMessage } from "./messages/MailMessage.ts";
import { SendNotificationJob } from "./SendNotificationJob.ts";
import { NotificationRegistry } from "./NotificationRegistry.ts";
import {
  hydrateNotifiable,
  hydrateNotification,
  notifiableType,
  serializeNotifiable,
} from "./serialization.ts";
import { UnknownNotificationTypeError } from "./errors.ts";
import type { Notifiable } from "./types.ts";

class OrderShipped extends Notification {
  constructor(
    private orderId: number = 0,
    private carrier: string = "",
  ) {
    super();
  }
  channels() {
    return ["mail"];
  }
  toMail() {
    return new MailMessage().subject(`Order ${this.orderId} via ${this.carrier}`);
  }
}

/** A notification whose state cannot survive JSON without help. */
class InvoicePaid extends Notification {
  constructor(private invoice: { id: number; save(): void } = { id: 0, save: () => {} }) {
    super();
  }
  channels() {
    return ["database"];
  }
  override payload() {
    return { invoiceId: this.invoice.id };
  }
  static fromPayload(data: Record<string, unknown>): InvoicePaid {
    return new InvoicePaid({ id: data["invoiceId"] as number, save: () => {} });
  }
  toDatabase() {
    return { invoiceId: this.invoice.id };
  }
}

beforeEach(() => {
  NotificationRegistry._map.clear();
});

describe("serializeNotifiable", () => {
  it("keeps the contract fields", () => {
    const s = serializeNotifiable({ id: 7, email: "a@b.test", name: "Ada", phone: "+1555" });
    expect(s.id).toBe(7);
    expect(s.email).toBe("a@b.test");
    expect(s.name).toBe("Ada");
    expect(s.phone).toBe("+1555");
  });

  it("prefers toJSON() when the notifiable is a model", () => {
    class User {
      id = 3;
      email = "u@b.test";
      _original = { secret: "leaked" };
      toJSON() {
        return { id: 3, email: "u@b.test", tier: "pro" };
      }
    }
    const s = serializeNotifiable(new User() as unknown as Notifiable);
    expect(s.tier).toBe("pro");
    expect(s["_original"]).toBeUndefined();
    expect(s.__type).toBe("User");
  });

  it("drops values JSON cannot carry rather than corrupting them", () => {
    const s = serializeNotifiable({
      id: 1,
      email: "a@b.test",
      widget: new (class Widget {})(),
      cb: () => "x",
      tags: ["a", "b"],
    } as unknown as Notifiable);

    expect(s["widget"]).toBeUndefined();
    expect(s["cb"]).toBeUndefined();
    expect(s["tags"]).toEqual(["a", "b"]);
    expect(JSON.stringify(s)).toContain("a@b.test");
  });

  it("skips underscore-prefixed internal fields", () => {
    const s = serializeNotifiable({ id: 1, _exists: true, $dirty: {} } as unknown as Notifiable);
    expect(s["_exists"]).toBeUndefined();
    expect(s["$dirty"]).toBeUndefined();
  });

  it("captures the broadcast channel, which is a method and cannot cross", () => {
    const s = serializeNotifiable({
      id: 9,
      receivesBroadcastNotificationsOn: () => "team.9",
    });
    expect(s.__broadcastChannel).toBe("team.9");

    const revived = hydrateNotifiable(s);
    expect(revived.receivesBroadcastNotificationsOn?.()).toBe("team.9");
  });
});

describe("notifiableType", () => {
  it("uses the class name", () => {
    class Team {
      id = 1;
    }
    expect(notifiableType(new Team() as unknown as Notifiable)).toBe("Team");
  });

  it("prefers a serialized __type over the plain-object constructor", () => {
    expect(notifiableType({ id: 1, __type: "User" } as unknown as Notifiable)).toBe("User");
  });

  it("falls back for a bare object literal", () => {
    expect(notifiableType({ id: 1 })).toBe("Notifiable");
  });
});

describe("hydrateNotification", () => {
  it("rebuilds a notification from the registry", async () => {
    NotificationRegistry.register(OrderShipped);
    const revived = await hydrateNotification("OrderShipped", { orderId: 42, carrier: "DHL" });

    expect(revived).toBeInstanceOf(OrderShipped);
    expect(revived.toMail({ id: 1 }).toPayload({ address: "x@y.z" }, []).subject).toBe(
      "Order 42 via DHL",
    );
  });

  it("uses a custom static fromPayload when the class defines one", async () => {
    NotificationRegistry.register(InvoicePaid as never);
    const revived = await hydrateNotification("InvoicePaid", { invoiceId: 88 });

    expect(revived).toBeInstanceOf(InvoicePaid);
    expect(revived.toDatabase({ id: 1 })).toEqual({ invoiceId: 88 });
  });

  it("throws a named error when the class cannot be found", async () => {
    await expect(hydrateNotification("GhostNotification", {})).rejects.toThrow(
      UnknownNotificationTypeError,
    );
    await expect(hydrateNotification("GhostNotification", {})).rejects.toThrow(
      "NotificationRegistry.register(GhostNotification)",
    );
  });
});

describe("SendNotificationJob — persistent-driver round trip", () => {
  const user: Notifiable = { id: 1, email: "alice@example.com", name: "Alice" };

  it("serializes the notifiable and the notification", () => {
    const job = new SendNotificationJob(user, new OrderShipped(42, "DHL"));
    const payload = job.payload();

    expect(payload["type"]).toBe("OrderShipped");
    expect(payload["data"]).toEqual({ orderId: 42, carrier: "DHL" });
    expect((payload["notifiable"] as Record<string, unknown>)["email"]).toBe("alice@example.com");

    // The whole point: it has to survive the driver's JSON column.
    expect(() => JSON.stringify(payload)).not.toThrow();
    expect(JSON.stringify(payload)).not.toBe("{}");
  });

  it("rebuilds an equivalent job from the stored payload", async () => {
    NotificationRegistry.register(OrderShipped);

    const stored = JSON.parse(
      JSON.stringify(new SendNotificationJob(user, new OrderShipped(7, "UPS")).payload()),
    ) as Record<string, unknown>;
    const revived = SendNotificationJob.fromPayload(stored);

    // _resolve() is what handle() uses; assert through payload() round-tripping.
    const again = revived.payload();
    expect(again["type"]).toBe("OrderShipped");
    expect(again["data"]).toEqual({ orderId: 7, carrier: "UPS" });

    const notification = await hydrateNotification(
      "OrderShipped",
      again["data"] as Record<string, unknown>,
    );
    const notifiable = hydrateNotifiable(again["notifiable"] as never);
    expect(notifiable.email).toBe("alice@example.com");
    expect(notification.toMail(notifiable).toPayload({ address: "x@y.z" }, []).subject).toBe(
      "Order 7 via UPS",
    );
  });

  it("routes to the notifications queue", () => {
    expect(new SendNotificationJob(user, new OrderShipped()).queue).toBe("notifications");
  });
});
