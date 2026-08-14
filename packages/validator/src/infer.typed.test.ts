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
