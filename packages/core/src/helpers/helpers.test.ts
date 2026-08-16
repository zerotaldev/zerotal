import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { tap, tapAsync, pipe, pipeAsync, rescue, rescueSync, data_get, basePath } from "./index.ts";
import { fluent } from "./fluent.ts";
import { config } from "./config.ts";
import { Application } from "../application/Application.ts";
import { ConfigManager } from "../config/ConfigManager.ts";

describe("tap()", () => {
  it("returns the original value", () => {
    const result = tap(42, () => {});
    expect(result).toBe(42);
  });
  it("calls the callback with the value", () => {
    const seen: number[] = [];
    tap(7, (v) => seen.push(v));
    expect(seen).toEqual([7]);
  });
  it("works with objects — mutations inside callback are visible", () => {
    const user = { name: "Alice", notified: false };
    tap(user, (u) => {
      u.notified = true;
    });
    expect(user.notified).toBe(true);
  });
  it("return value is the same reference for objects", () => {
    const obj = { x: 1 };
    expect(tap(obj, () => {})).toBe(obj);
  });
});

describe("rescue()", () => {
  it("returns the callback result on success", async () => {
    const result = await rescue(async () => "ok", "fallback");
    expect(result).toBe("ok");
  });
  it("returns fallback value when callback throws", async () => {
    const result = await rescue(async () => {
      throw new Error("boom");
    }, 0);
    expect(result).toBe(0);
  });
  it("calls fallback function with the error when it throws", async () => {
    let caught: unknown;
    const result = await rescue(
      async () => {
        throw new Error("oops");
      },
      (e) => {
        caught = e;
        return -1;
      },
    );
    expect(result).toBe(-1);
    expect((caught as Error).message).toBe("oops");
  });
  it("works with a sync callback", async () => {
    const result = await rescue(() => 123, 0);
    expect(result).toBe(123);
  });
  it("fallback function may itself be async", async () => {
    const result = await rescue(
      async () => {
        throw new Error();
      },
      async () => "async-fallback",
    );
    expect(result).toBe("async-fallback");
  });
});

describe("rescueSync()", () => {
  it("returns the callback value on success", () => {
    expect(rescueSync(() => JSON.parse("[1,2]") as number[], [])).toEqual([1, 2]);
  });
  it("returns a static fallback on throw", () => {
    expect(rescueSync(() => JSON.parse("not json"), null)).toBeNull();
  });
  it("fallback may be a function receiving the error", () => {
    const result = rescueSync(
      () => {
        throw new Error("boom");
      },
      (e) => (e as Error).message,
    );
    expect(result).toBe("boom");
  });
});

describe("data_get()", () => {
  it("reads a top-level key", () => {
    expect(data_get({ name: "Alice" }, "name")).toBe("Alice");
  });
  it("reads a nested key using dot notation", () => {
    const obj = { user: { address: { city: "Cape Town" } } };
    expect(data_get(obj, "user.address.city")).toBe("Cape Town");
  });
  it("returns undefined when a segment is missing", () => {
    expect(data_get({ a: {} }, "a.b.c")).toBeUndefined();
  });
  it("returns defaultValue when key is missing", () => {
    expect(data_get({}, "price", 0)).toBe(0);
  });
  it("returns defaultValue when target is null", () => {
    expect(data_get(null, "anything", "default")).toBe("default");
  });
  it("returns defaultValue when target is undefined", () => {
    expect(data_get(undefined, "key", 42)).toBe(42);
  });
  it("accesses array indices via dot notation", () => {
    const payload = { items: [{ price: 9.99 }, { price: 4.99 }] };
    expect(data_get(payload, "items.0.price")).toBe(9.99);
    expect(data_get(payload, "items.1.price")).toBe(4.99);
  });
  it("returns null (not defaultValue) when value is explicitly null", () => {
    expect(data_get({ a: null }, "a", "default")).toBeNull();
  });
});

