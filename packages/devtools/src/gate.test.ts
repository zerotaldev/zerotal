/**
 * The access gate: who may reach the inspector, and what happens by default.
 *
 * The default is the whole point — a deployed process with no configuration
 * exposes nothing, and an app that turns the inspector on outside development
 * without saying who may read it is refused rather than opened.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { HttpContext, RequestContext, config } from "@zerotal/core";
import { devtoolsAuthorized, devtoolsEnabled } from "./enabled.ts";
import { DevtoolsInjectionMiddleware } from "./DevtoolsInjectionMiddleware.ts";
import { TraceStore, _setTraceStore } from "./TraceStore.ts";
import type { DevtoolsConfigShape } from "./config.ts";

const priorEnv = Bun.env["APP_ENV"];

/** Put a `devtools` block in front of the config facade for one test. */
function withConfig(devtools: Partial<DevtoolsConfigShape>): void {
  const original = config.safe.bind(config);
  const patched = ((path: string, fallback: unknown) =>
    path === "devtools"
      ? devtools
      : original(path as never, fallback as never)) as typeof config.safe;
  (config as unknown as Record<string, unknown>)["safe"] = patched;
  restores.push(() => {
    (config as unknown as Record<string, unknown>)["safe"] = original;
  });
}

const restores: Array<() => void> = [];

function setEnv(value: string | undefined): void {
  if (value === undefined) delete Bun.env["APP_ENV"];
  else Bun.env["APP_ENV"] = value;
}

afterEach(() => {
  while (restores.length) restores.pop()!();
  setEnv(priorEnv);
});

const request = (headers: Record<string, string> = {}): Request =>
  new Request("http://localhost/__zerotal/devtools/api/traces", { headers });

describe("devtoolsEnabled", () => {
  it("follows the dev-surface gate when nothing is configured", () => {
    setEnv("development");
    expect(devtoolsEnabled()).toBe(true);
    setEnv("production");
    expect(devtoolsEnabled()).toBe(false);
  });

  it("lets an explicit setting win in either direction", () => {
    setEnv("production");
    withConfig({ enabled: true });
    expect(devtoolsEnabled()).toBe(true);
  });

  it("can be switched off on a development machine", () => {
    setEnv("development");
    withConfig({ enabled: false });
    expect(devtoolsEnabled()).toBe(false);
  });
});

describe("devtoolsAuthorized", () => {
  it("always allows a development process, gate or no gate", async () => {
    // A gate that can lock a developer out of their own laptop is a gate that
    // gets switched off, and then nothing is gated.
    setEnv("development");
    withConfig({ gate: () => false });
    expect(await devtoolsAuthorized(request())).toBe(true);
  });

  it("refuses another device on the network in development, unless the gate allows it", async () => {
    // The dev server listens on every interface, and the traces hold reset links.
    setEnv("development");
    const lan = new Request("http://192.168.0.131:3000/__zerotal/devtools/api/traces");
    expect(await devtoolsAuthorized(lan, "192.168.0.20")).toBe(false);
    expect(await devtoolsAuthorized(request(), "192.168.0.20")).toBe(false);

    withConfig({ gate: (r) => r.headers.get("X-Debug-Key") === "phone" });
    const phone = new Request(lan.url, { headers: { "X-Debug-Key": "phone" } });
    expect(await devtoolsAuthorized(phone, "192.168.0.20")).toBe(true);
  });

  it("refuses a local connection that names another site in development", async () => {
    // A page that points its own domain at 127.0.0.1 makes the developer's browser
    // connect locally, but still sends its domain as Host.
    setEnv("development");
    const rebound = new Request("http://localhost:3000/__zerotal/devtools/api/traces", {
      headers: { host: "evil.example:3000" },
    });
    expect(await devtoolsAuthorized(rebound, "127.0.0.1")).toBe(false);
  });

  it("refuses when the inspector is on outside development with no gate", async () => {
    // The absence of a decision is not permission.
    setEnv("production");
    withConfig({ enabled: true });
    expect(await devtoolsAuthorized(request())).toBe(false);
  });

  it("asks the gate outside development", async () => {
    setEnv("production");
    withConfig({
      enabled: true,
      gate: (r) => r.headers.get("X-Debug-Key") === "let-me-in",
    });
    expect(await devtoolsAuthorized(request({ "X-Debug-Key": "let-me-in" }))).toBe(true);
    expect(await devtoolsAuthorized(request({ "X-Debug-Key": "nope" }))).toBe(false);
  });

  it("awaits an async gate", async () => {
    setEnv("production");
    withConfig({ enabled: true, gate: async () => true });
    expect(await devtoolsAuthorized(request())).toBe(true);
  });

  it("treats a throwing gate as a refusal", async () => {
    // Failing open here would turn a typo in someone's authorization check into
    // an open trace inspector.
    setEnv("production");
    withConfig({
      enabled: true,
      gate: () => {
        throw new Error("lookup failed");
      },
    });
    expect(await devtoolsAuthorized(request())).toBe(false);
  });
});

