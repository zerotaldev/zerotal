import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { OptionalPeerMissingError } from "@zerotal/core/runtime";
import { Panel } from "./Panel.ts";
import { Resource } from "./Resource.ts";
import { text } from "./table/Column.ts";
import { adminPackagesCheck } from "./doctor.ts";
import { databaseNotifications } from "./databaseNotifications.ts";
import type { Application } from "@zerotal/core";

class OrderResource extends Resource {
  static override model = { name: "Order" };
  static override slug = "orders";
  static override history = true;
  static override columns() {
    return [text("id")];
  }
}

class PlainResource extends Resource {
  static override model = { name: "Note" };
  static override slug = "notes";
  static override columns() {
    return [text("id")];
  }
}

const app = {} as Application;

/** A loader that behaves as an absent package does. */
const absent = (peer: string, feature: string) => async (): Promise<never> => {
  throw new OptionalPeerMissingError({ peer, feature, install: `bun add ${peer}` });
};
const present = async (): Promise<unknown> => ({});

describe("adminPackagesCheck", () => {
  beforeEach(() => Panel.reset());
  afterEach(() => Panel.reset());

  it("passes when no panel feature needs an optional package", async () => {
    Panel.register(PlainResource);
    const check = adminPackagesCheck({
      loaders: { audit: absent("@zerotal/audit", "h"), notifications: absent("x", "n") },
    });
    expect((await check.run(app)).status).toBe("ok");
  });

  it("fails with the install command when a resource asks for history without audit", async () => {
    Panel.register(OrderResource, PlainResource);
    const check = adminPackagesCheck({
      loaders: {
        audit: absent("@zerotal/audit", "a resource with `static history = true`"),
        notifications: present,
      },
    });
    const result = await check.run(app);
    expect(result.status).toBe("fail");
    expect(result.message).toContain("@zerotal/audit");
    expect(result.fix).toBe("bun add @zerotal/audit");
  });

  it("recognises the database notifications provider and checks its package", async () => {
    Panel.notifications(databaseNotifications());
    const check = adminPackagesCheck({
      loaders: {
        audit: present,
        notifications: absent("@zerotal/notifications", "Panel.notifications(...)"),
      },
    });
    const result = await check.run(app);
    expect(result.status).toBe("fail");
    expect(result.fix).toBe("bun add @zerotal/notifications");
  });

  it("ignores a notification provider of the app's own", async () => {
    Panel.notifications({ resolve: async () => [] });
    const check = adminPackagesCheck({
      loaders: { audit: present, notifications: absent("@zerotal/notifications", "n") },
    });
    expect((await check.run(app)).status).toBe("ok");
  });

  it("passes against the real packages, which this workspace installs", async () => {
    Panel.register(OrderResource);
    Panel.notifications(databaseNotifications());
    expect((await adminPackagesCheck().run(app)).status).toBe("ok");
  });

  it("rethrows a package that fails for any other reason", async () => {
    Panel.register(OrderResource);
    const broken = new Error("audit threw while loading");
    const check = adminPackagesCheck({
      loaders: {
        audit: async () => {
          throw broken;
        },
        notifications: present,
      },
    });
    await expect(check.run(app)).rejects.toBe(broken);
  });

  it("loads the app's panel wiring before reading it", async () => {
    const check = adminPackagesCheck({
      prepare: async () => Panel.register(OrderResource),
      loaders: { audit: absent("@zerotal/audit", "h"), notifications: present },
    });
    expect((await check.run(app)).status).toBe("fail");
  });
});
