import { describe, it, expect } from "bun:test";
import { CircuitBreaker, CircuitBreakerOpenError } from "./CircuitBreaker.ts";
import { ApiClientError } from "./ApiClient.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const ok = async () => "ok";
const fail5xx = async () => {
  throw new ApiClientError(503, "Service Unavailable", "");
};
const fail4xx = async () => {
  throw new ApiClientError(404, "Not Found", "");
};
const failNet = async () => {
  throw new TypeError("fetch failed");
};

function makeTripBreaker(breaker: CircuitBreaker, times: number) {
  return async () => {
    for (let i = 0; i < times; i++) {
      try {
        await breaker.call(fail5xx);
      } catch {
        /* expected */
      }
    }
  };
}

// ── Closed state ──────────────────────────────────────────────────────────────

describe("CircuitBreaker — closed state", () => {
  it("passes through successful calls", async () => {
    const breaker = new CircuitBreaker({ threshold: 3 });
    const result = await breaker.call(ok);
    expect(result).toBe("ok");
    expect(breaker.state).toBe("closed");
  });

  it("counts 5xx failures toward threshold", async () => {
    const breaker = new CircuitBreaker({ threshold: 3 });
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.call(fail5xx);
      } catch {
        /* expected */
      }
    }
    expect(breaker.failures).toBe(2);
    expect(breaker.state).toBe("closed");
  });

  it("opens after threshold failures", async () => {
    const breaker = new CircuitBreaker({ threshold: 3 });
    await makeTripBreaker(breaker, 3)();
    expect(breaker.state).toBe("open");
  });

  it("does NOT count 4xx failures (client errors, not upstream faults)", async () => {
    const breaker = new CircuitBreaker({ threshold: 3 });
    for (let i = 0; i < 5; i++) {
      try {
        await breaker.call(fail4xx);
      } catch {
        /* expected */
      }
    }
    expect(breaker.failures).toBe(0);
    expect(breaker.state).toBe("closed");
  });

  it("counts network errors (TypeError) as failures", async () => {
    const breaker = new CircuitBreaker({ threshold: 2 });
    for (let i = 0; i < 2; i++) {
      try {
        await breaker.call(failNet);
      } catch {
        /* expected */
      }
    }
    expect(breaker.state).toBe("open");
  });

  it("resets failure count on any success", async () => {
    const breaker = new CircuitBreaker({ threshold: 5 });
    try {
      await breaker.call(fail5xx);
    } catch {
      /* expected */
    }
    expect(breaker.failures).toBe(1);
    await breaker.call(ok);
    expect(breaker.failures).toBe(0);
    expect(breaker.state).toBe("closed");
  });
});

// ── Open state ────────────────────────────────────────────────────────────────

