// ── Component mixins ────────────────────────────────────────────────────────
//
// Mixin composition machinery for Flow. The entry point is `Component.using(...)`
// (see Component.ts) — this module owns the types it is built from, and the fold
// itself. Nothing here imports `Component`: the fold seeds from its receiver, so
// this is a leaf module.
//
// A Component mixin is the canonical generic form below — note it extends an ABSTRACT
// base and returns an `abstract class`, so it doesn't have to implement Component's
// abstract `render()` (the final page supplies it):
//
//   // app/flow/mixins/file-upload.ts
//   import { Component, expose, type Constructor } from "@zerotal/flow";
//
//   export function FileUpload<T extends Constructor<Component>>(Base: T) {
//     abstract class WithUpload extends Base {
//       @expose uploading = false;
//       @expose async upload() { … }
//     }
//     return WithUpload;
//   }
//
// Compose them onto a page with `Component.using(FileUpload, …)`.

/**
 * A class constructor. Abstract-aware (`abstract new …`) so the abstract `Component` base —
 * and mixin classes that don't yet implement `render()` — satisfy it. Use `Constructor<Component>`
 * as a mixin's base bound to require a Component lineage.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic mixin base bound
export type Constructor<T = object> = abstract new (...args: any[]) => T;

/**
 * A Component mixin: receives a base constructor and returns an extended one. Authors write
 * the generic form so the mixin composes onto whatever base it is given:
 *
 *   export function FileUpload<T extends Constructor<Component>>(Base: T) {
 *     abstract class WithUpload extends Base { … }
 *     return WithUpload;
 *   }
 */
export type Mixin<TIn extends Constructor = Constructor, TOut extends Constructor = Constructor> = (
  Base: TIn,
) => TOut;

/**
 * The call signatures behind `Component.using(...)`.
 *
 * Each overload threads the accumulated type through every step, so the composed class carries
 * the base's full surface plus every mixin's members — fully type-checked. The `this: TBase`
 * parameter is what makes the base polymorphic: `using` composes onto whatever class it is
 * called on, not onto a hardcoded `Component`.
 *
 * Overloads cover 1–8 mixins. There is no ceiling: the composed class carries `using` too, so
 * `Base.using(a, b).using(c, d)` chains.
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
 * class `using` was called on). Assigned to `Component.using` — not exported publicly.
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
