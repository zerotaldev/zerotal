import { describe, it, expect } from "bun:test";
import { Container, HttpContext, ScopedResolver, withApp, type Application } from "@zerotal/core";
import { LoginRateLimiter } from "./LoginRateLimiter.ts";

/**
 * Failed sign-ins are counted per identifier and address. The address must come from where the
 * person signing in cannot write it. With no socket to read, it used to fall back to the
 * leftmost `X-Forwarded-For` entry, so rotating that header gave every guess a fresh counter.
 */
function requestFrom(headers: Record<string, string>, socket?: string): HttpContext {
  const ctx = new HttpContext(
    new Request("http://localhost/login", { headers }),
    new ScopedResolver(new Container()),
  );
  if (socket) {
    ctx._server = { requestIP: () => ({ address: socket, family: "IPv4", port: 0 }) };
  }
  return ctx;
}

/** Fail `attempts` sign-ins for one identifier, each from a request built by `make(i)`. */
function failures(
  limiter: LoginRateLimiter,
  attempts: number,
  make: (i: number) => HttpContext,
): number[] {
  return Array.from({ length: attempts }, (_, i) =>
    limiter.recordFailure(make(i), "ada@example.com"),
  );
}

function appWithThrottle(throttle: unknown): Application {
  const manager = {
    get: (path: string, fallback?: unknown) => (path === "app.throttle" ? throttle : fallback),
  };
  return { container: { makeSync: () => manager } } as unknown as Application;
}

describe("the address a login attempt is counted against", () => {
  it("does not change when the client rotates X-Forwarded-For and no socket is available", () => {
    const limiter = new LoginRateLimiter({ maxAttempts: 3, decaySeconds: 60 });

    // Five guesses, each claiming to come from somewhere else.
    const counts = failures(limiter, 5, (i) => requestFrom({ "x-forwarded-for": `1.1.1.${i}` }));

    expect(counts).toEqual([1, 2, 3, 4, 5]);
    expect(
      limiter.ensureNotLocked(requestFrom({ "x-forwarded-for": "9.9.9.9" }), "ada@example.com"),
    ).not.toBeNull();
  });

  it("is the socket address when there is one, whatever the header says", () => {
    const limiter = new LoginRateLimiter({ maxAttempts: 3, decaySeconds: 60 });

    const counts = failures(limiter, 4, (i) =>
      requestFrom({ "x-forwarded-for": `1.1.1.${i}` }, "203.0.113.9"),
    );

    expect(counts).toEqual([1, 2, 3, 4]);
  });

  it("keeps clients on different sockets apart", () => {
    const limiter = new LoginRateLimiter({ maxAttempts: 3, decaySeconds: 60 });

    failures(limiter, 3, () => requestFrom({}, "203.0.113.9"));

    expect(
      limiter.ensureNotLocked(requestFrom({}, "203.0.113.9"), "ada@example.com"),
    ).not.toBeNull();
    expect(limiter.ensureNotLocked(requestFrom({}, "203.0.113.10"), "ada@example.com")).toBeNull();
  });

  it("reads the client from the right of the header when the app has a proxy", () => {
    const limiter = new LoginRateLimiter({ maxAttempts: 3, decaySeconds: 60 });
    const app = appWithThrottle({ maxAttempts: 60, windowSeconds: 60, trustedProxies: 1 });

    withApp(app, () => {
      // One client, rotating what it writes in front of the address the proxy appended.
      const counts = failures(limiter, 3, (i) =>
        requestFrom({ "x-forwarded-for": `spoof-${i}, 203.0.113.9` }, "10.0.0.1"),
      );
      expect(counts).toEqual([1, 2, 3]);

      // A different client behind the same proxy has its own counter.
      expect(
        limiter.ensureNotLocked(
          requestFrom({ "x-forwarded-for": "spoof, 203.0.113.77" }, "10.0.0.1"),
          "ada@example.com",
        ),
      ).toBeNull();
    });
  });
});
