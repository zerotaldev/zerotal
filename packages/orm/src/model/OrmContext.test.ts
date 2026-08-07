import { describe, it, expect, afterEach } from "bun:test";
import { BaseModel } from "./BaseModel.ts";
import { State } from "./State.ts";
import { currentOrmContext, useOrmContext, resetOrmContext } from "./OrmContext.ts";

afterEach(() => resetOrmContext());

describe("OrmContext — execution-scoped ORM registries", () => {
  it("named connections are isolated per context", () => {
    BaseModel.registerConnection("alpha", {} as SQLInstance);
    expect(currentOrmContext().namedConnections.has("alpha")).toBe(true);
    const prev = useOrmContext();
    expect(currentOrmContext().namedConnections.has("alpha")).toBe(false);
    useOrmContext(prev);
    expect(currentOrmContext().namedConnections.has("alpha")).toBe(true);
  });

  it("global scopes, transition callbacks and observers live on the context", () => {
    class Widget extends State(BaseModel) {
      static override table = "widgets";
    }
    Widget.addGlobalScope("active", () => {});
    Widget.onTransition("done", () => {});
    Widget.observe(
      class {
        saving() {}
      } as never,
    );

    const ctx = currentOrmContext();
    expect(ctx.globalScopes.has(Widget)).toBe(true);
    expect(ctx.transitionCallbacks.has(Widget)).toBe(true);
    expect(ctx.hooks.has(Widget)).toBe(true);

    const prev = useOrmContext();
    expect(currentOrmContext().globalScopes.has(Widget)).toBe(false);
    expect(currentOrmContext().transitionCallbacks.has(Widget)).toBe(false);
    expect(currentOrmContext().hooks.has(Widget)).toBe(false);

    useOrmContext(prev);
    expect(currentOrmContext().globalScopes.has(Widget)).toBe(true);
  });

  it("resetOrmContext() clears every runtime registry in one call", () => {
    class M extends State(BaseModel) {
      static override table = "m";
    }
    BaseModel.registerConnection("beta", {} as SQLInstance);
    M.addGlobalScope("s", () => {});
    M.onTransition("x", () => {});
    resetOrmContext();
    expect(currentOrmContext().namedConnections.size).toBe(0);
    expect(currentOrmContext().globalScopes.size).toBe(0);
    expect(currentOrmContext().transitionCallbacks.size).toBe(0);
    expect(currentOrmContext().hooks.size).toBe(0);
  });
});
