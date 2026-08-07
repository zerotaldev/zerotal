// ── Component mixins ────────────────────────────────────────────────────────
//
// `ComponentWith(...)` composes any number of feature mixins on top of `Component`,
// so a page can be broken into focused, reusable behaviours (pagination, file uploads,
// sortable tables, …) that stack left-to-right instead of bloating one class — the
// Flow counterpart of the ORM's `BaseModelWith(...)`:
//
//   // before — one class carrying every feature inline, base repeated per mixin
//   class UsersPage extends FileUploads(Pagination(Component)) { … }
//
//   // after — flat, left-to-right, base baked in
//   class UsersPage extends ComponentWith(Pagination, FileUploads) {
//     async render() { … }   // the page only owns its own markup + state
//   }
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
// Because each mixin returns `class extends Base`, Component's full surface (`flash()`,
// `redirect()`, `validate()`, the `this.set`/`refresh`/… client magics, …) and every other
// mixin's members flow through to the final page — fully type-checked. The shipped
// `Pagination` mixin (see ./pagination.ts) is written exactly this way and composes here:
// `ComponentWith(Pagination)`.
//
// Mixin `@expose`/`@locked` props register on the mixin's prototype, which sits in the page's
// prototype chain — so they're discovered at runtime exactly like props declared on the page
// itself (snapshot, reactivity, client writes, `@url` sync all work). Note: pages composed
// with `ComponentWith(...)` render via the runtime path rather than the AOT compiler (which
// only statically sees a page's own `extends Component` + locally-declared members) — the same
// fallback complex pages already use; behaviour is identical, you just don't get the
// ahead-of-time compile step for that page.

import { Component } from "./Component.ts";

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

type Base = typeof Component;

/**
 * Compose one or more feature {@link Mixin}s onto {@link Component}, folding them left-to-right
 * so a page can be built from focused, reusable behaviours instead of one bloated class.
 *
 * @remarks
 * Each mixin receives the accumulated base and returns an extended class, so `Component`'s full
 * surface (`flash()`, `redirect()`, `validate()`, the client magics, …) and every mixin's
 * `@expose`/`@locked` members flow through to the final page — fully type-checked. Mixin props
 * register on the mixin prototype, which sits in the page's prototype chain, so snapshot,
 * reactivity, and client writes all work. Overloads cover 1–8 mixins; nest another
 * `ComponentWith(...)` call for more. Pages composed this way render via the runtime path rather
 * than the AOT compiler.
 *
 * @param mixins  mixin factories applied left-to-right (each takes the prior result as its base).
 * @returns a class extending `Component` with every mixin's members mixed in.
 *
 * @example
 * ```tsx
 * // app/flow/mixins/pagination.ts
 * import { Component, expose, type Constructor } from "@zerotal/flow";
 *
 * export function Pagination<T extends Constructor<Component>>(Base: T) {
 *   abstract class WithPagination extends Base {
 *     @expose page = 1;
 *     @expose next() { this.page++; }
 *   }
 *   return WithPagination;
 * }
 *
 * // app/flow/UsersPage.tsx
 * class UsersPage extends ComponentWith(Pagination) {
 *   override async render() {
 *     return <div data-flow-root>Page {this.page}</div>;
 *   }
 * }
 * ```
 */
export function ComponentWith<A extends Constructor>(a: (base: Base) => A): A;
export function ComponentWith<A extends Constructor, B extends Constructor>(
  a: (base: Base) => A,
  b: (base: A) => B,
): B;
export function ComponentWith<A extends Constructor, B extends Constructor, C extends Constructor>(
  a: (base: Base) => A,
  b: (base: A) => B,
  c: (base: B) => C,
): C;
export function ComponentWith<
  A extends Constructor,
  B extends Constructor,
  C extends Constructor,
  D extends Constructor,
>(a: (base: Base) => A, b: (base: A) => B, c: (base: B) => C, d: (base: C) => D): D;
export function ComponentWith<
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
export function ComponentWith<
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
export function ComponentWith<
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
export function ComponentWith<
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

// Implementation: fold the mixins over Component, left to right. The base param is `any` so
// each typed overload above (whose base is the narrower `typeof Component` or a prior mixin's
// result) stays assignable to this implementation signature.
export function ComponentWith(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- variadic mixin folder
  ...mixins: Array<(base: any) => Constructor>
): Constructor {
  return mixins.reduce<Constructor>(
    (acc, mixin) => mixin(acc),
    Component as unknown as Constructor,
  );
}
