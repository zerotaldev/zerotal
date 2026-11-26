/**
 * Compile-time tests for `Infer<>`.
 *
 * `array` and `object` used to infer `unknown`, which is worse than it sounds:
 * the idiomatic `data.ids ?? []` turns `unknown` into `{}`, so the error a user
 * sees is "Property 'map' does not exist on type '{}'" — pointing at the array
 * they just validated. These pin the item and shape types through the same
 * public entry point an app uses, so a regression fails `typecheck:tests`
 * rather than surfacing in an app months later.
 */
import { describe, it, expect } from "bun:test";
import { ValidatorFacade } from "./facades/Validator.ts";

/** Invariant type equality — `Equals<string, unknown>` is false, unlike `extends`. */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails to compile unless the argument type is exactly `true`. */
function assertType<_T extends true>(): void {}

/** The `data` of a successful outcome. */
type DataOf<O> = O extends { success: true; data: infer D } ? D : never;

// ── Inference through the builder, as an app writes it ────────────────────────
// `categoryIds` and `allocations` are the two schemas from the report verbatim.

const _outcome = ValidatorFacade.check({}, (r) => ({
  name: r.string(),
  age: r.number(),
  active: r.boolean(),
  createdAt: r.date(),
  categoryIds: r.array(r.number().positive()).max(60).optional(),
  allocations: r.array(r.object({ amount: r.number(), scope: r.string() })).optional(),
  matrix: r.array(r.array(r.number())),
  address: r.object({ street: r.string(), zip: r.string() }),
}));

type Data = DataOf<typeof _outcome>;

// Scalars — unchanged, and here so a rewrite of the conditional chain can't quietly
// break them while fixing the array branch.
assertType<Equals<Data["name"], string>>();
assertType<Equals<Data["age"], number>>();
assertType<Equals<Data["active"], boolean>>();
assertType<Equals<Data["createdAt"], Date>>();

assertType<Equals<Data["categoryIds"], number[]>>();
assertType<Equals<Data["allocations"], { amount: number; scope: string }[]>>();
assertType<Equals<Data["matrix"], number[][]>>();
assertType<Equals<Data["address"], { street: string; zip: string }>>();

// ── `in()` narrows a string to the listed values ───────────────────────────────
// Without this an app validates `status` against its statuses and then casts the
// result back to the status type before it can save it.

const STATUSES = ["planning", "active", "completed"] as const;
type Status = (typeof STATUSES)[number];
const looseList: string[] = ["a", "b"];

const _inOutcome = ValidatorFacade.check({}, (r) => ({
  inline: r.string().in(["draft", "active"]),
  asConst: r.string().in(STATUSES),
  spread: r.string().in([...STATUSES]),
  loose: r.string().in(looseList),
  nullable: r.string().in(STATUSES).nullable(),
  optional: r.string().trim().in(STATUSES).optional().max(20),
  required: r.required().in(STATUSES),
  listed: r.array(r.string().in(STATUSES)),
  nested: r.object({ status: r.string().in(STATUSES) }),
}));

type InData = DataOf<typeof _inOutcome>;

assertType<Equals<InData["inline"], "draft" | "active">>();
assertType<Equals<InData["asConst"], Status>>();
assertType<Equals<InData["spread"], Status>>();
assertType<Equals<InData["loose"], string>>();
assertType<Equals<InData["nullable"], Status>>();
assertType<Equals<InData["optional"], Status>>();
assertType<Equals<InData["required"], Status>>();
assertType<Equals<InData["listed"], Status[]>>();
assertType<Equals<InData["nested"], { status: Status }>>();

function _assignments(data: InData): void {
  const status: Status = data.asConst;
  // @ts-expect-error — "draft" is not one of the listed statuses.
  const wrong: "draft" = data.asConst;
  // @ts-expect-error — a narrowed value is not assignable from another literal.
  data.inline = "archived";
  void status;
  void wrong;
}
void _assignments;

// ── Runtime: the inferred type matches what validation actually returns ───────

describe("Infer<> — array and object", () => {
  it("returns array items the inferred element type can be used as", () => {
    const result = ValidatorFacade.check({ categoryIds: [1, 2, 3] }, (r) => ({
      categoryIds: r.array(r.number().positive()).max(60).optional(),
    }));

    expect(result.success).toBe(true);
    if (!result.success) return;

    // The line from the report: `.map` on `data.categoryIds ?? []`. This is the
    // assertion — it is a compile error when `Infer<>` regresses to `unknown`.
    const doubled = (result.data.categoryIds ?? []).map((id) => id * 2);
    expect(doubled).toEqual([2, 4, 6]);
  });

  it("returns an in() value usable as the literal union", () => {
    const result = ValidatorFacade.check({ status: "active" }, (r) => ({
      status: r.string().in(STATUSES),
    }));

    expect(result.success).toBe(true);
    if (!result.success) return;

    const status: Status = result.data.status;
    expect(status).toBe("active");
  });

  it("still rejects a value outside an in() list", () => {
    const result = ValidatorFacade.check({ status: "archived" }, (r) => ({
      status: r.string().in(STATUSES),
    }));

    expect(result.success).toBe(false);
  });

  it("returns nested object fields at their inferred types", () => {
    const result = ValidatorFacade.check({ allocations: [{ amount: 10, scope: "food" }] }, (r) => ({
      allocations: r.array(r.object({ amount: r.number(), scope: r.string() })).optional(),
    }));

    expect(result.success).toBe(true);
    if (!result.success) return;

    const total = (result.data.allocations ?? []).reduce((sum, a) => sum + a.amount, 0);
    expect(total).toBe(10);
    expect((result.data.allocations ?? [])[0]?.scope.toUpperCase()).toBe("FOOD");
  });
});
