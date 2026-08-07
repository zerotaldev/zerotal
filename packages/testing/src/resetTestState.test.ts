import { describe, it, expect, beforeEach } from "bun:test";
import { Application, Router } from "@zerotal/core";
import { BaseModel, currentOrmContext } from "@zerotal/orm";
import { resetTestState } from "./resetTestState.ts";

class C {
  handle() {}
}

describe("resetTestState() — one-call framework reset", () => {
  beforeEach(() => Application._resetInstance());

  it("clears router routes, ORM context and the app singleton", () => {
    const app = Application.create({ env: "test" });
    Router.get("/x", C as never, "handle");
    BaseModel.registerConnection("z", {} as SQLInstance);

    resetTestState();

    expect(Router.routes.has("GET /x")).toBe(false);
    expect(currentOrmContext().namedConnections.has("z")).toBe(false);

    const app2 = Application.create({ env: "test" });
    expect(app2).not.toBe(app);

    resetTestState();
  });
});
