/**
 * `DevTools.start()` must mount nothing when the server half is absent — and on a
 * production page it must work that out without asking.
 *
 * The panel shipped to production on zerotal.dev for the first half of that: the
 * provider is environment-gated, so the routes were gone, and the client mounted
 * anyway and rendered `Could not read the map — HTTP 404` over the marketing page.
 * Nothing failed, because nothing was asserting that a page without devtools
 * routes ends up without a devtools panel.
 *
 * The second half came from the fix. Probing on every page load was correct — a
 * 404 meant absent — but it left a request to a devtools URL in the console of a
 * live site, which reads as leaked tooling however deliberate it is. So presence
 * now arrives in the document where the middleware can put it there, and the probe
 * survives only for development hosts, because `Router.raw` bypasses the
 * middleware pipeline and the apps that use it have no other way to be found.
 *
 * These drive `start()` through a minimal DOM rather than a browser: what is under
 * test is the decision to mount, not the panel's markup.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { DevTools } from "./index.ts";

const PANEL_ID = "__zerotal_dt__";

let fetches: string[] = [];
let streams: string[] = [];

/**
 * A node with just enough surface for the mount path to run to completion.
 *
 * `attachShadow` matters: `mountShell` builds the panel inside a shadow root, and
 * without one the mount throws *inside* the promise the gate returns — surfacing
 * as an unhandled rejection rather than as a failing assertion, which hides the
 * result either way.
 */
function makeElement(nodes: Map<string, unknown>): Record<string, unknown> {
  const el: Record<string, unknown> = {
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    setAttribute(this: Record<string, unknown>, k: string, v: string) {
      if (k === "id") nodes.set(v, this);
    },
    getAttribute: () => null,
    removeAttribute() {},
    appendChild() {},
    addEventListener() {},
    removeEventListener() {},
    remove() {},
    focus() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    innerHTML: "",
    textContent: "",
  };
  el["attachShadow"] = () => ({
    appendChild() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    innerHTML: "",
  });
  return el;
}

/**
 * Enough DOM for `start()` to look for its marker, its panel, and a body.
 *
 * `marker` decides what `querySelector('meta[name="zerotal-devtools"]')` finds and
 * `hostname` what `location` reports — between them, the whole input to the gate.
 */
