import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { FrameworkEvents } from "./FrameworkEvents.ts";
import { Application } from "../application/Application.ts";

/**
 * A handler given to `on()` runs in the emitter's call stack. A ledger row is I/O, so it either
 * blocked the request that caused it or was fired and forgotten, and a promise rejected by a
 * synchronous handler is nobody's to catch: the failure was invisible to the request and could
 * be an unhandled rejection to the process. `onAsync` runs the handler off the emitter's stack,
 * awaits it, and reports a failure.
 */
class Thing {
  constructor(readonly id: number) {}
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("FrameworkEvents.onAsync", () => {
  let offs: Array<() => void> = [];

  beforeEach(() => {
    Application._resetInstance(); // no ambient app, so frameworkLog() writes to stdout
  });

  afterEach(() => {
    for (const off of offs) off();
    offs = [];
    Application._resetInstance();
  });

  const sub = <E extends object>(...args: Parameters<typeof FrameworkEvents.onAsync<E>>) => {
    const off = FrameworkEvents.onAsync(...args);
    offs.push(off);
    return off;
  };

  it("does not run the handler in the emitter's call stack", async () => {
    const order: string[] = [];
    sub(Thing, () => {
      order.push("handler");
    });

    FrameworkEvents.emit(new Thing(1));
    order.push("emitter continues");
    await FrameworkEvents.settled();

    expect(order).toEqual(["emitter continues", "handler"]);
  });

  it("does not make the emitter wait for a slow handler", async () => {
    let finished = false;
    sub(Thing, async () => {
      await sleep(40);
      finished = true;
    });

    const started = performance.now();
    FrameworkEvents.emit(new Thing(1));
    const emitMs = performance.now() - started;

    expect(emitMs).toBeLessThan(20);
    expect(finished).toBe(false);
    await FrameworkEvents.settled();
    expect(finished).toBe(true);
  });

  it("settled() waits for every handler, including slow ones started together", async () => {
    const done: number[] = [];
    sub(Thing, async (e) => {
      await sleep(e.id * 15);
      done.push(e.id);
    });

    FrameworkEvents.emit(new Thing(3));
    FrameworkEvents.emit(new Thing(1));
    FrameworkEvents.emit(new Thing(2));
    await FrameworkEvents.settled();

    expect(done).toEqual([1, 2, 3]);
  });

  it("settled() resolves at once when nothing is running", async () => {
    await FrameworkEvents.settled();
  });

  it("does not throw a failing handler at the emitter, and carries on with the next event", async () => {
    const seen: number[] = [];
    sub(Thing, async (e) => {
      seen.push(e.id);
      if (e.id === 1) throw new Error("ledger down");
    });

    expect(() => FrameworkEvents.emit(new Thing(1))).not.toThrow();
    FrameworkEvents.emit(new Thing(2));
    await FrameworkEvents.settled();

    expect(seen).toEqual([1, 2]);
  });

  it("reports a failure to the log rather than leaving it unhandled", async () => {
    let out = "";
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    }) as typeof process.stdout.write;
    try {
      sub(Thing, async () => {
        throw new Error("ledger down");
      });

      FrameworkEvents.emit(new Thing(1));
      await FrameworkEvents.settled();
      await Bun.sleep(0);
    } finally {
      process.stdout.write = original;
    }

    expect(out).toContain("An async handler for Thing failed");
    expect(out).toContain("ledger down");
  });

  it("stops delivering once unsubscribed", async () => {
    const seen: number[] = [];
    const off = sub(Thing, (e) => {
      seen.push(e.id);
    });

    FrameworkEvents.emit(new Thing(1));
    await FrameworkEvents.settled();
    off();
    FrameworkEvents.emit(new Thing(2));
    await FrameworkEvents.settled();

    expect(seen).toEqual([1]);
  });

  it("can subscribe by kind, like on()", async () => {
    const seen: number[] = [];
    sub<Thing>("Thing", (e) => {
      seen.push(e.id);
    });

    FrameworkEvents.emit(new Thing(7));
    await FrameworkEvents.settled();

    expect(seen).toEqual([7]);
  });

  it("works alongside a synchronous handler for the same event", async () => {
    const order: string[] = [];
    offs.push(FrameworkEvents.on(Thing, () => order.push("sync")));
    sub(Thing, () => {
      order.push("async");
    });

    FrameworkEvents.emit(new Thing(1));
    order.push("after emit");
    await FrameworkEvents.settled();

    expect(order).toEqual(["sync", "after emit", "async"]);
  });
});
