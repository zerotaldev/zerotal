/**
 * The provider's environment gate is the only thing standing between a deployed
 * app and an unauthenticated trace inspector, so it is tested from both sides.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { Application } from "@zerotal/core";
import { DevtoolsProvider } from "./provider/DevtoolsProvider.ts";
import { DevtoolsConfig } from "./config.ts";
import { traceChannels, _resetChannels } from "./tracing.ts";
import { _setTraceStore } from "./TraceStore.ts";

const ORIGINAL_ENV = Bun.env["APP_ENV"];

/** Boot an app with the devtools provider under a given APP_ENV. */
async function bootUnder(env: string, config?: Record<string, unknown>): Promise<Application> {
  Bun.env["APP_ENV"] = env;
  Application._resetInstance();
  const app = Application.create({ env: "web" }).register([DevtoolsProvider as never]);
  if (config) app.useConfig({ devtools: config } as never);
  await app.boot();
  return app;
}

afterEach(async () => {
  if (ORIGINAL_ENV === undefined) delete Bun.env["APP_ENV"];
  else Bun.env["APP_ENV"] = ORIGINAL_ENV;
  Application._resetInstance();
  _resetChannels();
  _setTraceStore(null);
});

describe("DevtoolsProvider — environment gate", () => {
  it("binds the trace sink in development", async () => {
    const app = await bootUnder("development");
    expect(app.container.tryMake("devtools.trace" as never)).toBeDefined();
  });

  it.each(["production", "prod", "staging", ""])(
    "stays inert under APP_ENV=%p",
    async (env: string) => {
      // Fail closed: an unset or unrecognised environment must not expose the
      // inspector, because the inspector needs no credentials.
      const app = await bootUnder(env);
      expect(app.container.tryMake("devtools.trace" as never)).toBeUndefined();
    },
  );

  it("does not create a database when it stays inert", async () => {
    const { existsSync } = await import("node:fs");
    const before = existsSync(".zerotal/devtools.sqlite");

    await bootUnder("production");

    expect(existsSync(".zerotal/devtools.sqlite")).toBe(before);
  });
});

describe("DevtoolsProvider — teardown", () => {
  it("drops declared channels and the store when the app stops", async () => {
    const app = await bootUnder("development");
    const sink = app.container.tryMake("devtools.trace" as never) as {
      channel(d: { id: string; label: string }): void;
    };
    sink.channel({ id: "temp", label: "Temp" });
    // By id, not by count: devtools declares its own `http` channel on boot, and
    // a test that asserts a total is a test that breaks every time the framework
    // grows a tab.
    expect(traceChannels().map((c) => c.id)).toContain("temp");

    await app.stop({ exit: false });

    // A channel declared by one app must not appear in the next one's panel.
    expect(traceChannels()).toHaveLength(0);
  });

  it("is safe to stop an app that never activated", async () => {
    const app = await bootUnder("production");
    await expect(app.stop({ exit: false })).resolves.toBeUndefined();
  });
});

describe("DevtoolsConfig", () => {
  it("redacts by default", () => {
    expect(DevtoolsConfig().redact.enabled).toBe(true);
  });

  it("keeps defaults for anything not overridden", () => {
    const config = DevtoolsConfig({ capacity: 250 });

    expect(config.capacity).toBe(250);
    expect(config.pruneHours).toBe(24);
    expect(config.redact.enabled).toBe(true);
  });

  it("accepts a null dbPath for memory-only traces", () => {
    expect(DevtoolsConfig({ dbPath: null }).dbPath).toBeNull();
  });

  it("merges an allow list into the redaction defaults", () => {
    const config = DevtoolsConfig({ redact: { allow: ["email"] } });

    expect(config.redact.allow).toEqual(["email"]);
    expect(config.redact.enabled).toBe(true);
  });
});
