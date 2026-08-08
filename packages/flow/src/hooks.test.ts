import { describe, it, expect, beforeAll } from "bun:test";
import { Component } from "./Component.ts";
import { expose, locked } from "./decorators.ts";
import { FlowTest } from "./testing.ts";
import type { HtmlNode } from "./jsx-runtime.ts";

beforeAll(() => {
  Bun.env.APP_KEY = "test-app-key-aaaaaaaaaaaaaaaaaaaaaaaa";
});

/**
 * A page that records every lifecycle hook into a (non-serialised) log so tests
 * can assert ordering and firing. `log` / `renderedHtml` are undecorated, so they
 * never cross the wire and persist across the harness's reused instance.
 */
class HookPage extends Component {
  @expose count = 0;
  @expose username = "";
  @locked secret = "x";

  log: string[] = [];
  renderedHtml = "";

  override async onBoot() {
    this.log.push("boot");
  }
  override async onMount() {
    this.log.push("mount");
  }
  override async onHydrate() {
    this.log.push("hydrate");
  }
  override async onDehydrate() {
    this.log.push("dehydrate");
  }
  override async onUpdate() {
    this.log.push("onUpdate");
  }
  override async onRendering() {
    this.log.push("rendering");
  }
  override async onRendered(html: string) {
    this.renderedHtml = html;
    this.log.push("rendered");
  }

  override async onUpdating(prop: string, value: unknown) {
    this.log.push(`updating:${prop}=${value}`);
  }
  override async onUpdated(prop: string, value: unknown) {
    this.log.push(`updated:${prop}=${value}`);
  }

  /** Per-property variant — normalises the value. */
  async onUpdatedUsername(value: unknown) {
    this.username = String(value).toLowerCase();
    this.log.push("updatedUsername");
  }

  @expose async bump() {
    this.count++;
  }
  @expose async save() {
    this.dispatch("saved", { id: 1 });
  }
  @expose async saveTo() {
    this.dispatchTo("Dashboard", "saved", { id: 2 });
  }
  @expose async saveSelf() {
    this.dispatchSelf("refresh");
  }
  @expose async boom() {
    throw new Error("kaboom");
  }

  override async render(): Promise<HtmlNode> {
    return { html: `<p>count:${this.count}</p>` };
  }
}

describe("lifecycle hooks — initial render", () => {
  it("runs boot then mount once, with rendering/rendered/dehydrate, but not hydrate", async () => {
    const t = await FlowTest.mount(HookPage);
    const log = t.page().log;

    expect(log.slice(0, 2)).toEqual(["boot", "mount"]);
    expect(log).toContain("rendering");
    expect(log).toContain("rendered");
    expect(log).toContain("dehydrate");
    expect(log).not.toContain("hydrate"); // hydrate is subsequent-only
    expect(t.page().renderedHtml).toContain("count:0");
    // rendering fires before rendered
    expect(log.indexOf("rendering")).toBeLessThan(log.indexOf("rendered"));
  });
});

describe("lifecycle hooks — subsequent (action) request", () => {
  it("runs boot + hydrate on each action, not mount", async () => {
    const t = await FlowTest.mount(HookPage);
    t.page().log.length = 0; // reset after the initial render

    await t.call("bump");
    const log = t.page().log;

    expect(log[0]).toBe("boot");
    expect(log[1]).toBe("hydrate");
    expect(log).toContain("onUpdate");
    expect(log).toContain("rendering");
    expect(log).toContain("rendered");
    expect(log).toContain("dehydrate");
    expect(log).not.toContain("mount");
    expect(t.page().count).toBe(1);
  });
});

describe("property update hooks", () => {
  it("fires updating then updated around a client update", async () => {
    const t = await FlowTest.mount(HookPage);
    t.page().log.length = 0;

    await t.update("count", 5);
    const log = t.page().log;

    expect(log).toContain("updating:count=5");
    expect(log).toContain("updated:count=5");
    expect(log.indexOf("updating:count=5")).toBeLessThan(log.indexOf("updated:count=5"));
    expect(t.page().count).toBe(5);
  });

  it("fires the per-property onUpdated<Prop> variant and can normalise the value", async () => {
    const t = await FlowTest.mount(HookPage);

    await t.update("username", "ALICE");

    expect(t.page().log).toContain("updatedUsername");
    expect(t.page().username).toBe("alice"); // lower-cased by onUpdatedUsername
  });

  it("does not fire update hooks for @locked props (and leaves them unchanged)", async () => {
    const t = await FlowTest.mount(HookPage);
    t.page().log.length = 0;

    await t.update("secret", "hacked");

    expect(t.page().log.some((l) => l.startsWith("updating"))).toBe(false);
    expect(t.page().secret).toBe("x");
  });
});

describe("events — dispatch targeting", () => {
  it("dispatch() queues a plain (broadcast) event", async () => {
    const t = await FlowTest.mount(HookPage);
    await t.call("save");

    t.assertDispatched("saved");
    const ev = t.effects()!.events.find((e) => e.name === "saved")!;
    expect(ev.to).toBeUndefined();
    expect(ev.self).toBeUndefined();
    expect(ev.data).toEqual({ id: 1 });
  });

  it("dispatchTo() tags the target component class", async () => {
    const t = await FlowTest.mount(HookPage);
    await t.call("saveTo");

    const ev = t.effects()!.events.find((e) => e.name === "saved")!;
    expect(ev.to).toBe("Dashboard");
  });

  it("dispatchSelf() marks the event self-only", async () => {
    const t = await FlowTest.mount(HookPage);
    await t.call("saveSelf");

    const ev = t.effects()!.events.find((e) => e.name === "refresh")!;
    expect(ev.self).toBe(true);
  });
});

describe("exception hook", () => {
  it("onError catches a thrown action and flashes by default", async () => {
    // tolerateErrors() opts into the capture: this test is *about* the error path.
    // Without it `call` rethrows, which is what stops an action that throws in
    // production from looking like an action that quietly did nothing in tests.
    const t = (await FlowTest.mount(HookPage)).tolerateErrors();
    await t.call("boom");
    t.assertFlashed("error", "kaboom");
    t.assertErrored("kaboom");
  });

  it("rethrows a thrown action by default, so a broken action fails its test", async () => {
    const t = await FlowTest.mount(HookPage);
    expect(t.call("boom")).rejects.toThrow("kaboom");
  });
});
