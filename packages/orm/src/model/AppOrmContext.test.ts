import { describe, it, expect, afterEach } from "bun:test";
import { Application } from "@zerotal/core";
import { BaseModel } from "./BaseModel.ts";
import { currentOrmContext } from "./OrmContext.ts";

afterEach(() => {
  Application._resetInstance();
});

describe("Application owns an OrmContext (Track 4 Phase 3b)", () => {
  it("create() installs a fresh OrmContext; _resetInstance() restores it", () => {
    Application._resetInstance();
    const before = currentOrmContext();
    Application.create({ env: "test" });
    const during = currentOrmContext();
    expect(during).not.toBe(before);
    BaseModel.registerConnection("app-conn", {} as SQLInstance);
    expect(during.namedConnections.has("app-conn")).toBe(true);
    Application._resetInstance();
    expect(currentOrmContext()).toBe(before);
    expect(currentOrmContext().namedConnections.has("app-conn")).toBe(false);
  });

  it("two apps get distinct, isolated ORM contexts", () => {
    Application._resetInstance();
    Application.create({ env: "test" });
    const c1 = currentOrmContext();
    BaseModel.registerConnection("in-app1", {} as SQLInstance);
    Application._resetInstance();
    Application.create({ env: "test" });
    const c2 = currentOrmContext();
    expect(c2).not.toBe(c1);
    expect(c2.namedConnections.has("in-app1")).toBe(false);
    Application._resetInstance();
  });
});
