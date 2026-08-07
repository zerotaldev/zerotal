import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { Component } from "./Component.ts";
import { expose, locked } from "./decorators.ts";
import { dehydrate } from "./dehydrate.ts";
import {
  persistDurable,
  restoreDurable,
  getDurableConfig,
  getDurableStore,
  _resetDurableStore,
} from "./durable.ts";
import type { HttpContext } from "@zerotal/core";
import type { HtmlNode } from "./jsx-runtime.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

class WizardPage extends Component {
  static override durable = true;
  @expose step = 1;
  @locked note = "";
  @expose next(): void {
    this.step++;
  }
  override async render(): Promise<HtmlNode> {
    return { html: `<div>${this.step}</div>` };
  }
}

const memo = { id: "w1", name: "WizardPage", path: "/wizard" } as const;

/** A minimal session-like store backing session-scoped keys. */
function makeSession() {
  const m = new Map<string, unknown>();
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: unknown) => m.set(k, v),
    has: (k: string) => m.has(k),
  };
}

function ctxFor(userId: string | null, session = makeSession()): HttpContext {
  return { ...(userId != null ? { user: { id: userId } } : {}), session } as unknown as HttpContext;
}

function wizard(step: number, note = ""): WizardPage {
  const p = new WizardPage();
  p._flowPath = "/wizard";
  p.step = step;
  p.note = note;
  return p;
}

describe("durable snapshots", () => {
  beforeEach(() => _resetDurableStore());

  it("persists a snapshot and resumes it exactly, skipping onMount", async () => {
    const ctx = ctxFor("A");
    await persistDurable(wizard(3, "hello"), ctx, dehydrate(wizard(3, "hello"), memo));

    const p = new WizardPage();
    p._flowPath = "/wizard";
    const resumed = await restoreDurable(p, ctx);

    expect(resumed).toBe(true);
    expect(p.step).toBe(3);
    expect(p.note).toBe("hello");
    expect((p as unknown as { _skipMount?: boolean })._skipMount).toBe(true);
  });

  it("returns false (fresh mount) when there is no stored snapshot", async () => {
    const p = new WizardPage();
    p._flowPath = "/wizard";
    expect(await restoreDurable(p, ctxFor("A"))).toBe(false);
    expect(p.step).toBe(1); // untouched default
  });

  it("isolates users — user B cannot resume user A's snapshot", async () => {
    const p1 = wizard(5);
    await persistDurable(p1, ctxFor("A"), dehydrate(p1, memo));

    const p2 = new WizardPage();
    p2._flowPath = "/wizard";
    expect(await restoreDurable(p2, ctxFor("B"))).toBe(false);
    expect(p2.step).toBe(1);
  });

  it("falls back to a fresh mount when the stored snapshot is tampered", async () => {
    const ctx = ctxFor("A");
    const p1 = wizard(4);
    await persistDurable(p1, ctx, dehydrate(p1, memo));

    // Tamper the stored snapshot in place (the memory store holds the object) without re-signing.
    const key = "flow:durable:u:A:/wizard:WizardPage";
    const stored = (await getDurableStore().get(key))!;
    stored.data["step"] = [999, {}];

    const p2 = new WizardPage();
    p2._flowPath = "/wizard";
    expect(await restoreDurable(p2, ctx)).toBe(false);
    expect(p2.step).toBe(1);
  });

  it("clearDurable() deletes the stored entry so the next visit starts fresh", async () => {
    const ctx = ctxFor("A");
    await persistDurable(wizard(2), ctx, dehydrate(wizard(2), memo));

    const done = wizard(9);
    done.clearDurable();
    await persistDurable(done, ctx, dehydrate(done, memo));

    const p = new WizardPage();
    p._flowPath = "/wizard";
    expect(await restoreDurable(p, ctx)).toBe(false);
  });

  it("user scope falls back to the session when anonymous", async () => {
    const anon = ctxFor(null); // no user, shared session object
    const p1 = wizard(7);
    await persistDurable(p1, anon, dehydrate(p1, memo));

    const p2 = new WizardPage();
    p2._flowPath = "/wizard";
    expect(await restoreDurable(p2, anon)).toBe(true);
    expect(p2.step).toBe(7);
  });

  it("is a no-op for a component that did not opt into static durable", async () => {
    class Plain extends Component {
      @expose x = 1;
      override async render(): Promise<HtmlNode> {
        return { html: "<i/>" };
      }
    }
    const ctx = ctxFor("A");
    const p = new Plain();
    p._flowPath = "/p";
    await persistDurable(p, ctx, dehydrate(p, { id: "p1", name: "Plain", path: "/p" }));

    const p2 = new Plain();
    p2._flowPath = "/p";
    expect(await restoreDurable(p2, ctx)).toBe(false);
  });

  it("getDurableConfig normalizes the opt-in surface", () => {
    class A extends Component {
      static override durable = true;
      override async render(): Promise<HtmlNode> {
        return { html: "" };
      }
    }
    class B extends Component {
      static override durable = { ttl: "2h", scope: "session" as const };
      override async render(): Promise<HtmlNode> {
        return { html: "" };
      }
    }
    class C extends Component {
      override async render(): Promise<HtmlNode> {
        return { html: "" };
      }
    }
    expect(getDurableConfig(new A())).toEqual({ ttlMs: 86_400_000, scope: "user" });
    expect(getDurableConfig(new B())).toEqual({ ttlMs: 7_200_000, scope: "session" });
    expect(getDurableConfig(new C())).toBeNull();
  });
});
