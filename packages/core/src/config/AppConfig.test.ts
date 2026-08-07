import { describe, it, expect } from "bun:test";
import { AppConfig } from "./AppConfig.ts";

describe("AppConfig conventions", () => {
  it("fills the full default convention paths and enables discovery", () => {
    const c = AppConfig({ name: "Example" });
    expect(c.conventions.enabled).toBe(true);
    expect(c.conventions.paths).toEqual({
      providers: "app/providers",
      middleware: "app/middleware",
      models: "app/models",
      observers: "app/observers",
      policies: "app/policies",
      listeners: "app/listeners",
      events: "app/events",
      jobs: "app/jobs",
      schedules: "app/schedules",
      validators: "app/validators",
    });
  });

  it("merges path overrides and respects enabled:false", () => {
    const c = AppConfig({ conventions: { enabled: false, paths: { models: "src/models" } } });
    expect(c.conventions.enabled).toBe(false);
    expect(c.conventions.paths.models).toBe("src/models");
    expect(c.conventions.paths.observers).toBe("app/observers"); // default kept
  });
});

describe("AppConfig middleware defaults", () => {
  it("provides cors/throttle/secureHeaders defaults", () => {
    const c = AppConfig({ name: "Example" });
    // Same-origin by default: the framework cannot know which origins an app means to
    // share with, and "*" is the wrong guess.
    expect(c.cors).toEqual({ origin: [], credentials: false });
    expect(c.throttle).toEqual({ maxAttempts: 120, windowSeconds: 60 });
    expect(c.secureHeaders).toEqual({ frameOptions: "SAMEORIGIN" });
  });

  it("caps the request body well below Bun's 128 MiB default", () => {
    // Bodies are fully buffered, so this is the memory ceiling for one request.
    expect(AppConfig({}).maxRequestBodySize).toBe(8 * 1024 * 1024);
    expect(AppConfig({ maxRequestBodySize: 64 * 1024 }).maxRequestBodySize).toBe(64 * 1024);
  });

  it("deep-merges a partial override, keeping sibling defaults", () => {
    const c = AppConfig({ cors: { credentials: true } });
    expect(c.cors).toEqual({ origin: [], credentials: true }); // origin default kept
  });
});

describe("AppConfig health", () => {
  it("defaults to false", () => {
    expect(AppConfig({}).health).toBe(false);
  });

  it("accepts the boolean shorthand", () => {
    expect(AppConfig({ health: true }).health).toBe(true);
  });

  it("accepts the full config object under app.health", () => {
    const c = AppConfig({
      health: { enabled: true, path: "/healthz", secret: "k", showDetails: false },
    });
    expect(c.health).toEqual({
      enabled: true,
      path: "/healthz",
      secret: "k",
      showDetails: false,
    });
  });
});
