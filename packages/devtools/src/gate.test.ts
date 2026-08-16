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
  async function hit(url: string): Promise<Response | undefined> {
    _setTraceStore(new TraceStore({ dbPath: null }));
    const ctx = HttpContext.fake(url);
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
    "http://localhost/__zerotal/devtools/client.js",
    "http://localhost/__zerotal/devtools/dashboard.js",
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

  it("leaves application routes alone", async () => {
    // The gate covers the devtools prefix and nothing else.
    setEnv("production");
    withConfig({ enabled: true });
    expect(await hit("http://localhost/posts")).toBeUndefined();
  });
});