describe("tapAsync()", () => {
  it("returns the original value after awaiting the callback", async () => {
    const result = await tapAsync(42, async () => {});
    expect(result).toBe(42);
  });
  it("awaits the callback before returning", async () => {
    const log: string[] = [];
    const user = { id: 1 };
    await tapAsync(user, async (u) => {
      log.push(`notified:${u.id}`);
    });
    expect(log).toEqual(["notified:1"]);
  });
  it("returns the same object reference", async () => {
    const obj = { x: 1 };
    expect(await tapAsync(obj, async () => {})).toBe(obj);
  });
});

describe("pipe()", () => {
  it("returns the result of the callback", () => {
    expect(pipe(5, (n) => n * 2)).toBe(10);
  });
  it("passes the value to the callback", () => {
    expect(pipe("hello", (s) => s.toUpperCase())).toBe("HELLO");
  });
  it("preserves type transformation", () => {
    const result: number = pipe("42", (s) => parseInt(s, 10));
    expect(result).toBe(42);
  });
});

describe("pipeAsync()", () => {
  it("returns the async result of the callback", async () => {
    const result = await pipeAsync("hello", async (s) => s.toUpperCase());
    expect(result).toBe("HELLO");
  });
  it("resolves the promise before returning", async () => {
    const result = await pipeAsync(10, async (n) => n * 3);
    expect(result).toBe(30);
  });
});

describe("fluent()", () => {
  it("wraps and unwraps a value", () => {
    expect(fluent(42).get()).toBe(42);
  });
  it("pipe transforms the value", () => {
    expect(
      fluent("hello")
        .pipe((s) => s.toUpperCase())
        .get(),
    ).toBe("HELLO");
  });
  it("tap runs a side-effect and returns the same Fluent", () => {
    const seen: number[] = [];
    const result = fluent(7)
      .tap((n) => seen.push(n))
      .get();
    expect(result).toBe(7);
    expect(seen).toEqual([7]);
  });
  it("chains pipe and tap together", () => {
    const log: string[] = [];
    const result = fluent("  Hello World  ")
      .pipe((s) => s.trim())
      .tap((s) => log.push(s))
      .pipe((s) => s.toLowerCase())
      .get();
    expect(result).toBe("hello world");
    expect(log).toEqual(["Hello World"]);
  });
  it("pipe changes the type across steps", () => {
    const n = fluent("42")
      .pipe((s) => parseInt(s, 10))
      .get();
    expect(n).toBe(42);
  });
  it("toString() coerces the wrapped value", () => {
    expect(String(fluent(123))).toBe("123");
  });
  it("each pipe returns a new Fluent — original is unchanged", () => {
    const a = fluent(10);
    const b = a.pipe((n) => n + 5);
    expect(a.get()).toBe(10);
    expect(b.get()).toBe(15);
  });
});

// ── setAppEnv() ───────────────────────────────────────────────────────────────

import { setAppEnv, env, requireEnv } from "./index.ts";

