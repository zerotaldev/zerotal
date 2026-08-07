import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Emitter } from "./Emitter.ts";
import { CallQueuedListener } from "./CallQueuedListener.ts";
import { Application } from "../application/Application.ts";

// ── Helpers ───────────────────────────────────────────────────────────────

class UserRegistered {
  constructor(
    public readonly userId: number,
    public readonly email: string,
  ) {}
}

class OrderPlaced {
  constructor(public readonly orderId: number) {}
}

class RecordingListener {
  static calls: UserRegistered[] = [];
  async handle(event: UserRegistered): Promise<void> {
    RecordingListener.calls.push(event);
  }
}

class ThrowingListener {
  async handle(_event: UserRegistered): Promise<void> {
    throw new Error("listener error");
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Emitter — on/emit", () => {
  it("calls the listener with the event", async () => {
    RecordingListener.calls = [];
    const e = new Emitter();
    e.on(UserRegistered as never, RecordingListener);
    await e.emit(new UserRegistered(1, "a@b.com"));
    expect(RecordingListener.calls).toHaveLength(1);
    expect(RecordingListener.calls[0]!.userId).toBe(1);
  });

  it("calls multiple listeners for the same event", async () => {
    const log: string[] = [];

    class ListenerA {
      async handle(_e: UserRegistered) {
        log.push("A");
      }
    }
    class ListenerB {
      async handle(_e: UserRegistered) {
        log.push("B");
      }
    }

    const e = new Emitter();
    e.on(UserRegistered as never, ListenerA);
    e.on(UserRegistered as never, ListenerB);
    await e.emit(new UserRegistered(1, "x@y.com"));
    expect(log).toContain("A");
    expect(log).toContain("B");
  });

  it("does not call listeners for a different event", async () => {
    RecordingListener.calls = [];
    const e = new Emitter();
    e.on(UserRegistered as never, RecordingListener);
    await e.emit(new OrderPlaced(99)); // different event
    expect(RecordingListener.calls).toHaveLength(0);
  });

  it("does not throw when a listener throws — catches and logs", async () => {
    const e = new Emitter();
    e.on(UserRegistered as never, ThrowingListener);
    // Should not throw — errors are caught by Promise.allSettled
    await expect(e.emit(new UserRegistered(1, "x@y.com"))).resolves.toBeUndefined();
  });
});

describe("Emitter — off()", () => {
  it("removes a listener so it no longer fires", async () => {
    RecordingListener.calls = [];
    const e = new Emitter();
    e.on(UserRegistered as never, RecordingListener);
    e.off(UserRegistered as never, RecordingListener);
    await e.emit(new UserRegistered(1, "a@b.com"));
    expect(RecordingListener.calls).toHaveLength(0);
  });
});

describe("Emitter — emitSync()", () => {
  it("awaits each listener in order", async () => {
    const order: number[] = [];

    class First {
      async handle(_e: UserRegistered) {
        await new Promise((r) => setTimeout(r, 10));
        order.push(1);
      }
    }
    class Second {
      async handle(_e: UserRegistered) {
        order.push(2);
      }
    }

    const e = new Emitter();
    e.on(UserRegistered as never, First);
    e.on(UserRegistered as never, Second);
    await e.emitSync(new UserRegistered(1, "x@y.com"));
    expect(order).toEqual([1, 2]); // strict order guaranteed
  });
});

describe("Emitter — hasListeners()", () => {
  it("returns true when listeners are registered", () => {
    const e = new Emitter();
    e.on(UserRegistered as never, RecordingListener);
    expect(e.hasListeners(UserRegistered as never)).toBe(true);
  });

  it("returns false when no listeners registered", () => {
    const e = new Emitter();
    expect(e.hasListeners(UserRegistered as never)).toBe(false);
  });

  it("returns false after clear()", () => {
    const e = new Emitter();
    e.on(UserRegistered as never, RecordingListener);
    e.clear();
    expect(e.hasListeners(UserRegistered as never)).toBe(false);
  });
});

// ── Emitter.dispatchQueuedListener() ─────────────────────────────────────────

