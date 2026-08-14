/**
 * `session.get<T>()` — the generic the contract's own docblock promised.
 *
 * `SessionContract.get` was declared `get(key: string): unknown`, and its
 * docblock said higher-level surfaces layer a generic on top. `ctx.session` is
 * typed as the contract, so it was not one of those surfaces:
 * `ctx.session.get<number>(k)` was "Expected 0 type arguments, but got 1" while
 * `ctx.flashed<T>(k)` on the same object compiled fine.
 *
 * The assertions here are mostly type-level, which is the point — the bug was
 * entirely in the signature — and this file is covered by `typecheck:tests`.
 */
import { describe, it, expect } from "bun:test";
import { SessionManager } from "./SessionManager.ts";
import type { SessionContract } from "@zerotal/core/contracts";
import type { SessionDriver } from "./drivers/CookieDriver.ts";

/** These tests never persist, so the driver only has to exist. */
const driver = {
  cookieName: "session",
  async loadFromRequest() {
    return { id: "sid", data: {} };
  },
  async saveSession() {},
} as unknown as SessionDriver;

describe("session.get<T>()", () => {
  it("returns the asserted type", () => {
    const session = new SessionManager("sid", { issuedAt: 1_700_000_000 }, driver);

    const issuedAt: number | undefined = session.get<number>("issuedAt");
    expect(issuedAt).toBe(1_700_000_000);
  });

  it("still defaults to unknown, so the safe form keeps working", () => {
    const session = new SessionManager("sid", { raw: "whatever" }, driver);

    const value: unknown = session.get("raw");
    expect(typeof value).toBe("string");
  });

  it("is generic through the contract, which is how ctx.session is typed", () => {
    // The original failure: `ctx.session` is a SessionContract, not a
    // SessionManager, so the generic had to exist on the contract to be reachable.
    const contract: SessionContract = new SessionManager("sid", { count: 3 }, driver);

    const count: number | undefined = contract.get<number>("count");
    expect(count).toBe(3);
  });

  it("pull() is generic too, and still removes the value", () => {
    const session = new SessionManager("sid", { token: "abc" }, driver);

    const token: string | undefined = session.pull<string>("token");
    expect(token).toBe("abc");
    expect(session.has("token")).toBe(false);
  });

  it("returns undefined for a missing key", () => {
    const session = new SessionManager("sid", {}, driver);
    expect(session.get<number>("nope")).toBeUndefined();
  });
});