describe("setAppEnv()", () => {
  /**
   * The contract changed in 1.7.1: `setAppEnv` writes the runtime mode to
   * `APP_TYPE` and never touches `APP_ENV`, which holds the deployment name.
   * They used to share one variable and the mode won, so `APP_ENV=production`
   * read back as `"console"` in every CLI command — and a guard written
   * `if (env("APP_ENV") === "production") refuse()` was inert exactly where
   * destructive commands live.
   */
  function isolated(fn: () => void) {
    const bag = Bun.env as Record<string, string | undefined>;
    const saved = { env: bag["APP_ENV"], type: bag["APP_TYPE"], preserved: bag["ZT_APP_ENV"] };
    delete bag["APP_ENV"];
    delete bag["APP_TYPE"];
    delete bag["ZT_APP_ENV"];
    try {
      fn();
    } finally {
      for (const [key, value] of [
        ["APP_ENV", saved.env],
        ["APP_TYPE", saved.type],
        ["ZT_APP_ENV", saved.preserved],
      ] as const) {
        if (value !== undefined) bag[key] = value;
        else delete bag[key];
      }
    }
  }

  const modeFor = (command: string | undefined): string | undefined => {
    setAppEnv(command);
    return Bun.env["APP_TYPE"];
  };

  it('sets APP_TYPE to "web" for the server commands', () => {
    for (const command of ["serve", "start", "s", "dev", "d"]) {
      isolated(() => expect(modeFor(command)).toBe("web"));
    }
  });

  it('sets APP_TYPE to "worker" for the worker commands', () => {
    for (const command of ["worker", "queue:work"]) {
      isolated(() => expect(modeFor(command)).toBe("worker"));
    }
  });

  it('sets APP_TYPE to "console" for anything else, including no command', () => {
    isolated(() => expect(modeFor("migrate")).toBe("console"));
    isolated(() => expect(modeFor(undefined)).toBe("console"));
  });

  it("never touches APP_ENV, whatever the command", () => {
    // The whole point. A deployment name survives every command.
    for (const command of ["serve", "worker", "migrate", "db:seed"]) {
      isolated(() => {
        (Bun.env as Record<string, string>)["APP_ENV"] = "production";
        setAppEnv(command);
        expect(Bun.env["APP_ENV"]).toBe("production");
      });
    }
  });

  it("reads the deployment name back through env() inside a console command", () => {
    // The reproduction from the seeder that found this: the documented variable,
    // read the documented way, after the framework has started.
    isolated(() => {
      (Bun.env as Record<string, string>)["APP_ENV"] = "development";
      setAppEnv("db:seed");
      expect(env("APP_ENV", "(unset)")).toBe("development");
      expect(Bun.env["APP_TYPE"]).toBe("console");
    });
  });

  it("lets an explicit APP_TYPE win over the command", () => {
    // How the dev orchestrator boots the server it supervises as `web`.
    isolated(() => {
      (Bun.env as Record<string, string>)["APP_TYPE"] = "web";
      setAppEnv("route:list");
      expect(Bun.env["APP_TYPE"]).toBe("web");
    });
  });

  it("mirrors a deployment name to the preserved copy, for anything still reading it", () => {
    isolated(() => {
      (Bun.env as Record<string, string>)["APP_ENV"] = "staging";
      setAppEnv("serve");
      expect(Bun.env["ZT_APP_ENV"]).toBe("staging");
    });
  });
});

// ── env() ────────────────────────────────────────────────────────────────────

describe("env()", () => {
  function withEnv(key: string, value: string, fn: () => void) {
    (Bun.env as Record<string, string>)[key] = value;
    try {
      fn();
    } finally {
      delete (Bun.env as Record<string, string | undefined>)[key];
    }
  }

  it("returns undefined when key is absent and no fallback", () => {
    delete (Bun.env as Record<string, string | undefined>)["__TEST_MISSING__"];
    expect(env("__TEST_MISSING__")).toBeUndefined();
  });

  it("returns the string value when key is present", () => {
    withEnv("__TEST_KEY__", "hello", () => {
      expect(env("__TEST_KEY__")).toBe("hello");
    });
  });

  it("returns string fallback when key is absent", () => {
    delete (Bun.env as Record<string, string | undefined>)["__TEST_MISSING__"];
    expect(env("__TEST_MISSING__", "default")).toBe("default");
  });

  it('coerces "true" to boolean true', () => {
    withEnv("__TEST_BOOL__", "true", () => {
      expect(env("__TEST_BOOL__", false)).toBe(true);
    });
  });

  it('coerces "1" to boolean true', () => {
    withEnv("__TEST_BOOL__", "1", () => {
      expect(env("__TEST_BOOL__", false)).toBe(true);
    });
  });

  it('coerces "false" to boolean false', () => {
    withEnv("__TEST_BOOL__", "false", () => {
      expect(env("__TEST_BOOL__", false)).toBe(false);
    });
  });

  it("returns boolean fallback when key is absent", () => {
    delete (Bun.env as Record<string, string | undefined>)["__TEST_MISSING__"];
    expect(env("__TEST_MISSING__", true)).toBe(true);
  });

  it('coerces "3000" to number 3000', () => {
    withEnv("__TEST_NUM__", "3000", () => {
      expect(env("__TEST_NUM__", 0)).toBe(3000);
    });
  });

  it("returns number fallback for NaN string", () => {
    withEnv("__TEST_NUM__", "not-a-number", () => {
      expect(env("__TEST_NUM__", 42)).toBe(42);
    });
  });

  it("returns number fallback when key is absent", () => {
    delete (Bun.env as Record<string, string | undefined>)["__TEST_MISSING__"];
    expect(env("__TEST_MISSING__", 100)).toBe(100);
  });
});

