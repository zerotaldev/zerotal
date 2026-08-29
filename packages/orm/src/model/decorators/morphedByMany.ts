import { makeRelationDecorator } from "./_registerRelation.ts";

export interface MorphedByManyOptions {
  /** Morph name — the pivot `{name}_id` / `{name}_type` columns describe the related side. */
  morphName: string;
  /** FK on the pivot referencing the parent model (e.g. 'tag_id'). */
  parentPivotKey: string;
  /** Pivot table name. Defaults to `{morphName}s`. */
  pivotTable?: string | undefined;
  withPivot?: string[] | undefined;
  withTimestamps?: boolean | undefined;
}

/**
 * Declare a polymorphic many-to-many from the "inverse" side: the shared model
 * reaches back to each of the owning types through the same morph pivot table
 * (e.g. `Tag` —(taggables)→ `Post` / `Video`). The property is a
 * {@link ManyToMany} collection with pivot methods.
 *
 * @param related - Lazy factory returning the related (owning) model class.
 * @param options - Morph name, parent pivot key, and optional pivot config.
 * @category Relationships
 *
 * @example
 * ```ts
 * class Tag extends BaseModel {
 *   \@morphedByMany(() => Post, { morphName: 'taggable', parentPivotKey: 'tag_id' })
 *   posts!: ManyToMany<Post>;
 * }
 * ```
 */
export function morphedByMany(related: () => unknown, options: MorphedByManyOptions) {
  const pivotTable = options.pivotTable ?? `${options.morphName}s`;
  return makeRelationDecorator(() => ({
    type: "morphedByMany" as const,
    related,
    pivotTable,
    pivotForeignKey: options.parentPivotKey,
    pivotRelatedKey: `${options.morphName}_id`,
    pivotMorphType: `${options.morphName}_type`,
    foreignKey: options.parentPivotKey,
    localKey: "id",
    ...(options.withPivot ? { pivotColumns: options.withPivot } : {}),
    ...(options.withTimestamps ? { pivotTimestamps: options.withTimestamps } : {}),
  }));
}
