import { makeRelationDecorator } from "./_registerRelation.ts";

export interface MorphToManyOptions {
  /** Morph name — prefix for the pivot `{name}_id` / `{name}_type` columns (e.g. 'taggable'). */
  morphName: string;
  /** FK on the pivot table referencing the related model (e.g. 'tag_id'). */
  relatedPivotKey: string;
  /** Pivot table name. Defaults to `{morphName}s`. */
  pivotTable?: string | undefined;
  /** Extra pivot columns to hydrate. */
  withPivot?: string[] | undefined;
  /** Maintain pivot timestamps. */
  withTimestamps?: boolean | undefined;
}

/**
 * Declare a polymorphic many-to-many from the "owning" side: several parent types
 * share one pivot table that carries a `_type` discriminator, linking each to the
 * related model (e.g. `Post` / `Video` —(taggables)→ `Tag`). The property is a
 * {@link ManyToMany} collection with pivot methods.
 *
 * @param related - Lazy factory returning the related model class.
 * @param options - Morph name, related pivot key, and optional pivot config.
 * @category Relationships
 *
 * @example
 * ```ts
 * class Post extends BaseModel {
 *   \@morphToMany(() => Tag, { morphName: 'taggable', relatedPivotKey: 'tag_id' })
 *   tags!: ManyToMany<Tag>;
 * }
 * ```
 */
export function morphToMany(related: () => unknown, options: MorphToManyOptions) {
  const pivotTable = options.pivotTable ?? `${options.morphName}s`;
  return makeRelationDecorator((ctor) => ({
    type: "morphToMany" as const,
    related,
    pivotTable,
    pivotForeignKey: `${options.morphName}_id`,
    pivotRelatedKey: options.relatedPivotKey,
    pivotMorphType: `${options.morphName}_type`,
    pivotMorphValue: ctor.name,
    foreignKey: `${options.morphName}_id`,
    localKey: "id",
    ...(options.withPivot ? { pivotColumns: options.withPivot } : {}),
    ...(options.withTimestamps ? { pivotTimestamps: options.withTimestamps } : {}),
  }));
}
