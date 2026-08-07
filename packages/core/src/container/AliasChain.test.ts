import { describe, it, expect } from "bun:test";
import { Container } from "./Container.ts";

describe("Container._resolveAlias — chain resolution", () => {
  it("follows a multi-level alias chain to the canonical token", () => {
    const c = new Container();
    c.alias("a", "b");
    c.alias("b", "c");
    expect(c._resolveAlias("a")).toBe("c");
  });
  it("resolves a value through an alias chain via make()", async () => {
    const c = new Container();
    c.value("canonical", { hello: "world" });
    c.alias("mid", "canonical");
    c.alias("top", "mid");
    const resolved = await c.make<{ hello: string }>("top" as never);
    expect(resolved.hello).toBe("world");
  });
  it("does not loop forever on a cyclic alias", () => {
    const c = new Container();
    c.alias("x", "y");
    c.alias("y", "x");
    const result = c._resolveAlias("x");
    expect(result === "x" || result === "y").toBe(true);
  });
  it("returns the token unchanged when it has no alias", () => {
    const c = new Container();
    expect(c._resolveAlias("plain")).toBe("plain");
  });
});
