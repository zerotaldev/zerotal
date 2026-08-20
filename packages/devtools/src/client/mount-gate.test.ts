/**
 * `DevTools.start()` must mount nothing when the server half is absent.
 *
 * The panel shipped to production on zerotal.dev for exactly this reason: the
 * provider is environment-gated, so the routes were gone, and the client mounted
 * anyway and rendered `Could not read the map — HTTP 404` over the marketing page.
 * Nothing failed, because nothing was asserting that a page without devtools
 * routes ends up without a devtools panel.
 *
 * These drive `start()` through a stubbed `fetch` and a minimal DOM rather than a
 * browser: what is under test is the decision to mount, not the panel's markup.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { DevTools } from "./index.ts";

const PANEL_ID = "__zerotal_dt__";

/** Enough DOM for `start()` to look for its panel and mount into a body. */
function installDom(): void {
  const body = {
    appendChild() {},
    // `mountShell` reaches for these when it builds the frame.
    querySelector: () => null,
    addEventListener() {},
  };
  const nodes = new Map<string, unknown>();

  (globalThis as Record<string, unknown>)["document"] = {
    body,
    getElementById: (id: string) => nodes.get(id) ?? null,
    createElement: () => ({
      style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(this: Record<string, unknown>, k: string, v: string) {
        if (k === "id") nodes.set(v, this);
      },
      appendChild() {},
      addEventListener() {},
      remove() {},
    }),
    addEventListener() {},
    querySelector: () => null,
  };
  (globalThis as Record<string, unknown>)["window"] = { addEventListener() {} };

  // The transport opens one as soon as a mount is allowed. Only the *decision* to
  // mount is under test here, so this exists to keep the allowed path from
  // throwing rather than to model a stream.
  (globalThis as Record<string, unknown>)["EventSource"] = class {
    addEventListener() {}
    close() {}
  };
}

let calls: string[] = [];

beforeEach(() => {
  calls = [];
  installDom();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>)["document"];
  delete (globalThis as Record<string, unknown>)["window"];
});

/** Replace `fetch` with one that answers the probe with `status`. */
function stubFetch(status: number): void {
  (globalThis as Record<string, unknown>)["fetch"] = (url: string) => {
    calls.push(String(url));
    return Promise.resolve({ ok: status >= 200 && status < 300, status });
  };
}

/** Let the probe's promise chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("DevTools.start() — the mount gate", () => {
  it("probes the server before deciding anything", () => {
    // A probe that never settles. The call is recorded synchronously, so the
    // assertion holds — and the mount path never runs, which keeps this test off
    // the real `mountShell` and its shadow root. Whether a 200 mounts is the
    // browser suite's job; what matters here is that nothing is decided before
    // asking.
    (globalThis as Record<string, unknown>)["fetch"] = (url: string) => {
      calls.push(String(url));
      return new Promise(() => {});
    };

    DevTools.start();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/__zerotal/devtools/api/channels");
  });

  it("mounts nothing when the routes are absent", async () => {
    // Production: the provider never registered, so every devtools path 404s.
    stubFetch(404);
    DevTools.start();
    await settle();

    expect(document.getElementById(PANEL_ID)).toBeNull();
  });

  it("mounts nothing when the probe fails outright", async () => {
    // Offline, blocked by CSP, or a proxy answering with something else. Absent is
    // the safe reading: a missed panel costs a keystroke, a stray one is a debug
    // surface on someone's production page.
    (globalThis as Record<string, unknown>)["fetch"] = () => Promise.reject(new Error("blocked"));
    DevTools.start();
    await settle();

    expect(document.getElementById(PANEL_ID)).toBeNull();
  });

  it("honours a custom endpoint when probing", async () => {
    stubFetch(404);
    DevTools.start({ endpoint: "/_dt/" });
    await settle();

    // Trailing slash trimmed, so the probe is not `/_dt//api/channels`.
    expect(calls[0]).toBe("/_dt/api/channels");
  });

  it("does not probe at all when a panel is already on the page", async () => {
    stubFetch(200);
    (globalThis as Record<string, unknown>)["document"] = {
      ...document,
      getElementById: (id: string) => (id === PANEL_ID ? {} : null),
    };

    DevTools.start();
    await settle();

    expect(calls).toHaveLength(0);
  });
});
