import { describe, it, expect } from "bun:test";
import { HttpContext } from "@zerotal/core";
import { currentUser } from "@zerotal/core/auth";
import type { CurrentUser } from "@zerotal/core";
import type { UserModel } from "./facades/Auth.ts";
import "./augment.ts";

describe("the signed-in user's type, from core", () => {
  it("is UserModel once the auth package is loaded, with no cast at the reader", () => {
    // `typecheck:tests` fails this file if `UserRegistry` stops resolving to `UserModel`:
    // both assignments need the two types to agree.
    const ctx = HttpContext.fake("http://localhost/");
    const user: UserModel | undefined = currentUser(ctx);
    const back: CurrentUser | undefined = user;
    expect(back).toBeUndefined();
  });
});
