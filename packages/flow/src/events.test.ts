import { describe, it, expect, beforeEach } from "bun:test";
import { Component } from "./Component.ts";
import { on } from "./decorators.ts";
import { registerFlowEvent, _resetEventGuards } from "./events.ts";
import type { EventPayload } from "./events.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

// An app-style event contract, declared here so the compile-time assertions below have
// something to check. (Real apps augment `@zerotal/flow`; the package's own tests target
// the source module.)
declare module "./events.ts" {
  interface FlowEvents {
    "post-created": { id: number; title: string };
    "cart-cleared": void;
  }
}

class Emitter extends Component {
  @on("post-created")
  async onPost(data: EventPayload<"post-created">): Promise<void> {
    void data.id; // typed against the contract
  }
  override async render(): Promise<HtmlNode> {
    return { html: "" };
  }
}

describe("typed events", () => {
  beforeEach(() => _resetEventGuards());

  it("dispatch queues the event with its typed payload", () => {
    const p = new Emitter();
    p.dispatch("post-created", { id: 1, title: "hi" });
    expect(p._drainEffects().events).toEqual([
      { name: "post-created", data: { id: 1, title: "hi" } },
    ]);
  });

  it("a void-payload event takes no argument", () => {
    const p = new Emitter();
    p.dispatch("cart-cleared");
    expect(p._drainEffects().events).toEqual([{ name: "cart-cleared", data: {} }]);
  });

  it("an unknown event name still works (untyped fallback — socket:/gradual adoption)", () => {
    const p = new Emitter();
    p.dispatch("socket:orders,OrderPlaced", { any: "thing" });
    expect(p._drainEffects().events[0]!.name).toBe("socket:orders,OrderPlaced");
  });

  it("dispatchTo / dispatchSelf carry the typed payload + targeting", () => {
    const p = new Emitter();
    p.dispatchTo("Dashboard", "post-created", { id: 3, title: "t" });
    p.dispatchSelf("cart-cleared");
    const events = p._drainEffects().events;
    expect(events[0]).toMatchObject({ name: "post-created", to: "Dashboard" });
    expect(events[1]).toMatchObject({ name: "cart-cleared", self: true });
  });

  it("a registered guard rejects a malformed payload at dispatch", () => {
    registerFlowEvent(
      "post-created",
      (x): x is { id: number; title: string } =>
        typeof (x as { id?: unknown })?.id === "number" &&
        typeof (x as { title?: unknown })?.title === "string",
    );
    const p = new Emitter();
    expect(() => p.dispatch("post-created", { id: 7, title: "ok" })).not.toThrow();
    // A payload that violates the guard (only reachable at runtime, e.g. a forged client dispatch):
    expect(() =>
      (p as unknown as { dispatch(n: string, d: unknown): void }).dispatch("post-created", {
        id: "nope",
      }),
    ).toThrow(/failed its registered guard/);
  });

  // ── Compile-time enforcement (validated by tsc; the runtime lines are harmless) ──
  it("enforces payload types at compile time", () => {
    const p = new Emitter();
    p.dispatch("post-created", { id: 1, title: "ok" }); // ✓ correct
    // @ts-expect-error — wrong field type in the payload
    p.dispatch("post-created", { id: "x", title: "ok" });
    // @ts-expect-error — missing required payload
    p.dispatch("post-created");
    // @ts-expect-error — a void event accepts no payload
    p.dispatch("cart-cleared", { nope: true });
    p._drainEffects(); // clear the queue
    expect(true).toBe(true);
  });
});