describe("Emitter — dispatchQueuedListener()", () => {
  it("invokes the registered listener by name with the payload", async () => {
    const received: unknown[] = [];
    class NamedListener {
      async handle(event: unknown) {
        received.push(event);
      }
    }
    const e = new Emitter();
    e.on(UserRegistered as never, NamedListener as never);

    const payload = { id: 7, email: "test@example.com" };
    await e.dispatchQueuedListener("NamedListener", payload);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(payload);
  });

  it("throws when the listener name is not registered", async () => {
    const e = new Emitter();
    await expect(e.dispatchQueuedListener("GhostListener", {})).rejects.toThrow("GhostListener");
  });
});

// ── CallQueuedListener ────────────────────────────────────────────────────────

describe("CallQueuedListener — constructor & properties", () => {
  it("stores listener/event/payload and defaults", () => {
    const job = new CallQueuedListener("MyListener", "UserRegistered", { id: 1 });
    expect(job.listenerName).toBe("MyListener");
    expect(job.eventName).toBe("UserRegistered");
    expect(job.eventPayload).toEqual({ id: 1 });
    expect(job.queue).toBe("default");
    expect(job.maxAttempts).toBe(3);
    expect(job.retryDelay).toBe(1000);
  });

  it("uses custom queue, maxAttempts, retryDelay when provided", () => {
    const job = new CallQueuedListener("L", "E", {}, "priority", 5, 500);
    expect(job.queue).toBe("priority");
    expect(job.maxAttempts).toBe(5);
    expect(job.retryDelay).toBe(500);
  });

  it('uses "default" queue when queueName is boolean true', () => {
    const job = new CallQueuedListener("L", "E", {}, true);
    expect(job.queue).toBe("default");
  });

  it('className getter returns "CallQueuedListener"', () => {
    const job = new CallQueuedListener("L", "E", {});
    expect(job.className).toBe("CallQueuedListener");
  });
});

describe("CallQueuedListener — payload()", () => {
  it("returns all fields as a plain object", () => {
    const job = new CallQueuedListener("MyListener", "UserRegistered", { id: 42 }, "high", 2, 200);
    const p = job.payload();
    expect(p.listenerName).toBe("MyListener");
    expect(p.eventName).toBe("UserRegistered");
    expect(p.eventPayload).toEqual({ id: 42 });
    expect(p.queue).toBe("high");
    expect(p.maxAttempts).toBe(2);
    expect(p.retryDelay).toBe(200);
  });
});

describe("CallQueuedListener — fromPayload()", () => {
  it("reconstructs an instance from a payload object", () => {
    const original = new CallQueuedListener("SomeListener", "SomeEvent", { x: 1 }, "low", 4, 300);
    const p = original.payload();
    const restored = CallQueuedListener.fromPayload(p);
    expect(restored.listenerName).toBe("SomeListener");
    expect(restored.eventName).toBe("SomeEvent");
    expect(restored.eventPayload).toEqual({ x: 1 });
    expect(restored.queue).toBe("low");
    expect(restored.maxAttempts).toBe(4);
    expect(restored.retryDelay).toBe(300);
  });
});

// ── CallQueuedListener.handle() ───────────────────────────────────────────────

describe("CallQueuedListener — handle()", () => {
  beforeEach(() => {
    Application._resetInstance();
  });

  afterEach(() => {
    Application._resetInstance();
  });

  it("is a no-op when emitter is not in container", async () => {
    // Create app but do NOT call boot() — so 'events' singleton is not registered
    Application.create({ env: "test" });
    // tryMake('events') returns undefined → handle() returns early
    const job = new CallQueuedListener("SomeListener", "SomeEvent", {});
    await expect(job.handle()).resolves.toBeUndefined();
  });

  it("calls dispatchQueuedListener on the emitter when available", async () => {
    const app = Application.create({ env: "test" });
    // Register a fake emitter directly (without full boot)
    const dispatched: Array<[string, unknown]> = [];
    const fakeEmitter = {
      dispatchQueuedListener: async (name: string, payload: unknown) => {
        dispatched.push([name, payload]);
      },
    };
    app.container.value("events" as never, fakeEmitter as never);

    const job = new CallQueuedListener("OnOrderShipped", "OrderShipped", { orderId: 7 });
    await job.handle();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]![0]).toBe("OnOrderShipped");
    expect(dispatched[0]![1]).toEqual({ orderId: 7 });
  });
});
