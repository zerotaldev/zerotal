/**
 * What a patch says about the snapshot it was computed against, and what an error frame says
 * about what went wrong.
 *
 * A delta only rebuilds the signed snapshot when it is applied to the snapshot the server
 * diffed against. When a slow action's reply and the next one's both landed, the browser applied
 * the second to the first's result, the rebuilt snapshot no longer verified, and every later
 * action was refused. A delta now names its base, and the browser asks for the whole snapshot
 * (`full`) when it holds another.
 */
import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { Container } from "@zerotal/core";
import { Component } from "../Component.ts";
import { expose, locked } from "../decorators.ts";
import {
  applySnapshotDelta,
  dehydrate,
  encodeSnapshotDelta,
  verifySnapshot,
} from "../dehydrate.ts";
import { registerPage, _getPageEntries } from "../registry.ts";
import type { Snapshot } from "../types.ts";
import { _handleFlowMessage, _resetInvalidFrames } from "./FlowProvider.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

type Frame = Record<string, unknown>;
type Deps = Parameters<typeof _handleFlowMessage>[2];
type Socket = Parameters<typeof _handleFlowMessage>[0];

class CounterPage extends Component {
  @locked count = 0;
  @expose label = "same";

  @expose async bump(): Promise<void> {
    this.count += 1;
  }

  @expose async nothing(): Promise<void> {}

  async hidden(): Promise<void> {}

  override async render() {
    return { html: `<p>${this.label}</p>` };
  }
}

class BrokenPage extends Component {
  @expose async go(): Promise<void> {}
  override async render(): Promise<{ html: string }> {
    throw new Error("connect ECONNREFUSED 10.0.0.12:5432");
  }
}

function socket(): { ws: Socket; frames: Frame[] } {
  const frames: Frame[] = [];
  const ws = {
    data: { origin: "http://localhost", headers: new Headers(), remoteIp: "203.0.113.11" },
    send(message: string): void {
      frames.push(JSON.parse(message) as Frame);
    },
  };
  return { ws: ws as unknown as Socket, frames };
}

const deps = (): Deps => ({ container: new Container(), globalMiddleware: () => [] });

function snapshotOf(count = 0): Snapshot {
  const page = new CounterPage();
  page.count = count;
  return dehydrate(page, {
    id: "counter-1",
    name: "CounterPage",
    path: "/counter",
    url: "/counter",
  });
}

function call(method: string, snapshot: unknown, extra: Frame = {}): string {
  return JSON.stringify({
    type: "call",
    component: "counter-1",
    method,
    args: [],
    updates: {},
    snapshot,
    ...extra,
  });
}

const patchOf = (frames: Frame[]): Frame => frames.find((f) => f["type"] === "patch")!;
const errorOf = (frames: Frame[]): Frame | undefined => frames.find((f) => f["type"] === "error");

beforeEach(() => {
  _resetInvalidFrames();
  _getPageEntries().delete("CounterPage");
  registerPage("/counter", CounterPage);
});

describe("a delta patch", () => {
  it("names the snapshot it was computed against", async () => {
    const sent = snapshotOf();
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("bump", sent), deps());

    const patch = patchOf(frames);
    expect(patch["base"]).toBe(sent.checksum);
    expect(patch["snapshot"]).toBeUndefined();
    expect(patch["dataDelta"]).toBeDefined();
  });

  it("names its base in the encoder too, which is what the browser checks", () => {
    const before = snapshotOf(0);
    const after = snapshotOf(1);

    const delta = encodeSnapshotDelta(before, after);

    expect(delta.base).toBe(before.checksum);
    expect(verifySnapshot(applySnapshotDelta(before, delta))).toBe(true);
  });
});

describe("a call that asks for the full snapshot", () => {
  it("is answered with the whole signed snapshot, not a delta", async () => {
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("bump", snapshotOf(), { full: true }), deps());

    const patch = patchOf(frames);
    const snapshot = patch["snapshot"] as Snapshot;
    expect(verifySnapshot(snapshot)).toBe(true);
    expect(snapshot.data["count"]?.[0]).toBe(1);
    expect(patch["dataDelta"]).toBeUndefined();
    expect(patch["base"]).toBeUndefined();
  });

  it("always carries its HTML, even when it is the same as the last patch's", async () => {
    // The browser asks for a full snapshot after setting aside a patch it could not apply,
    // whose HTML it never showed, so the server cannot assume the browser has it.
    const { ws, frames } = socket();
    await _handleFlowMessage(ws, call("nothing", snapshotOf()), deps());
    await _handleFlowMessage(ws, call("nothing", snapshotOf()), deps());
    const [, suppressed] = frames.filter((f) => f["type"] === "patch");
    expect(suppressed!["html"]).toBeUndefined();

    await _handleFlowMessage(ws, call("nothing", snapshotOf(), { full: true }), deps());

    const full = frames.filter((f) => f["type"] === "patch").at(-1)!;
    expect(typeof full["html"]).toBe("string");
  });

  it("is a delta again when `full` is anything but true", async () => {
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, call("bump", snapshotOf(), { full: "yes" }), deps());

    expect(patchOf(frames)["snapshot"]).toBeUndefined();
    expect(patchOf(frames)["base"]).toBeDefined();
  });
});

describe("an error frame", () => {
  it.each([
    ["a snapshot that does not verify", () => call("bump", { ...snapshotOf(), checksum: "0" })],
    ["a frame with no snapshot", () => '{"type":"call","component":"counter-1","method":"bump"}'],
    ["a method that is not exposed", () => call("hidden", snapshotOf())],
    [
      "a page that is not registered",
      () => {
        _getPageEntries().delete("CounterPage");
        return call("bump", snapshotOf());
      },
    ],
  ])("carries a code for %s", async (_label, frame) => {
    const { ws, frames } = socket();

    await _handleFlowMessage(ws, frame(), deps());

    expect(errorOf(frames)).toBeDefined();
    expect(
      {
        "Invalid snapshot": "invalid_snapshot",
        "Malformed frame": "malformed_frame",
        'Method "hidden" is not allowed': "method_not_allowed",
        "Unknown component": "unknown_component",
      }[errorOf(frames)!["message"] as string],
    ).toBe(errorOf(frames)!["code"] as string);
  });
});

describe("an error thrown outside the action body", () => {
  it("is reported as a server error, for the browser to show the message it carries", async () => {
    _getPageEntries().delete("BrokenPage");
    registerPage("/broken", BrokenPage);
    const snapshot = dehydrate(new BrokenPage(), {
      id: "broken-1",
      name: "BrokenPage",
      path: "/broken",
      url: "/broken",
    });
    const { ws, frames } = socket();

    await _handleFlowMessage(
      ws,
      JSON.stringify({ type: "call", component: "broken-1", method: "go", snapshot }),
      deps(),
    );

    expect(errorOf(frames)).toMatchObject({ component: "broken-1", code: "server_error" });
    _getPageEntries().delete("BrokenPage");
  });
});