function installDom(marker: boolean, hostname = "zerotal.dev"): void {
  const body = {
    appendChild() {},
    querySelector: () => null,
    addEventListener() {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
  };
  const nodes = new Map<string, unknown>();

  (globalThis as Record<string, unknown>)["document"] = {
    body,
    documentElement: { style: { setProperty() {} } },
    getElementById: (id: string) => nodes.get(id) ?? null,
    createElement: () => makeElement(nodes),
    addEventListener() {},
    querySelector: (sel: string) =>
      marker && sel.includes("zerotal-devtools") ? { name: "zerotal-devtools" } : null,
  };
  (globalThis as Record<string, unknown>)["window"] = { addEventListener() {} };
  (globalThis as Record<string, unknown>)["location"] = { hostname };

  // Recorded, not modelled: the transport opens one as soon as a mount is allowed,
  // so constructing it is the earliest observable sign that the gate said yes.
  (globalThis as Record<string, unknown>)["EventSource"] = class {
    constructor(url: string) {
      streams.push(String(url));
    }
    addEventListener() {}
    close() {}
  };
}

/** Answer the probe with `status`, recording that it was asked at all. */
function stubFetch(status: number): void {
  (globalThis as Record<string, unknown>)["fetch"] = (url: string) => {
    fetches.push(String(url));
    return Promise.resolve({ ok: status >= 200 && status < 300, status });
  };
}

/** Let the probe's promise chain settle, so a late fetch still counts. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  fetches = [];
  streams = [];
  stubFetch(404);
});

afterEach(() => {
  for (const key of ["document", "window", "location", "fetch"]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
});

describe("DevTools.start() — on a production page", () => {
  it("mounts nothing", async () => {
    // The provider never registered, so the middleware that writes the marker was
    // never in the stack.
    installDom(false, "zerotal.dev");

    DevTools.start();
    await settle();

    expect(document.getElementById(PANEL_ID)).toBeNull();
    expect(streams).toHaveLength(0);
  });

  it("makes no request at all", async () => {
    // The reason the marker exists. A production page must not so much as name a
    // devtools URL — a 404 in the console reads as leaked tooling to anyone
    // auditing the site, and the reading is reasonable.
    installDom(false, "zerotal.dev");

    DevTools.start();
    await settle();

    expect(fetches).toEqual([]);
  });

  it("still mounts when the page is marked", async () => {
    // A gated staging host, where devtools is deliberately on. The marker is the
    // server saying so, and a real domain is exactly where the probe will not run.
    installDom(true, "staging.example.com");

    // Asserted on the transport, which `mount()` opens before it builds any
    // markup: the decision to mount is what is under test here, and the panel's
    // markup is the browser suite's job.
    DevTools.start();
    await settle();

    expect(streams).toHaveLength(1);
    expect(fetches).toEqual([]);
  });
});

describe("DevTools.start() — on a development host", () => {
  it("asks, because a raw-route app is never marked", async () => {
    // `Router.raw` bypasses the middleware pipeline by design, so the marker never
    // reaches those pages. The documentation site is one of them.
    installDom(false, "localhost");

    DevTools.start();
    await settle();

    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toContain("/__zerotal/devtools/api/channels");
  });

  it("mounts nothing when the routes answer 404", async () => {
    installDom(false, "localhost");
    stubFetch(404);

    DevTools.start();
    await settle();

    expect(document.getElementById(PANEL_ID)).toBeNull();
    expect(streams).toHaveLength(0);
  });

  it("mounts when the routes answer", async () => {
    installDom(false, "127.0.0.1");
    stubFetch(200);

    DevTools.start();
    await settle();

    expect(streams).toHaveLength(1);
  });

  it("mounts nothing when the probe fails outright", async () => {
    // Offline, blocked by CSP, or a proxy answering with something else. Absent is
    // the safe reading: a missed panel costs a keystroke, a stray one is a debug
    // surface on someone's production page.
    installDom(false, "localhost");
    (globalThis as Record<string, unknown>)["fetch"] = () => Promise.reject(new Error("blocked"));

    DevTools.start();
    await settle();

    expect(document.getElementById(PANEL_ID)).toBeNull();
  });

  it("does not ask when the page is already marked", async () => {
    installDom(true, "localhost");

    DevTools.start();
    await settle();

    expect(fetches).toEqual([]);
  });

  it("honours a custom endpoint", async () => {
    installDom(false, "localhost");

    DevTools.start({ endpoint: "/_dt/" });
    await settle();

    // Trailing slash trimmed, so the probe is not `/_dt//api/channels`.
    expect(fetches[0]).toBe("/_dt/api/channels");
  });

  it("treats a private network address as development", async () => {
    // A phone on the same wifi, pointed at a laptop's dev server.
    installDom(false, "192.168.1.14");

    DevTools.start();
    await settle();

    expect(fetches).toHaveLength(1);
  });

  it("does not treat a lookalike public address as development", async () => {
    // `172.15.x` sits just outside 172.16.0.0/12, and `110.x` merely starts with
    // the digits of a private range.
    for (const hostname of ["172.15.0.1", "110.0.0.1"]) {
      fetches = [];
      installDom(false, hostname);

      DevTools.start();
      await settle();

      expect(fetches).toEqual([]);
    }
  });
});

describe("DevTools.start() — regardless of host", () => {
  it("does nothing when a panel is already on the page", async () => {
    installDom(true, "localhost");
    (globalThis as Record<string, unknown>)["document"] = {
      ...document,
      getElementById: (id: string) => (id === PANEL_ID ? {} : null),
    };

    DevTools.start();
    await settle();

    expect(streams).toHaveLength(0);
    expect(fetches).toEqual([]);
  });

  it("does nothing at all without a document", () => {
    // Imported into a server bundle — `start()` has to be inert rather than throw.
    expect(() => DevTools.start()).not.toThrow();
    expect(streams).toHaveLength(0);
  });
});
