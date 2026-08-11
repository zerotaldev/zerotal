import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Application } from "../application/Application.ts";
import { Config } from "./facades/Config.ts";
import { Events } from "./facades/Events.ts";
import { Artisan } from "./facades/Artisan.ts";
import {
  FacadeAccessedBeforeBootError,
  FacadeBindingMissingError,
} from "../errors/ContainerErrors.ts";
import { createFacade } from "./Facade.ts";
// NOTE: the Auth facade lives in `@zerotal/auth` and is tested there
// (packages/auth) — it is not a core facade, so it is not tested here.

class TestEvent {}
let hit = false;
class TestListener {
  handle(_e: TestEvent) {
    hit = true;
  }
}

describe("Facades", () => {
  describe("Container Facades (Config & Events)", () => {
    it("throws FacadeAccessedBeforeBootError if Application is not created", () => {
      Application._resetInstance();
      expect(() => Config.get("test")).toThrow(FacadeAccessedBeforeBootError);
    });

    it("FacadeAccessedBeforeBootError names the facade key and gives actionable guidance", () => {
      Application._resetInstance();
      let caught: unknown;
      try {
        Config.get("test");
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(FacadeAccessedBeforeBootError);
      const err = caught as FacadeAccessedBeforeBootError;
      expect(err.message).toContain('"config"');
      expect(err.message).toContain("Application.boot()");
      expect(err.code).toBe("E_FACADE_BEFORE_BOOT");
      expect(err.context).toEqual({ facade: "config" });
    });

    it("throws FacadeBindingMissingError when the binding has no provider (after boot)", async () => {
      Application._resetInstance();
      const app = Application.create({ env: "test" });
      await app.boot();

      // A facade for a binding nothing registers — the app IS booted, so this is a
      // missing-provider problem, not a module-scope/before-boot one.
      const Missing = createFacade("not_registered" as never) as { anything(): void };
      let caught: unknown;
      try {
        Missing.anything();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(FacadeBindingMissingError);
      expect((caught as FacadeBindingMissingError).message).toContain('"not_registered"');
      expect((caught as FacadeBindingMissingError).code).toBe("E_FACADE_BINDING_MISSING");
    });

    it("resolves underlying methods after boot", async () => {
      Application._resetInstance();
      const app = Application.create({ env: "test" });
      await app.boot();

      Config.set("app.name", "Zerotal");
      expect(Config.get("app.name")).toBe("Zerotal");

      hit = false;
      Events.on(TestEvent, TestListener);
      await Events.emit(new TestEvent());
      expect(hit).toBe(true);
    });

    it("preserves `this` context for methods", async () => {
      Application._resetInstance();
      const app = Application.create({ env: "test" });
      await app.boot();

      const setFn = Config.set;
      setFn("detached.call", true);
      expect(Config.get("detached.call")).toBe(true);
    });
  });
});

// ── Artisan Facade ────────────────────────────────────────────────────────────

describe("Artisan Facade", () => {
  beforeEach(() => {
    Application._resetInstance();
  });

  afterEach(() => {
    Application._resetInstance();
  });

  it("throws when no CommandRunner is registered in container", async () => {
    const app = Application.create({ env: "test" });
    await app.boot();
    await expect(Artisan.call("cache:clear")).rejects.toThrow("Artisan.call('cache:clear')");
  });

  it("calls CommandRunner.callInProcess with correct argv", async () => {
    const app = Application.create({ env: "test" });
    await app.boot();

    const calls: string[][] = [];
    const fakeRunner = {
      callInProcess: async (argv: string[]) => {
        calls.push(argv);
        return { code: 0, output: "done" };
      },
    };
    app.container.value("commands" as never, fakeRunner as never);

    const result = await Artisan.call("cache:clear");
    expect(result.code).toBe(0);
    expect(calls[0]).toEqual(["cache:clear"]);
  });

  it("passes boolean flags as flag keys (truthy → include, falsy → exclude)", async () => {
    const app = Application.create({ env: "test" });
    await app.boot();

    const calls: string[][] = [];
    const fakeRunner = {
      callInProcess: async (argv: string[]) => {
        calls.push(argv);
        return { code: 0, output: "" };
      },
    };
    app.container.value("commands" as never, fakeRunner as never);

    await Artisan.call("migrate", { "--fresh": true, "--seed": false });
    expect(calls[0]).toContain("--fresh");
    expect(calls[0]).not.toContain("--seed");
  });

  it("passes string/number parameters as key=value pairs", async () => {
    const app = Application.create({ env: "test" });
    await app.boot();

    const calls: string[][] = [];
    const fakeRunner = {
      callInProcess: async (argv: string[]) => {
        calls.push(argv);
        return { code: 0, output: "" };
      },
    };
    app.container.value("commands" as never, fakeRunner as never);

    await Artisan.call("make:controller", { name: "UserController", "--resource": 1 });
    expect(calls[0]).toContain("name=UserController");
    expect(calls[0]).toContain("--resource=1");
  });
});

// ── Runtime probes ────────────────────────────────────────────────────────────

describe("createFacade — runtime probes", () => {
  it("is not thenable, so it can be returned from an async function", async () => {
    // Returning a facade from `async` makes the runtime read `.then` to decide
    // whether to await it. Answering that with a container lookup meant an
    // unregistered binding threw from inside promise resolution — with a stack
    // pointing at the proxy instead of at the caller.
    Application._resetInstance();
    const app = Application.create({ env: "test" });
    await app.boot();
    const facade = createFacade("nothing-provides-this" as never);

    const returned = await (async () => facade)();

    expect(returned).toBe(facade);
  });

  it("survives string coercion and inspection without resolving", () => {
    Application._resetInstance();
    const facade = createFacade("nothing-provides-this" as never) as unknown as Record<
      string | symbol,
      unknown
    >;

    expect(facade["then"]).toBeUndefined();
    expect(facade[Symbol.toPrimitive]).toBeUndefined();
    expect(facade[Symbol.toStringTag]).toBeUndefined();
  });

  it("still reports a missing binding for a real property", async () => {
    Application._resetInstance();
    const app = Application.create({ env: "test" });
    await app.boot();
    const facade = createFacade("nothing-provides-this" as never) as unknown as {
      doSomething: unknown;
    };

    expect(() => facade.doSomething).toThrow("nothing-provides-this");
  });
});
