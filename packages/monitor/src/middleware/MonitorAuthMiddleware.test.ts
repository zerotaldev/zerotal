/**
 * The guard on the monitoring panel.
 *
 * This middleware is the only thing standing between the public internet and a
 * page that shows recent requests, their users, their IPs, and the SQL the app
 * ran. A gate that fails open is not a cosmetic bug, so its behaviour is pinned
 * here rather than assumed — including the two ways it could fail open without
 * anyone noticing: forgetting to `await` an async predicate (a promise is always
 * truthy), and a predicate that throws.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { Application, withApp } from "@zerotal/core";
import type { HttpContext, NextFn } from "@zerotal/core";
import { MonitorAuthMiddleware } from "./MonitorAuthMiddleware.ts";
import { MonitorConfig } from "../config.ts";

/** Run the middleware against a config + user, reporting what it did. */
async function guard(
  auth: (user: unknown) => boolean | Promise<boolean>,
  user: unknown,
): Promise<{ passed: boolean; response: Response | void }> {
  Application._resetInstance();
  const app = Application.create({ env: "test" });
  app.container.value("monitor" as never, MonitorConfig({ auth }) as never);

  let passed = false;
  const next: NextFn = async () => {
    passed = true;
  };

  const response = await withApp(app as never, () =>
    new MonitorAuthMiddleware().handle({ user } as unknown as HttpContext, next),
  );
  return { passed, response: response as Response | void };
}

afterEach(() => Application._resetInstance());

describe("MonitorAuthMiddleware", () => {
  it("passes the request through when auth allows", async () => {
    const { passed, response } = await guard(() => true, { role: "admin" });
    expect(passed).toBe(true);
    expect(response).toBeUndefined();
  });

  it("redirects instead of continuing when auth denies", async () => {
    const { passed, response } = await guard(() => false, { role: "member" });
    expect(passed).toBe(false);
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(302);
  });

  it("denies an anonymous visitor when the predicate requires a user", async () => {
    // The commonest real configuration: `(user) => user?.role === "admin"`.
    const { passed } = await guard((u) => (u as { role?: string })?.role === "admin", undefined);
    expect(passed).toBe(false);
  });

  it("awaits an async predicate rather than treating the promise as truthy", async () => {
    // A promise is always truthy. If the middleware forgot to await, a denying
    // async predicate would silently allow everyone through — the worst
    // possible failure for this particular gate.
    const { passed } = await guard(async () => false, { role: "admin" });
    expect(passed).toBe(false);
  });

  it("fails closed when the predicate throws", async () => {
    // The middleware does not catch, so the throw propagates and the request
    // errors out. That is still fail-closed — what matters is that `next()` is
    // never reached, so a broken predicate cannot serve the panel to anyone.
    let passed = false;
    Application._resetInstance();
    const app = Application.create({ env: "test" });
    app.container.value(
      "monitor" as never,
      MonitorConfig({
        auth: () => {
          throw new Error("auth backend unreachable");
        },
      }) as never,
    );

    await expect(
      withApp(app as never, () =>
        new MonitorAuthMiddleware().handle({ user: null } as unknown as HttpContext, async () => {
          passed = true;
        }),
      ),
    ).rejects.toThrow("auth backend unreachable");
    expect(passed).toBe(false);
  });

  it("passes the authenticated user to the predicate", async () => {
    let seen: unknown = "never called";
    await guard(
      (u) => {
        seen = u;
        return true;
      },
      { id: 7, role: "admin" },
    );
    expect(seen).toEqual({ id: 7, role: "admin" });
  });
});

describe("the default auth predicate", () => {
  it("survives config merging as a callable", () => {
    // `deepMerge` cannot carry a function through, and the reattach in
    // MonitorConfig() only fires when the caller supplied `auth`. So the default
    // has to come out the other side callable on its own — if it ever arrives as
    // a plain object the guard throws on every request instead of denying.
    expect(typeof MonitorConfig().auth).toBe("function");
    expect(typeof MonitorConfig({ path: "/ops" }).auth).toBe("function");
  });

  it("keeps an explicitly supplied predicate", async () => {
    const config = MonitorConfig({ auth: () => "sentinel" as unknown as boolean });
    expect(await config.auth(null)).toBe("sentinel" as unknown as boolean);
  });
});
