/** @jsxImportSource @zerotal/flow */
/**
 * `this.refresh()` called inside an action re-runs `onMount()` on that same round trip.
 *
 * The docs promise it (the lifecycle guide, the events guide, the pagination guide), and the
 * `make:flow --crud` stub depends on it: an action changes the database, calls `refresh()`, and
 * expects the list on screen to be the new one. The server only looked for the flag *before* the
 * action ran, so a refresh the action itself asked for was recorded, copied into the effects,
 * and never read. The action ran, the row was saved, the list rendered as it was before, and
 * nothing anywhere said so.
 */
import { describe, it, expect, beforeEach, beforeAll } from "bun:test";
import { Container } from "@zerotal/core";
import { Component } from "./Component.ts";
import { expose, locked } from "./decorators.ts";
import { dehydrate } from "./dehydrate.ts";
import { registerPage, _getPageEntries } from "./registry.ts";
import { _handleFlowMessage } from "./provider/FlowProvider.ts";
import { FlowTest } from "./testing.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

/** Stands in for the database: what onMount() loads from. */
let rows: string[] = [];
/** The order things happened in, so "after the action" is something a test can say. */
let trail: string[] = [];

class ListPage extends Component {
  @locked items: string[] = [];
  @expose failing = false;

  override async onMount(): Promise<void> {
    trail.push("mount");
    this.items = [...rows];
  }

  /** The documented pattern: change the data, then ask for a reload. */
  @expose async add(): Promise<void> {
    trail.push("action");
    rows = [...rows, "added"];
    this.refresh();
  }

  /** An action that never asks for a reload. */
  @expose async addQuietly(): Promise<void> {
    trail.push("action");
    rows = [...rows, "added"];
  }

  @expose async addThenFail(): Promise<void> {
    rows = [...rows, "added"];
    this.refresh();
    throw new Error("boom");
  }

  override async render() {
    return <p>{this.items.join(",")}</p>;
  }
}

beforeEach(() => {
  rows = ["first"];
  trail = [];
});

describe("this.refresh() inside an action", () => {
  it("reloads what onMount() loads, so the render shows the change", async () => {
    const t = await FlowTest.mount(ListPage);
    t.assertSee("first");

    await t.call("add");

    expect(t.page().items).toEqual(["first", "added"]);
    t.assertSee("first,added");
  });

  it("runs onMount() after the action, once, and before the render", async () => {
    const t = await FlowTest.mount(ListPage);
    trail = [];

    await t.call("add");

    expect(trail).toEqual(["action", "mount"]);
  });

  it("does not re-run onMount() for an action that did not ask for it", async () => {
    const t = await FlowTest.mount(ListPage);
    trail = [];

    await t.call("addQuietly");

    expect(trail).toEqual(["action"]);
    expect(t.page().items).toEqual(["first"]); // the stale list is the documented default
  });

  it("asks once per call: the next action starts without a pending refresh", async () => {
    const t = await FlowTest.mount(ListPage);
    await t.call("add");
    trail = [];

    await t.call("addQuietly");

    expect(trail).toEqual(["action"]);
  });

  it("does not reload after an action that threw", async () => {
    const t = (await FlowTest.mount(ListPage)).tolerateErrors();
    trail = [];

    await t.call("addThenFail");

    t.assertErrored(/boom/);
    expect(trail).toEqual([]);
    expect(t.page().items).toEqual(["first"]);
  });
});

/**
 * The same thing through the server's own dispatcher, the one the socket and the HTTP fallback
 * both call. FlowTest drives a copy of that pipeline, so a fix there proves nothing about the
 * server: the bug was in this one.
 */
describe("this.refresh() inside an action, through the server's dispatcher", () => {
  async function callThroughServer(method: string): Promise<Array<Record<string, unknown>>> {
    _getPageEntries().delete("ListPage");
    registerPage("/list", ListPage);

    const page = new ListPage();
    page._flowId = "list-1";
    page._flowPath = "/list";
    await page.onBoot();
    await page.onMount();
    const snapshot = dehydrate(page, { id: "list-1", name: "ListPage", path: "/list" });

    const frames: Array<Record<string, unknown>> = [];
    const ws = {
      data: { origin: "http://localhost", headers: new Headers(), remoteIp: "127.0.0.1" },
      send(message: string): void {
        frames.push(JSON.parse(message) as Record<string, unknown>);
      },
    };
    const frame = { type: "call", component: "list-1", method, args: [], updates: {}, snapshot };

    await _handleFlowMessage(
      ws as unknown as Parameters<typeof _handleFlowMessage>[0],
      JSON.stringify(frame),
      { container: new Container(), globalMiddleware: () => [] },
    );
    return frames;
  }

  /** The html the client would paint after the action. */
  const painted = (frames: Array<Record<string, unknown>>): string =>
    String(frames.find((f) => f["type"] === "patch")?.["html"] ?? "");

  it("paints the reloaded list", async () => {
    const frames = await callThroughServer("add");

    expect(painted(frames)).toContain("first,added");
  });

  it("paints the old list when the action did not ask for a reload", async () => {
    const frames = await callThroughServer("addQuietly");

    expect(painted(frames)).toContain("<p>first</p>");
    expect(painted(frames)).not.toContain("added");
  });
});
