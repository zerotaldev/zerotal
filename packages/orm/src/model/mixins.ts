// ── Model mixins ──────────────────────────────────────────────────────────────
//
// `BaseModelWith(...)` composes any number of model mixins on top of `BaseModel`,
// so packages can ship reusable model behaviour (auth contract, roles, permissions,
// soft deletes, …) that apps stack without "wrapper hell":
//
//   // before — nested, base repeated, order reads inside-out
//   class User extends Roles(Permissions(AuthUser)) {}
//
//   // after — flat, left-to-right, base baked in
//   class User extends BaseModelWith(Authenticatable, Permissions, Roles) {}
//
// A mixin is the canonical generic form `(<T>(Base: T) => class extends Base { … })`.
// Because each one returns `class extends Base`, BaseModel's full static surface
// (`User.query()`, `find()`, `create()`, scopes, …) and every mixin's instance
// members flow through to the final class — fully type-checked.

import { BaseModel } from "./BaseModel.ts";

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

type Base = typeof BaseModel;

// Typed overloads (1–8 mixins) thread the accumulated type through each step so the
// result is `BaseModel`'s statics + every mixin's members. Need more? Nest a
// `BaseModelWith(...)` call or add another overload.

/**
 * Compose any number of model {@link Mixin | mixins} on top of {@link BaseModel},
 * folding them left-to-right so the resulting class carries `BaseModel`'s full
 * static surface (`query()`, `find()`, `create()`, scopes, …) plus every mixin's
 * instance and static members — all fully type-checked.
 *
 * Prefer this over hand-nesting mixins (`Roles(Permissions(AuthUser))`), which
 * reads inside-out and repeats the base. Each overload (1–20 mixins) threads the
 * accumulated type through every step; for more, nest a second `BaseModelWith(...)`.
 *
 * @param mixins - Mixin factories applied in order; each receives the class the
 *   previous one produced.
 * @returns A model class extending `BaseModel` with every mixin applied.
 *
 * @example
 * ```ts
 * class User extends BaseModelWith(Authenticatable, Permissions, Roles) {}
 * ```
 */