describe("the endpoints behind the gate", () => {
  async function hit(url: string, init: RequestInit = {}): Promise<Response | undefined> {
    _setTraceStore(new TraceStore({ dbPath: null }));
    const ctx = HttpContext.fake(url, init);
    const mw = new DevtoolsInjectionMiddleware();
    let out: Response | undefined;
    await RequestContext.run(ctx, async () => {
      const result = await mw.handle(ctx, async () => undefined);
      if (result instanceof Response) out = result;
    });
    _setTraceStore(null);
    return out;
  }

  const ENDPOINTS = [
    "http://localhost/__zerotal/devtools",
    "http://localhost/__zerotal/devtools/sse",
    "http://localhost/__zerotal/devtools/api/traces",
    "http://localhost/__zerotal/devtools/api/channels",
    // The routes and the resolved config.
    "http://localhost/__zerotal/devtools/api/map",
    "http://localhost/__zerotal/devtools/client.js",
    "http://localhost/__zerotal/devtools/dashboard.js",
    // The hashed bundles too: under the same prefix, so behind the same gate.
    "http://localhost/__zerotal/devtools/assets/client.0123456789abcdef.js",
  ];

  it("refuses every one of them when unauthorized", async () => {
    // One gate for all of them: the stream, the trace JSON, the dashboard, and
    // the bundle expose the same request data, and checking per endpoint is how
    // one of them ends up ungated.
    setEnv("production");
    withConfig({ enabled: true });
    for (const url of ENDPOINTS) {
      const res = await hit(url);
      expect(res?.status).toBe(404);
    }
  });

  it("answers 404 rather than 403 — there is nothing here to find", async () => {
    setEnv("production");
    withConfig({ enabled: true });
    expect((await hit(ENDPOINTS[2]!))?.status).toBe(404);
  });

  it("serves them on a development machine", async () => {
    setEnv("development");
    const res = await hit("http://localhost/__zerotal/devtools/api/traces");
    expect(res?.status).toBe(200);
  });

  it("refuses them to a request naming another host in development", async () => {
    setEnv("development");
    for (const url of ENDPOINTS.map((u) => u.replace("localhost", "192.168.0.131"))) {
      expect((await hit(url))?.status).toBe(404);
    }
  });

  it("refuses the clear action from a page on another site", async () => {
    // The developer's own browser, sent there by another site: it passes the
    // local check, and only the Origin header tells it apart.
    setEnv("development");
    const clear = "http://localhost/__zerotal/devtools/api/clear";
    const foreign = await hit(clear, {
      method: "POST",
      headers: { origin: "http://evil.example" },
    });
    expect(foreign?.status).toBe(403);

    const own = await hit(clear, { method: "POST", headers: { origin: "http://localhost" } });
    expect(own?.status).toBe(204);
  });

  it("leaves application routes alone", async () => {
    // The gate covers the devtools prefix and nothing else.
    setEnv("production");
    withConfig({ enabled: true });
    expect(await hit("http://localhost/posts")).toBeUndefined();
  });
});

describe("the page marker", () => {
  /** Run a normal (non-devtools) request through the middleware. */
  async function pass(next: () => Promise<Response | undefined>): Promise<Response | undefined> {
    _setTraceStore(new TraceStore({ dbPath: null }));
    const ctx = HttpContext.fake("http://localhost/");
    const mw = new DevtoolsInjectionMiddleware();
    let out: Response | undefined;
    await RequestContext.run(ctx, async () => {
      const result = await mw.handle(ctx, next);
      if (result instanceof Response) out = result;
    });
    _setTraceStore(null);
    return out;
  }

  const html = (body = "<html><head><title>x</title></head><body>hi</body></html>") =>
    new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

  it("writes the marker into an HTML page when the inspector is reachable", async () => {
    setEnv("development");
    const res = await pass(async () => html());

    expect(await res!.text()).toContain(
      '<meta name="zerotal-devtools" content="/__zerotal/devtools">',
    );
  });

  it("puts it inside the head, before the closing tag", async () => {
    setEnv("development");
    const res = await pass(async () => html());
    const text = await res!.text();

    // The client reads it via `querySelector` on a parsed document, so anywhere in
    // the head is correct — but before `</head>` means it is there even if the page
    // runs a script in the head that looks.
    expect(text.indexOf("zerotal-devtools")).toBeLessThan(text.indexOf("</head>"));
  });

  it("drops the page's Content-Length once the marker makes it longer", async () => {
    setEnv("development");
    const page = "<html><head><title>x</title></head><body>hi</body></html>";
    const res = await pass(
      async () =>
        new Response(page, {
          headers: { "content-type": "text/html", "content-length": String(page.length) },
        }),
    );

    expect(res!.headers.has("content-length")).toBe(false);
    expect((await res!.text()).length).toBeGreaterThan(page.length);
  });

  it("writes nothing on a page the viewer could not use it on", async () => {
    // Production, unauthorized. This is the case that put a devtools request in
    // every visitor's console: the marker is what the client now looks for, so its
    // absence is what keeps a live site quiet.
    setEnv("production");
    const res = await pass(async () => html());

    expect(await res!.text()).not.toContain("zerotal-devtools");
  });

  it("leaves a non-HTML response alone", async () => {
    // A JSON body is not a document, and rewriting one would corrupt it.
    setEnv("development");
    const res = await pass(async () => Response.json({ ok: true }));

    expect(await res!.json()).toEqual({ ok: true });
  });

  it("leaves an HTML fragment with no head alone", async () => {
    // Flow patches and partials come back as HTML without a document around them.
    setEnv("development");
    const res = await pass(async () => html("<div>a fragment</div>"));

    expect(await res!.text()).toBe("<div>a fragment</div>");
  });

  it("keeps the original status and headers", async () => {
    setEnv("development");
    const res = await pass(
      async () =>
        new Response("<html><head></head><body>gone</body></html>", {
          status: 404,
          headers: { "content-type": "text/html", "x-from": "app" },
        }),
    );

    expect(res!.status).toBe(404);
    expect(res!.headers.get("x-from")).toBe("app");
  });

  it("passes a handler that returned nothing straight through", async () => {
    // Routing continues past the middleware stack; there is no response to mark yet.
    setEnv("development");
    expect(await pass(async () => undefined)).toBeUndefined();
  });
});
