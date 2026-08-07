import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Application } from "../../application/Application.ts";
import { App } from "./App.ts";
import { inject } from "../../container/inject.ts";
import { ContainerLockedError } from "../../errors/ContainerErrors.ts";

class Clock {
  now = "tick";
}

@inject(Clock)
class Greeter {
  constructor(public clock: Clock) {}
}

describe("App facade", () => {
  beforeEach(() => {
    Application._resetInstance();
  });
  afterEach(() => {
    Application._resetInstance();
  });

  describe("resolution", () => {
    it("make() auto-wires a class through its @inject tokens", async () => {
      const app = Application.create({ env: "test" });
      app.bind((c) => c.singleton(Clock, () => new Clock()));
      await app.boot();

      const greeter = await App.make(Greeter);
      expect(greeter).toBeInstanceOf(Greeter);
      expect(greeter.clock).toBeInstanceOf(Clock);
    });

    it("build() returns a fresh instance each call", async () => {
      const app = Application.create({ env: "test" });
      app.bind((c) => c.singleton(Clock, () => new Clock()));
      await app.boot();

      const a = await App.build(Greeter);
      const b = await App.build(Greeter);
      expect(a).not.toBe(b);
    });

    it("bound() reflects registration", async () => {
      const app = Application.create({ env: "test" });
      app.bind((c) => c.value("clock", new Clock()));
      await app.boot();

      expect(App.bound("clock")).toBe(true);
      expect(App.bound("nope")).toBe(false);
    });
  });

  describe("environment helpers", () => {
    it("environment() returns the runtime env", async () => {
      const app = Application.create({ env: "test" });
      await app.boot();
      expect(App.environment()).toBe("test");
    });

    it("isProduction()/isLocal() read app.env config", async () => {
      const app = Application.create({ env: "test" });
      await app.boot();

      App.container.makeSync("config").set("app.env", "production");
      expect(App.isProduction()).toBe(true);
      expect(App.isLocal()).toBe(false);

      App.container.makeSync("config").set("app.env", "local");
      expect(App.isLocal()).toBe(true);
      expect(App.isProduction()).toBe(false);
    });
  });

  describe("registration lock", () => {
    it("allows registration before boot completes (via bind callback)", async () => {
      const app = Application.create({ env: "test" });
      app.bind((c) => c.singleton(Clock, () => new Clock()));
      await app.boot();
      expect(App.bound(Clock)).toBe(true);
    });

    it("throws ContainerLockedError when registering after boot", async () => {
      const app = Application.create({ env: "test" });
      await app.boot();

      expect(() => App.singleton(Clock, () => new Clock())).toThrow(ContainerLockedError);
      expect(() => App.bind(Clock, () => new Clock())).toThrow(ContainerLockedError);
      expect(() => App.value("x", 1)).toThrow(ContainerLockedError);
      expect(() => App.alias("a", "b")).toThrow(ContainerLockedError);
      expect(() => App.forget("x")).toThrow(ContainerLockedError);
    });

    it("the underlying container stays mutable for framework internals", async () => {
      const app = Application.create({ env: "test" });
      await app.boot();
      // Raw container access is intentionally NOT locked (deferred providers, tests).
      expect(() => App.container.singleton(Clock, () => new Clock())).not.toThrow();
    });
  });
});
