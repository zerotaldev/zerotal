import { makeRelationDecorator } from "./_registerRelation.ts";

/** Options for {@link manyToMany}. */
export interface ManyToManyOptions {
  /** Name of the pivot (join) table (e.g. `role_user`). */
  pivotTable: string;
  /** Pivot column referencing this (parent) model (e.g. `user_id`). */
  pivotForeignKey: string;
  /** Pivot column referencing the related model (e.g. `role_id`). */
  pivotRelatedKey: string;
  /** Parent local key the pivot FK references. Defaults to `'id'`. */
  localKey?: string;
  /** Related local key the pivot relatedKey references. Defaults to `'id'`. */
  relatedKey?: string;
  /** Extra pivot columns to hydrate onto each related model's `pivot` bag. */
  withPivot?: string[];
  /** Maintain created_at / updated_at on the pivot table during attach/sync. */
  withTimestamps?: boolean;
}

/**
 * Declare a many-to-many relation through a pivot table (e.g. `User` ↔ `Role`
 * via `role_user`). The relation property is a {@link ManyToMany} collection that
 * behaves as an array yet also exposes pivot methods (`attach` / `detach` /
 * `sync` / `toggle`).
 *
 * @param related - Lazy factory returning the related model class.
 * @param options - Pivot table and key configuration.
 * @category Relationships
 *
 * @example
 * ```ts
 * class User extends BaseModel {
 *   \@manyToMany(() => Role, {
 *     pivotTable: 'role_user',
 *     pivotForeignKey: 'user_id',
 *     pivotRelatedKey: 'role_id',
 *   })
 *   roles!: ManyToMany<Role>;
 * }
 * ```
 */
export function manyToMany(related: () => unknown, options: ManyToManyOptions) {
  return makeRelationDecorator(() => ({
    type: "manyToMany" as const,
    related,
    foreignKey: options.pivotForeignKey,
    localKey: options.localKey ?? "id",
    pivotTable: options.pivotTable,
    pivotForeignKey: options.pivotForeignKey,
    pivotRelatedKey: options.pivotRelatedKey,
    ...(options.withPivot ? { pivotColumns: options.withPivot } : {}),
    ...(options.withTimestamps ? { pivotTimestamps: options.withTimestamps } : {}),
  }));
}
