import { describe, it, expect } from "bun:test";
import { redactGraph } from "./redactGraph.ts";
import type { RedactGraphOptions } from "./redactGraph.ts";

/** The vocabulary DevTools uses, since that is the caller this walk was extracted for. */
const options = (over: Partial<RedactGraphOptions> = {}): RedactGraphOptions => ({
  sensitive: (key) => /key|secret|password|token|credential/i.test(key),
  mask: "‹redacted›",
  circular: "‹circular›",
  tooDeep: "‹truncated›",
  maxDepth: 6,
  ...over,
});

describe("redactGraph", () => {
  it("masks a value whose key says it is a secret", () => {
    expect(redactGraph({ password: "hunter2", name: "ada" }, options())).toEqual({
      password: "‹redacted›",
      name: "ada",
    });
  });

  it("masks at any depth", () => {
    const out = redactGraph({ db: { conn: { password: "p" } } }, options()) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(out["db"]!["conn"]!["password"]).toBe("‹redacted›");
  });

  /**
   * The reason this rule exists. Names are matched by substring, so
   * `cors.credentials` — a boolean saying whether credentialed CORS is on —
   * contains "credential" and came back masked on the DevTools Config tab. A
   * boolean has two possible values: masking one conceals nothing a reader could
   * not guess, and hides the answer they opened the tab for.
   */
  it("never masks a boolean, whatever its key is called", () => {
    expect(redactGraph({ credentials: true, secret: false, token: "abc" }, options())).toEqual({
      credentials: true,
      secret: false,
      token: "‹redacted›",
    });
  });

  it("still masks a number, which can be a PIN or an account", () => {
    expect(redactGraph({ token: 123456 }, options())).toEqual({ token: "‹redacted›" });
  });

  it("replaces a reference back to an ancestor", () => {
    const parent: Record<string, unknown> = { name: "parent" };
    parent["child"] = { parent };
    const out = redactGraph(parent, options()) as Record<string, Record<string, unknown>>;
    expect(out["child"]!["parent"]).toBe("‹circular›");
  });

  it("renders a value that appears twice as a sibling, both times", () => {
    // The ancestor set is released on the way back up, so this is not a cycle.
    const shared = { id: 1 };
    expect(redactGraph({ a: shared, b: shared }, options())).toEqual({
      a: { id: 1 },
      b: { id: 1 },
    });
  });

  it("stops at the depth limit rather than following a pathological graph", () => {
    const deep = { a: { b: { c: { d: {} } } } };
    const out = redactGraph(deep, options({ maxDepth: 2 })) as Record<
      string,
      Record<string, unknown>
    >;
    expect(out["a"]!["b"]).toBe("‹truncated›");
  });

  it("lets a caller render a value flat instead of walking it", () => {
    const when = new Date("2026-08-16T00:00:00.000Z");
    const out = redactGraph(
      { when },
      options({ flatten: (v) => (v instanceof Date ? v.toISOString() : undefined) }),
    );
    expect(out).toEqual({ when: "2026-08-16T00:00:00.000Z" });
  });

  it("walks arrays, masking by the key they hang from", () => {
    expect(redactGraph({ items: [{ token: "a" }, { name: "b" }] }, options())).toEqual({
      items: [{ token: "‹redacted›" }, { name: "b" }],
    });
  });

  it("returns a new value and leaves the input alone", () => {
    const input = { password: "hunter2", nested: { name: "ada" } };
    const out = redactGraph(input, options());
    expect(input.password).toBe("hunter2");
    expect(out).not.toBe(input);
  });

  it("passes a bare scalar through — there is no name to judge it by", () => {
    expect(redactGraph("hunter2", options())).toBe("hunter2");
    expect(redactGraph(null, options())).toBeNull();
  });
});
