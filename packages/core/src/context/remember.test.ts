/**
 * `RequestContext.remember()` — ask once per request.
 *
 * The N+1 detector says a query ran too many times; the fix is nearly always
 * "ask once per request", and every app that hits it builds this by hand on top
 * of `RequestContext` + `setInternal`. The two details that make it work are
 * both easy to get wrong and both invisible when wrong: cache the *promise*, and
 * evict a rejected one.
 */
import { describe, it, expect } from "bun:test";
import { RequestContext } from "./RequestContext.ts";
import { HttpContext } from "../pipeline/HttpContext.ts";

/** Run `fn` inside a request boundary, as the fetch handler does. */
async function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = HttpContext.fake("http://localhost/test");
  return RequestContext.run(ctx, fn);
}

describe("RequestContext.remember", () => {
  it("runs the factory once and reuses the answer", async () => {
    let calls = 0;

    await inRequest(async () => {
      const load = (): Promise<number> => {
        calls++;
        return Promise.resolve(42);
      };

      expect(await RequestContext.remember("k", load)).toBe(42);
      expect(await RequestContext.remember("k", load)).toBe(42);
      expect(await RequestContext.remember("k", load)).toBe(42);
    });

    expect(calls).toBe(1);
  });

  it("de-duplicates concurrent callers — the reason the promise is cached", async () => {
    let calls = 0;

    const results = await inRequest(async () => {
      const load = async (): Promise<string> => {
        calls++;
        await Bun.sleep(5);
        return "value";
      };

      // Caching after the await would let all ten miss: none has resolved when
      // the others look, which is exactly the shape a `Promise.all` produces.
      return Promise.all(Array.from({ length: 10 }, () => RequestContext.remember("shared", load)));
    });

    expect(calls).toBe(1);
    expect(results).toEqual(Array<string>(10).fill("value"));
  });

  it("keeps different keys apart", async () => {
    await inRequest(async () => {
      expect(await RequestContext.remember("a", () => Promise.resolve(1))).toBe(1);
      expect(await RequestContext.remember("b", () => Promise.resolve(2))).toBe(2);
      expect(await RequestContext.remember("a", () => Promise.resolve(99))).toBe(1);
    });
  });

  it("does not cache across requests", async () => {
    let calls = 0;
    const load = (): Promise<number> => Promise.resolve(++calls);

    expect(await inRequest(() => RequestContext.remember("k", load))).toBe(1);
    expect(await inRequest(() => RequestContext.remember("k", load))).toBe(2);
  });

  it("evicts a rejection, so one failure does not poison the request", async () => {
    let calls = 0;

    await inRequest(async () => {
      const flaky = async (): Promise<string> => {
        calls++;
        if (calls === 1) throw new Error("transient");
        return "recovered";
      };

      await expect(RequestContext.remember("k", flaky)).rejects.toThrow("transient");
      // Without eviction this would re-throw the cached rejection forever.
      expect(await RequestContext.remember("k", flaky)).toBe("recovered");
    });

    expect(calls).toBe(2);
  });

  it("accepts a synchronous factory", async () => {
    await inRequest(async () => {
      expect(await RequestContext.remember("sync", () => "plain")).toBe("plain");
    });
  });

  it("is a pass-through outside a request, rather than a process-wide cache", async () => {
    let calls = 0;
    const load = (): Promise<number> => Promise.resolve(++calls);

    // A queue worker has no request to scope to, and quietly sharing a value
    // across jobs would be worse than not caching at all.
    expect(await RequestContext.remember("k", load)).toBe(1);
    expect(await RequestContext.remember("k", load)).toBe(2);
  });

  it("forget() drops a value so a later read recomputes it", async () => {
    let calls = 0;
    const load = (): Promise<number> => Promise.resolve(++calls);

    await inRequest(async () => {
      expect(await RequestContext.remember("k", load)).toBe(1);
      RequestContext.forget("k");
      expect(await RequestContext.remember("k", load)).toBe(2);
    });
  });
});
