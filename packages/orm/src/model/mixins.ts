// ── Model mixins ──────────────────────────────────────────────────────────────
//
// Mixin composition machinery for the ORM. The entry point is `Model.using(...)`
// (see BaseModel.ts) — this module owns the types it is built from, and the fold
// itself. Nothing here imports `BaseModel`: the fold seeds from its receiver, so
// this is a leaf module.
//
// `Model.using(...)` composes any number of model mixins, so packages can ship
// reusable model behaviour (auth contract, roles, permissions, soft deletes, …)
// that apps stack without "wrapper hell":
//
//   // before — nested, base repeated, order reads inside-out
//   class User extends Roles(Permissions(AuthUser)) {}
//
//   // after — flat, left-to-right, base baked in
//   class User extends Model.using(Authenticatable, Permissions, Roles) {}
//
// A mixin is the canonical generic form `(<T>(Base: T) => class extends Base { … })`.
// Because each one returns `class extends Base`, the base's full static surface
// (`User.query()`, `find()`, `create()`, scopes, …) and every mixin's instance
// members flow through to the final class — fully type-checked.

/** A concrete class constructor. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic mixin base bound
export type Constructor<T = object> = new (...args: any[]) => T;

/**
 * A model mixin: receives a base constructor and returns an extended one. Authors
 * write the generic form so the mixin composes onto whatever base it is given:
 *
 *   export const SoftDeletes = <T extends Constructor>(Base: T) =>
 *     class extends Base { … };
 */
export type Mixin<TIn extends Constructor = Constructor, TOut extends Constructor = Constructor> = (
  Base: TIn,
) => TOut;

/**
 * The call signatures behind `Model.using(...)`.
 *
 * Each overload threads the accumulated type through every step, so the composed class carries
 * the base's full static surface plus every mixin's instance and static members — fully
 * type-checked. The `this: TBase` parameter is what makes the base polymorphic: `using` composes
 * onto whatever class it is called on, not onto a hardcoded `BaseModel`.
 *
 * Overloads cover 1–8 mixins. There is no ceiling: the composed class carries `using` too, so
 * `Model.using(a, b).using(c, d)` chains.
 */
export interface Compose {
  <TBase extends Constructor, A extends Constructor>(this: TBase, a: (base: TBase) => A): A;
  <TBase extends Constructor, A extends Constructor, B extends Constructor>(
    this: TBase,
    a: (base: TBase) => A,
    b: (base: A) => B,
  ): B;
  <TBase extends Constructor, A extends Constructor, B extends Constructor, C extends Constructor>(
    this: TBase,
    a: (base: TBase) => A,
    b: (base: A) => B,
    c: (base: B) => C,
  ): C;
  <
    TBase extends Constructor,
    A extends Constructor,
    B extends Constructor,
    C extends Constructor,
    D extends Constructor,
  >(
    this: TBase,
    a: (base: TBase) => A,
    b: (base: A) => B,
    c: (base: B) => C,
    d: (base: C) => D,
  ): D;
  <
    TBase extends Constructor,
    A extends Constructor,
    B extends Constructor,
    C extends Constructor,
    D extends Constructor,
    E extends Constructor,
  >(
    this: TBase,
    a: (base: TBase) => A,
    b: (base: A) => B,
    c: (base: B) => C,
    d: (base: C) => D,
    e: (base: D) => E,
  ): E;
  <
    TBase extends Constructor,
    A extends Constructor,
    B extends Constructor,
    C extends Constructor,
    D extends Constructor,
    E extends Constructor,
    F extends Constructor,
  >(
    this: TBase,
    a: (base: TBase) => A,
    b: (base: A) => B,
    c: (base: B) => C,
    d: (base: C) => D,
    e: (base: D) => E,
    f: (base: E) => F,
  ): F;
  <
    TBase extends Constructor,
    A extends Constructor,
    B extends Constructor,
    C extends Constructor,
    D extends Constructor,
    E extends Constructor,
    F extends Constructor,
    G extends Constructor,
  >(
    this: TBase,
    a: (base: TBase) => A,
    b: (base: A) => B,
    c: (base: B) => C,
    d: (base: C) => D,
    e: (base: D) => E,
    f: (base: E) => F,
    g: (base: F) => G,
  ): G;
  <
    TBase extends Constructor,
    A extends Constructor,
    B extends Constructor,
    C extends Constructor,
    D extends Constructor,
    E extends Constructor,
    F extends Constructor,
    G extends Constructor,
    H extends Constructor,
  >(
    this: TBase,
    a: (base: TBase) => A,
    b: (base: A) => B,
    c: (base: B) => C,
    d: (base: C) => D,
    e: (base: D) => E,
    f: (base: E) => F,
    g: (base: F) => G,
    h: (base: G) => H,
  ): H;
}

/**
 * The fold behind {@link Compose}: apply each mixin left-to-right, seeding from `this` (the
 * class `using` was called on). Assigned to `BaseModel.using` — not exported publicly.
 *
 * @internal
 */
export const _compose = function (
  this: Constructor,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- variadic mixin folder
  ...mixins: Array<(base: any) => Constructor>
): Constructor {
  return mixins.reduce<Constructor>((acc, mixin) => mixin(acc), this);
} as Compose;
