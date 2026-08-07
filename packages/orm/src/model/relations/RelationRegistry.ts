/** Discriminator for every relation kind the ORM supports. */
export type RelationType =
  | "hasMany"
  | "belongsTo"
  | "hasOne"
  | "manyToMany"
  | "morphTo"
  | "morphMany"
  | "morphOne"
  | "hasManyThrough"
  | "hasOneThrough"
  | "morphToMany"
  | "morphedByMany";

/**
 * Normalized descriptor for a single relation, produced by a relation decorator
 * and stored in the {@link relationRegistry}. The {@link ModelQueryBuilder} reads
 * it to build eager-load, existence and aggregate queries. Which fields are
 * meaningful depends on {@link RelationMetadata.type | type} (see the per-field
 * notes below).
 */
export interface RelationMetadata {
  type: RelationType;
  related: () => unknown;
  foreignKey: string;
  localKey: string;
  /** manyToMany only */
  pivotTable?: string;
  /** manyToMany only */
  pivotForeignKey?: string;
  /** manyToMany only */
  pivotRelatedKey?: string;
  /** morphTo only: maps type discriminator string → model factory */
  morphMap?: Record<string, () => unknown>;
  /** morphMany / morphOne / morphTo: the _type column name (e.g. "commentable_type") */
  morphTypeColumn?: string;

  // ── has*Through ─────────────────────────────────────────────────────────────
  /** Intermediate ("through") model factory. */
  through?: () => unknown;
  /** FK on the through table pointing back to the parent (e.g. country_id on users). */
  firstKey?: string;
  /** FK on the related table pointing to the through model (e.g. user_id on posts). */
  secondKey?: string;
  /** Local key on the through model the related FK references. Defaults to 'id'. */
  throughLocalKey?: string;

  // ── manyToMany / morphToMany pivot enrichment ───────────────────────────────
  /** Extra pivot columns to hydrate onto each related model's `pivot` bag. */
  pivotColumns?: string[];
  /** Maintain created_at / updated_at on the pivot table during attach/sync. */
  pivotTimestamps?: boolean;
  /** Constant pivot constraints applied to loads and writes: [column, value][]. */
  pivotWheres?: Array<[string, unknown]>;
  /** morphToMany / morphedByMany: the pivot _type column name. */
  pivotMorphType?: string;
  /** morphToMany / morphedByMany: the _type value stored for this side. */
  pivotMorphValue?: string;

  // ── belongsTo ───────────────────────────────────────────────────────────────
  /** belongsTo withDefault: true, an attributes object, or a builder callback. */
  withDefault?: boolean | Record<string, unknown> | ((model: unknown) => void);
}

/** Alias for RelationMetadata — preferred name going forward. */
export type RelationDefinition = RelationMetadata;

/**
 * Global registry of relation metadata, keyed by model constructor then by
 * relation (property) name. Populated by the relation decorators at class-definition
 * time and consulted by {@link ModelQueryBuilder} when resolving a relation.
 */
export const relationRegistry = new Map<Function, Map<string, RelationMetadata>>();

// ── Pivot collection ─────────────────────────────────────────────────────────

/**
 * Return type for manyToMany relation properties. Extends Array<T> so every
 * array operation (map, filter, for-of, spread, destructuring) works without
 * casting, while adding fully-typed pivot manipulation methods.
 *
 * On an unloaded model the pivot methods (attach / detach / sync / toggle)
 * still function — they hit the DB directly using the parent's primary key.
 * Array access on an unloaded relation throws RelationNotLoadedError.
 */
export interface ManyToMany<T> extends Array<T> {
  /** Insert pivot rows linking the parent to the given related id(s). Ignores duplicates. */
  attach(id: number | number[], pivotData?: Record<string, unknown>): Promise<void>;
  /** Remove pivot rows for the given related id(s), or all rows if omitted. */
  detach(id?: number | number[]): Promise<void>;
  /** Replace all pivot rows with exactly the given related ids. */
  sync(ids: number[]): Promise<void>;
  /** Attach ids that are missing; detach ids that already exist. */
  toggle(id: number | number[]): Promise<void>;
  /** Attach ids without detaching existing ones (no duplicates created). */
  syncWithoutDetaching(ids: number[]): Promise<void>;
  /** Update extra pivot columns on an existing pivot row. */
  updateExistingPivot(id: number, pivotData: Record<string, unknown>): Promise<void>;
}

// ── Relation marker types (used as property annotations: `posts!: HasMany<Post>`) ─

export declare const __relation__: unique symbol;

/**
 * Property annotation for a {@link hasMany} relation. A phantom marker: once the
 * relation is eager-loaded (via `.with()`), {@link WithLoaded} resolves the
 * property to a concrete `T[]`.
 */
export interface HasMany<T> {
  [__relation__]: "hasMany";
  __type__: T;
}

/**
 * Property annotation for a {@link belongsTo} relation. A phantom marker resolved
 * by {@link WithLoaded} to `T | null` once eager-loaded.
 */
export interface BelongsTo<T> {
  [__relation__]: "belongsTo";
  __type__: T;
}

/**
 * Property annotation for a {@link hasOne} relation. A phantom marker resolved by
 * {@link WithLoaded} to `T | null` once eager-loaded.
 */
export interface HasOne<T> {
  [__relation__]: "hasOne";
  __type__: T;
}

/**
 * Property annotation for a {@link morphTo} (inverse polymorphic) relation. A
 * phantom marker resolved by {@link WithLoaded} to `T | null` once eager-loaded.
 */
export interface MorphTo<T> {
  [__relation__]: "morphTo";
  __type__: T;
}

/**
 * Property annotation for a {@link morphMany} (polymorphic one-to-many) relation.
 * A phantom marker resolved by {@link WithLoaded} to `T[]` once eager-loaded.
 */
export interface MorphMany<T> {
  [__relation__]: "morphMany";
  __type__: T;
}

/**
 * Property annotation for a {@link morphOne} (polymorphic one-to-one) relation. A
 * phantom marker resolved by {@link WithLoaded} to `T | null` once eager-loaded.
 */
export interface MorphOne<T> {
  [__relation__]: "morphOne";
  __type__: T;
}

// ── WithLoaded ───────────────────────────────────────────────────────────────

/**
 * Narrows the model type M after calling .with(relation).
 * ManyToMany<T> is preserved as-is (keeps pivot methods).
 * Phantom types HasMany/BelongsTo/HasOne are resolved to their concrete forms.
 * Concrete types (e.g. User, Comment[]) are passed through unchanged.
 */
export type WithLoaded<M, R extends keyof M> = Omit<M, R> & {
  [K in R]: M[K] extends ManyToMany<infer T>
    ? ManyToMany<T>
    : M[K] extends HasMany<infer T>
      ? T[]
      : M[K] extends BelongsTo<infer T>
        ? T | null
        : M[K] extends HasOne<infer T>
          ? T | null
          : M[K] extends MorphTo<infer T>
            ? T | null
            : M[K] extends MorphMany<infer T>
              ? T[]
              : M[K] extends MorphOne<infer T>
                ? T | null
                : M[K];
};
