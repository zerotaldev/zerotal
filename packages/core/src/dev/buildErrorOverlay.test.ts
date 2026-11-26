/**
 * A failed frontend build is shown in the browser, not only in the terminal.
 *
 * From the 1.18.0 starter walk: in React/Vue dev, breaking a page's syntax and reloading served
 * the last good bundle with nothing said; the error was only in the terminal. The orchestrator
 * now tells the worker, the worker tells every tab (and each tab that connects later), and
 * `/__dev/reload.js` draws the error over the page, under a strict Content-Security-Policy.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { DevOrchestrator } from "./DevOrchestrator.ts";
import * as DevWsServer from "./DevWsServer.ts";
import { _DEV_RELOAD_SOURCE } from "./reloadClient.ts";
import { _onOrchestratorLine } from "../command/builtin/ServeCommand.ts";

afterEach(() => DevWsServer._setBuildError(null));

// ── The orchestrator ──────────────────────────────────────────────────────────

describe("the orchestrator reports a failed build to the worker", () => {
  function setup() {
    let fail = true;
    const orchestrator = new DevOrchestrator(
      3000,
      "/app",
      async () =>
        fail
          ? {
              success: false,
              logs: ["\u001b[31m[inertia] pages/home.tsx:3:9 Unexpected ;\u001b[0m"],
            }
          : { success: true, logs: [] },
      { onNotice: () => {} },
    );
    const internals = orchestrator as unknown as Record<string, unknown>;
    const lines: string[] = [];
    const child = (into: string[]) => ({
      stdin: { write: (text: string) => void into.push(text), flush: () => {} },
      exited: new Promise<number>(() => {}),
    });
    internals["_child"] = child(lines);
    const build = () => (internals["_runBuild"] as () => Promise<unknown>).call(orchestrator);
    return { orchestrator, internals, lines, child, build, fixed: () => (fail = false) };
  }

  it("sends the failure's lines, without colour codes, and `build-ok` once it builds again", async () => {
    const { lines, build, fixed } = setup();

    await build();
    expect(lines).toEqual([
      `build-error:${JSON.stringify(["[inertia] pages/home.tsx:3:9 Unexpected ;"])}\n`,
    ]);

    fixed();
    await build();
    expect(lines.at(-1)).toBe("build-ok\n");

    // A good build after a good build says nothing new.
    await build();
    expect(lines).toHaveLength(2);
  });

  it("tells a server started after the failure, which knows nothing of it", async () => {
    const { orchestrator, internals, build, child } = setup();
    await build();

    const fresh: string[] = [];
    internals["_spawnServer"] = function (this: Record<string, unknown>) {
      const next = child(fresh);
      this["_child"] = next;
      return next;
    };
    await (internals["_spawnServerWithRetry"] as () => Promise<void>).call(orchestrator);

    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toStartWith("build-error:");
  });
});

// ── The worker ────────────────────────────────────────────────────────────────

describe("the worker shows a failed build in every tab", () => {
  function socket() {
    const sent: string[] = [];
    return { data: {}, sent, send: (m: string) => void sent.push(m) };
  }

  it("pushes the failure to open tabs, and to a tab that opens afterwards", () => {
    const open = socket();
    DevWsServer.open(open);

    _onOrchestratorLine(`build-error:${JSON.stringify(["a.tsx:1:2 Unexpected ;"])}`);
    expect(open.sent).toEqual([`build-error:${JSON.stringify(["a.tsx:1:2 Unexpected ;"])}`]);

    // The developer reloads: the new tab is told at once.
    const reloaded = socket();
    DevWsServer.open(reloaded);
    expect(reloaded.sent).toEqual([`build-error:${JSON.stringify(["a.tsx:1:2 Unexpected ;"])}`]);

    DevWsServer.close(open);
    DevWsServer.close(reloaded);
  });

  it("clears it when the build works again, and a later tab hears nothing of it", () => {
    const tab = socket();
    DevWsServer.open(tab);
    _onOrchestratorLine(`build-error:${JSON.stringify(["x"])}`);
    _onOrchestratorLine("reload:abc123");

    expect(tab.sent).toEqual([`build-error:${JSON.stringify(["x"])}`, "build-ok", "reload"]);
    expect(DevWsServer._currentBuildError()).toBeNull();

    const later = socket();
    DevWsServer.open(later);
    expect(later.sent).toEqual([]);
    DevWsServer.close(tab);
    DevWsServer.close(later);
  });

  it("ignores a line that is not the orchestrator's", () => {
    _onOrchestratorLine("build-error:not json");
    expect(DevWsServer._currentBuildError()).toBeNull();
  });
});

// ── The browser ───────────────────────────────────────────────────────────────

describe("/__dev/reload.js draws the failure over the page", () => {
  /** Just enough of a DOM: elements that record their text, styles, children and attributes. */
  class FakeElement {
    tag: string;
    textContent = "";
    id = "";
    style: Record<string, string> = {};
    attributes: Record<string, string> = {};
    children: FakeElement[] = [];
    parent: FakeElement | null = null;
    constructor(tag: string) {
      this.tag = tag;
    }
    setAttribute(name: string, value: string): void {
      this.attributes[name] = value;
    }
    appendChild(child: FakeElement): FakeElement {
      child.parent = this;
      this.children.push(child);
      return child;
    }
    remove(): void {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((c) => c !== this);
      this.parent = null;
    }
    text(): string {
      return this.textContent + this.children.map((c) => c.text()).join("\n");
    }
  }

  function runClient() {
    const body = new FakeElement("body");
    const keydown: Array<(e: { key: string }) => void> = [];
    const document = {
      body,
      documentElement: body,
      createElement: (tag: string) => new FakeElement(tag),
      addEventListener: (type: string, fn: (e: { key: string }) => void) => {
        if (type === "keydown") keydown.push(fn);
      },
    };
    const sockets: Array<{ onmessage?: (e: { data: string }) => void }> = [];
    class FakeSocket {
      onmessage?: (e: { data: string }) => void;
      onclose?: () => void;
      constructor() {
        sockets.push(this);
      }
    }
    new Function("location", "WebSocket", "setTimeout", "document", _DEV_RELOAD_SOURCE)(
      { protocol: "http:", host: "localhost:3000", reload: () => {} },
      FakeSocket,
      () => {},
      document,
    );
    const overlay = () => body.children.find((c) => c.id === "__zerotal_build_error");
    const send = (data: string) => sockets[0]!.onmessage!({ data });
    return { body, overlay, send, press: (key: string) => keydown.forEach((fn) => fn({ key })) };
  }

  it("shows each line of the failure, says the page is the last good build, and goes on a fix", () => {
    const client = runClient();
    client.send(`build-error:${JSON.stringify(["pages/home.tsx:3:9 Unexpected ;", "second"])}`);

    const overlay = client.overlay()!;
    expect(overlay).toBeDefined();
    expect(overlay.attributes["role"]).toBe("alertdialog");
    expect(overlay.style["position"]).toBe("fixed");
    expect(overlay.text()).toContain("Build failed");
    expect(overlay.text()).toContain("last build that worked");
    expect(overlay.children.find((c) => c.tag === "pre")?.textContent).toBe(
      "pages/home.tsx:3:9 Unexpected ;\nsecond",
    );

    // A second failure replaces the first rather than stacking.
    client.send(`build-error:${JSON.stringify(["third"])}`);
    expect(client.body.children).toHaveLength(1);

    client.send("build-ok");
    expect(client.overlay()).toBeUndefined();
  });

  it("hides on Escape", () => {
    const client = runClient();
    client.send(`build-error:${JSON.stringify(["x"])}`);
    client.press("Escape");
    expect(client.overlay()).toBeUndefined();
  });

  it("builds the overlay without anything a strict CSP refuses", () => {
    // No markup strings (which would need trusting), no style attribute or <style> element
    // (`style-src` without 'unsafe-inline' refuses both), no eval. CSSOM properties set from
    // a same-origin script are allowed.
    for (const banned of [
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "cssText",
      "'style'",
      "<style",
      "eval(",
    ]) {
      expect(_DEV_RELOAD_SOURCE).not.toContain(banned);
    }
  });
});
