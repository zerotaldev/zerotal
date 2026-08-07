import { describe, it, expect, afterEach } from "bun:test";
import { FrameworkEvents } from "./FrameworkEvents.ts";

// The bus is vocabulary-agnostic, so it is exercised with local event classes
// rather than any package's real events.
class Alpha {
  constructor(readonly value = 1) {}
}
class Beta {
  constructor(readonly label = "b") {}
}
class Namespaced {
  static readonly kind = "custom.thing_happened";
}

afterEach(() => FrameworkEvents.clear());

describe("FrameworkEvents bus", () => {
  it("delivers an emitted event to a subscriber synchronously", () => {
    const seen: Alpha[] = [];
    FrameworkEvents.on(Alpha, (e) => seen.push(e));

    FrameworkEvents.emit(new Alpha(42));

    expect(seen).toHaveLength(1);
    expect(seen[0]!.value).toBe(42);
  });

  it("only delivers to handlers registered for that event class", () => {
    let alphas = 0;
    let betas = 0;
    FrameworkEvents.on(Alpha, () => alphas++);
    FrameworkEvents.on(Beta, () => betas++);

    FrameworkEvents.emit(new Beta());

    expect(alphas).toBe(0);
    expect(betas).toBe(1);
  });

  it("unsubscribe() removes the handler", () => {
    let count = 0;
    const off = FrameworkEvents.on(Alpha, () => count++);

    FrameworkEvents.emit(new Alpha());
    off();
    FrameworkEvents.emit(new Alpha());

    expect(count).toBe(1);
  });

  it("swallows subscriber errors so the emitter is never affected", () => {
    FrameworkEvents.on(Alpha, () => {
      throw new Error("boom");
    });
    let reached = false;
    FrameworkEvents.on(Alpha, () => {
      reached = true;
    });

    expect(() => FrameworkEvents.emit(new Alpha())).not.toThrow();
    expect(reached).toBe(true);
  });

  it("clear() removes all subscriptions and handlerCount() reflects it", () => {
    FrameworkEvents.on(Alpha, () => {});
    FrameworkEvents.on(Beta, () => {});
    expect(FrameworkEvents.handlerCount()).toBe(2);

    FrameworkEvents.clear();
    expect(FrameworkEvents.handlerCount()).toBe(0);
  });

  it("delivers to a subscriber registered by string kind (no class import needed)", () => {
    // A decoupled observer subscribes by the event's kind — here the class name,
    // since Alpha declares no explicit `static kind`.
    const seen: unknown[] = [];
    FrameworkEvents.on("Alpha", (e) => seen.push(e));

    FrameworkEvents.emit(new Alpha(7));

    expect(seen).toHaveLength(1);
    expect((seen[0] as Alpha).value).toBe(7);
  });

  it("fires both class- and kind-registered handlers for one emit", () => {
    let byClass = 0;
    let byKind = 0;
    FrameworkEvents.on(Alpha, () => byClass++);
    FrameworkEvents.on("Alpha", () => byKind++);

    FrameworkEvents.emit(new Alpha());

    expect(byClass).toBe(1);
    expect(byKind).toBe(1);
    expect(FrameworkEvents.handlerCount()).toBe(2);
  });

  it("honours an explicit `static kind` over the class name", () => {
    const seen: unknown[] = [];
    FrameworkEvents.on("custom.thing_happened", (e) => seen.push(e));

    FrameworkEvents.emit(new Namespaced());

    expect(seen).toHaveLength(1);
  });
});
