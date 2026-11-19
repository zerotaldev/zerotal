/**
 * What this package's suites assume of `bun:test`'s mocks, on every Bun the framework supports.
 *
 * Bun 1.4 changed `mock.restore()` to drop the implementation a `mock()` was given as well, where
 * Bun 1.3 kept it. The suites here only ever restore `spyOn(globalThis, "fetch")` and install a
 * fresh response for each test, so the part they depend on is the same on both: restoring puts
 * the real `fetch` back, and a spy set up afterwards starts clean.
 */
import { describe, it, expect, spyOn, mock } from "bun:test";

describe("mock.restore() with a spy on fetch", () => {
  it("puts the real fetch back", () => {
    const real = globalThis.fetch;
    const spy = spyOn(globalThis, "fetch");
    spy.mockResolvedValueOnce(new Response("stubbed"));
    expect(globalThis.fetch).not.toBe(real);

    mock.restore();

    expect(globalThis.fetch).toBe(real);
  });

  it("leaves a later spy with no calls and no queued responses", async () => {
    const first = spyOn(globalThis, "fetch");
    first.mockResolvedValueOnce(new Response("first"));
    first.mockResolvedValueOnce(new Response("never used"));
    await fetch("http://example.test/a");
    mock.restore();

    const second = spyOn(globalThis, "fetch");
    second.mockResolvedValueOnce(new Response("second"));

    expect(second.mock.calls).toHaveLength(0);
    expect(await (await fetch("http://example.test/b")).text()).toBe("second");
    expect(second.mock.calls[0]![0]).toBe("http://example.test/b");
    mock.restore();
  });

  it("keeps an implementation installed after a reset, which is the order the suites use", async () => {
    const fn = mock(async () => "old");
    fn.mockReset();
    fn.mockImplementation(async () => "new");

    expect(await fn()).toBe("new");
  });
});