describe("CircuitBreaker — open state", () => {
  it("throws CircuitBreakerOpenError without calling fn", async () => {
    const breaker = new CircuitBreaker({ threshold: 1, resetTimeout: 60_000 });
    try {
      await breaker.call(fail5xx);
    } catch {
      /* open */
    }

    let called = false;
    await expect(
      breaker.call(async () => {
        called = true;
        return "x";
      }),
    ).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(called).toBe(false);
  });

  it("still throws after multiple open-state attempts", async () => {
    const breaker = new CircuitBreaker({ threshold: 1, resetTimeout: 60_000 });
    try {
      await breaker.call(fail5xx);
    } catch {
      /* open */
    }

    for (let i = 0; i < 3; i++) {
      await expect(breaker.call(ok)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    }
    expect(breaker.state).toBe("open");
  });

  it("transitions to half-open after resetTimeout", async () => {
    const breaker = new CircuitBreaker({ threshold: 1, resetTimeout: 1 });
    try {
      await breaker.call(fail5xx);
    } catch {
      /* open */
    }

    await new Promise((r) => setTimeout(r, 10)); // wait past timeout
    expect(breaker.state).toBe("open"); // still open until next call

    const result = await breaker.call(ok); // probe succeeds → closed
    expect(result).toBe("ok");
    expect(breaker.state).toBe("closed");
  });
});

// ── Half-open state ───────────────────────────────────────────────────────────

describe("CircuitBreaker — half-open state", () => {
  async function openBreaker(resetTimeout = 1): Promise<CircuitBreaker> {
    const breaker = new CircuitBreaker({ threshold: 1, resetTimeout });
    try {
      await breaker.call(fail5xx);
    } catch {
      /* open */
    }
    await new Promise((r) => setTimeout(r, 10));
    return breaker;
  }

  it("closes on a successful probe", async () => {
    const breaker = await openBreaker();
    await breaker.call(ok);
    expect(breaker.state).toBe("closed");
    expect(breaker.failures).toBe(0);
  });

  it("re-opens on a failed probe", async () => {
    const breaker = await openBreaker();
    try {
      await breaker.call(fail5xx);
    } catch {
      /* expected */
    }
    expect(breaker.state).toBe("open");
  });

  it("rejects concurrent calls while a probe is in flight", async () => {
    const breaker = await openBreaker();

    // Start a probe that is intentionally slow
    let resolveProbe!: () => void;
    const slowProbe = (): Promise<string> =>
      new Promise<string>((resolve) => {
        resolveProbe = () => resolve("ok");
      });

    const probePromise = breaker.call(slowProbe);

    // A second concurrent call should be rejected immediately
    await expect(breaker.call(ok)).rejects.toBeInstanceOf(CircuitBreakerOpenError);

    resolveProbe();
    const result = await probePromise;
    expect(result).toBe("ok");
    expect(breaker.state).toBe("closed");
  });
});

// ── Custom isFailure ──────────────────────────────────────────────────────────

describe("CircuitBreaker — custom isFailure", () => {
  it("uses the custom predicate to decide what counts as a failure", async () => {
    const breaker = new CircuitBreaker({
      threshold: 2,
      isFailure: (err) => err instanceof ApiClientError && err.status === 429,
    });

    // 429 → should count
    try {
      await breaker.call(async () => {
        throw new ApiClientError(429, "Too Many Requests", "");
      });
    } catch {
      /* expected */
    }

    // 503 → should NOT count (predicate only checks 429)
    try {
      await breaker.call(fail5xx);
    } catch {
      /* expected */
    }

    expect(breaker.failures).toBe(1); // only the 429 counted
    expect(breaker.state).toBe("closed");
  });
});

// ── Manual reset ──────────────────────────────────────────────────────────────

describe("CircuitBreaker.reset()", () => {
  it("resets an open circuit to closed", async () => {
    const breaker = new CircuitBreaker({ threshold: 1, resetTimeout: 60_000 });
    try {
      await breaker.call(fail5xx);
    } catch {
      /* open */
    }
    expect(breaker.state).toBe("open");

    breaker.reset();
    expect(breaker.state).toBe("closed");
    expect(breaker.failures).toBe(0);

    const result = await breaker.call(ok);
    expect(result).toBe("ok");
  });
});

// ── ApiClient integration ─────────────────────────────────────────────────────

describe("CircuitBreaker + ApiClient integration", () => {
  it("accepts CircuitBreakerOptions in createApiClient config", async () => {
    const { createApiClient } = await import("./index.ts");

    let fetchCount = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCount++;
      return new Response("error", { status: 503, statusText: "Service Unavailable" });
    };

    const client = createApiClient({
      baseUrl: "http://test",
      circuitBreaker: { threshold: 2, resetTimeout: 60_000 },
    });

    try {
      await client.get("/a").catch(() => {});
      expect(fetchCount).toBe(1);
      await client.get("/b").catch(() => {});
      expect(fetchCount).toBe(2); // circuit now open
      await client.get("/c").catch(() => {});
      expect(fetchCount).toBe(2); // open — fetch not called
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("accepts a shared CircuitBreaker instance", async () => {
    const { createApiClient } = await import("./index.ts");
    const breaker = new CircuitBreaker({ threshold: 1, resetTimeout: 60_000 });

    const client = createApiClient({ baseUrl: "http://test", circuitBreaker: breaker });

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response("err", { status: 500, statusText: "Internal Server Error" });

    try {
      await client.get("/x").catch(() => {});
      expect(breaker.state).toBe("open");
      // The shared breaker is now open — another client using same breaker would also be blocked
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
