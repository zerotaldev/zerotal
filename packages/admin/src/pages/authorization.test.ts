import { describe, it, expect } from "bun:test";
import {
  assertCan,
  assertActionAllowed,
  resolveDeclaredRelation,
  resolveDeclaredRelationByName,
  AdminForbiddenError,
} from "../support/authorize.ts";
import { Action } from "../actions/Action.ts";
import type { ActionContext } from "../actions/Action.ts";
import type { ResourceClass } from "../Panel.ts";
import type { RelationManager } from "../relations/RelationManager.ts";

/**
 * Regression guard for admin authorization.
 *
 * `Action._authorizeFn` was consulted in exactly one place — `isVisibleFor()`, called while
 * *rendering* the row-action column. The `@expose` dispatchers never called it, and Flow
 * applies client-supplied arguments straight to the resolved method. So hiding a button was
 * the entire control: any user who could load an admin page could invoke `runAction`,
 * `runBulkAction`, `deleteRecord`, `deleteRelated`, `attachRelated` or `detachRelated` with
 * arguments of their choosing.
 *
 * Two of those were worse than "missing check": `deleteRelated(slug, id)` resolved *any*
 * registered resource by slug (so `deleteRelated("users", 1)` from a posts page deleted the
 * superadmin), and `toggleColumn(id, column, value)` wrote a client-named column, which is an
 * arbitrary-column write.
 */

/** Minimal resource double — only what the authorize helpers touch. */
function fakeResource(overrides: Partial<Record<string, unknown>> = {}): ResourceClass {
  return {
    getLabel: () => "Post",
    getSlug: () => "posts",
    can: () => true,
    relations: () => [],
    columns: () => [],
    ...overrides,
  } as unknown as ResourceClass;
}

function fakeCtx(resource: ResourceClass): ActionContext {
  return {
    resource,
    page: {} as never,
    base: "/admin",
    slug: "posts",
    record: undefined,
  } as ActionContext;
}

describe("assertCan", () => {
  it("passes when the resource allows the ability", () => {
    const R = fakeResource({ can: () => true });
    expect(() => assertCan(R, "delete")).not.toThrow();
  });

  it("throws AdminForbiddenError when the resource denies it", () => {
    const R = fakeResource({ can: () => false });
    expect(() => assertCan(R, "delete")).toThrow(AdminForbiddenError);
  });

  it("forwards the ability and record to Resource.can()", () => {
    const seen: unknown[] = [];
    const R = fakeResource({
      can: (ability: string, record?: unknown) => {
        seen.push([ability, record]);
        return true;
      },
    });
    assertCan(R, "update", { id: 7 });
    expect(seen).toEqual([["update", { id: 7 }]]);
  });

  it("carries a 403 so it renders correctly if it escapes the action", () => {
    const R = fakeResource({ can: () => false });
    try {
      assertCan(R, "delete");
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as AdminForbiddenError).status).toBe(403);
      expect((error as AdminForbiddenError).code).toBe("E_ADMIN_FORBIDDEN");
    }
  });
});

describe("assertActionAllowed", () => {
  it("allows an action with no predicates", () => {
    const R = fakeResource();
    const action = new Action("edit").run(async () => {});
    expect(() => assertActionAllowed(action, undefined, fakeCtx(R))).not.toThrow();
  });

  it("refuses an action whose authorize() predicate returns false", () => {
    const R = fakeResource();
    const action = new Action("delete").run(async () => {}).authorize(() => false);
    expect(() => assertActionAllowed(action, { id: 1 }, fakeCtx(R))).toThrow(AdminForbiddenError);
  });

  it("refuses an action whose visible() predicate returns false", () => {
    // The renderer hides it; the dispatcher must refuse it. These were different answers.
    const R = fakeResource();
    const action = new Action("restore").run(async () => {}).visible(() => false);
    expect(() => assertActionAllowed(action, { id: 1 }, fakeCtx(R))).toThrow(AdminForbiddenError);
  });

  it("evaluates the predicate against the record it was given", () => {
    const R = fakeResource();
    const action = new Action("publish")
      .run(async () => {})
      .authorize((rec) => (rec as { ownerId?: number } | undefined)?.ownerId === 1);

    expect(() => assertActionAllowed(action, { ownerId: 1 }, fakeCtx(R))).not.toThrow();
    expect(() => assertActionAllowed(action, { ownerId: 2 }, fakeCtx(R))).toThrow(
      AdminForbiddenError,
    );
  });
});

describe("resolveDeclaredRelation", () => {
  const comments = fakeResource({ getSlug: () => "comments", getLabel: () => "Comment" });
  const withRelations = fakeResource({
    relations: () => [{ _resource: comments, _canAttach: false } as unknown as RelationManager],
  });

  it("resolves a slug that is a declared relation", () => {
    expect(resolveDeclaredRelation(withRelations, "comments")).not.toBeNull();
  });

  it("refuses a slug that is merely a registered resource elsewhere in the panel", () => {
    // This is the IDOR: Panel.find("users") used to succeed from a posts page.
    expect(resolveDeclaredRelation(withRelations, "users")).toBeNull();
  });

  it("refuses when the resource declares no relations at all", () => {
    expect(resolveDeclaredRelation(fakeResource(), "comments")).toBeNull();
  });
});

describe("resolveDeclaredRelationByName", () => {
  const roles = fakeResource({ getSlug: () => "roles" });
  const parent = fakeResource({
    relations: () => [
      { _resource: roles, _relationName: "roles", _canAttach: true } as unknown as RelationManager,
      {
        _resource: roles,
        _relationName: "auditLogs",
        _canAttach: false,
      } as unknown as RelationManager,
    ],
  });

  it("resolves a declared attachable relation method", () => {
    expect(resolveDeclaredRelationByName(parent, "roles")).not.toBeNull();
  });

  it("refuses an arbitrary method name on the model", () => {
    // attachRelated used to invoke whatever name it was given on the parent model.
    for (const name of ["delete", "save", "toJSON", "constructor", "__proto__"]) {
      expect(resolveDeclaredRelationByName(parent, name)).toBeNull();
    }
  });

  it("refuses a declared relation that is not attachable", () => {
    expect(resolveDeclaredRelationByName(parent, "auditLogs")).toBeNull();
  });
});