export function BaseModelWith<A extends Constructor>(a: (base: Base) => A): A;
export function BaseModelWith<A extends Constructor, B extends Constructor>(
  a: (base: Base) => A,
  b: (base: A) => B,
): B;
export function BaseModelWith<A extends Constructor, B extends Constructor, C extends Constructor>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
): C;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
>(a: (base: Base) => A, b: (base: A) => B, c: (base: B) => C, d: (base: C) => D): D;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
): E;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
  F extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
  f: (base: E) => F,
): F;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
  F extends Constructor,
  G extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
  f: (base: E) => F,
  g: (base: F) => G,
): G;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
  F extends Constructor,
  G extends Constructor,
  H extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
  f: (base: E) => F,
  g: (base: F) => G,
  h: (base: G) => H,
): H;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
  F extends Constructor,
  G extends Constructor,
  H extends Constructor,
  I extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
  f: (base: E) => F,
  g: (base: F) => G,
  h: (base: G) => H,
  i: (base: H) => I,
): I;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
  F extends Constructor,
  G extends Constructor,
  H extends Constructor,
  I extends Constructor,
  J extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
  f: (base: E) => F,
  g: (base: F) => G,
  h: (base: G) => H,
  i: (base: H) => I,
  j: (base: I) => J,
): J;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
  F extends Constructor,
  G extends Constructor,
  H extends Constructor,
  I extends Constructor,
  J extends Constructor,
  K extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
  f: (base: E) => F,
  g: (base: F) => G,
  h: (base: G) => H,
  i: (base: H) => I,
  j: (base: I) => J,
  k: (base: J) => K,
): K;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
  F extends Constructor,
  G extends Constructor,
  H extends Constructor,
  I extends Constructor,
  J extends Constructor,
  K extends Constructor,
  L extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
  f: (base: E) => F,
  g: (base: F) => G,
  h: (base: G) => H,
  i: (base: H) => I,
  j: (base: I) => J,
  k: (base: J) => K,
  l: (base: K) => L,
): L;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
  F extends Constructor,
  G extends Constructor,
  H extends Constructor,
  I extends Constructor,
  J extends Constructor,
  K extends Constructor,
  L extends Constructor,
  M extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
  f: (base: E) => F,
  g: (base: F) => G,
  h: (base: G) => H,
  i: (base: H) => I,
  j: (base: I) => J,
  k: (base: J) => K,
  l: (base: K) => L,
  m: (base: L) => M,
): M;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
  F extends Constructor,
  G extends Constructor,
  H extends Constructor,
  I extends Constructor,
  J extends Constructor,
  K extends Constructor,
  L extends Constructor,
  M extends Constructor,
  N extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
  f: (base: E) => F,
  g: (base: F) => G,
  h: (base: G) => H,
  i: (base: H) => I,
  j: (base: I) => J,
  k: (base: J) => K,
  l: (base: K) => L,
  m: (base: L) => M,
  n: (base: M) => N,
): N;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
  F extends Constructor,
  G extends Constructor,
  H extends Constructor,
  I extends Constructor,
  J extends Constructor,
  K extends Constructor,
  L extends Constructor,
  M extends Constructor,
  N extends Constructor,
  O extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
  f: (base: E) => F,
  g: (base: F) => G,
  h: (base: G) => H,
  i: (base: H) => I,
  j: (base: I) => J,
  k: (base: J) => K,
  l: (base: K) => L,
  m: (base: L) => M,
  n: (base: M) => N,
  o: (base: N) => O,
): O;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
  F extends Constructor,
  G extends Constructor,
  H extends Constructor,
  I extends Constructor,
  J extends Constructor,
  K extends Constructor,
  L extends Constructor,
  M extends Constructor,
  N extends Constructor,
  O extends Constructor,
  P extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
  f: (base: E) => F,
  g: (base: F) => G,
  h: (base: G) => H,
  i: (base: H) => I,
  j: (base: I) => J,
  k: (base: J) => K,
  l: (base: K) => L,
  m: (base: L) => M,
  n: (base: M) => N,
  o: (base: N) => O,
  p: (base: O) => P,
): P;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
  F extends Constructor,
  G extends Constructor,
  H extends Constructor,
  I extends Constructor,
  J extends Constructor,
  K extends Constructor,
  L extends Constructor,
  M extends Constructor,
  N extends Constructor,
  O extends Constructor,
  P extends Constructor,
  Q extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
  f: (base: E) => F,
  g: (base: F) => G,
  h: (base: G) => H,
  i: (base: H) => I,
  j: (base: I) => J,
  k: (base: J) => K,
  l: (base: K) => L,
  m: (base: L) => M,
  n: (base: M) => N,
  o: (base: N) => O,
  p: (base: O) => P,
  q: (base: P) => Q,
): Q;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
  F extends Constructor,
  G extends Constructor,
  H extends Constructor,
  I extends Constructor,
  J extends Constructor,
  K extends Constructor,
  L extends Constructor,
  M extends Constructor,
  N extends Constructor,
  O extends Constructor,
  P extends Constructor,
  Q extends Constructor,
  R extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
  f: (base: E) => F,
  g: (base: F) => G,
  h: (base: G) => H,
  i: (base: H) => I,
  j: (base: I) => J,
  k: (base: J) => K,
  l: (base: K) => L,
  m: (base: L) => M,
  n: (base: M) => N,
  o: (base: N) => O,
  p: (base: O) => P,
  q: (base: P) => Q,
  r: (base: Q) => R,
): R;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
  F extends Constructor,
  G extends Constructor,
  H extends Constructor,
  I extends Constructor,
  J extends Constructor,
  K extends Constructor,
  L extends Constructor,
  M extends Constructor,
  N extends Constructor,
  O extends Constructor,
  P extends Constructor,
  Q extends Constructor,
  R extends Constructor,
  S extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
  f: (base: E) => F,
  g: (base: F) => G,
  h: (base: G) => H,
  i: (base: H) => I,
  j: (base: I) => J,
  k: (base: J) => K,
  l: (base: K) => L,
  m: (base: L) => M,
  n: (base: M) => N,
  o: (base: N) => O,
  p: (base: O) => P,
  q: (base: P) => Q,
  r: (base: Q) => R,
  s: (base: R) => S,
): S;
export function BaseModelWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
  E extends Constructor,
  F extends Constructor,
  G extends Constructor,
  H extends Constructor,
  I extends Constructor,
  J extends Constructor,
  K extends Constructor,
  L extends Constructor,
  M extends Constructor,
  N extends Constructor,
  O extends Constructor,
  P extends Constructor,
  Q extends Constructor,
  R extends Constructor,
  S extends Constructor,
  T extends Constructor,
>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
  d: (base: C) => D,
  e: (base: D) => E,
  f: (base: E) => F,
  g: (base: F) => G,
  h: (base: G) => H,
  i: (base: H) => I,
  j: (base: I) => J,
  k: (base: J) => K,
  l: (base: K) => L,
  m: (base: L) => M,
  n: (base: M) => N,
  o: (base: N) => O,
  p: (base: O) => P,
  q: (base: P) => Q,
  r: (base: Q) => R,
  s: (base: R) => S,
  t: (base: S) => T,
): T;

// Implementation: fold the mixins over BaseModel, left to right. The base param is
// `any` so each typed overload above (whose base is the narrower `typeof BaseModel`
// or a prior mixin's result) stays assignable to this implementation signature.
export function BaseModelWith(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- variadic mixin folder
  ...mixins: Array<(base: any) => Constructor>
): Constructor {
  return mixins.reduce<Constructor>(
    (acc, mixin) => mixin(acc),
    BaseModel as unknown as Constructor,
  );
}
