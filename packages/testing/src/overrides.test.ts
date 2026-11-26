import { afterAll, describe, expect, it } from "bun:test";
import { Application, SecureHeadersMiddleware } from "@zerotal/core";
import { ConfigManager } from "@zerotal/core/config";
import { withConfig, withEnv } from "./overrides.ts";

function appWith(config: ConfigManager): Application {
  return { container: { makeSync: () => config } } as unknown as Application;
}

describe("withEnv()", () => {
  it("sets variables for the callback and restores them after", async () => {
    Bun.env["ZT_OVR_SET"] = "before";
    delete Bun.env["ZT_OVR_UNSET"];

    const seen = await withEnv({ ZT_OVR_SET: "during", ZT_OVR_UNSET: "new" }, () => ({
      set: Bun.env["ZT_OVR_SET"],
      unset: Bun.env["ZT_OVR_UNSET"],
    }));

    expect(seen).toEqual({ set: "during", unset: "new" });
    expect(Bun.env["ZT_OVR_SET"]).toBe("before");
    expect("ZT_OVR_UNSET" in Bun.env).toBe(false);
    delete Bun.env["ZT_OVR_SET"];
  });

  it("unsets a variable given undefined, and restores it even when the callback throws", async () => {
    Bun.env["ZT_OVR_THROW"] = "kept";
    await expect(
      withEnv({ ZT_OVR_THROW: undefined }, () => {
        expect(Bun.env["ZT_OVR_THROW"]).toBeUndefined();
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(Bun.env["ZT_OVR_THROW"]).toBe("kept");
    delete Bun.env["ZT_OVR_THROW"];
  });

  describe("per test", () => {
    withEnv({ ZT_OVR_HOOK: "on" });
    it("applies before each test", () => {
      expect(Bun.env["ZT_OVR_HOOK"]).toBe("on");
    });
  });

  it("is undone after each test of the describe that declared it", () => {
    expect(Bun.env["ZT_OVR_HOOK"]).toBeUndefined();
  });
});

describe("withConfig()", () => {
  function store(): ConfigManager {
    const config = new ConfigManager();
    config.load("app", { name: "Demo", secureHeaders: { frameOptions: "DENY" } });
    return config;
  }

  it("overrides existing paths and puts the old values back", async () => {
    const config = store();
    await withConfig({ "app.name": "Other" }, () => expect(config.get("app.name")).toBe("Other"), {
      app: appWith(config),
    });
    expect(config.get("app.name")).toBe("Demo");
  });

  it("removes a path that did not exist, with the objects it had to create", async () => {
    const config = store();
    await withConfig(
      { "app.features.billing.enabled": true, "features.beta": true },
      () => {
        expect(config.get("app.features.billing.enabled")).toBe(true);
        expect(config.get("features.beta")).toBe(true);
      },
      { app: appWith(config) },
    );
    expect(config.get("app.features")).toBeUndefined();
    expect(Object.keys(config.get<object>("app"))).toEqual(["name", "secureHeaders"]);
    expect(config.has("features")).toBe(false);
  });

  it("restores after a throw", async () => {
    const config = store();
    await expect(
      withConfig(
        { "app.name": "Other" },
        () => {
          throw new Error("boom");
        },
        { app: appWith(config) },
      ),
    ).rejects.toThrow("boom");
    expect(config.get("app.name")).toBe("Demo");
  });

  const live = store();

  describe("per test, against the current app", () => {
    const app = Application.create({ env: "test" });
    app.container.value("config", live);
    afterAll(() => Application._resetInstance());

    withConfig({ "app.secureHeaders.contentSecurityPolicy": "default-src 'none'" });

    it("reaches code that reads config per request, CSP included", () => {
      const middleware = new SecureHeadersMiddleware() as unknown as {
        options: { contentSecurityPolicy?: string };
      };
      expect(middleware.options.contentSecurityPolicy).toBe("default-src 'none'");
    });
  });

  it("is undone after each test of the describe that declared it", () => {
    expect(live.get("app.secureHeaders.contentSecurityPolicy")).toBeUndefined();
    expect(live.get("app.secureHeaders")).toEqual({ frameOptions: "DENY" });
  });
});
