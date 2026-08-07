import { describe, it, expect, afterEach } from "bun:test";
import { AdminGuardMiddleware } from "./AdminGuardMiddleware.ts";
import type { HttpContext, NextFn } from "@zerotal/core";

/**
 * The admin panel exposes full CRUD over every registered resource, and this middleware is the
 * only thing standing between a production deploy and unauthenticated create/read/update/delete
 * when `config/admin.ts` declares no `middleware` of its own.
 *
 * It had **zero test references anywhere in the repository**. An inverted condition or a
 * renamed environment value would have silently opened the panel with nothing failing.
 */

const ORIGINAL_APP_ENV = Bun.env["APP_ENV"];

afterEach(() => {
  if (ORIGINAL_APP_ENV === undefined) delete Bun.env["APP_ENV"];
  else Bun.env["APP_ENV"] = ORIGINAL_APP_ENV;
});

/** Run the guard and report whether it passed through or short-circuited. */
async function run(appEnv: string | undefined): Promise<{ passed: boolean; status?: number }> {
  if (appEnv === undefined) delete Bun.env["APP_ENV"];
  else Bun.env["APP_ENV"] = appEnv;

  let passed = false;
  const next: NextFn = () => {
    passed = true;
    return Promise.resolve(undefined);
  };

  const result = await new AdminGuardMiddleware().handle({} as HttpContext, next);
  return result instanceof Response ? { passed, status: result.status } : { passed };
}

describe("AdminGuardMiddleware — fails closed", () => {
  it("denies when APP_ENV is unset", async () => {
    // The decisive case: an operator who never set APP_ENV must not get an open panel.
    const { passed, status } = await run(undefined);
    expect(passed).toBe(false);
    expect(status).toBe(403);
  });

  it("denies in production-like environments", async () => {
    for (const env of ["production", "prod", "staging", "stage", "live", "PRODUCTION"]) {
      const { passed, status } = await run(env);
      expect({ env, passed, status }).toEqual({ env, passed: false, status: 403 });
    }
  });

  it("denies for an unknown environment name", async () => {
    // Anything not on the allow-list reads as production. Guessing wrong must fail safe.
    for (const env of ["qa", "preview", "demo", "", "developement"]) {
      const { passed } = await run(env);
      expect({ env, passed }).toEqual({ env, passed: false });
    }
  });

  it("allows local development environments", async () => {
    for (const env of ["development", "dev", "local", "test", "testing"]) {
      const { passed } = await run(env);
      expect({ env, passed }).toEqual({ env, passed: true });
    }
  });

  it("explains what to do rather than failing blankly", async () => {
    Bun.env["APP_ENV"] = "production";
    const result = await new AdminGuardMiddleware().handle({} as HttpContext, () =>
      Promise.resolve(undefined),
    );
    const body = await (result as Response).text();
    expect(body).toContain("config/admin.ts");
    expect((result as Response).headers.get("Content-Type")).toContain("text/plain");
  });
});
