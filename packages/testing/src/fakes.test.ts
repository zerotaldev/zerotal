import { describe, it, expect, beforeAll, afterEach } from "bun:test";
import { Application, currentApp } from "@zerotal/core";
import { Job } from "@zerotal/queue";
import { QueueFake } from "@zerotal/queue";
import { Notification, MailMessage } from "@zerotal/notifications";
import { NotificationFake } from "@zerotal/notifications";
import type { Notifiable } from "@zerotal/notifications";

// ── Minimal app setup ─────────────────────────────────────────────────────────
// Application is a process-wide singleton; create once per test run.

let app: Application;

beforeAll(() => {
  try {
    app = Application.create({ env: "test" });
  } catch {
    app = currentApp();
  }
  // Seed placeholder bindings so install() has an original to save.
  const stub = {};
  app.container.value("queue", stub);
  app.container.value("notifications", stub);
});

// ── Concrete fixtures ─────────────────────────────────────────────────────────

class ProcessPaymentJob extends Job {
  constructor(public readonly orderId: number) {
    super();
  }
  async handle() {}
}

class SendReportJob extends Job {
  async handle() {}
}

class OrderShippedNotification extends Notification {
  constructor(public readonly orderId: number) {
    super();
  }
  channels() {
    return ["database"];
  }
  toDatabase() {
    return { orderId: this.orderId };
  }
}

class BillingNotification extends Notification {
  channels() {
    return ["mail"];
  }
  toMail() {
    return new MailMessage().subject("Your invoice").line("Thanks for your business.");
  }
}

const user: Notifiable = { id: 1, email: "alice@example.com" };
const other: Notifiable = { id: 2 };

// ── QueueFake ─────────────────────────────────────────────────────────────────

describe("QueueFake", () => {
  let queue: QueueFake;

  afterEach(() => queue?.restore());

  it("captures dispatch()", async () => {
    queue = QueueFake.install();
    await queue.dispatch(new ProcessPaymentJob(1));
    expect(queue.dispatched()).toHaveLength(1);
  });

  it("does NOT execute the job", async () => {
    queue = QueueFake.install();
    let ran = false;
    class CheckJob extends Job {
      async handle() {
        ran = true;
      }
    }
    await queue.dispatch(new CheckJob());
    expect(ran).toBe(false);
  });

  it("assertDispatched passes when the class was dispatched", async () => {
    queue = QueueFake.install();
    await queue.dispatch(new ProcessPaymentJob(42));
    expect(() => queue.assertDispatched(ProcessPaymentJob)).not.toThrow();
  });

  it("assertDispatched throws when the class was NOT dispatched", async () => {
    queue = QueueFake.install();
    await queue.dispatch(new ProcessPaymentJob(42));
    expect(() => queue.assertDispatched(SendReportJob)).toThrow("SendReportJob");
  });

  it("assertDispatched passes with matching filter", async () => {
    queue = QueueFake.install();
    await queue.dispatch(new ProcessPaymentJob(99));
    expect(() => queue.assertDispatched(ProcessPaymentJob, (j) => j.orderId === 99)).not.toThrow();
  });

  it("assertNotDispatched passes when class was not dispatched", async () => {
    queue = QueueFake.install();
    await queue.dispatch(new ProcessPaymentJob(1));
    expect(() => queue.assertNotDispatched(SendReportJob)).not.toThrow();
  });

  it("assertNothingDispatched passes when empty", async () => {
    queue = QueueFake.install();
    expect(() => queue.assertNothingDispatched()).not.toThrow();
  });

  it("assertNothingDispatched throws when job was dispatched", async () => {
    queue = QueueFake.install();
    await queue.dispatch(new ProcessPaymentJob(1));
    expect(() => queue.assertNothingDispatched()).toThrow("1 job");
  });

  it("assertDispatchedCount matches exact count", async () => {
    queue = QueueFake.install();
    await queue.dispatch(new ProcessPaymentJob(1));
    await queue.dispatch(new SendReportJob());
    expect(() => queue.assertDispatchedCount(2)).not.toThrow();
    expect(() => queue.assertDispatchedCount(5)).toThrow("Expected 5");
  });

  it("restore() brings back the original binding", () => {
    const before = app.container.registry.get("queue");
    queue = QueueFake.install();
    expect(app.container.registry.get("queue")).not.toBe(before);
    queue.restore();
    expect(app.container.registry.get("queue")).toBe(before);
  });
});

// ── NotificationFake ──────────────────────────────────────────────────────────

describe("NotificationFake", () => {
  let notify: NotificationFake;

  afterEach(() => notify?.restore());

  it("captures send()", async () => {
    notify = NotificationFake.install();
    await notify.send(user, new OrderShippedNotification(1));
    expect(notify.sent()).toHaveLength(1);
  });

  it("captures queue() as sent", async () => {
    notify = NotificationFake.install();
    await notify.queue(user, new OrderShippedNotification(1));
    expect(notify.sent()).toHaveLength(1);
  });

  it("assertSentTo passes when notification was sent", async () => {
    notify = NotificationFake.install();
    await notify.send(user, new OrderShippedNotification(7));
    expect(() => notify.assertSentTo(user, OrderShippedNotification)).not.toThrow();
  });

  it("assertSentTo fails when sent to different notifiable", async () => {
    notify = NotificationFake.install();
    await notify.send(other, new OrderShippedNotification(7));
    expect(() => notify.assertSentTo(user, OrderShippedNotification)).toThrow("#1");
  });

  it("assertSentTo passes with matching filter", async () => {
    notify = NotificationFake.install();
    await notify.send(user, new OrderShippedNotification(42));
    expect(() =>
      notify.assertSentTo(user, OrderShippedNotification, (n) => n.orderId === 42),
    ).not.toThrow();
  });

  it("assertNotSentTo passes when not sent to that user", async () => {
    notify = NotificationFake.install();
    await notify.send(other, new OrderShippedNotification(1));
    expect(() => notify.assertNotSentTo(user, OrderShippedNotification)).not.toThrow();
  });

  it("assertNotSentTo throws when notification WAS sent to user", async () => {
    notify = NotificationFake.install();
    await notify.send(user, new OrderShippedNotification(1));
    expect(() => notify.assertNotSentTo(user, OrderShippedNotification)).toThrow(
      "OrderShippedNotification",
    );
  });

  it("assertNothingSent passes when empty", async () => {
    notify = NotificationFake.install();
    expect(() => notify.assertNothingSent()).not.toThrow();
  });

  it("assertNothingSent throws when notification was sent", async () => {
    notify = NotificationFake.install();
    await notify.send(user, new OrderShippedNotification(1));
    expect(() => notify.assertNothingSent()).toThrow("1 notification");
  });

  it("assertSentCount matches exact total", async () => {
    notify = NotificationFake.install();
    await notify.send(user, new OrderShippedNotification(1));
    await notify.send(other, new BillingNotification());
    expect(() => notify.assertSentCount(2)).not.toThrow();
    expect(() => notify.assertSentCount(1)).toThrow("Expected 1");
  });

  it("restore() brings back the original binding", () => {
    const before = app.container.registry.get("notifications");
    notify = NotificationFake.install();
    expect(app.container.registry.get("notifications")).not.toBe(before);
    notify.restore();
    expect(app.container.registry.get("notifications")).toBe(before);
  });
});
