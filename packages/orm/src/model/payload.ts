// ── RelationBrand — nominal marker for "this property is a related model" ────

/**
 * Structural shape carried by every `BaseModel` (via its phantom `__isZerotalModel`
 * brand). We detect relation properties by this single marker instead of
 * `extends BaseModel`, because matching against the full `BaseModel` structure
 * drags in its `fill(data: UpdatePayload<this>)` method — whose type loops back
 * through `ColumnKeys`. For mutually-referential models (A.b: B, B.a: A) that
 * feedback loop never bottoms out and TS reports TS2615. Resolving one branded
 * property does not, so the cycle is broken. See `BaseModel.__isZerotalModel`.
 */
type RelationBrand = { readonly __isZerotalModel: true };

// ── WritableKeys — exclude getter-only computed properties ───────────────────

/**
 * Detect whether property K of T is writable (plain field or has a setter).
 * Readonly getter-only properties resolve to `never` so they are excluded.
 *
 * Technique: compare { [P in K]: T[P] } against { -readonly [P in K]: T[P] }
 * using TypeScript's structural equality check.  They match only when K is
 * not readonly.
 */
type IfEquals<X, Y, A = X, B = never> =
  (<G>() => G extends X ? 1 : 2) extends <G>() => G extends Y ? 1 : 2 ? A : B;

type WritableKeys<T> = {
  [K in keyof T]-?: IfEquals<{ [P in K]: T[P] }, { -readonly [P in K]: T[P] }, K, never>;
}[keyof T];

// ── ColumnKeys — the set of properties that map to actual DB columns ─────────

/**
 * Columns automatically managed by the ORM or the database engine.
 * Excluded from both InsertPayload and UpdatePayload.
 */
type AutoManagedKeys = "id" | "createdAt" | "updatedAt" | "deletedAt";

/**
 * Extract the property keys of T that represent actual database columns.
 *
 * A key is a column key when ALL of the following hold:
 *  - It is writable (not a getter-only computed property)
 *  - It does not start with `_` (internal ORM bookkeeping)
 *  - Its non-null value does NOT extend BaseModel or BaseModel[]
 *    (i.e. it is not a relation — BelongsTo, HasMany, ManyToMany, etc.)
 *  - Its value is not a function / method
 *
 * This correctly INCLUDES:
 *  - Primitive columns:  string, number, boolean
 *  - Date columns:       Date, Carbon (Carbon is a standalone class, not Date)
 *  - JSON columns:       Record<string, unknown>, any[] of non-model values
 *  - Nullable variants:  string | null, Carbon | null, etc.
 *
 * And correctly EXCLUDES:
 *  - Relation properties typed as Post[], User, ManyToMany<Tag>, …
 *  - Methods (save, delete, toJSON, …)
 *  - Internal fields (_exists, _original, _zerotal_*)
 *  - Getter-only computed properties (isVerified, isPublished, …)
 */

type ColumnKeys<T> = WritableKeys<T> &
  {
    [K in keyof T & string]-?: K extends `_${string}`
      ? never
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        T[K] extends (...args: any[]) => any
        ? never
        : NonNullable<T[K]> extends RelationBrand | RelationBrand[]
          ? never
          : K;
  }[keyof T & string];

// ── Public payload types ──────────────────────────────────────────────────────

/**
 * Data shape required to create a new model record.
 *
 * - Retains all writable column properties, including Carbon dates and JSON
 *   columns, while stripping relations, methods, computed getters, and the
 *   ORM-managed fields (id, createdAt, updatedAt, deletedAt).
 * - Preserves required (`name!: string`) vs optional (`role?: string`)
 *   exactly as declared on the model — no manual DTO needed.
 *
 * @example
 * // In a controller:
 * const user = await User.create(await ctx.body<InsertPayload<User>>());
 *
 * // Alias pattern (recommended — keeps controllers clean):
 * export type NewUser = InsertPayload<User>;
 * const user = await User.create({ name: "Alice", email: "alice@example.com", password: "…" });
 */
export type InsertPayload<T> = Omit<Pick<T, ColumnKeys<T>>, AutoManagedKeys>;

/**
 * The insert payload narrowed to a model's mass-assignable columns.
 *
 * `create()` funnels into `fill()`, which throws {@link MassAssignmentError} for any key
 * outside `fillable`. Without this narrowing the type demands fields the runtime forbids:
 * a non-optional column deliberately kept out of `fillable` — a compliance flag that must
 * never come from a request body — is *required* by `InsertPayload`, and supplying it
 * throws. There was no way to satisfy both.
 *
 * `Fillable` is inferred from the model's `static fillable`. Declare it `as const` (or as
 * a literal tuple) and the payload becomes exactly the assignable columns: the flag is no
 * longer required, and passing it is a compile error rather than a runtime one. When
 * `fillable` is absent or widened to `string[]`, `Fillable` is `string` and the payload is
 * the unnarrowed {@link InsertPayload}, so existing models are unaffected.
 *
 * @example
 * class Customer extends BaseModel {
 *   static fillable = ['name', 'email'] as const;
 *   @column() name!: string;
 *   @column() email!: string;
 *   @column({ type: 'boolean', cast: 'boolean', default: false }) legalHold!: boolean;
 * }
 *
 * await Customer.create({ name: 'Ada', email: 'ada@example.com' }); // ok — legalHold not required
 * await Customer.create({ name: 'Ada', email: 'a@b.c', legalHold: true }); // compile error
 */
export type FillablePayload<T, Fillable extends string> = string extends Fillable
  ? InsertPayload<T>
  : Pick<InsertPayload<T>, Extract<keyof InsertPayload<T>, Fillable>>;

/**
 * Data shape accepted when updating an existing record.
 * Every field is optional — pass only what should change.
 *
 * @example
 * const user = await User.findOrFail(ctx.integer("id"));
 * await user.update(await ctx.body<UpdatePayload<User>>());
 *
 * // Alias pattern:
 * export type UserPatch = UpdatePayload<User>;
 */
export type UpdatePayload<T> = Partial<InsertPayload<T>>;

/**
 * Union of all data-column property names on a model class.
 *
 * Re-exported here as a convenience alongside InsertPayload / UpdatePayload.
 * Primary definition lives in BaseModel.ts.
 */
export type { Columns } from "./BaseModel.ts";
