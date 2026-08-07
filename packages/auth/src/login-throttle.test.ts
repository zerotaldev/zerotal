import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { FrameworkEvents } from "@zerotal/core";
import { Lockout } from "./events.ts";
import { LoginRateLimiter } from "./LoginRateLimiter.ts";

// Minimal HttpContext stand-in: just the bits LoginRateLimiter touches.
function fakeCtx(ip = "1.2.3.4", headers: Record<string, string> = {}) {
  return {
    ip: () => ip,
    header: (name: string) => headers[name.toLowerCase()] ?? undefined,
  } as never;
}

describe("LoginRateLimiter — key-based API", () => {
  it("counts hits and reports tooManyAttempts at the max", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 3, decaySeconds: 60 });
    const key = LoginRateLimiter.key("a@b.com", "ip");
    expect(rl.attempts(key)).toBe(0);
    expect(rl.hit(key)).toBe(1);
    expect(rl.hit(key)).toBe(2);
    expect(rl.tooManyAttempts(key)).toBe(false);
    expect(rl.hit(key)).toBe(3);
    expect(rl.tooManyAttempts(key)).toBe(true);
  });

  it("clear() resets the counter", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 2 });
    const key = LoginRateLimiter.key("a@b.com", "ip");
    rl.hit(key);
    rl.hit(key);
    expect(rl.tooManyAttempts(key)).toBe(true);
    rl.clear(key);
    expect(rl.attempts(key)).toBe(0);
    expect(rl.tooManyAttempts(key)).toBe(false);
  });

  it("expires the window so attempts reset after decay", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 1, decaySeconds: 0 });
    const key = LoginRateLimiter.key("a@b.com", "ip");
    rl.hit(key);
    // decaySeconds: 0 → window already elapsed on the next read
    expect(rl.attempts(key)).toBe(0);
    expect(rl.tooManyAttempts(key)).toBe(false);
  });

  it("availableIn() reports a positive countdown while limited", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 1, decaySeconds: 60 });
    const key = LoginRateLimiter.key("a@b.com", "ip");
    rl.hit(key);
    expect(rl.availableIn(key)).toBeGreaterThan(0);
    expect(rl.availableIn(key)).toBeLessThanOrEqual(60);
  });

  it("keys are case-insensitive on the identifier and scoped by IP", () => {
    expect(LoginRateLimiter.key("A@B.com", "ip")).toBe(LoginRateLimiter.key("a@b.com", "ip"));
    expect(LoginRateLimiter.key("a@b.com", "ip1")).not.toBe(LoginRateLimiter.key("a@b.com", "ip2"));
  });
});

describe("LoginRateLimiter — context API + Lockout event", () => {
  let captured: Lockout[] = [];
  let unsubscribe: () => void;

  beforeEach(() => {
    captured = [];
    unsubscribe = FrameworkEvents.on(Lockout, (e) => captured.push(e));
  });
  afterEach(() => unsubscribe());

  it("ensureNotLocked() returns null until the limit, then a countdown", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 2, decaySeconds: 60 });
    const ctx = fakeCtx();
    expect(rl.ensureNotLocked(ctx, "a@b.com")).toBeNull();
    rl.recordFailure(ctx, "a@b.com");
    rl.recordFailure(ctx, "a@b.com");
    const wait = rl.ensureNotLocked(ctx, "a@b.com");
    expect(wait).not.toBeNull();
    expect(wait!).toBeGreaterThan(0);
  });

  it("emits a single Lockout event per lockout window", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 1, decaySeconds: 60 });
    const ctx = fakeCtx();
    rl.recordFailure(ctx, "a@b.com");
    rl.ensureNotLocked(ctx, "a@b.com");
    rl.ensureNotLocked(ctx, "a@b.com"); // still locked, but no duplicate event
    expect(captured).toHaveLength(1);
    expect(captured[0]!.identifier).toBe("a@b.com");
    expect(captured[0]!.guard).toBe("web");
  });

  it("clearFor() resets the per-context counter and re-arms the event", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 1, decaySeconds: 60 });
    const ctx = fakeCtx();
    rl.recordFailure(ctx, "a@b.com");
    expect(rl.ensureNotLocked(ctx, "a@b.com")).not.toBeNull();
    rl.clearFor(ctx, "a@b.com");
    expect(rl.ensureNotLocked(ctx, "a@b.com")).toBeNull();
  });

  it("different IPs are throttled independently", () => {
    const rl = new LoginRateLimiter({ maxAttempts: 1, decaySeconds: 60 });
    rl.recordFailure(fakeCtx("10.0.0.1"), "a@b.com");
    expect(rl.ensureNotLocked(fakeCtx("10.0.0.1"), "a@b.com")).not.toBeNull();
    expect(rl.ensureNotLocked(fakeCtx("10.0.0.2"), "a@b.com")).toBeNull();
  });
});