// ── requireEnv() ─────────────────────────────────────────────────────────────

describe("requireEnv()", () => {
  it("returns the value when key is set", () => {
    (Bun.env as Record<string, string>)["__REQ_KEY__"] = "secret";
    expect(requireEnv("__REQ_KEY__")).toBe("secret");
    delete (Bun.env as Record<string, string | undefined>)["__REQ_KEY__"];
  });

  it("throws ConfigError when key is missing", () => {
    delete (Bun.env as Record<string, string | undefined>)["__REQ_MISSING__"];
    expect(() => requireEnv("__REQ_MISSING__")).toThrow("Required environment variable");
  });

  it("throws with the key name in the message", () => {
    delete (Bun.env as Record<string, string | undefined>)["__REQ_NAMED__"];
    expect(() => requireEnv("__REQ_NAMED__")).toThrow("__REQ_NAMED__");
  });
});

// ── config() helper ───────────────────────────────────────────────────────────

describe("config() helper", () => {
  let mgr: ConfigManager;

  beforeEach(() => {
    Application._resetInstance();
    const app = Application.create({ env: "test" });
    // Manually wire a ConfigManager into the container so config() can resolve it
    mgr = new ConfigManager();
    mgr.load("app", { name: "Zerotal", debug: true });
    mgr.load("cache", { driver: "memory", ttl: 60 });
    app.container.value("config" as never, mgr);
  });

  afterEach(() => {
    Application._resetInstance();
  });

  it("reads a value by dot-notation path", () => {
    expect(config("app.name")).toBe("Zerotal");
  });

  it("returns fallback for missing path", () => {
    expect(config("app.missing", "fallback")).toBe("fallback");
  });

  it("config.set() updates a value", () => {
    config.set("app.name", "Updated");
    expect(config("app.name")).toBe("Updated");
  });

  it("config.all() returns the full config object", () => {
    const all = config.all();
    expect(all).toHaveProperty("app");
    expect(all).toHaveProperty("cache");
  });

  it("config.require() throws for missing path", () => {
    expect(() => config.require("app.nonexistent")).toThrow();
  });

  it("config.require() returns value when present", () => {
    expect(config.require("app.name")).toBe("Zerotal");
  });
});

// ── basePath() ────────────────────────────────────────────────────────────────

describe("basePath()", () => {
  it("returns an absolute path under process.cwd()", () => {
    const result = basePath("routes/web.ts");
    expect(result).toContain("routes");
    expect(result).toContain("web.ts");
    // Must be absolute
    expect(result.startsWith("/") || /^[A-Z]:\\/i.test(result)).toBe(true);
  });

  it("joins multiple segments", () => {
    const result = basePath("app", "routes", "index.ts");
    expect(result).toContain("app");
    expect(result).toContain("routes");
    expect(result).toContain("index.ts");
  });

  it("with no arguments returns process.cwd()", () => {
    expect(basePath()).toBe(process.cwd());
  });
});
