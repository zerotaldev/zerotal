import { describe, expect, it } from "bun:test";
import type { Application } from "../application/Application.ts";
import { ThrottleMiddleware } from "../middleware/ThrottleMiddleware.ts";
import { BaseMiddleware } from "../middleware/BaseMiddleware.ts";
import { registeredThrottles, throttlesKeyedOnSocket } from "./throttleIdentity.ts";
import type { NextFn } from "../pipeline/types.ts";
import type { HttpContext } from "../pipeline/HttpContext.ts";

/** Something in the pipeline that is not a throttle, to prove detection is not "anything". */
class Unrelated extends BaseMiddleware {
  protected options = {};
  async handle(_http: HttpContext, next: NextFn): Promise<Response | void> {
    return next();
  }
}

/** An app whose only interesting property is its global middleware list. */
function appWith(middleware: unknown[]): Application {
  return { globalMiddleware: middleware } as unknown as Application;
}

describe("registeredThrottles", () => {
  it("finds a plain ThrottleMiddleware", () => {
    const found = registeredThrottles(appWith([ThrottleMiddleware]));
    expect(found).toHaveLength(1);
    expect(found[0]!.where).toBe("global");
  });

  it("finds the anonymous subclass .with() returns", () => {
    const configured = ThrottleMiddleware.with({ maxAttempts: 5 });
    expect(registeredThrottles(appWith([configured]))).toHaveLength(1);
  });

  it("ignores middleware that is not a throttle", () => {
    expect(registeredThrottles(appWith([Unrelated]))).toEqual([]);
  });

  it("reads the configured trustedProxies off a .with() subclass", () => {
    const behindProxy = ThrottleMiddleware.with({ maxAttempts: 5, trustedProxies: 1 });
    expect(registeredThrottles(appWith([behindProxy]))[0]!.trustsProxies).toBe(true);
  });

  it("notices an app that resolves identity itself", () => {
    const byUser = ThrottleMiddleware.with({
      maxAttempts: 1000,
      keyResolver: () => "user-1",
    });
    expect(registeredThrottles(appWith([byUser]))[0]!.customKey).toBe(true);
  });

  it("survives an app with no global middleware at all", () => {
    expect(registeredThrottles(appWith([]))).toEqual([]);
    expect(registeredThrottles({} as unknown as Application)).toEqual([]);
  });
});

describe("throttlesKeyedOnSocket", () => {
  it("reports a throttle that was never told about a proxy", () => {
    const exposed = throttlesKeyedOnSocket(appWith([ThrottleMiddleware.with({ maxAttempts: 5 })]));
    expect(exposed).toHaveLength(1);
  });

  it("says nothing about one that trusts a proxy", () => {
    const behindProxy = ThrottleMiddleware.with({ maxAttempts: 5, trustedProxies: 1 });
    expect(throttlesKeyedOnSocket(appWith([behindProxy]))).toEqual([]);
  });

  it("says nothing about one keyed on something other than an IP", () => {
    // An app keying on a user id has already decided identity for itself, and the
    // proxy question does not arise.
    const byUser = ThrottleMiddleware.with({ maxAttempts: 5, keyResolver: () => "u" });
    expect(throttlesKeyedOnSocket(appWith([byUser]))).toEqual([]);
  });

  it("treats trustedProxies: 0 as keying on the socket, because it does", () => {
    const explicit = ThrottleMiddleware.with({ maxAttempts: 5, trustedProxies: 0 });
    expect(throttlesKeyedOnSocket(appWith([explicit]))).toHaveLength(1);
  });
});
