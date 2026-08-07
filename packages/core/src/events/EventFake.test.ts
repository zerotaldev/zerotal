import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Application } from "../application/Application.ts";
import { Emitter } from "./Emitter.ts";
import { EventFake } from "./EventFake.ts";
import { Events } from "../facade/facades/Events.ts";

class OrderPlaced {
  constructor(
    readonly orderId: number,
    readonly total: number,
  ) {}
}

class OrderCancelled {
  constructor(readonly orderId: number) {}
}

let ran: string[] = [];

class ChargeCard {
  handle(event: OrderPlaced): void {
    ran.push(`charged:${event.orderId}`);
  }
}

describe("EventFake", () => {
  beforeEach(async () => {
    Application._resetInstance();
    ran = [];
    const app = Application.create({ env: "test" });
    app.bind((c) => c.singleton("events" as never, () => new Emitter() as never));
    await app.boot();
    const emitter = (await app.container.make("events" as never)) as Emitter;
    emitter.on(OrderPlaced, ChargeCard);
  });

  afterEach(() => {
    Application._resetInstance();
  });

  it("captures emitted events instead of running listeners", async () => {
    const events = EventFake.install();

    await Events.emit(new OrderPlaced(1, 4999));

    expect(ran).toEqual([]); // the listener did not run
    events.assertEmitted(OrderPlaced);
    events.restore();
  });

  it("restores the real emitter, which then runs listeners again", async () => {
    const events = EventFake.install();
    events.restore();

    await Events.emit(new OrderPlaced(2, 100));

    expect(ran).toEqual(["charged:2"]);
  });

  it("matches on a filter", async () => {
    const events = EventFake.install();

    await Events.emit(new OrderPlaced(7, 4999));

    events.assertEmitted(OrderPlaced, (e) => e.total === 4999);
    expect(() => events.assertEmitted(OrderPlaced, (e) => e.total === 1)).toThrow("filter");
    events.restore();
  });

  it("names the events that were emitted when the expected one was not", async () => {
    const events = EventFake.install();

    await Events.emit(new OrderCancelled(3));

    expect(() => events.assertEmitted(OrderPlaced)).toThrow("OrderCancelled");
    events.restore();
  });

  it("assertNotEmitted and assertNothingEmitted", async () => {
    const events = EventFake.install();

    events.assertNothingEmitted();
    events.assertNotEmitted(OrderPlaced);

    await Events.emit(new OrderPlaced(1, 1));

    expect(() => events.assertNothingEmitted()).toThrow("OrderPlaced");
    expect(() => events.assertNotEmitted(OrderPlaced)).toThrow("OrderPlaced");
    events.restore();
  });

  it("counts events of one class", async () => {
    const events = EventFake.install();

    await Events.emit(new OrderPlaced(1, 1));
    await Events.emit(new OrderPlaced(2, 2));
    await Events.emit(new OrderCancelled(1));

    events.assertEmittedCount(OrderPlaced, 2);
    expect(() => events.assertEmittedCount(OrderPlaced, 1)).toThrow("but got 2");
    events.restore();
  });

  it("captures emitSync too, and exposes the captured instances", async () => {
    const events = EventFake.install();

    await Events.emitSync(new OrderPlaced(9, 500));

    expect(events.emittedOf(OrderPlaced)[0]?.orderId).toBe(9);
    expect(events.emitted()).toHaveLength(1);
    events.restore();
  });

  it("clear() drops what was captured", async () => {
    const events = EventFake.install();
    await Events.emit(new OrderPlaced(1, 1));
    events.clear();
    events.assertNothingEmitted();
    events.restore();
  });
});
