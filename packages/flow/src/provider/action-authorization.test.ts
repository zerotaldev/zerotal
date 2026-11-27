/**
 * What the action handler trusts from the browser, end to end: one raw frame in, the frames it
 * would send out. A call `beforeAction()` refuses is answered like a call to a method that is
 * not exposed, and a `@reactive` prop changes only with the values its parent signed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { Application, Container } from "@zerotal/core";
import type { HttpContext } from "@zerotal/core";
import { Component } from "../Component.ts";
import { expose, locked, reactive } from "../decorators.ts";
import { MONOTONIC_FIELD, _resetMonotonicStore } from "../monotonic.ts";
import { dehydrate } from "../dehydrate.ts";
import { registerPage, _getPageEntries } from "../registry.ts";
import { _signParentProps } from "../parentProps.ts";
import { _handleFlowMessage, _resetInvalidFrames } from "./FlowProvider.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

type Frame = Record<string, unknown>;
type Socket = Parameters<typeof _handleFlowMessage>[0];
type Deps = Parameters<typeof _handleFlowMessage>[2];

let ran: string[] = [];

class GuardedPage extends Component {
  @locked closed = false;
  @reactive limit = 5;

  @expose async withdraw(): Promise<void> {
    ran.push("withdraw");
  }

  override beforeAction(name: string): boolean {
    return !(this.closed && name === "withdraw");
  }

  override async render() {
    return { html: `<p>limit ${this.limit}</p>` };
  }
}

function socket(): { ws: Socket; frames: Frame[] } {
  const frames: Frame[] = [];
  const ws = {
    data: { origin: "http://localhost", headers: new Headers(), remoteIp: "203.0.113.8" },
    send(message: string): void {
      frames.push(JSON.parse(message) as Frame);
    },
  };
  return { ws: ws as unknown as Socket, frames };
}

const deps = (): Deps => ({
  container: new Container(),
  globalMiddleware: () => [],
  report: async (_error: unknown, _ctx: HttpContext) => {},
});

async function snapshotOf(overrides: Partial<GuardedPage> = {}) {
  const page = new GuardedPage();
  Object.assign(page, overrides);
  page._flowId = "guarded-1";
  page._flowPath = "/guarded";
  return dehydrate(page, { id: "guarded-1", name: "GuardedPage", path: "/guarded" });
}

function call(method: string, snapshot: unknown, args: unknown[] = []): string {
  return JSON.stringify({
    type: "call",
    component: "guarded-1",
    method,
    args,
    updates: {},
    snapshot,
  });
}

const errorOf = (frames: Frame[]) => frames.find((f) => f["type"] === "error");
const patchOf = (frames: Frame[]) => frames.find((f) => f["type"] === "patch");

const writeOut = process.stdout.write.bind(process.stdout);

beforeEach(() => {
  Application._resetInstance();
  _resetInvalidFrames();
  _getPageEntries().delete("GuardedPage");
  registerPage("/guarded", GuardedPage);
  ran = [];
  process.stdout.write = (() => true) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = writeOut;
});

describe("a call beforeAction() refuses", () => {
  it("does not run, and is answered like a method that is not exposed", async () => {
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("withdraw", await snapshotOf({ closed: true })), deps());

    expect(ran).toEqual([]);
    expect(errorOf(frames)?.["message"]).toBe('Method "withdraw" is not allowed');
    expect(patchOf(frames)).toBeUndefined();
  });

  it("runs when beforeAction() lets it through", async () => {
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("withdraw", await snapshotOf()), deps());

    expect(ran).toEqual(["withdraw"]);
    expect(errorOf(frames)).toBeUndefined();
  });
});

describe("a @reactive prop over the wire", () => {
  it("is not written by $set", async () => {
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("$set", await snapshotOf(), ["limit", 9999]), deps());

    expect(String(patchOf(frames)?.["html"])).toContain("limit 5");
  });

  it("is written by $props with the parent's signed values", async () => {
    const { ws, frames } = socket();
    const json = JSON.stringify({ limit: 8 });
    const sig = _signParentProps("guarded-1", json);

    await _handleFlowMessage(ws, call("$props", await snapshotOf(), [json, sig]), deps());

    expect(String(patchOf(frames)?.["html"])).toContain("limit 8");
  });

  it("is not written by $props with values the parent did not sign", async () => {
    const { ws, frames } = socket();
    const sig = _signParentProps("guarded-1", JSON.stringify({ limit: 8 }));

    await _handleFlowMessage(
      ws,
      call("$props", await snapshotOf(), [JSON.stringify({ limit: 9999 }), sig]),
      deps(),
    );

    expect(String(patchOf(frames)?.["html"])).toContain("limit 5");
  });
});

class BrokenPolicyPage extends Component {
  @expose async go(): Promise<void> {
    ran.push("go");
  }

  override beforeAction(): boolean {
    throw new Error("policy store down");
  }

  override async render() {
    return { html: "<p></p>" };
  }
}

describe("an authorization check that throws", () => {
  it("refuses the call and reports the error to the app's handler", async () => {
    _getPageEntries().delete("BrokenPolicyPage");
    registerPage("/broken", BrokenPolicyPage);
    const page = new BrokenPolicyPage();
    page._flowId = "broken-1";
    page._flowPath = "/broken";
    const snapshot = dehydrate(page, { id: "broken-1", name: "BrokenPolicyPage", path: "/broken" });
    const reported: unknown[] = [];
    const { ws, frames } = socket();

    await _handleFlowMessage(
      ws,
      JSON.stringify({ ...JSON.parse(call("go", snapshot)), component: "broken-1" }),
      { ...deps(), report: async (error: unknown) => void reported.push(error) },
    );

    expect(ran).toEqual([]);
    expect(errorOf(frames)).toMatchObject({ code: "method_not_allowed" });
    expect(String(reported[0])).toContain("policy store down");
    _getPageEntries().delete("BrokenPolicyPage");
  });
});

class CreditsPage extends Component {
  @locked({ monotonic: true }) credits = 3;
  @expose note = "";

  @expose async spend(): Promise<void> {
    ran.push("spend");
  }

  override async onUpdating(prop: string): Promise<void> {
    ran.push(`updating ${prop}`);
  }

  override async render() {
    return { html: `<p>${this.credits}</p>` };
  }
}

describe("a @locked({ monotonic: true }) page over the wire", () => {
  const send = async (snapshot: unknown) => {
    const { ws, frames } = socket();
    await _handleFlowMessage(
      ws,
      JSON.stringify({ ...JSON.parse(call("spend", snapshot)), component: "credits-1" }),
      deps(),
    );
    return frames;
  };

  it("keeps the claim of a frame whose field writes ran, even when its method is refused", async () => {
    // The hooks a write runs are the page's own code: a refused method name on top must not
    // hand the snapshot back to run them again.
    _getPageEntries().delete("CreditsPage");
    registerPage("/credits", CreditsPage);
    _resetMonotonicStore();
    const page = new CreditsPage();
    page._flowId = "credits-1";
    page._flowPath = "/credits";
    const snapshot = dehydrate(page, { id: "credits-1", name: "CreditsPage", path: "/credits" });
    const writeAndRefuse = async () => {
      const { ws, frames } = socket();
      const frame = { ...JSON.parse(call("noSuchMethod", snapshot)), component: "credits-1" };
      frame.updates = { note: "hi" };
      await _handleFlowMessage(ws, JSON.stringify(frame), deps());
      return frames;
    };

    await writeAndRefuse();
    expect(ran).toEqual(["updating note"]);
    const again = await writeAndRefuse();
    expect(ran).toEqual(["updating note"]);
    expect(errorOf(again)).toMatchObject({ code: "snapshot_replayed" });
    _getPageEntries().delete("CreditsPage");
  });

  it("runs a snapshot once, and refuses it the second time with snapshot_replayed and a reload", async () => {
    _getPageEntries().delete("CreditsPage");
    registerPage("/credits", CreditsPage);
    const page = new CreditsPage();
    page._flowId = "credits-1";
    page._flowPath = "/credits";
    const snapshot = dehydrate(page, { id: "credits-1", name: "CreditsPage", path: "/credits" });
    expect(snapshot.data[MONOTONIC_FIELD]).toBeDefined();

    const first = await send(snapshot);
    expect(ran).toEqual(["spend"]);
    const next = patchOf(first);
    expect(next).toBeDefined();

    const again = await send(snapshot);
    expect(ran).toEqual(["spend"]);
    expect(errorOf(again)).toMatchObject({ code: "snapshot_replayed", reload: true });

    // Sent at the same moment, the same snapshot runs once.
    ran = [];
    const fresh = new CreditsPage();
    fresh._flowId = "credits-1";
    fresh._flowPath = "/credits";
    _resetMonotonicStore();
    const twin = dehydrate(fresh, { id: "credits-1", name: "CreditsPage", path: "/credits" });
    await Promise.all([send(twin), send(twin)]);
    expect(ran).toEqual(["spend"]);
    _getPageEntries().delete("CreditsPage");
  });
});
