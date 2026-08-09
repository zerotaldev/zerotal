import { describe, it, expect } from "bun:test";
import { BaseModel } from "@zerotal/orm";
import { AuthUser } from "./AuthUser.ts";
import { Roles } from "./rbac/Roles.ts";
import { Permissions } from "./rbac/Permissions.ts";

describe("AuthUser.using — composition onto a mixin-produced base", () => {
  it("composes mixins onto AuthUser, keeping it in the chain", () => {
    class Team extends AuthUser.using(Roles) {}
    class ApiKey extends AuthUser.using(Permissions) {}
    class Admin extends AuthUser.using(Roles, Permissions) {}

    const t = new Team();
    expect(t).toBeInstanceOf(AuthUser);
    expect(t).toBeInstanceOf(BaseModel);
    expect(typeof t.hasRole).toBe("function");

    const k = new ApiKey();
    expect(typeof k.hasPermissionTo).toBe("function");

    const a = new Admin();
    expect(typeof a.hasRole).toBe("function");
    expect(typeof a.hasPermissionTo).toBe("function");
    expect(typeof Admin.query).toBe("function");
  });
});
