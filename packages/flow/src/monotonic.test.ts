import { describe, it, expect, beforeAll } from "bun:test";
import { HttpContext, RequestContext } from "@zerotal/core";
import { Component } from "./Component.ts";
import { expose, locked, getMonotonicProps, getLockedProps } from "./decorators.ts";
import { dehydrate, hydrate } from "./dehydrate.ts";
import { MONOTONIC_FIELD, _assertMonotonic, FlowSnapshotReplayError } from "./monotonic.ts";
import type { Snapshot } from "./types.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

/**
 * `@locked` stops the browser editing a value, not rewinding it: any snapshot issued to the user
 * in the last twelve hours verifies, so an earlier copy of the page's state can be sent back and
 * acted on again. `@locked({ monotonic: true })` refuses a snapshot older than one already used.
 */

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

class Wallet extends Component {
  @locked({ monotonic: true }) balance = 100;
  @expose amount = 10;

  @expose spend(): void {
    this.balance -= this.amount;
  }

  override async render(): Promise<HtmlNode> {
    return { html: `<p>${this.balance}</p>` };
  }
}

class Plain extends Component {
  @locked balance = 100;
  override async render(): Promise<HtmlNode> {
    return { html: "" };
  }
}

/** A session that lives across requests, as a server-side store would keep it. */
function sessionStore() {
  const data = new Map<string, unknown>();
  return {
    get: (k: string) => data.get(k),
    set: (k: string, v: unknown) => void data.set(k, v),
  };
}

type Store = ReturnType<typeof sessionStore>;

function inRequest<T>(session: Store | undefined, fn: () => T): T {
  const ctx = HttpContext.fake("http://localhost/wallet");
  if (session) Reflect.set(ctx, "session", session);
  return RequestContext.run(ctx, fn);
}

/** The first render: a snapshot issued for a fresh page. */
function firstRender(session: Store): Snapshot {
  const page = new Wallet();
  page._flowId = "wallet-1";
  return inRequest(session, () => dehydrate(page, { id: "wallet-1", name: "Wallet", path: "/w" }));
}

/** One action as the dispatcher runs it: check, restore, act, issue the next snapshot. */
async function act(session: Store, snapshot: Snapshot): Promise<Snapshot> {
  return inRequest(session, async () => {
    _assertMonotonic(snapshot, getMonotonicProps(Wallet.prototype).size > 0);
    const page = await hydrate(snapshot, Wallet);
    page._flowId = snapshot.memo.id;
    page.spend();
    return dehydrate(page, snapshot.memo);
  });
}

describe("@locked({ monotonic: true })", () => {
  it("is still a locked field, and plain @locked is not monotonic", () => {
    const wallet = new Wallet();
    expect(getLockedProps(wallet).has("balance")).toBe(true);
    expect(getMonotonicProps(Wallet.prototype).has("balance")).toBe(true);
    expect(getMonotonicProps(Plain.prototype).size).toBe(0);
  });

  it("carries a server-issued sequence in the signed snapshot", () => {
    const session = sessionStore();
    const first = firstRender(session);
    const second = firstRender(session);
    expect(first.data[MONOTONIC_FIELD]![0]).toBe("1:wallet-1");
    expect(second.data[MONOTONIC_FIELD]![0]).toBe("2:wallet-1");
    expect(first.data[MONOTONIC_FIELD]![1]["locked"]).toBe(true);
  });

  it("accepts each newer snapshot in turn", async () => {
    const session = sessionStore();
    const s1 = firstRender(session);
    const s2 = await act(session, s1);
    const s3 = await act(session, s2);
    expect(s3.data["balance"]![0]).toBe(80);
  });

  it("refuses a snapshot older than one already acted on", async () => {
    const session = sessionStore();
    const s1 = firstRender(session);
    await act(session, s1); // the balance is now 90 on the server's side

    // The browser saved s1 (balance 100) and sends it back.
    await expect(act(session, s1)).rejects.toBeInstanceOf(FlowSnapshotReplayError);
  });

  it("refuses the same snapshot twice", async () => {
    const session = sessionStore();
    const s1 = firstRender(session);
    const s2 = await act(session, s1);
    await act(session, s2);
    await expect(act(session, s2)).rejects.toBeInstanceOf(FlowSnapshotReplayError);
  });

  it("refuses a snapshot whose counter is not in this session", async () => {
    const s1 = firstRender(sessionStore());
    await expect(act(sessionStore(), s1)).rejects.toBeInstanceOf(FlowSnapshotReplayError);
  });

  it("asks for SessionMiddleware when a request has no session", () => {
    const page = new Wallet();
    page._flowId = "wallet-1";
    expect(() =>
      inRequest(undefined, () => dehydrate(page, { id: "wallet-1", name: "Wallet", path: "/w" })),
    ).toThrow(/SessionMiddleware/);
  });

  it("leaves a plain @locked page's replay as it was", async () => {
    // Plain @locked does not cover rewinding — documented, and unchanged here.
    const page = new Plain();
    const snap = dehydrate(page, { id: "plain-1", name: "Plain", path: "/p" });
    expect(() => _assertMonotonic(snap, getMonotonicProps(Plain.prototype).size > 0)).not.toThrow();
    expect(() => _assertMonotonic(snap, getMonotonicProps(Plain.prototype).size > 0)).not.toThrow();
  });
});
